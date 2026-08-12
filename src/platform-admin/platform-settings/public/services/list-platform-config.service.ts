import { Injectable, Logger } from '@nestjs/common';
import { PlatformSetting, PlatformSettingValueType } from '@prisma/client';
import { PlatformSettingsRepository } from '../../platform-settings.repository';
import { KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS } from '../known-platform-config-defaults';

/** The leaf-value types a resolved `PlatformSetting.value` can unwrap to. */
type PlatformConfigLeafValue = boolean | string | number;

/**
 * A node in the tree `listPlatformConfig()` builds: either a nested object
 * (an intermediate path segment) or a leaf value (the setting's own
 * unwrapped value). Plain `Record`, not a GraphQL type — the whole point of
 * `platformConfig: JSON!` is that this shape is NOT fixed/typed at the
 * schema level.
 */
type PlatformConfigNode =
  { [key: string]: PlatformConfigNode } | PlatformConfigLeafValue;

/**
 * Thin application service backing `platformConfig`. Reads EXCLUSIVELY via
 * `PlatformSettingsRepository.findPublicSettings()`, which already filters
 * to `isEncrypted = false AND isPublic = true` (BOTH gates required, since
 * the GOS-3x follow-up #2 reintroduction of `isPublic` — see
 * `PlatformSetting`'s own header comment in `prisma/schema.prisma`) — this
 * service does not re-filter (that would be redundant with the
 * repository's own `where`).
 *
 * Reshaped (2026-08-09, confirmed with the human via a concrete JSON
 * preview) from the immediately prior round's one-level "group by dropping
 * the key's last segment" (`[{ key, fields }]`) to a single, arbitrarily
 * deep NESTED object: every dot-segment of a row's key becomes one level of
 * nesting, and the row's own unwrapped value becomes the leaf at the end of
 * that path — e.g. `customer.social-login.google.enabled` and
 * `customer.social-login.google.client-id` both contribute into
 * `{ customer: { socialLogin: { google: { enabled: ..., clientId: ... } } } }`
 * rather than each forming their own one-level-deep group keyed by a raw
 * dotted string. This is a strict generalization of the prior grouping (an
 * arbitrary tree instead of exactly two fixed levels — "group key" and
 * "field name") — the mobile client no longer has to know the fixed
 * "everything except the last segment is the group" convention to navigate
 * the response; it just walks the object like the (already
 * dot-namespaced-conventioned) key it already knows.
 *
 * Key-casing transform is UNCHANGED from the prior round: each dot-segment
 * (its raw, stored kebab-case form, e.g. `client-id`, `social-login`) is
 * camelCased via `toCamelCaseFieldName` before becoming an object property
 * name — `client-id` -> `clientId`; a segment with no `-` at all (e.g.
 * `enabled`) passes through unchanged.
 *
 * Sorted, deterministic processing is UNCHANGED from the prior round and
 * for the same reason: GraphQL/JS object key insertion order isn't
 * guaranteed by the type system, and a client diffing/caching this response
 * benefits from stable ordering across calls.
 *
 * New (2026-08-10, human-requested): after the tree is built from real rows
 * as described above, a second, manifest-driven pass
 * (`applyKnownBooleanDefaults`, fed by `KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS`
 * in `../known-platform-config-defaults.ts`) fills in ANY known boolean
 * feature-flag's branch that is still completely missing — so a client can
 * rely on a known flag's leaf always being present (`false` when
 * unconfigured) instead of getting `undefined` for "never saved yet". See
 * that pass's own comment and the manifest file's header comment for the
 * full rationale, including why this is boolean-only, not a general
 * mechanism. Real rows are always the higher-priority source; a default
 * never overwrites a real, already-saved value (including an explicit
 * `false`).
 */
@Injectable()
export class ListPlatformConfigService {
  private readonly logger = new Logger(ListPlatformConfigService.name);

  constructor(
    private readonly platformSettingsRepository: PlatformSettingsRepository,
  ) {}

  async listPlatformConfig(): Promise<Record<string, unknown>> {
    const rows = await this.platformSettingsRepository.findPublicSettings();
    const sortedRows = [...rows].sort((a, b) => a.key.localeCompare(b.key));

    const root: Record<string, PlatformConfigNode> = {};
    for (const row of sortedRows) {
      const value = this.resolveValue(row);
      if (value === null) {
        // See `resolveValue`'s own comment — logged there; skip contributing
        // a key with no meaningful value rather than polluting the tree
        // with `null`.
        continue;
      }

      const segments = row.key
        .split('.')
        .map((segment) => this.toCamelCaseFieldName(segment));
      this.assignAtPath(root, segments, value, row.key);
    }

    // --- Default-fill pass (manifest-driven, NOT DB-row-driven) ---
    // Everything above this line comes exclusively from real
    // `PlatformSetting` rows. Everything below fills in ONLY the known
    // boolean flags' branches that are still completely missing after that
    // pass — see `applyKnownBooleanDefaults`'s own comment and
    // `known-platform-config-defaults.ts`'s header comment for the full
    // rationale. Always runs last so real data (including an explicitly
    // saved `false`) is never overwritten by a default.
    this.applyKnownBooleanDefaults(root);

    return root;
  }

