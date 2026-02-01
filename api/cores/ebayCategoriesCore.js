const categoriesByCid = require('./ebayCategoriesConfig.js')
export async function ebayCategoriesCore(input) {
  const payload = (input && input.payload) || input
  const cid = String(payload?.categoryId ?? payload?.category_id ?? '').trim()
  const defaultAspects = [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
  ]
  const byCid = (categoriesByCid || {})[cid]
  const aspects = byCid && byCid.length ? byCid : defaultAspects
  return { ok: true, data: { categoryId: cid || '0', aspects }, error: null, requestId: String(Date.now()) }
}
