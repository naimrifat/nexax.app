// api/publish-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 30,
};

// Types just for clarity – they won't affect runtime
type Category = {
  id: string;
  name: string;
  path?: string;
};

type ItemSpecific = {
  name: string;
  value: string | string[];
};

type PublishPayload = {
  title: string;
  description: string;
  price?: number;
  currency?: string;
  quantity?: number;
  category: Category | null;
  item_specifics: ItemSpecific[];
  image_urls: string[];
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isCategory(v: any): v is Category {
  return v && isNonEmptyString(v.id) && isNonEmptyString(v.name);
}

function isItemSpecificArray(v: any): v is ItemSpecific[] {
  return Array.isArray(v) && v.every((s) => s && isNonEmptyString(s.name));
}

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
    const body = req.body as PublishPayload | undefined;

    if (!body) {
      return res.status(400).json({ error: 'Missing request body' });
    }

    const {
      title,
      description,
      price,
      currency,
      quantity,
      category,
      item_specifics,
      image_urls,
    } = body;

    // Basic validation – this should mirror what you do on the frontend
    const errors: string[] = [];

    if (!isNonEmptyString(title)) errors.push('Title is required.');
    if (!isNonEmptyString(description)) errors.push('Description is required.');
    if (!isCategory(category)) errors.push('Category is required.');
    if (!isItemSpecificArray(item_specifics)) {
      errors.push('item_specifics must be an array of { name, value }.');
    }

    if (!Array.isArray(image_urls) || image_urls.length === 0) {
      errors.push('At least one image URL is required.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // Build a minimal "eBay-like" payload preview for the future real API integration
    const ebayPayloadPreview = {
      title: title.trim(),
      description: description.trim(),
      categoryId: category.id,
      categoryName: category.name,
      price: typeof price === 'number' ? price : undefined,
      currency: currency || 'USD',
      quantity: typeof quantity === 'number' && quantity > 0 ? quantity : 1,
      itemSpecifics: item_specifics.map((s) => ({
        name: s.name,
        value: s.value,
      })),
      pictures: image_urls,
    };

    // For now, this is just a stub: we do not actually call eBay.
    // You can check Vercel logs to confirm what is being sent.
    console.log('Received listing for publish (stub only):');
    console.log(JSON.stringify(ebayPayloadPreview, null, 2));

    // In the future, this is where you will:
    // - Construct the real eBay Trading API request (AddFixedPriceItem / ReviseFixedPriceItem).
    // - Make the HTTP call to eBay.
    // - Handle success / error responses and map them back to the client.

    return res.status(200).json({
      success: true,
      message: 'Listing received by nexax.app publish endpoint (stub). Not yet sent to eBay.',
      preview: ebayPayloadPreview,
    });
  } catch (err: any) {
    console.error('publish-listing error:', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error in publish-listing',
    });
  }
}
