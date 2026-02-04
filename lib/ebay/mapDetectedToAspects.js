function norm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeValue(v) {
  return norm(v)
}

function normalizeSizeToken(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchAllowed(value, allowed) {
  const map = new Map(allowed.map((v) => [normalizeValue(v), v]))
  return map.get(normalizeValue(value)) || ''
}

function matchAllowedMulti(values, allowed) {
  const map = new Map(allowed.map((v) => [normalizeValue(v), v]))
  return values
    .map((v) => map.get(normalizeValue(v)) || '')
    .filter(Boolean)
}

function inferSizeTypeValue(sizeRaw, allowed) {
  const size = normalizeSizeToken(sizeRaw)
  const allowedMap = new Map(allowed.map((v) => [normalizeValue(v), v]))

  if (size.includes('PET') || size.includes('PETITE')) {
    return allowedMap.get('petite') || ''
  }

  if (size.includes('TALL') || size.includes('XLT') || size.includes('2XLT') || size.includes('3XLT')) {
    return allowedMap.get('big tall') || allowedMap.get('big & tall') || allowedMap.get('tall') || ''
  }

  return allowedMap.get('regular') || ''
}

function normalizeCandidateArray(input) {
  if (Array.isArray(input)) return input.map((v) => String(v || '').trim()).filter(Boolean)
  const s = String(input || '').trim()
  return s ? [s] : []
}

function candidateForAspect(name, detected) {
  const key = norm(name)
  if (!key) return null

  if (key.includes('brand')) return detected.brand
  if (key.includes('size type')) return detected.sizeTypeHint
  if (key === 'size' || key.includes('size')) return detected.size
  if (key.includes('color') || key.includes('colour')) return Array.isArray(detected.colors) ? detected.colors[0] : detected.colors
  if (key.includes('material')) {
    return (
      (Array.isArray(detected.materials) ? detected.materials[0] : detected.materials) ||
      detected.outerShellMaterial ||
      detected.liningMaterial ||
      ''
    )
  }
  if (key.includes('department')) return detected.department
  if (key === 'style' || key.includes('style')) return detected.style
  if (key === 'type') return detected.type
  if (key.includes('pattern')) return detected.pattern
  if (key.includes('theme')) return detected.theme
  if (key.includes('feature')) return detected.features
  if (key.includes('country') && key.includes('origin')) return detected.countryOfOrigin
  if (key.includes('country') && key.includes('manufacture')) return detected.countryOfOrigin
  if (key === 'model' || key.includes('model')) return detected.model
  if (key === 'mpn' || key.includes('mpn')) return detected.mpn
  if (key.includes('sleeve') && key.includes('length')) return detected.sleeveLength
  if (key === 'fit' || key.includes('fit')) return detected.fit
  if (key.includes('fabric type')) return detected.fabricType

  return null
}

export function mapDetectedToAspects({ detected, aspects }) {
  const out = []
  const det = detected || {}
  const list = Array.isArray(aspects) ? aspects : []

  for (const aspect of list) {
    const name = String(aspect?.name || '').trim()
    if (!name) continue

    const selectionOnly = !!aspect?.selectionOnly || aspect?.freeTextAllowed === false
    const freeTextAllowed = aspect?.freeTextAllowed !== false && !selectionOnly
    const multi = !!aspect?.multi
    const allowed = Array.isArray(aspect?.values) ? aspect.values : []

    let candidate = candidateForAspect(name, det)
    if (candidate == null || candidate === '') continue

    if (norm(name).includes('size type')) {
      if (selectionOnly && allowed.length) {
        const inferred = inferSizeTypeValue(det.size || det.sizeTypeHint || '', allowed)
        if (inferred) out.push({ name, value: inferred })
      } else if (freeTextAllowed) {
        const inferred = inferSizeTypeValue(det.size || det.sizeTypeHint || '', allowed)
        if (inferred) out.push({ name, value: inferred })
        else if (det.sizeTypeHint) out.push({ name, value: String(det.sizeTypeHint) })
      }
      continue
    }

    if (norm(name).includes('size') && selectionOnly && allowed.length) {
      const raw = normalizeSizeToken(det.size || '')
      const exact = matchAllowed(raw, allowed)
      if (exact) {
        out.push({ name, value: exact })
        continue
      }

      let sizeToken = raw
      if (sizeToken.includes('PET')) {
        sizeToken = sizeToken.replace(/\bPETITE\b|\bPET\b/g, '').trim()
      }
      const first = sizeToken.split(' ')[0] || ''
      const fallback = matchAllowed(first, allowed)
      if (fallback) out.push({ name, value: fallback })
      continue
    }

    if (selectionOnly && allowed.length) {
      if (multi) {
        const rawVals = normalizeCandidateArray(candidate).slice(0, 5)
        const matched = matchAllowedMulti(rawVals, allowed)
        if (matched.length) out.push({ name, value: matched })
      } else {
        const matched = matchAllowed(String(candidate || ''), allowed)
        if (matched) out.push({ name, value: matched })
      }
      continue
    }

    if (freeTextAllowed) {
      if (multi) {
        const rawVals = normalizeCandidateArray(candidate).slice(0, 5)
        if (rawVals.length) out.push({ name, value: rawVals })
      } else {
        const value = String(candidate || '').trim()
        if (value) out.push({ name, value })
      }
    }
  }

  return out
}
