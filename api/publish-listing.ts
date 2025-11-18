// api/publish-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // Support both camelCase and Pascal/snake just in case
    const title: string = body.title ?? body.Title ?? '';
    const description: string = body.description ?? body.Description ?? '';

    const price: number | undefined =
      typeof body.price === 'number'
        ? body.price
        : typeof body.Price === 'number'
        ? body.Price
        : undefined;

    const currency: string = body.currency ?? body.Currency ?? 'USD';

    const quantity: number =
      typeof body.quantity === 'number'
        ? body.quantity
        : typeof body.Quantity === 'number'
        ? body.Quantity
        : 1;

    const category = body.category ?? body.Category ?? null;

    const itemSpecificsRaw = body.item_specifics ?? body.itemSpecifics ?? [];
    const imageUrlsRaw = body.image_urls ?? body.imageUrls ?? body.images ?? [];

    const errors: string[] = [];

    // Required fields
    if (!title.trim()) errors.push('Title is required.');
    if (!description.trim()) errors.push('Description is required.');
    if (!category) errors.push('Category is required.');

    // Item specifics must be an array of { name, value }
    let item_specifics: Array<{ name: string; value: any }> = [];
    if (!Array.isArray(itemSpecificsRaw)) {
      errors.push('item_specifics must be an array of { name, value }.');
    } else {
      item_specifics = itemSpecificsRaw
        .filter((s: any) => s && typeof s.name === 'string')
        .map((s: any) => ({
          name: String(s.name),
          value: s.value,
        }));
      if (item_specifics.length === 0) {
        errors.push('item_specifics must be an array of { name, value }.');
      }
    }

    // Image URLs
    const image_urls: string[] = Array.isArray(imageUrlsRaw)
      ? imageUrlsRaw.map((u: any) => String(u)).filter(Boolean)
      : [];

    if (image_urls.length === 0) {
      errors.push('At least one image URL is required.');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Clean payload ready for eBay (stub for now)
    const listingPayload = {
      title,
      description,
      price,
      currency,
      quantity,
      category,
      item_specifics,
      image_urls,
    };

    console.log(
      '📤 Ready to publish listing (stub):',
      JSON.stringify(listingPayload, null, 2)
    );

    return res.status(200).json({
      success: true,
      message: 'Listing payload validated and accepted (stub).',
      listingPayload,
    });
  } catch (err: any) {
    console.error('❌ publish-listing error:', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}
