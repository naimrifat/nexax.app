export function normalizeSizeAlias(input) {
  const raw = String(input || '').trim()
  if (!raw) return { canonical: null, candidates: [] }

  const upper = raw.toUpperCase().replace(/\s+/g, ' ').trim()
  const trimmed = upper.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
  const compact = trimmed.replace(/[^A-Z0-9]/g, '')

  const candidates = []
  const pushUnique = (val) => {
    if (!val) return
    if (candidates.includes(val)) return
    candidates.push(val)
  }

  if (compact === 'SP' || compact === 'SML' || compact === 'SMALL') {
    pushUnique('S')
  } else if (compact === 'MD' || compact === 'MED' || compact === 'MEDIUM') {
    pushUnique('M')
  } else if (
    compact === 'LARGE' ||
    (compact.startsWith('LG') && /^[LG]+$/.test(compact))
  ) {
    pushUnique('L')
  } else if (compact === 'EXTRASMALL') {
    pushUnique('XS')
  } else if (compact === 'XL' || compact === 'XLARGE' || compact === 'EXTRALARGE') {
    pushUnique('XL')
  } else if (compact === 'XXL' || compact === 'XXLARGE' || compact === 'EXTRAEXTRALARGE') {
    pushUnique('2XL')
  } else if (compact === 'XXXL' || compact === 'XXXLARGE' || compact === 'EXTRAEXTRAEXTRALARGE') {
    pushUnique('3XL')
  } else if (compact === 'XXXXL') {
    pushUnique('4XL')
  }

  const multiX = compact.match(/^X{2,6}L$/)
  if (multiX) {
    const count = compact.length - 1
    pushUnique(`${count}XL`)
  }

  const digitX = compact.match(/^([2-6])X$/)
  if (digitX) {
    pushUnique(`${digitX[1]}XL`)
    pushUnique(`${digitX[1]}X`)
  }

  const canonical = candidates[0] || null
  return { canonical, candidates }
}
