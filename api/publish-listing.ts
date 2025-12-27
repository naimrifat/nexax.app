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
  value: string | string[];
  required?: boolean;
};

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBlobOrObjectUrl(u: string): boolean {
  const s = (u || '').trim().toLowerCase();
  return s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('file:');
}

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  try {
    const body: any = req.body || {};

    // Support BOTH:
    // 1) { listing_data: {...}, images: [...] }
    // 2) { title, description, category, item_specifics, image_urls }
    const listingData = body.listing_data || body;

    const title: string = listingData?.title ?? '';
    const description: string = listingData?.description ?? '';
    const category: Category | null = listingData?.category ?? null;

    const itemSpecifics: ItemSpecific[] = Array.isArray(listingData?.item_specifics)
      ? listingData.item_specifics
      : [];

    // Prefer "images" if present, else fall back to "image_urls"
    const rawImages = body?.images ?? body?.image_urls ?? listingData?.images ?? listingData?.image_urls ?? [];
    const incomingUrls = normalizeStringArray(rawImages);

    // Categorize URL issues
    const blobOrObjectUrls = incomingUrls.filter(isBlobOrObjectUrl);
    const nonHttpUrls = incomingUrls.filter((u) => !isBlobOrObjectUrl(u) && !isHttpUrl(u));

    // Valid hosted URLs only
    const imageUrls = incomingUrls.filter((u) => !isBlobOrObjectUrl(u) && isHttpUrl(u));

    const errors: string[] = [];

    if (!title.trim()) errors.push('Title is required.');
    if (!description.trim()) errors.push('Description is required.');
    if (!category || !category.id) errors.push('Category is required.');

    if (!Array.isArray(itemSpecifics)) {
      errors.push('item_specifics must be an array of { name, value }.');
    }

    // Image validation: fail loudly for blob/data/file URLs
    if (blobOrObjectUrls.length > 0) {
      errors.push(
        `Invalid image URL(s) received (blob/data/file URLs are not allowed). Please upload images to Cloudinary first.`
      );
    }

    if (nonHttpUrls.length > 0) {
      errors.push(`Invalid image URL(s) received (must be http/https).`);
    }

    if (!imageUrls.length) {
      errors.push('At least one hosted image URL is required.');
    }

    // Observability: log the essentials every time
    console.log('[publish-listing]', {
      requestId,
      titleLen: String(title || '').length,
      hasCategoryId: Boolean(category?.id),
      specificsCount: Array.isArray(itemSpecifics) ? itemSpecifics.length : 0,
      imagesReceivedCount: incomingUrls.length,
      imagesValidCount: imageUrls.length,
      blobOrObjectCount: blobOrObjectUrls.length,
      nonHttpCount: nonHttpUrls.length,
      sampleInvalidBlobOrObject: blobOrObjectUrls.slice(0, 2),
      sampleInvalidNonHttp: nonHttpUrls.slice(0, 2),
      sampleValid: imageUrls.slice(0, 2),
    });

    if (errors.length) {
      return res.status(400).json({
        error: 'Validation failed',
        requestId,
        details: errors,
        imageDiagnostics: {
          receivedCount: incomingUrls.length,
          validCount: imageUrls.length,
          blobOrObjectCount: blobOrObjectUrls.length,
          nonHttpCount: nonHttpUrls.length,
          sampleBlobOrObject: blobOrObjectUrls.slice(0, 2),
          sampleNonHttp: nonHttpUrls.slice(0, 2),
        },
      });
    }

    // NOTE: still a stub — we’re NOT calling eBay yet.
    const listingPayload = {
      title: title.trim(),
      description: description.trim(),
      category,
      item_specifics: itemSpecifics,
      image_urls: imageUrls, // canonical output
    };

    console.log('✅ Listing payload ready to send to eBay (stub):', {
      requestId,
      categoryId: category?.id,
      imageCount: imageUrls.length,
    });

    return res.status(200).json({
      success: true,
      requestId,
      message: 'Listing payload validated (stub).',
      data: listingPayload,
    });
  } catch (err: any) {
    console.error('❌ /api/publish-listing error:', { requestId, err });
    return res.status(500).json({
      error: 'Internal server error',
      requestId,
      details: err?.message || String(err),
    });
  }
}
