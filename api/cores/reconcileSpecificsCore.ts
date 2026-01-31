import type { Response } from 'node-fetch'

export async function reconcileSpecificsCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  const current: any[] = Array.isArray(payload?.item_specifics) ? payload.item_specifics : []
  // Merge ai suggestions by name, preserve user edits where present
  const ai: any[] = Array.isArray(payload?.aiSpecifics) ? payload.aiSpecifics : ([] as any[])
  const aiMap = new Map<string, any>()
  for (const s of ai) aiMap.set(String((s?.name ?? '').toString()).toLowerCase(), s.value)

  const merged = current.map((s) => {
    const key = String((s?.name ?? '').toString()).toLowerCase()
    if (aiMap.has(key)) {
      const v = aiMap.get(key)
      // Normalize value type
      const isArray = Array.isArray(v)
      return { name: s?.name ?? key, value: v, multi: isArray }
    }
    return s
  })

  // If nothing present, provide an empty array to keep UI stable
  const item_specifics = merged.length ? merged : []
  return { ok: true, data: { item_specifics }, error: null, requestId: String(Date.now()) }
}
