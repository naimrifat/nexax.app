import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safeJSON<T = any>(txt: string, fallback: T): T {
  try {
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

function clipInstruction(v: unknown, max: number): string {
  const s = String(v ?? '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

async function fetchWorkspaceListingStyle(params: {
  userClient: any;
  workspaceId: string;
}): Promise<
  | {
      enabled: boolean;
      title_instructions: string;
      description_instructions: string;
      extra_rules: string;
    }
  | null
> {
  const wsId = String(params.workspaceId || '').trim();
  if (!wsId) return null;

  const q = await params.userClient
    .from('workspace_listing_style')
    .select('enabled,title_instructions,description_instructions,extra_rules')
    .eq('workspace_id', wsId)
    .maybeSingle();

  if (q.error) throw q.error;
  const row: any = q.data || null;
  if (!row) return null;

  return {
    enabled: Boolean(row.enabled),
    title_instructions: String(row.title_instructions || ''),
    description_instructions: String(row.description_instructions || ''),
    extra_rules: String(row.extra_rules || ''),
  };
}

async function callOpenAIChat(body: any) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI API error: ${r.status} ${await r.text()}`);
  return r.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId });

  try {
    const body: any = req.body || {};
    const listingId = String(body.listing_id || '').trim();
    const feedback = String(body.feedback || '').trim();
    const targets = {
      title: Boolean(body?.targets?.title),
      description: Boolean(body?.targets?.description),
      specifics: Boolean(body?.targets?.specifics),
    };

    if (!listingId) return res.status(400).json({ error: 'Missing listing_id', requestId });
    if (feedback.length < 10) return res.status(400).json({ error: 'Feedback too short', requestId });
    if (!targets.title && !targets.description && !targets.specifics) {
      return res.status(400).json({ error: 'Select at least one target', requestId });
    }

    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized', requestId });

    const userClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized', requestId });

    const u = await serviceClient
      .from('users')
      .select('workspace_id')
      .eq('auth_provider_user_id', user.id)
      .maybeSingle();

    if (u.error) return res.status(500).json({ error: 'Internal server error', requestId });
    const userWorkspaceId = String((u.data as any)?.workspace_id || '').trim();
    if (!userWorkspaceId) return res.status(403).json({ error: 'Unauthorized workspace', requestId });

    const listingResp = await serviceClient
      .from('listings')
      .select('id,workspace_id,listing_json,category_id')
      .eq('id', listingId)
      .maybeSingle();

    if (listingResp.error || !listingResp.data) {
      return res.status(404).json({ error: 'Listing not found', requestId });
    }

    if (String((listingResp.data as any)?.workspace_id || '').trim() !== userWorkspaceId) {
      return res.status(403).json({ error: 'Unauthorized listing', requestId });
    }

    const current = body.current || {};

    let listingStyleInstructions = '';
    try {
      const wsStyle = await fetchWorkspaceListingStyle({ userClient, workspaceId: userWorkspaceId });
      if (wsStyle?.enabled) {
        const title = clipInstruction(wsStyle.title_instructions, 800);
        const desc = clipInstruction(wsStyle.description_instructions, 1200);
        const extra = clipInstruction(wsStyle.extra_rules, 800);
        const lines: string[] = [];
        lines.push('STYLE (apply ONLY to writing style/structure; never invent facts; never include secrets):');
        if (title) lines.push('STYLE_TITLE_INSTRUCTIONS:\n' + title);
        if (desc) lines.push('STYLE_DESCRIPTION_INSTRUCTIONS:\n' + desc);
        if (extra) lines.push('STYLE_EXTRA_RULES:\n' + extra);
        listingStyleInstructions = lines.join('\n\n');
      }
    } catch {
      listingStyleInstructions = '';
    }

    const prompt = `
${listingStyleInstructions ? listingStyleInstructions + '\n\n' : ''}You are given CURRENT_LISTING and user FEEDBACK.

Rules:
- Modify ONLY the fields where targets.<field> is true.
- Keep all other fields unchanged.
- If targets.specifics=false, item_specifics must be identical to CURRENT_LISTING.item_specifics.
- Do not change category, images, policies, merchant location, or pricing unless explicitly requested AND targets allow it.

FEEDBACK:
${feedback}

TARGETS:
${JSON.stringify(targets)}

CURRENT_LISTING:
${JSON.stringify(current, null, 2)}

Return a single JSON object with this schema:
{
  "title": "...",
  "description": "...",
  "condition_intent": "NEW_WITH_TAGS|NEW_WITH_BOX|NEW_OTHER|USED_EXCELLENT|USED_GOOD|USED_FAIR|UNKNOWN",
  "detected": {},
  "keywords": ["..."],
  "item_specifics": [{ "name": "...", "value": "..." }]
}
`;

    const response = await callOpenAIChat({
      model: 'gpt-5.1',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert eBay lister. Modify only the requested fields. Keep all other fields unchanged. Output JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const parsed = safeJSON<any>(response.choices?.[0]?.message?.content || '{}', {});

    const currentTitle = String(current.title || '');
    const currentDescription = String(current.description || '');
    const currentKeywords = current.keywords ?? [];
    const currentSpecifics = Array.isArray(current.item_specifics) ? current.item_specifics : [];
    const currentIntent = String(current.condition_intent || 'UNKNOWN');

    if (!targets.title) parsed.title = currentTitle;
    if (!targets.description) parsed.description = currentDescription;
    if (!targets.specifics) parsed.item_specifics = currentSpecifics;
    if (!Array.isArray(parsed.item_specifics)) parsed.item_specifics = currentSpecifics;
    if (!Array.isArray(parsed.keywords)) parsed.keywords = currentKeywords;
    if (!parsed.condition_intent) parsed.condition_intent = currentIntent;
    if (!parsed.title) parsed.title = currentTitle;
    if (!parsed.description) parsed.description = currentDescription;

    return res.status(200).json({
      success: true,
      requestId,
      data: parsed,
    });
  } catch (err: any) {
    console.error('❌ /api/rebuild-listing error:', { requestId, err });
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      requestId,
    });
  }
}
