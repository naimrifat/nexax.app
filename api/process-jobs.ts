import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
  maxDuration: 60,
};

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Simple endpoint auth:
 * - Set CRON_SECRET in env
 * - Call with header: x-cron-secret: <CRON_SECRET>
 * (Prevents random internet callers from flipping listings to published.)
 */
function requireCronSecret(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return; // If you don't set it, it won't block. Recommended to set.
  const got = (req.headers["x-cron-secret"] || "").toString();
  if (got !== secret) {
    const err = new Error("Unauthorized");
    (err as any).statusCode = 401;
    throw err;
  }
}

type JobRow = {
  id: string;
  listing_id: string;
  workspace_id: string;
  user_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  max_attempts: number;
  job_type: "publish";
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", requestId });
  }

  try {
    requireCronSecret(req);

    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Batch size controls how many jobs are processed per call
    const limitRaw = (req.query.limit || req.body?.limit || "10").toString();
    const limit = Math.max(1, Math.min(50, Number(limitRaw) || 10));

    // 1) Fetch candidate queued jobs (newest first; adjust if you prefer FIFO)
    const { data: candidates, error: fetchErr } = await supabase
      .from("listing_jobs")
      .select("id, listing_id, workspace_id, user_id, status, attempts, max_attempts, job_type, created_at")
      .eq("job_type", "publish")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (fetchErr) {
      return res.status(500).json({ error: "Failed to fetch queued jobs", requestId, details: fetchErr.message });
    }

    const jobs: JobRow[] = (candidates || []) as any;

    const results: Array<{
      jobId: string;
      listingId: string;
      outcome: "succeeded" | "failed" | "skipped";
      message?: string;
    }> = [];

    let processed = 0;

    // 2) Process sequentially to keep it simple and safe (avoid rate-limits later)
    for (const job of jobs) {
      // a) Claim job (best-effort lock): update only if still queued
      const startedAt = new Date().toISOString();

      const { data: claimed, error: claimErr } = await supabase
        .from("listing_jobs")
        .update({
          status: "running",
          started_at: startedAt,
          // increment attempts when starting
          attempts: (job.attempts ?? 0) + 1,
        })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();

      if (claimErr) {
        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "failed", message: "claim failed" });
        continue;
      }

      if (!claimed) {
        // Another worker likely claimed it
        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "skipped", message: "already claimed" });
        continue;
      }

      // b) Stub publish: mark listing as published with fake ids
      // IMPORTANT: This is intentionally fake. We'll replace with real eBay API calls later.
      const stubItemId = `STUB-${job.listing_id}`;
      const stubUrl = `https://www.ebay.com/itm/${stubItemId}`;

      const finishedAt = new Date().toISOString();

      try {
        // Update listing -> published
        const { error: listingUpdErr } = await supabase
          .from("listings")
          .update({
            status: "published",
            published_at: finishedAt,
            ebay_item_id: stubItemId,
            ebay_listing_url: stubUrl,
            last_publish_error: null,
            last_publish_error_details: null,
          })
          .eq("id", job.listing_id);

        if (listingUpdErr) {
          // If listing update fails, job must fail and listing stays draft by default
          throw new Error(`listing update failed: ${listingUpdErr.message}`);
        }

        // Mark job succeeded
        const { error: jobDoneErr } = await supabase
          .from("listing_jobs")
          .update({
            status: "succeeded",
            finished_at: finishedAt,
            result_json: {
              stub: true,
              ebay_item_id: stubItemId,
              ebay_listing_url: stubUrl,
            },
            error_message: null,
            error_json: null,
          })
          .eq("id", job.id);

        if (jobDoneErr) {
          // Listing already marked published; job update failed. Log and move on.
          console.error("[process-jobs] job success update failed", { requestId, jobId: job.id, jobDoneErr });
        }

        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "succeeded" });
        processed++;
      } catch (e: any) {
        const errMsg = e?.message || "Unknown error";
        const finishedFailAt = new Date().toISOString();

        // Mark job failed
        await supabase
          .from("listing_jobs")
          .update({
            status: "failed",
            finished_at: finishedFailAt,
            error_message: errMsg,
            error_json: { stub: true, stage: "stub_publish", message: errMsg },
          })
          .eq("id", job.id);

        // Keep listing in draft and record error (per your requirement)
        await supabase
          .from("listings")
          .update({
            status: "draft",
            last_publish_error: "Publish failed",
            last_publish_error_details: { stub: true, stage: "stub_publish", message: errMsg },
          })
          .eq("id", job.listing_id);

        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "failed", message: errMsg });
      }
    }

    return res.status(200).json({
      success: true,
      requestId,
      fetched: jobs.length,
      processed,
      results,
    });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return res.status(status).json({
      error: err?.message || "Internal server error",
      requestId,
    });
  }
}
