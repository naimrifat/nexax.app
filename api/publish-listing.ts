// api/publish-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 60,
};

type Category = {
  id: string;
  name?: string;
  path?: string;
  [key: string]: any;
};

type ItemSpecific = {
  name: string;
  value: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body: any = req.body || {};

    // Support BOTH:
    // 1) { listing_data: {...}, images: [...] }
    // 2) { title, description, category, item_specifics, image_urls }
    const listingData = body.listing_data || body;

    const title: string = listingData.title ?? '';
    const description: string = listingData.description ?? '';
    const category: Category | null = listingData.category ?? null;
    const itemSpecifics: ItemSpecific[] = Array.isArray(listingData.item_specifics)
      ? listingData.item_specifics
      : [];

    const rawImages = body.images || body.image_urls || [];
    const imageUrls: string[] = Array.isArray(rawImages)
      ? rawImages.filter((u: any) => typeof u === 'string' && u.trim() !== '')
      : [];

    const errors: string[] = [];

    if (!title.trim()) errors.push('Title is required.');
    if (!description.trim()) errors.push('Description is required.');
    if (!category || !category.id) errors.push('Category is required.');

    if (!Array.isArray(itemSpecifics)) {
      errors.push('item_specifics must be an array of { name, value }.');
    }

    if (!imageUrls.length) {
      errors.push('At least one image URL is required.');
    }

    if (errors.length) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // NOTE: this is still a stub — we’re NOT calling eBay yet.
    // We just echo back the payload the way eBay would need it.
    const listingPayload = {
      title: title.trim(),
      description: description.trim(),
      category,
      item_specifics: itemSpecifics,
      image_urls: imageUrls,
      // You can tack on price/currency/etc later
    };

    console.log('✅ Listing payload ready to send to eBay:', listingPayload);

    return res.status(200).json({
      success: true,
      message: 'Listing payload validated (stub).',
      data: listingPayload,
    });
  } catch (err: any) {
    console.error('❌ /api/publish-listing error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: err?.message || String(err),
    });
  }
}
