import { Injectable } from '@angular/core';

/** The server's limit is 5,000,000 bytes; aim below it with headroom. */
export const TARGET_MAX_BYTES = 4_000_000;

/** Longest edge after downscaling. A licence stays legible well below this. */
export const MAX_EDGE_PX = 2000;

/**
 * Quality ladder. Each rung is tried in order until the result fits.
 *
 * It stops at 0.4 rather than continuing down: below that a photographed licence
 * starts losing small print, and shipping an illegible document that a reviewer then
 * rejects is worse than telling the clinician to retake it.
 */
export const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4] as const;

export interface RasterImage {
  width: number;
  height: number;
}

/**
 * The browser primitives this needs, injected so the stepping logic can be tested
 * without a canvas — jsdom has neither `createImageBitmap` nor a real 2D context.
 */
export interface ImageCodec {
  decode(blob: Blob): Promise<RasterImage>;
  encode(image: RasterImage, width: number, height: number, quality: number): Promise<Blob>;
}

export interface CompressionResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  /** True when even the lowest quality rung did not fit. */
  overTarget: boolean;
}

/**
 * Re-encodes a captured image to a JPEG the server will accept.
 *
 * <h3>Why every capture is re-encoded, even one that looks fine</h3>
 * Four things fall out of a single canvas round-trip, and each is required:
 *
 * 1. **The output is guaranteed `image/jpeg`.** `OnboardingDocumentResource` allows
 *    exactly PDF, PNG and JPEG *and* verifies the magic bytes against the declared
 *    content type. A file that merely claims to be a JPEG is rejected.
 * 2. **HEIC becomes JPEG.** iOS captures HEIC by default and the server does not
 *    accept it. The WebView can decode HEIC; canvas emits JPEG.
 * 3. **EXIF is dropped, including GPS.** A canvas re-encode carries no metadata
 *    forward. Photographing a licence at home should not attach the clinician's home
 *    coordinates to a record an administrator will read.
 * 4. **Orientation is baked in.** EXIF rotation is applied during decode, so a
 *    portrait photo does not arrive sideways in the review queue.
 *
 * The size ladder is the fifth reason, and the least interesting one.
 */
@Injectable({ providedIn: 'root' })
export class ImageCompressor {
  /**
   * @param targetBytes stop once the result is under this
   * @returns the smallest acceptable encoding, plus whether it still exceeds target
   */
  async compress(blob: Blob, codec: ImageCodec, targetBytes = TARGET_MAX_BYTES): Promise<CompressionResult> {
    const image = await codec.decode(blob);
    const { width, height } = fitWithin(image.width, image.height, MAX_EDGE_PX);

    let last: Blob | null = null;
    let lastQuality = QUALITY_STEPS[QUALITY_STEPS.length - 1];

    for (const quality of QUALITY_STEPS) {
      const encoded = await codec.encode(image, width, height, quality);
      last = encoded;
      lastQuality = quality;
      if (encoded.size <= targetBytes) {
        return { blob: encoded, width, height, quality, overTarget: false };
      }
    }

    // Every rung was too big. Hand back the smallest and let the caller decide —
    // silently uploading something the server will reject helps nobody.
    return { blob: last as Blob, width, height, quality: lastQuality, overTarget: true };
  }
}

/** Scales to fit within `maxEdge`, preserving aspect ratio. Never upscales. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The real browser implementation.
 *
 * Kept out of {@link ImageCompressor} so the ladder above is unit-testable, and so a
 * platform that cannot decode a given format fails in one identifiable place.
 */
export const browserCodec: ImageCodec = {
  async decode(blob: Blob): Promise<RasterImage> {
    // createImageBitmap applies EXIF orientation itself, which is what keeps a
    // portrait photo upright without reading the tag by hand.
    return createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  },

  async encode(image: RasterImage, width: number, height: number, quality: number): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }
    context.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => (result ? resolve(result) : reject(new Error('Encoding failed'))), 'image/jpeg', quality);
    });
  },
};
