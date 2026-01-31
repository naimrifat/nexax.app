// Production-grade category to attribute mapping (sample baseline, expandable)
type Aspect = { name: string; required?: boolean; multi?: boolean; type?: string; values?: string[] }

export const categoriesByCid: Record<string, Aspect[]> = {
  // Default / generic
  '0': [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
  ],
  // Apparel example
  '1000': [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
  ],
  // Electronics example
  '2000': [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Voltage', required: false, multi: false, type: 'FreeText', values: [] },
  ],
}

export default categoriesByCid
