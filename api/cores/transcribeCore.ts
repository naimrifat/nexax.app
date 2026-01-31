export async function transcribeCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  // Production-grade transcription would be invoked here. For now, provide a stable transcript.
  const transcript = 'transcript (phase-3-core)'
  return { ok: true, data: { text: transcript, payload }, error: null, requestId: String(Date.now()) }
}
