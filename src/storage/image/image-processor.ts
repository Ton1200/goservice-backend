import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  IMAGE_MAX_DIMENSION_PX_CHOICES,
  IMAGE_MAX_DIMENSION_PX_DEFAULT,
  IMAGE_WEBP_QUALITY_DEFAULT,
  IMAGE_WEBP_QUALITY_MAX,
  IMAGE_WEBP_QUALITY_MIN,
  STORAGE_SETTING_KEYS,
} from '../storage-setting-keys.constants';

/**
 * GOS-70 — the one place raw upload bytes become the WebP that actually
 * gets stored. Runs inside the `image-processing` BullMQ worker
 * (`ImageProcessingProcessor`), NOT in the request path: the heavy
 * resize/re-encode is async so a large HEIC never ties up an HTTP worker.
 *
 * Max dimension and WebP quality are admin-managed `PlatformSetting` rows
 * (`storage.image-processing.*`), read LIVE on every call — same "no config
 * cached at boot" discipline as `ResendEmailClientAdapter`, so an admin
 * lowering the size takes effect on the very next upload. Both values are
 * clamped defensively here even though the admin write path validates them,
 * because a row could also be edited directly in the DB or left stale.
 *
 * Also exported by `StorageModule` so GOS-72 (Quote attachments) can reuse
 * it without re-implementing any of this.
 */
@Injectable()
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async toWebp(input: Buffer): Promise<Buffer> {
    const maxDimensionPx = await this.resolveMaxDimensionPx();
    const quality = await this.resolveQuality();

    return (
      sharp(input, { failOn: 'error' })
        // Honour EXIF orientation before metadata is stripped by the encode.
        .rotate()
        .resize(maxDimensionPx, maxDimensionPx, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer()
    );
  }

  private async resolveMaxDimensionPx(): Promise<number> {
    const raw = await this.platformSettingPort.getValue(
      STORAGE_SETTING_KEYS.imageMaxDimensionPx,
    );
    const parsed = Number(raw);
    if (
      raw !== null &&
      (IMAGE_MAX_DIMENSION_PX_CHOICES as readonly number[]).includes(parsed)
    ) {
      return parsed;
    }
    if (raw !== null) {
      this.logger.warn({
        event: 'storage_setting_invalid',
        key: STORAGE_SETTING_KEYS.imageMaxDimensionPx,
        fallback: IMAGE_MAX_DIMENSION_PX_DEFAULT,
      });
    }
    return IMAGE_MAX_DIMENSION_PX_DEFAULT;
  }

  private async resolveQuality(): Promise<number> {
    const raw = await this.platformSettingPort.getValue(
      STORAGE_SETTING_KEYS.imageWebpQuality,
    );
    const parsed = Number(raw);
    if (
      raw !== null &&
      Number.isInteger(parsed) &&
      parsed >= IMAGE_WEBP_QUALITY_MIN &&
      parsed <= IMAGE_WEBP_QUALITY_MAX
    ) {
      return parsed;
    }
    if (raw !== null) {
      this.logger.warn({
        event: 'storage_setting_invalid',
        key: STORAGE_SETTING_KEYS.imageWebpQuality,
        fallback: IMAGE_WEBP_QUALITY_DEFAULT,
      });
    }
    return IMAGE_WEBP_QUALITY_DEFAULT;
  }
}