  /**
   * Fills in `{ key: defaultValue }` from
   * `KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS` for every manifest entry whose
   * leaf is still completely absent from `root` after the real-row pass
   * above — see that file's header comment for why this is boolean-only and
   * why it's a manifest rather than a general mechanism.
   *
   * Deliberately separate from `assignAtPath` (the real-row path-building
   * method) rather than reused as-is: their PRIORITY semantics at the leaf
   * are opposite. `assignAtPath` treats an already-occupied leaf as a
   * pathological collision between two real rows and logs+skips it (see its
   * own comment). Here, an already-occupied leaf is the NORMAL, EXPECTED
   * case — it just means a real row (or an earlier-processed default) has
   * already provided a value at that path, and this method silently leaves
   * it alone; that's the entire point of a default being the lowest-priority
   * source, not a collision worth logging.
   */
  private applyKnownBooleanDefaults(
    root: Record<string, PlatformConfigNode>,
  ): void {
    for (const {
      key,
      defaultValue,
    } of KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS) {
      this.fillDefaultAtPath(root, key, defaultValue);
    }
  }

  /**
   * Walks `key`'s dot-path (camelCasing each segment, same transform as
   * `assignAtPath`) into `root`, creating intermediate nested objects only
   * where nothing exists yet, and setting `defaultValue` at the final
   * segment ONLY IF that exact leaf is still `undefined`. Never overwrites
   * anything a real row (or the real-row pass above) already placed there —
   * neither a leaf value (including an explicit `false`) nor an object
   * subtree.
   */
  private fillDefaultAtPath(
    root: Record<string, PlatformConfigNode>,
    key: string,
    defaultValue: boolean,
  ): void {
    const segments = key
      .split('.')
      .map((segment) => this.toCamelCaseFieldName(segment));

    let cursor: Record<string, PlatformConfigNode> = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = cursor[segment];
      if (existing === undefined) {
        const next: Record<string, PlatformConfigNode> = {};
        cursor[segment] = next;
        cursor = next;
      } else if (this.isNestedObject(existing)) {
        cursor = existing;
      } else {
        // A real row already placed a LEAF value at this intermediate path
        // segment (the same pathological shape `assignAtPath` defends
        // against, from the opposite side) — a default cannot build a
        // branch through an already-existing leaf. Skip this manifest entry
        // entirely rather than clobber real data; log for visibility since
        // this indicates a real key/manifest mismatch worth investigating.
        this.logger.warn({
          event: 'platform_config_default_path_collision',
          key,
          conflictingSegment: segment,
          reason: 'expected_object_found_leaf',
        });
        return;
      }
    }

    const lastSegment = segments[segments.length - 1];
    if (cursor[lastSegment] !== undefined) {
      // Real data (or an earlier default) already occupies this exact leaf
      // — an already-saved value (including an explicit `false`) always
      // wins over a default; this is the expected, common case, not an
      // error.
      return;
    }

