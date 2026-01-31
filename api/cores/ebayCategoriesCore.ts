export async function ebayCategoriesCore(input: any): Promise<any> {
  const payload = input?.payload ?? input
  const cid = String(payload?.categoryId ?? payload?.category_id ?? '').trim()

  // Basic, category-aware aspects: provide a few representative fields per category when known
  const mapping: Record<string, Array<{ name: string; required?: boolean; multi?: boolean; type?: string; values?: string[] }>> = {
    // Clothing / Apparel
    '1000': [
      { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
      { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
      { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
      { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
    ],
    // Electronics
    '2000': [
      { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
      { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
      { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
      { name: 'Voltage', required: false, multi: false, type: 'FreeText', values: [] },
    ],
    // Default generic fields
  }

  const per = mapping[cid] ?? mapping[''] ?? [];
  const aspects = per.length ? per : [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
  ] as any[]

  return { ok: true, data: { categoryId: cid || '0', aspects }, error: null, requestId: String(Date.now()) }
}
