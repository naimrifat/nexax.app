export async function transcribeCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  // Minimal transcription path; defer actual 3rd party call to a later phase
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  // Return a dummy transcript to keep UI functional during migration
  const transcript = 'transcript (phase-3-core)';
  return { ok: true, data: { text: transcript, ...payload }, error: null, requestId: String(Date.now()) }
}