    cursor[lastSegment] = defaultValue;
  }

  /**
   * Walks `segments` (the row's own dot-path, already camelCased
   * segment-by-segment) into `root`, creating an intermediate nested object
   * at every segment except the last, then assigning `value` at the final
   * segment.
   *
   * Collision handling (deliberate, not accidental — see this method's own
   * two branches below): a real, well-formed key never collides with
   * another this way (the DB's `key` column is `@unique`, and no two real
   * seeded keys are a strict dot-prefix of one another), but nothing in the
   * schema *enforces* that a key can never be entered such that one key is
   * a strict prefix of another (e.g. hypothetically `customer.enabled` AND
   * `customer.enabled.foo` both existing) — one row would expect an OBJECT
   * at a path position where the other row already placed (or will place) a
   * LEAF VALUE, or vice versa. Rather than silently overwrite one setting's
   * contribution with the other's (data loss with no signal) or let a
   * `cursor[segment] = {}` write clobber a boolean/string/number and then
   * throw a few lines later when a subsequent property access expects an
   * object, this method detects the conflict explicitly at the exact point
   * it would occur and logs + skips ONLY that one offending row — mirroring
   * `resolveValue`'s own established defensive-degradation pattern (a single
   * bad row degrades gracefully; it never crashes the whole query).
   *
   * Both collision directions are genuinely reachable, not just one: rows
   * are processed in RAW-key-sorted order (`sortedRows` above, sorted
   * BEFORE camelCasing), so a simple dot-prefix pair on its own (e.g.
   * `customer.enabled` vs `customer.enabled.foo`) always sorts the shorter,
   * leaf-desiring key first — only ever hitting the "expected object, found
   * leaf" branch below. The OTHER direction ("expected leaf, found object")
   * is reached when two DIFFERENT raw kebab-case segments camelCase to the
   * SAME result (e.g. `aaa-bbb` and `aaaBbb` both -> `aaaBbb`) — the raw
   * strings then don't sort as a simple prefix pair, so the object-building
   * row can legitimately sort, and get processed, first. See this class's
   * own spec file for a worked example of each direction.
   */
  private assignAtPath(
    root: Record<string, PlatformConfigNode>,
    segments: string[],
    value: PlatformConfigLeafValue,
    originalKey: string,
  ): void {
    let cursor: Record<string, PlatformConfigNode> = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = cursor[segment];
      if (existing === undefined) {
        const next: Record<string, PlatformConfigNode> = {};
        cursor[segment] = next;
        cursor = next;
      } else if (this.isNestedObject(existing)) {
        cursor = existing;
      } else {
        // A prior row already placed a LEAF value at this exact path
        // segment (e.g. this row is `customer.enabled.foo` and an earlier
        // row was `customer.enabled`) — an object is needed here to keep
        // descending, but a leaf already occupies it. Skip this row rather
        // than clobber the earlier, already-placed leaf value.
        this.logger.warn({
          event: 'platform_config_key_path_collision',
          key: originalKey,
          conflictingSegment: segment,
          reason: 'expected_object_found_leaf',
        });
        return;
      }
    }

    const lastSegment = segments[segments.length - 1];
    const existingAtLeaf = cursor[lastSegment];
    if (existingAtLeaf !== undefined && this.isNestedObject(existingAtLeaf)) {
      // The inverse collision: a prior row already built an OBJECT subtree
      // at this exact path (e.g. this row is `customer.enabled` and an
      // earlier row was `customer.enabled.foo`) — this row's own leaf value
      // would overwrite that whole subtree. Skip this row rather than
      // destroy the earlier rows' already-placed nested data.
      this.logger.warn({
        event: 'platform_config_key_path_collision',
        key: originalKey,
        conflictingSegment: lastSegment,
        reason: 'expected_leaf_found_object',
      });
      return;
    }

    cursor[lastSegment] = value;
  }

  private isNestedObject(
    node: PlatformConfigNode,
  ): node is { [key: string]: PlatformConfigNode } {
    return typeof node === 'object' && node !== null;
  }

  /**
   * kebab-case -> camelCase, e.g. `client-id` -> `clientId`,
   * `enabled` -> `enabled` (unchanged, no `-` to transform). See this
   * class's own header comment for the full rationale.
   */
  private toCamelCaseFieldName(fieldName: string): string {
    const [first, ...rest] = fieldName.split('-');
    return [
      first,
      ...rest.map(
        (segment) => segment.charAt(0).toUpperCase() + segment.slice(1),
      ),
    ].join('');
  }

  /**
   * Unwraps `row.value` into its actual typed value per `row.valueType`
   * (boolean/string/number) — unchanged from the prior round.
   *
   * `row.value` is guaranteed non-null here by the DB CHECK constraint
   * (`platform_setting_encrypted_shape_check`) — every row this service
   * ever sees has `isEncrypted = false` (enforced by the repository's own
   * `where`), which requires `value IS NOT NULL`. The `row.value == null`
   * branch below is still handled defensively (never thrown) rather than
   * asserted with `!`, so a future, unrelated data anomaly degrades to that
   * one field being OMITTED from the tree instead of a 500 or a `null`
   * entry a client would have to special-case.
   */
  private resolveValue(row: PlatformSetting): PlatformConfigLeafValue | null {
    if (row.value === null) {
      this.logger.warn({
        event: 'platform_config_missing_value',
        key: row.key,
      });
      return null;
    }

    switch (row.valueType) {
      case PlatformSettingValueType.BOOLEAN:
        return row.value === 'true';
      case PlatformSettingValueType.STRING:
        return row.value;
      case PlatformSettingValueType.NUMBER: {
        const parsed = Number(row.value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      default:
        return null;
    }
  }
}
