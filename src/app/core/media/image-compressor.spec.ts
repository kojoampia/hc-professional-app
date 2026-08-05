import { TestBed } from '@angular/core/testing';

import { ImageCodec, ImageCompressor, MAX_EDGE_PX, QUALITY_STEPS, RasterImage, TARGET_MAX_BYTES, fitWithin } from './image-compressor';

/**
 * A codec whose output size falls as quality falls, so the ladder can be exercised
 * without a canvas — jsdom has neither `createImageBitmap` nor a real 2D context.
 */
const codecProducing = (sizeForQuality: (quality: number) => number) => {
  const calls: { width: number; height: number; quality: number }[] = [];
  const codec: ImageCodec = {
    decode: async (): Promise<RasterImage> => ({ width: 4032, height: 3024 }),
    encode: async (_image, width, height, quality) => {
      calls.push({ width, height, quality });
      return new Blob([new Uint8Array(sizeForQuality(quality))], { type: 'image/jpeg' });
    },
  };
  return { codec, calls };
};

describe('fitWithin', () => {
  it('scales a landscape photo down to the long edge', () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it('scales a portrait photo by its height', () => {
    expect(fitWithin(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it('NEVER upscales — a small scan must not be blown up', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it('leaves an exactly-sized image alone', () => {
    expect(fitWithin(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 });
  });

  it('never rounds a dimension to zero', () => {
    expect(fitWithin(10000, 3, 2000).height).toBeGreaterThanOrEqual(1);
  });
});

describe('ImageCompressor', () => {
  let compressor: ImageCompressor;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    compressor = TestBed.inject(ImageCompressor);
  });

  it('stops at the FIRST quality that fits, rather than always going to the floor', async () => {
    const { codec, calls } = codecProducing(() => 1_000_000);
    const result = await compressor.compress(new Blob(['x']), codec);

    expect(calls).toHaveLength(1);
    expect(result.quality).toBe(QUALITY_STEPS[0]);
    expect(result.overTarget).toBe(false);
  });

  it('steps down through the ladder until it fits', async () => {
    // Only 0.55 and below come in under target.
    const { codec, calls } = codecProducing(quality => (quality > 0.55 ? 9_000_000 : 3_000_000));
    const result = await compressor.compress(new Blob(['x']), codec);

    expect(calls.map(c => c.quality)).toEqual([0.85, 0.7, 0.55]);
    expect(result.quality).toBe(0.55);
    expect(result.blob.size).toBeLessThanOrEqual(TARGET_MAX_BYTES);
  });

  it('reports overTarget rather than silently uploading something the server will reject', async () => {
    const { codec, calls } = codecProducing(() => 20_000_000);
    const result = await compressor.compress(new Blob(['x']), codec);

    expect(calls).toHaveLength(QUALITY_STEPS.length);
    expect(result.overTarget).toBe(true);
    // The smallest attempt is still returned so the caller can report a size.
    expect(result.blob).toBeDefined();
  });

  it('caps the long edge before encoding', async () => {
    const { codec, calls } = codecProducing(() => 100);
    await compressor.compress(new Blob(['x']), codec);

    expect(Math.max(calls[0].width, calls[0].height)).toBe(MAX_EDGE_PX);
  });

  it('always emits image/jpeg — the server allowlist is exact and magic-byte checked', async () => {
    const { codec } = codecProducing(() => 100);
    const result = await compressor.compress(new Blob(['x'], { type: 'image/heic' }), codec);

    // A HEIC in, a JPEG out. The server accepts exactly PDF/PNG/JPEG and verifies
    // the bytes against the declared type, so this is not cosmetic.
    expect(result.blob.type).toBe('image/jpeg');
  });

  it('honours a caller-supplied target', async () => {
    const { codec } = codecProducing(quality => (quality > 0.7 ? 900 : 400));
    const result = await compressor.compress(new Blob(['x']), codec, 500);

    expect(result.quality).toBe(0.7);
  });

  it('re-encodes even when the source is already small', async () => {
    // The size ladder is the least important reason to re-encode. EXIF/GPS stripping
    // and orientation happen in the same pass, so an already-small photo must still
    // go through it.
    const { codec, calls } = codecProducing(() => 50_000);
    await compressor.compress(new Blob(['x']), codec);

    expect(calls.length).toBeGreaterThan(0);
  });
});
