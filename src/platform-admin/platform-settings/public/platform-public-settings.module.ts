import { Module } from '@nestjs/common';
import { JsonScalar } from '../../../common/graphql/json.scalar';
import { PlatformSettingsModule } from '../platform-settings.module';
import { PlatformConfigResolver } from './platform-config.resolver';
import { ListPlatformConfigService } from './services/list-platform-config.service';

/**
 * The PUBLIC-schema counterpart to `PlatformAdminModule` — this module
 * DOES carry a real `@Resolver()` class (`PlatformConfigResolver`),
 * unlike every other module in `platform-admin/` that's meant to be
 * imported cross-boundary. That is deliberate here, not an oversight: this
 * module's resolver is MEANT to be reachable from the public `/graphql`
 * schema, so it must be listed in `src/app.module.ts`'s public
 * `GraphQLModule.forRootAsync()` `include` array (and, correspondingly,
 * imported into `AppModule.imports`) — never into the admin schema's
 * `include` array. Importing `PlatformSettingsModule` (resolver-free) for
 * `PlatformSettingsRepository` only, exactly like `AuthModule` does for
 * `PlatformSettingPort` — see that module's own header comment for the
 * transitive-schema-leak defense this split exists to preserve.
 *
 * Class name kept as `PlatformPublicSettingsModule` (not renamed to
 * "...ConfigModule") even though the query it now exposes is
 * `platformConfig` (renamed 2026-08-09 from `platformPublicFeatures`, pure
 * rename, no behavior change — the schema isolation itself already
 * communicates "this is the safe, consumer-facing subset," making "Public"
 * in the query/type names redundant) — this module's own domain is still
 * "the public view of platform settings" as a whole; only the query's name
 * and response shape changed, not the module's purpose.
 *
 * `JsonScalar` (added 2026-08-09, later reshaped the SAME day —
 * `platformConfig` went `[PlatformConfigGroup!]!` with a per-group
 * `fields: JSON!` map -> a single bare `JSON!` scalar for the whole
 * response, see `PlatformConfigResolver`'s own header comment) is
 * registered as a provider HERE because `PlatformConfigResolver.
 * platformConfig` is this schema's actual consumer of it — this is the
 * registration that makes `JSON` a genuinely USABLE/reachable scalar on
 * `/graphql`. Whether `JsonScalar` ALSO needs registering on
 * `PlatformAdminModule` (it did, transiently, while `PlatformConfigGroup`
 * — an `@ObjectType()` — existed and got force-included as a process-wide
 * orphaned type into every schema) was re-investigated after
 * `PlatformConfigGroup` was deleted in this same round — see
 * `PlatformAdminModule`'s own header comment for the finding.
 */
@Module({
  imports: [PlatformSettingsModule],
  providers: [PlatformConfigResolver, ListPlatformConfigService, JsonScalar],
})
export class PlatformPublicSettingsModule {}
