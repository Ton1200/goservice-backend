import { PlatformSettingModel } from './platform-setting.model';
import type { PlatformSettingWithUpdatedBy } from '../platform-settings.repository';

/**
 * The ONE place a `PlatformSetting` Prisma row is mapped to the
 * GraphQL-facing `PlatformSettingModel` — shared by
 * `ListPlatformSettingsService` and `SetPlatformSettingService` so there is
 * exactly one mapping to keep correct, not two that could drift.
 *
 * This mapper copies `row.value`/`row.maskedPreview` into
 * `rawValue`/`rawMaskedPreview` UNCONDITIONALLY — it does NOT itself decide
 * what's safe to expose. That decision is `PlatformSettingFieldResolver`'s
 * job alone (see that class's header comment): even if this mapper is ever
 * changed carelessly, the field resolver's own independent `isEncrypted`
 * check is what actually keeps a decrypted value off the wire, not this
 * function's care.
 */
export function toPlatformSettingModel(
  row: PlatformSettingWithUpdatedBy,
): PlatformSettingModel {
  const model = new PlatformSettingModel();
  model.id = row.id;
  model.key = row.key;
  model.description = row.description;
  model.valueType = row.valueType;
  model.isEncrypted = row.isEncrypted;
  model.isPublic = row.isPublic;
  model.provider = row.provider;
  model.updatedBy = row.updatedByAdminUser?.displayName ?? null;
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  model.rawValue = row.value;
  model.rawMaskedPreview = row.maskedPreview;
  return model;
}
