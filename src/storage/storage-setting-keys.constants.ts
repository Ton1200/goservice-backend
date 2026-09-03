/**
 * GOS-70 — `PlatformSetting.key` dot-paths for the admin-managed storage /
 * image-processing knobs. Same namespacing convention as
 * `notifications.email.<provider>.<field>` (see `PlatformSetting`'s header
 * comment in `prisma/schema.prisma`), under a `storage.` prefix.
 *
 * Read LIVE (never cached) by their consumers so an admin change takes
 * effect on the next request/job with no restart — same discipline as
 * `ResendEmailClientAdapter`. Written ONLY through the dedicated
 * `updateStorageSettings` admin mutation (gated by `STORAGE_SETTINGS_WRITE`);
 * the generic `setPlatformSetting` rejects any key under `STORAGE_SETTING_KEY_PREFIX`.
 */
export const STORAGE_SETTING_KEY_PREFIX = 'storage.';

export const STORAGE_SETTING_KEYS = {
  /** BOOLEAN. Gates the profile-photo upload flow ONLY (not SR attachments
   *  or the email logo). Read with `PlatformSettingPort.isEnabled(...)`
   *  (fail-open: a missing row means enabled). Seeded `true`. */
  profilePhotoUploadEnabled: 'storage.profile-photo-upload.enabled',
  /** NUMBER. Longest-edge cap (px) applied to EVERY image processed by the
   *  shared layer. Constrained to one of `IMAGE_MAX_DIMENSION_PX_CHOICES`;
   *  anything else falls back to `IMAGE_MAX_DIMENSION_PX_DEFAULT`. */
  imageMaxDimensionPx: 'storage.image-processing.max-dimension-px',
  /** NUMBER. WebP encode quality (1..100). Out-of-range / unparseable falls
   *  back to `IMAGE_WEBP_QUALITY_DEFAULT`. */
  imageWebpQuality: 'storage.image-processing.webp-quality',
} as const;

export const IMAGE_MAX_DIMENSION_PX_CHOICES = [512, 1024, 2048] as const;
export const IMAGE_MAX_DIMENSION_PX_DEFAULT = 1024;

export const IMAGE_WEBP_QUALITY_MIN = 1;
export const IMAGE_WEBP_QUALITY_MAX = 100;
export const IMAGE_WEBP_QUALITY_DEFAULT = 80;
