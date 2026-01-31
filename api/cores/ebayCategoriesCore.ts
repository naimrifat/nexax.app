import categoriesByCid from './ebayCategoriesConfig'

export async function ebayCategoriesCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  const cid = String(payload?.categoryId ?? payload?.category_id ?? '').trim()

  const defaultAspects = [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
  ] as any[]

  const byCid = (categoriesByCid as any)[cid]
  const aspects = (Array.isArray(byCid) && byCid.length ? byCid : defaultAspects) as any[]

  return { ok: true, data: { categoryId: cid || '0', aspects }, error: null, requestId: String(Date.now()) }
}
