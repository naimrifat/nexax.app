import imageCompression from "browser-image-compression";

export type CompressedImageResult = {
  file: File;
  meta: {
    originalBytes: number;
    finalBytes: number;
    maxDimUsed: number;
    outputType: string;
  };
};

const CLOUDINARY_SAFE_BYTES = Math.floor(9.2 * 1024 * 1024); // 9.2MB buffer under 10MB
const DIM_FALLBACKS = [3072, 2560, 2048];
const QUALITY_HINT = 0.85;

function mb(n: number) {
  return (n / (1024 * 1024)).toFixed(2);
}

/**
 * Dimension-first compression to preserve small text (tags/labels).
 * Hard-blocks if it cannot get under the Cloudinary safe limit.
 */
export async function compressForUpload(file: File): Promise<CompressedImageResult> {
  const originalBytes = file.size;

  // Small files: keep unchanged (avoids unnecessary recompression)
  if (originalBytes <= 1.5 * 1024 * 1024) {
    return {
      file,
      meta: {
        originalBytes,
        finalBytes: originalBytes,
        maxDimUsed: 0,
        outputType: file.type || "unknown",
      },
    };
  }

  let best: File | null = null;
  let bestDim = DIM_FALLBACKS[0];

  for (const maxDim of DIM_FALLBACKS) {
    // Prefer WebP for size/quality
    const webp = await imageCompression(file, {
      maxWidthOrHeight: maxDim,
      useWebWorker: true,
      fileType: "image/webp",
      initialQuality: QUALITY_HINT,
      maxSizeMB: 12, // hint only; we enforce bytes ourselves
    });

    let candidate: File = webp;

    // Some images compress smaller as JPEG; try fallback if still too large
    if (candidate.size > CLOUDINARY_SAFE_BYTES) {
      const jpeg = await imageCompression(file, {
        maxWidthOrHeight: maxDim,
        useWebWorker: true,
        fileType: "image/jpeg",
        initialQuality: QUALITY_HINT,
        maxSizeMB: 12,
      });

      if (jpeg.size < candidate.size) candidate = jpeg;
    }

    if (!best || candidate.size < best.size) {
      best = candidate;
      bestDim = maxDim;
    }

    if (candidate.size <= CLOUDINARY_SAFE_BYTES) {
      return {
        file: candidate,
        meta: {
          originalBytes,
          finalBytes: candidate.size,
          maxDimUsed: maxDim,
          outputType: candidate.type || "unknown",
        },
      };
    }
  }

  // No silent fallback: block
  throw new Error(
    `This image is still too large after compression (${mb(best?.size ?? originalBytes)}MB). ` +
      `Please retake the photo at lower resolution or upload fewer photos.`
  );
}
