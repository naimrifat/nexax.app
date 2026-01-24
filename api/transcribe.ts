import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import FormData from 'form-data';
import fs from 'fs';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4']);

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseForm(req: VercelRequest): Promise<{ fields: any; files: any }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: MAX_BYTES,
      multiples: false,
      allowEmptyFiles: false,
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId });

  try {
    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized', requestId });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Transcription unavailable', requestId });
    }

    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;

    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    const u = await serviceClient
      .from('users')
      .select('workspace_id')
      .eq('auth_provider_user_id', user.id)
      .maybeSingle();

    if (u.error) return res.status(500).json({ error: 'Internal server error', requestId });
    const workspaceId = String((u.data as any)?.workspace_id || '').trim();

    const { fields, files } = await parseForm(req);
    const field = String((fields?.field?.[0] ?? fields?.field ?? '') || '').trim();
    const listingId = String((fields?.listing_id?.[0] ?? fields?.listing_id ?? '') || '').trim();

    if (field !== 'title' && field !== 'description') {
      return res.status(400).json({ error: 'Invalid field', requestId });
    }

    const audioFile = Array.isArray(files?.audio) ? files.audio[0] : files?.audio;
    if (!audioFile) {
      return res.status(400).json({ error: 'Missing audio', requestId });
    }

    const mimeType = String(audioFile.mimetype || '').toLowerCase();
    const size = Number(audioFile.size || 0);
    const filePath = String(audioFile.filepath || audioFile.filePath || audioFile.path || '').trim();
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid audio upload', requestId });
    }

    if (!ALLOWED_TYPES.has(mimeType)) {
      return res.status(415).json({ error: 'Unsupported audio type', requestId });
    }

    if (size > MAX_BYTES) {
      return res.status(413).json({ error: 'Audio file too large', requestId });
    }

    console.log('[transcribe]', {
      requestId,
      workspace_id: workspaceId || null,
      field,
      listing_id: listingId || null,
      size,
      mimeType,
    });

    const formData = new FormData();
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
    formData.append('file', fs.createReadStream(filePath), {
      filename: audioFile.originalFilename || 'dictation',
      contentType: mimeType,
    } as any);

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData as any,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[transcribe] openai failed', { requestId, status: resp.status, body: text.slice(0, 200) });
      return res.status(500).json({ error: 'Transcription failed', requestId });
    }

    const data: any = await resp.json().catch(() => ({}));
    const transcript = String(data?.text || '').trim();

    return res.status(200).json({ text: transcript, requestId });
  } catch (err: any) {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Audio file too large', requestId });
    }

    console.error('[transcribe] error', { requestId, message: String(err?.message || '') });
    return res.status(500).json({ error: 'Internal server error', requestId });
  }
}
