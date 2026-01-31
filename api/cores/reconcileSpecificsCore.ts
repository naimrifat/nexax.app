import type { Response } from 'node-fetch'

export async function reconcileSpecificsCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  const current: any[] = Array.isArray(payload?.item_specifics) ? payload.item_specifics : []
  // Simple merge strategy: take current specs and, if ai suggestions exist, merge by name
  const ai = payload?.aiSpecifics ?? payload?.ai ?? []
  const aiMap = new Map<string, any>()
  if (Array.isArray(ai)) ai.forEach((s) => aiMap.set(String((s?.name ?? '').toString()).toLowerCase(), s.value))

  const merged = current.map((s) => {
    const key = String((s?.name ?? '').toString()).toLowerCase()
    if (aiMap.has(key)) {
      const v = aiMap.get(key)
      return { name: s?.name ?? key, value: v, multi: Array.isArray(v) }
    }
    return s
  })

  // If nothing present, provide an empty array to keep UI stable
  const item_specifics = merged.length ? merged : []
  return { ok: true, data: { item_specifics }, error: null, requestId: String(Date.now()) }
}
