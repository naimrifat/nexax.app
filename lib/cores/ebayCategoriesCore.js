import categoriesByCid from './ebayCategoriesConfig.js'

let cachedAppToken = null

async function getEbayAppToken() {
  if (cachedAppToken && cachedAppToken.expires_at > Date.now()) return cachedAppToken.access_token

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

  cachedAppToken = {
    access_token: accessToken,
    expires_at: Date.now() + Math.max(0, (expiresIn - 300) * 1000),
  }

  return accessToken
}

async function ebayGetJsonOrNull(url, accessToken) {
  if (!accessToken) return null
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!resp.ok) return null
  return await resp.json().catch(() => null)
}

export async function ebayCategoriesCore(input) {
  const payload = (input && input.payload) || input
  const action = String(payload?.action || '').trim()

  if (action === 'getCategories') {
    const parentCategoryId = String(payload?.parentCategoryId ?? payload?.parent_category_id ?? '0').trim() || '0'

    try {
      const token = await getEbayAppToken()
      if (!token) {
        return {
          ok: true,
          data: { categories: [], items: [] },
          error: null,
          requestId: String(Date.now()),
        }
      }

      let parentIdToUse = parentCategoryId

      if (parentIdToUse === '0') {
        const root = await ebayGetJsonOrNull(
          'https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_root_category_node',
          token
        )
        const rid = String(root?.rootCategoryNode?.category?.categoryId || '').trim()
        if (rid) parentIdToUse = rid
      }

      const subtree = await ebayGetJsonOrNull(
        `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=${encodeURIComponent(
          parentIdToUse
        )}`,
        token
      )

      const children = Array.isArray(subtree?.categorySubtreeNode?.childCategoryTreeNodes)
        ? subtree.categorySubtreeNode.childCategoryTreeNodes
        : []

      const categories = children
        .map((n) => {
          const c = n?.category || {}
          return {
            categoryId: String(c.categoryId || ''),
            name: String(c.categoryName || ''),
            leafCategory: !!n?.leafCategoryTreeNode,
            parentCategoryId: String(parentIdToUse || parentCategoryId || '0'),
          }
        })
        .filter((c) => c.categoryId && c.name)

      return {
        ok: true,
        data: { categories, items: categories },
        error: null,
        requestId: String(Date.now()),
      }
    } catch {
      return { ok: true, data: { categories: [], items: [] }, error: null, requestId: String(Date.now()) }
    }
  }

  const cid = String(payload?.categoryId ?? payload?.category_id ?? '').trim()
  if (action === 'getCategorySpecifics' && cid) {
    const requestId = String(Date.now())
    try {
      const token = await getEbayAppToken()
      if (!token) {
        console.log('[ebay-categories] aspects', {
          requestId,
          categoryId: cid,
          categoryTreeId: null,
          ebayStatus: 401,
          aspectCount: 0,
        })
        return {
          ok: false,
          error: 'EBAY_ASPECTS_ERROR',
          status: 401,
          details: 'Missing eBay application token',
          requestId,
        }
      }

      const treeRes = await fetch(
        'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US',
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      )
      const treeText = await treeRes.text().catch(() => '')
      if (!treeRes.ok) {
        console.log('[ebay-categories] aspects', {
          requestId,
          categoryId: cid,
          categoryTreeId: null,
          ebayStatus: treeRes.status,
          aspectCount: 0,
        })
        return {
          ok: false,
          error: 'EBAY_ASPECTS_ERROR',
          status: treeRes.status,
          details: String(treeText || '').slice(0, 200),
          requestId,
        }
      }
      const treeJson = treeText ? JSON.parse(treeText) : {}
      const categoryTreeId = String(treeJson?.categoryTreeId || '').trim()
      if (!categoryTreeId) {
        console.log('[ebay-categories] aspects', {
          requestId,
          categoryId: cid,
          categoryTreeId: null,
          ebayStatus: 502,
          aspectCount: 0,
        })
        return {
          ok: false,
          error: 'EBAY_ASPECTS_ERROR',
          status: 502,
          details: 'Missing categoryTreeId',
          requestId,
        }
      }

      const aspectsRes = await fetch(
        `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
          categoryTreeId
        )}/get_item_aspects_for_category?category_id=${encodeURIComponent(cid)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      )
      const aspectsText = await aspectsRes.text().catch(() => '')
      if (!aspectsRes.ok) {
        console.log('[ebay-categories] aspects', {
          requestId,
          categoryId: cid,
          categoryTreeId,
          ebayStatus: aspectsRes.status,
          aspectCount: 0,
        })
        return {
          ok: false,
          error: 'EBAY_ASPECTS_ERROR',
          status: aspectsRes.status,
          details: String(aspectsText || '').slice(0, 200),
          requestId,
        }
      }

      const data = aspectsText ? JSON.parse(aspectsText) : {}
      const aspectGroups = Array.isArray(data?.aspectGroups) ? data.aspectGroups : []
      const aspects = aspectGroups
        .flatMap((g) => (Array.isArray(g?.aspects) ? g.aspects : []))
        .map((aspect) => {
          const name = String(aspect?.localizedAspectName || aspect?.aspectName || '').trim()
          if (!name) return null
          const values = Array.isArray(aspect?.aspectValues)
            ? aspect.aspectValues
                .map((v) => String(v?.localizedValue || v?.valueName || '').trim())
                .filter(Boolean)
            : []
          const mode = String(aspect?.aspectConstraint?.aspectMode || '').toUpperCase()
          const multi = mode === 'MULTI'
          const required = !!aspect?.aspectConstraint?.aspectRequired
          const selectionOnly = values.length > 0
          const freeTextAllowed = values.length === 0
          return {
            name,
            required,
            multi,
            type: selectionOnly ? 'SelectionOnly' : 'FreeText',
            selectionOnly,
            freeTextAllowed,
            values,
          }
        })
        .filter(Boolean)

      console.log('[ebay-categories] aspects', {
        requestId,
        categoryId: cid,
        categoryTreeId,
        ebayStatus: aspectsRes.status,
        aspectCount: aspects.length,
      })

      if (!aspects.length) {
        return {
          ok: false,
          error: 'EBAY_ASPECTS_EMPTY',
          status: 200,
          details: 'No aspects returned for category',
          requestId,
        }
      }

      return {
        ok: true,
        data: { categoryId: cid || '0', aspects },
        error: null,
        requestId,
      }
    } catch (err) {
      console.log('[ebay-categories] aspects', {
        requestId,
        categoryId: cid,
        categoryTreeId: null,
        ebayStatus: 500,
        aspectCount: 0,
      })
      return {
        ok: false,
        error: 'EBAY_ASPECTS_ERROR',
        status: 500,
        details: String(err?.message || 'Failed to fetch aspects').slice(0, 200),
        requestId,
      }
    }
  }
  const defaultAspects = [
    { name: 'Brand', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Model', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Color', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Size', required: false, multi: false, type: 'FreeText', values: [] },
    { name: 'Pattern', required: false, multi: false, type: 'FreeText', values: [] },
  ]
  const byCid = (categoriesByCid || {})[cid]
  const rawAspects = byCid && byCid.length ? byCid : defaultAspects
  const aspects = rawAspects
    .map((aspect) => {
      const name = String(aspect?.name || '').trim()
      if (!name) return null
      const values = Array.isArray(aspect?.values) ? aspect.values : []
      const type = String(aspect?.type || '')
      const selectionOnly = type === 'SelectionOnly'
      const freeTextAllowed = type !== 'SelectionOnly'
      return {
        name,
        required: !!aspect?.required,
        multi: !!aspect?.multi,
        type: type || (values.length ? 'SelectionOnly' : 'FreeText'),
        selectionOnly,
        freeTextAllowed,
        values,
      }
    })
    .filter(Boolean)
  return { ok: true, data: { categoryId: cid || '0', aspects }, error: null, requestId: String(Date.now()) }
}
