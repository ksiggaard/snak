// Client-side image preparation: downscale large images and re-encode to JPEG
// before sending to a provider, to bound token cost and request size.

export interface PreparedImage {
  /** MIME type of the encoded image, e.g. "image/jpeg". */
  mediaType: string;
  /** Base64 payload (no data: prefix) — what providers and the DB store. */
  base64: string;
  /** Full data URL, for thumbnail previews. */
  dataUrl: string;
}

const DEFAULT_MAX_DIM = 1568; // safe vision input size across providers
const JPEG_QUALITY = 0.85;

export async function prepareImage(
  file: Blob,
  maxDim = DEFAULT_MAX_DIM,
): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { mediaType: "image/jpeg", base64, dataUrl };
}
