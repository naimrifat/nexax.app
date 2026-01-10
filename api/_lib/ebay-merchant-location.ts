// api/_lib/ebay-merchant-location.ts

type EbayEnv = "production" | "sandbox";

function ebayApiBase(env: EbayEnv) {
  return env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

async function ebayJsonOrText(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
}

/**
 * Ensures an eBay Inventory "merchant location" exists.
 *
 * - merchantLocationKey is stable and reused (idempotent)
 * - GET first. If 404, POST create.
 * - Success responses:
 *    GET: 200
 *    POST: 204 No Content
 */
export async function ensureMerchantLocation(params: {
  env: EbayEnv;
  accessToken: string;
  merchantLocationKey?: string; // default mainWarehouse
  // v1: hardcoded address; later: store workspace merchant address in DB
  address?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    stateOrProvince: string;
    postalCode: string;
    country: string; // "US"
  };
  requestId?: string;
}): Promise<{ merchantLocationKey: string; created: boolean }> {
  const base = ebayApiBase(params.env);
  const merchantLocationKey = params.merchantLocationKey || "mainWarehouse";

  const address = params.address || {
    addressLine1: "123 Main St",
    city: "San Jose",
    stateOrProvince: "CA",
    postalCode: "95125",
    country: "US",
  };

  const url = `${base}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`;

  // 1) Try GET
  const getRes = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Content-Language": "en-US",
    },
  });

  if (getRes.status === 200) {
    return { merchantLocationKey, created: false };
  }

  if (getRes.status !== 404) {
    const details = await ebayJsonOrText(getRes);
    console.error("[ensureMerchantLocation] GET failed", {
      requestId: params.requestId,
      status: getRes.status,
      details,
    });
    throw Object.assign(new Error("Failed to check eBay merchant location"), {
      code: "EBAY_LOCATION_CHECK_FAILED",
      statusCode: 502,
      details,
    });
  }

  // 2) Create with POST
  const payload: any = {
    name: "Main Warehouse",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
    location: {
      address,
    },
  };

  const postRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(payload),
  });

  // eBay returns 204 on success
  if (postRes.status === 204) {
    return { merchantLocationKey, created: true };
  }

  // If another concurrent request created it, eBay might return 409 sometimes; treat as OK if it does
  if (postRes.status === 409) {
    return { merchantLocationKey, created: false };
  }

  const details = await ebayJsonOrText(postRes);
  console.error("[ensureMerchantLocation] POST failed", {
    requestId: params.requestId,
    status: postRes.status,
    details,
  });

  throw Object.assign(new Error("Failed to create eBay merchant location"), {
    code: "EBAY_LOCATION_CREATE_FAILED",
    statusCode: 502,
    details,
  });
}
