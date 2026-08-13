import { registerEnumType } from '@nestjs/graphql';
import { PlatformSettingValueType } from '@prisma/client';

/**
 * Registers the Prisma-generated `PlatformSettingValueType` enum
 * (`prisma/schema.prisma`) directly as a GraphQL enum type, used by the
 * admin-facing `PlatformSettingModel.valueType` (`/admin/graphql`) — same
 * reasoning as `admin-permission.enum.ts` for reusing the Prisma enum
 * directly rather than declaring a second, parallel GraphQL-only enum.
 *
 * Until 2026-08-09 this GraphQL enum was ALSO used by the consumer-facing
 * `PlatformConfigField.valueType` (`/graphql`) — that per-setting type was
 * removed in this round's reshape of `platformConfig` to a flat `fields:
 * JSON!` map (see `services/list-platform-config.service.ts`'s own header
 * comment), which no longer exposes `valueType` as its own GraphQL field at
 * all (the value is unwrapped server-side and placed directly into the
 * `fields` map). `PlatformSettingValueType` (the Prisma import, not this
 * GraphQL-registered wrapper) is still used internally by
 * `ListPlatformConfigService` to decide HOW to unwrap each stored value —
 * just no longer surfaced as a GraphQL-typed field on the consumer schema.
 * This GraphQL enum registration is therefore, as of this round, only
 * reachable from `/admin/graphql`.
 *
 * `registerEnumType` runs once per process regardless of how many files
 * import this module (Node's module cache), so it's safe for any number of
 * model files to import `PlatformSettingValueType` from here.
 */
registerEnumType(PlatformSettingValueType, {
  name: 'PlatformSettingValueType',
  description:
    'The primitive shape a PlatformSetting value is stored/exposed as.',
});

export { PlatformSettingValueType };
