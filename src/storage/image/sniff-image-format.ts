import sharp from 'sharp';
import { unsupportedImageFormat } from '../errors/unsupported-image-format.error';

/**
 * Raster formats `sharp` (libvips) can DECODE that we accept as image
 * uploads. Encoding is always WebP regardless — see `ImageProcessor`.
 * `sharp` reports both HEIC and HEIF as `'heif'`.
 */
const DECODABLE_RASTER_FORMATS: ReadonlySet<string> = new Set([
  'jpeg',
  'png',
  'webp',
  'gif',
  'heif',
  'avif',
  'tiff',
]);

/**
 * GOS-70 — the real, bytes-based format check. Reads only the header via
 * `sharp().metadata()` (cheap, no full decode) and returns the detected
 * format string, or throws `unsupportedImageFormat()` (HTTP 415) when the
 * bytes are not a raster image we can process. The client's declared
 * `Content-Type` is never consulted here.
 */
export async function sniffImageFormat(bytes: Buffer): Promise<string> {
  let format: string | undefined;
  try {
    format = (await sharp(bytes).metadata()).format;
  } catch {
    throw unsupportedImageFormat();
  }
  if (!format || !DECODABLE_RASTER_FORMATS.has(format)) {
    throw unsupportedImageFormat();
  }
  return format;
}
