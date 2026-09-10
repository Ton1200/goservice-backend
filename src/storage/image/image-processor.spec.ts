import sharp from 'sharp';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { STORAGE_SETTING_KEYS } from '../storage-setting-keys.constants';
import { ImageProcessor } from './image-processor';

function buildProcessor(values: Record<string, string | null> = {}): {
  processor: ImageProcessor;
  getValue: jest.Mock;
} {
  const getValue = jest.fn((key: string): Promise<string | null> =>
    Promise.resolve(key in values ? values[key] : null),
  );
  const port = {
    getValue,
    isEnabled: jest.fn(),
  } as unknown as PlatformSettingPort;
  return { processor: new ImageProcessor(port), getValue };
}

function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

describe('ImageProcessor.toWebp', () => {
  it('re-encodes to WebP and downsizes to the configured max dimension', async () => {
    const { processor } = buildProcessor({
      [STORAGE_SETTING_KEYS.imageMaxDimensionPx]: '512',
      [STORAGE_SETTING_KEYS.imageWebpQuality]: '70',
    });

    const out = await processor.toWebp(await solidPng(3000, 2000));
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(512);
  });

  it('does not enlarge an image smaller than the max dimension', async () => {
    const { processor } = buildProcessor({
      [STORAGE_SETTING_KEYS.imageMaxDimensionPx]: '2048',
    });

    const out = await processor.toWebp(await solidPng(100, 80));
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(80);
  });

  it('converts a GIF input to WebP', async () => {
    const gif = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .gif()
      .toBuffer();

    const { processor } = buildProcessor();
    const meta = await sharp(await processor.toWebp(gif)).metadata();
    expect(meta.format).toBe('webp');
  });

  it('falls back to 1024/80 when the settings are missing or invalid', async () => {
    const { processor } = buildProcessor({
      [STORAGE_SETTING_KEYS.imageMaxDimensionPx]: 'not-a-number',
      [STORAGE_SETTING_KEYS.imageWebpQuality]: '9999',
    });

    const out = await processor.toWebp(await solidPng(4000, 1000));
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
  });

  it('rejects an out-of-set max dimension (e.g. 4096) and uses 1024', async () => {
    const { processor } = buildProcessor({
      [STORAGE_SETTING_KEYS.imageMaxDimensionPx]: '4096',
    });
    const out = await processor.toWebp(await solidPng(5000, 5000));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1024);
  });
});
