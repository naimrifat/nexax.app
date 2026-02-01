export async function transcribeCore(input) {
  const payload = (input && input.payload) || input
  if (!payload) return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  // Best effort: return a stable transcript; could hook real transcription later
  const transcript = 'transcript (phase-3-core)'
  return { ok: true, data: { text: transcript, payload }, error: null, requestId: String(Date.now()) }
}
