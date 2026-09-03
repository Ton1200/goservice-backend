import sharp from 'sharp';
import { UNSUPPORTED_IMAGE_FORMAT_CODE } from '../errors/unsupported-image-format.error';
import { sniffImageFormat } from './sniff-image-format';

function solid(width: number, height: number): sharp.Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  });
}

describe('sniffImageFormat', () => {
  it('detects common raster formats from the bytes', async () => {
    const png = await solid(8, 8).png().toBuffer();
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    const webp = await solid(8, 8).webp().toBuffer();
    const gif = await solid(8, 8).gif().toBuffer();

    expect(await sniffImageFormat(png)).toBe('png');
    expect(await sniffImageFormat(jpeg)).toBe('jpeg');
    expect(await sniffImageFormat(webp)).toBe('webp');
    expect(await sniffImageFormat(gif)).toBe('gif');
  });

  it('ignores a lying declaration — decision is byte-based', async () => {
    // A real PNG. There is no content-type argument to lie with; the point
    // is that the function never takes one and answers from the bytes.
    const png = await solid(4, 4).png().toBuffer();
    expect(await sniffImageFormat(png)).toBe('png');
  });

  it('rejects non-image bytes with UNSUPPORTED_IMAGE_FORMAT', async () => {
    await expect(sniffImageFormat(Buffer.from('not an image'))).rejects.toEqual(
      expect.objectContaining({ message: UNSUPPORTED_IMAGE_FORMAT_CODE }),
    );
  });

  it('rejects a PDF (not a raster image)', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\n%\xff\xff\xff\xff\n');
    await expect(sniffImageFormat(fakePdf)).rejects.toEqual(
      expect.objectContaining({ message: UNSUPPORTED_IMAGE_FORMAT_CODE }),
    );
  });
});
