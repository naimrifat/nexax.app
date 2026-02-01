export async function reconcileSpecificsCore(input: any) {
  const payload = (input && input.payload) || input
  const current = Array.isArray(payload?.item_specifics) ? payload.item_specifics : []
  const ai = Array.isArray(payload?.aiSpecifics) ? payload.aiSpecifics : []
  const aiMap = new Map<string, any>()
  for (const s of ai) aiMap.set(String((s?.name ?? '').toString()).toLowerCase(), (s as any).value)
  const merged = current.map((s: any) => {
    const key = String((s?.name ?? '').toString()).toLowerCase()
    if (aiMap.has(key)) {
      const v = aiMap.get(key)
      const isArray = Array.isArray(v)
      return { name: s?.name ?? key, value: v, multi: isArray }
    }
    return s
  })
  const item_specifics = merged.length ? merged : []
  return { ok: true, data: { item_specifics }, error: null, requestId: String(Date.now()) }
}
