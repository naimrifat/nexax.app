// Production-grade analyzeListing core (JS wrapper for runtime stability)
export async function analyzeListingCore(input) {
  const payload = (input && input.payload) || input
  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId: '0' }
  }
  const title = String(payload.title ?? 'Untitled Listing')
  const description = String(payload.description ?? '')
  let categoryId = String(payload.category_id ?? payload.categoryId ?? '')
  if (categoryId === '0') categoryId = ''
  let categoryName = String(payload.categoryName ?? '')
  let categoryPath = String(payload.category_path ?? payload.categoryPath ?? '')
  let item_specifics = []
  const rawSpecs = payload.item_specifics
  if (Array.isArray(rawSpecs)) {
    item_specifics = rawSpecs
  } else if (rawSpecs && typeof rawSpecs === 'object') {
    item_specifics = Object.entries(rawSpecs).map(([name, value]) => ({ name, value: value ?? '', multi: false }))
  }
  let keywords = []
  if (Array.isArray(payload.keywords)) keywords = payload.keywords
  else if (payload.keywords) keywords = [payload.keywords]
  async function getEbayAppToken() {
    if (getEbayAppToken.cached && getEbayAppToken.cached.expires_at > Date.now()) {
      return getEbayAppToken.cached.access_token
    }
    const clientId = process.env.EBAY_CLIENT_ID
    const clientSecret = process.env.EBAY_CLIENT_SECRET
    if (!clientId || !clientSecret) return ''
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const resp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${encoded}`,
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    })
    if (!resp.ok) return ''
    const data = await resp.json().catch(() => ({}))
    const accessToken = String(data?.access_token || '')
    const expiresIn = Number(data?.expires_in ?? 7200)
    if (!accessToken) return ''
    getEbayAppToken.cached = {
      access_token: accessToken,
      expires_at: Date.now() + Math.max(0, (expiresIn - 300) * 1000),
    }
    return accessToken
  }

  async function suggestCategory(query) {
    const token = await getEbayAppToken()
    if (!token) return null
    const treeRes = await fetch(
      'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US',
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )
    if (!treeRes.ok) return null
    const treeJson = await treeRes.json().catch(() => ({}))
    const categoryTreeId = String(treeJson?.categoryTreeId || '').trim()
    if (!categoryTreeId) return null
    const sugRes = await fetch(
      `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
        categoryTreeId
      )}/get_category_suggestions?q=${encodeURIComponent(String(query || '').trim())}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )
    if (!sugRes.ok) return null
    const sugJson = await sugRes.json().catch(() => ({}))
    const suggestions = Array.isArray(sugJson?.categorySuggestions)
      ? sugJson.categorySuggestions
      : []
    return suggestions[0] || null
  }

  if (!categoryId) {
    const detected = payload.detected || payload.ai?.detected || payload.analysis?.detected || {}
    const detectedQuery = [
      detected.brand,
      detected.type,
      detected.department,
      detected.color,
      detected.size,
    ]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(' ')

    let query = ''
    if (title && title !== 'Untitled Listing') query = title
    else if (keywords && keywords.length) query = keywords.join(' ')
    else if (detectedQuery) query = detectedQuery

    if (query) {
      const suggestion = await suggestCategory(query)
      const cat = suggestion?.category || {}
      const cid = String(cat?.categoryId || '').trim()
      const cname = String(cat?.categoryName || '').trim()
      if (cid && cid !== '0') {
        categoryId = cid
        categoryName = cname || categoryName
        const ancestors = Array.isArray(suggestion?.categoryTreeNodeAncestors)
          ? suggestion.categoryTreeNodeAncestors
          : []
        const pathParts = ancestors
          .map((a) => String(a?.categoryName || '').trim())
          .filter(Boolean)
        if (cname) pathParts.push(cname)
        if (pathParts.length) categoryPath = pathParts.join(' > ')
      }
    }
  }

  if (!categoryId) {
    categoryName = ''
    categoryPath = ''
  }

  const data = {
    title,
    description,
    category: { id: categoryId, name: categoryName, path: categoryPath },
    category_id: categoryId || null,
    category_path: categoryId ? categoryPath || null : null,
    item_specifics,
    keywords,
  }
  return { ok: true, data, error: null, requestId: String(Date.now()) }
}
