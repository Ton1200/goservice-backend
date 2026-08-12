import { PlatformSettingsRepository } from '../../platform-settings.repository';
import { ListPlatformConfigService } from './list-platform-config.service';

/**
 * GOS-3x follow-up #2 (2026-08-10) note: this service trusts
 * `PlatformSettingsRepository.findPublicSettings()` to have ALREADY filtered
 * to `isEncrypted: false AND isPublic: true` — it deliberately does not
 * re-filter (see `ListPlatformConfigService`'s own header comment). The
 * regression guard proving a row with `isEncrypted: false, isPublic: false`
 * is EXCLUDED (the actual behavior change this round introduces) therefore
 * lives at the repository level — see
 * `platform-settings.repository.spec.ts`'s `findPublicSettings` describe
 * block — and end-to-end against a real DB in
 * `test/platform-config.e2e-spec.ts`. Every fixture row in THIS file is
 * already assumed to have passed that gate (this service never receives a
 * non-public row to begin with), so its own tests focus on tree-shaping,
 * not the public/non-public distinction.
 */
describe('ListPlatformConfigService', () => {
  function makeService(rows: unknown[]) {
    const findPublicSettings = jest.fn().mockResolvedValue(rows);
    const platformSettingsRepository = {
      findPublicSettings,
    } as unknown as PlatformSettingsRepository;
    return new ListPlatformConfigService(platformSettingsRepository);
  }

  // The `KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS` manifest is a hardcoded,
  // module-level import (not injectable/mockable) — so EVERY call to
  // `listPlatformConfig()`, in every test in this file, always gets this
  // exact branch merged in unless a test's own fixture rows already provide
  // a real value for `customer.social-login.google.enabled`/
  // `.apple.enabled`. Tests below that are unrelated to social-login (and
  // predate this manifest) include this constant in their expected trees
  // for that reason — see the dedicated
  // "known boolean default-fill" describe block further down for the tests
  // that actually exercise this behavior.
  const DEFAULT_SOCIAL_LOGIN_BRANCH = {
    socialLogin: { google: { enabled: false }, apple: { enabled: false } },
  };

  it('nests settings into a single tree, one level per dot-segment of the key', async () => {
    const service = makeService([
      {
        key: 'customer.social-login.google.enabled',
        description: 'Gates Google sign-in.',
        valueType: 'BOOLEAN',
        value: 'true',
      },
      {
        key: 'customer.social-login.google.client-id',
        description: 'Google client-id.',
        valueType: 'STRING',
        value: 'abc123.apps.googleusercontent.com',
      },
      {
        key: 'customer.social-login.apple.enabled',
        description: 'Gates Apple sign-in.',
        valueType: 'BOOLEAN',
        value: 'true',
      },
    ]);

    const tree = await service.listPlatformConfig();

    expect(tree).toEqual({
      customer: {
        socialLogin: {
          google: {
            enabled: true,
            clientId: 'abc123.apps.googleusercontent.com',
          },
          apple: { enabled: true },
        },
      },
    });
  });

  it('a single-segment key (no dot at all) becomes a top-level leaf', async () => {
    const service = makeService([
      {
        // Deliberately no `-` in this key — isolates the "no dot at all"
        // edge case from the separate kebab-case -> camelCase transform,
        // which has its own dedicated tests below.
        key: 'standalonesetting',
        description: 'A hypothetical top-level setting.',
        valueType: 'BOOLEAN',
        value: 'true',
      },
    ]);

    const tree = await service.listPlatformConfig();

    expect(tree).toEqual({
      standalonesetting: true,
      customer: DEFAULT_SOCIAL_LOGIN_BRANCH,
    });
  });

  it('returns only the manifest default-filled branches (no other keys) when there are no public settings at all', async () => {
    const service = makeService([]);

    const tree = await service.listPlatformConfig();

    // No longer a bare `{}` — the known-boolean-default-fill pass (see the
    // dedicated describe block below) still runs even with zero
    // `PlatformSetting` rows at all.
    expect(tree).toEqual({ customer: DEFAULT_SOCIAL_LOGIN_BRANCH });
  });

  it('processes rows in key-sorted order for deterministic object key insertion order', async () => {
    const service = makeService([
      {
        key: 'zzz.feature.b',
        description: 'b',
        valueType: 'BOOLEAN',
        value: 'true',
      },
      {
        key: 'zzz.feature.a',
        description: 'a',
        valueType: 'BOOLEAN',
        value: 'true',
      },
      {
        key: 'aaa.feature.a',
        description: 'a',
        valueType: 'BOOLEAN',
        value: 'true',
      },
    ]);

    const tree = await service.listPlatformConfig();

    // 'customer' (added last, by the default-fill pass — see the dedicated
    // describe block below) intentionally breaks strict alphabetical
    // insertion order here; this test's own point (real rows insert in
    // sorted order) still holds for 'aaa'/'zzz', which are unaffected by
    // the manifest.
    expect(Object.keys(tree)).toEqual(['aaa', 'zzz', 'customer']);
    expect(tree).toEqual({
      aaa: { feature: { a: true } },
      zzz: { feature: { a: true, b: true } },
      customer: DEFAULT_SOCIAL_LOGIN_BRANCH,
    });
  });

  describe('kebab-case -> camelCase segment transform', () => {
    it('camelCases every segment of a multi-segment kebab-case key, not just the leaf', async () => {
      const service = makeService([
        {
          key: 'customer.social-login.apple.enabled',
          description: 'Gates Apple sign-in.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
        {
          key: 'customer.social-login.apple.client-id',
          description: 'Apple client-id.',
          valueType: 'STRING',
          value: 'abc123',
        },
      ]);

      const tree = await service.listPlatformConfig();

      expect(tree).toEqual({
        customer: {
          socialLogin: {
            apple: { enabled: true, clientId: 'abc123' },
            // Google's `enabled` has no real row here — default-filled.
            google: { enabled: false },
          },
        },
      });
    });

    it('leaves a single-segment path segment unchanged (no `-` to transform)', async () => {
      const service = makeService([
        {
          key: 'feature.enabled',
          description: 'A single-segment field name.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
      ]);

      const tree = (await service.listPlatformConfig()) as {
        feature: Record<string, unknown>;
      };

      expect(Object.keys(tree.feature)).toEqual(['enabled']);
    });

    it('camelCases a segment with more than two kebab parts', async () => {
      const service = makeService([
        {
          key: 'feature.some-long-field-name',
          description: 'multi-segment field name',
          valueType: 'STRING',
          value: 'x',
        },
      ]);

      const tree = await service.listPlatformConfig();

      expect(tree).toEqual({
        feature: { someLongFieldName: 'x' },
        customer: DEFAULT_SOCIAL_LOGIN_BRANCH,
      });
    });
  });

  describe('value unwrapping by valueType', () => {
    it('unwraps a NUMBER-typed value into an actual number', async () => {
      const service = makeService([
        {
          key: 'feature.max-retries',
          description: 'A numeric setting.',
          valueType: 'NUMBER',
          value: '3',
        },
      ]);

      const tree = await service.listPlatformConfig();

      expect(tree).toEqual({
        feature: { maxRetries: 3 },
        customer: DEFAULT_SOCIAL_LOGIN_BRANCH,
      });
    });

    it('omits a leaf (rather than emitting null) when its value is missing', async () => {
      const service = makeService([
        {
          key: 'feature.enabled',
          description: 'A setting with no stored value.',
          valueType: 'BOOLEAN',
          value: null,
        },
      ]);

      const tree = await service.listPlatformConfig();

      expect(tree).toEqual({ customer: DEFAULT_SOCIAL_LOGIN_BRANCH });
    });
  });

  describe('key-path collisions (pathological — never expected from real seed data, defensive only)', () => {
    it('skips a row whose path needs an OBJECT where an earlier row already placed a LEAF, without throwing', async () => {
      const service = makeService([
        // Sorted order: this key comes first (shorter, alphabetically
        // precedes its own extension).
        {
          key: 'customer.enabled',
          description: 'A leaf placed first.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
        // This row needs `customer.enabled` to be an OBJECT (to descend
        // into `.foo`), but it's already a leaf boolean.
        {
          key: 'customer.enabled.foo',
          description: 'Conflicts with the leaf above.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
      ]);

      const tree = await service.listPlatformConfig();

      // The first (leaf) row wins; the conflicting second row is skipped,
      // not thrown. `customer.socialLogin.*` is default-filled alongside
      // the real `customer.enabled` leaf — a sibling key, no collision.
      expect(tree).toEqual({
        customer: { enabled: true, ...DEFAULT_SOCIAL_LOGIN_BRANCH },
      });
    });

    it('skips a row whose path is a LEAF where an earlier row already built an OBJECT subtree, without throwing', async () => {
      // A simple dot-prefix pair (e.g. `customer.enabled` vs
      // `customer.enabled.foo`) always sorts prefix-first — the shorter,
      // leaf-desiring key is always a strict string prefix of the longer,
      // object-desiring one, so `localeCompare` always processes it FIRST,
      // meaning that particular pair can only ever exercise the OTHER
      // collision branch (covered by the test above). This branch — an
      // already-built object standing where THIS row wants to write a
      // leaf — is instead reached via two raw kebab-case keys whose
      // CAMELCASED segments collide even though the raw strings don't sort
      // as a simple prefix pair: `aaa-bbb` and `aaaBbb` both camelCase to
      // `aaaBbb`, and `customer.aaa-bbb.nested` sorts (locale-compare,
      // verified) BEFORE `customer.aaaBbb` — so the object-building row is
      // guaranteed to be processed first here.
      const service = makeService([
        {
          key: 'customer.aaa-bbb.nested',
          description: 'Builds an object subtree first.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
        {
          key: 'customer.aaaBbb',
          description: 'Conflicts with the object subtree above.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
      ]);

      const tree = await service.listPlatformConfig();

      // The first (object-building) row wins; the conflicting second row
      // is skipped, not thrown, and does not clobber the subtree.
      // `customer.socialLogin.*` is default-filled alongside `aaaBbb` — a
      // sibling key, no collision.
      expect(tree).toEqual({
        customer: {
          aaaBbb: { nested: true },
          ...DEFAULT_SOCIAL_LOGIN_BRANCH,
        },
      });
    });

    it('does not let one conflicting row corrupt unrelated sibling data elsewhere in the tree', async () => {
      const service = makeService([
        {
          key: 'customer.enabled',
          description: 'leaf',
          valueType: 'BOOLEAN',
          value: 'true',
        },
        {
          key: 'customer.enabled.foo',
          description: 'conflict',
          valueType: 'BOOLEAN',
          value: 'true',
        },
        {
          key: 'customer.socialLogin.google.enabled',
          description: 'unrelated sibling',
          valueType: 'BOOLEAN',
          value: 'true',
        },
      ]);

      const tree = await service.listPlatformConfig();

      expect(tree).toEqual({
        customer: {
          enabled: true,
          // Google's `enabled` is the real, saved row (`true`); Apple's has
          // no row here and is default-filled (`false`).
          socialLogin: { google: { enabled: true }, apple: { enabled: false } },
        },
      });
    });
  });

  describe('known boolean default-fill (KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS)', () => {
    it('a known boolean key with NO row at all still appears in the result, defaulting to false', async () => {
      const service = makeService([]);

      const tree = (await service.listPlatformConfig()) as {
        customer: { socialLogin: Record<string, unknown> };
      };

      expect(tree.customer.socialLogin).toEqual({
        google: { enabled: false },
        apple: { enabled: false },
      });
    });

    it('a known boolean key WITH a real DB row is NOT overwritten by the default — the real value wins', async () => {
      const service = makeService([
        {
          key: 'customer.social-login.google.enabled',
          description: 'Gates Google sign-in.',
          valueType: 'BOOLEAN',
          value: 'true',
        },
      ]);

      const tree = (await service.listPlatformConfig()) as {
        customer: { socialLogin: Record<string, unknown> };
      };

      // Google keeps its real, saved `true`; Apple (no row) still gets its
      // default `false` — proving the default-fill pass is per-leaf, not
      // all-or-nothing.
      expect(tree.customer.socialLogin).toEqual({
        google: { enabled: true },
        apple: { enabled: false },
      });
    });

    it('an already-saved explicit `false` is preserved as-is, not treated as "missing" and re-defaulted', async () => {
      const service = makeService([
        {
          key: 'customer.social-login.google.enabled',
          description: 'Gates Google sign-in.',
          valueType: 'BOOLEAN',
          value: 'false',
        },
        {
          key: 'customer.social-login.apple.enabled',
          description: 'Gates Apple sign-in.',
          valueType: 'BOOLEAN',
          value: 'false',
        },
      ]);

      const tree = (await service.listPlatformConfig()) as {
        customer: { socialLogin: Record<string, unknown> };
      };

      expect(tree.customer.socialLogin).toEqual({
        google: { enabled: false },
        apple: { enabled: false },
      });
    });

    it('an unrelated, non-manifest key with no row is still correctly absent — defaults only apply to the manifest', async () => {
      const service = makeService([]);

      const tree = await service.listPlatformConfig();

      // No `standalonesetting`, no `feature`, nothing outside what the
      // manifest declares — proves the default-fill pass does not invent
      // branches for arbitrary/unrelated keys.
      expect(Object.keys(tree)).toEqual(['customer']);
      expect(
        (tree.customer as { socialLogin: Record<string, unknown> }).socialLogin,
      ).toEqual({
        google: { enabled: false },
        apple: { enabled: false },
      });
    });

    it('a real row for an UNRELATED sibling under the same manifest-covered parent does not block that parent from also receiving its manifest defaults', async () => {
      const service = makeService([
        {
          key: 'customer.social-login.google.client-id',
          description: 'Google client-id.',
          valueType: 'STRING',
          value: 'abc123',
        },
      ]);

      const tree = (await service.listPlatformConfig()) as {
        customer: {
          socialLogin: { google: Record<string, unknown> };
        };
      };

      expect(tree.customer.socialLogin.google).toEqual({
        clientId: 'abc123',
        enabled: false,
      });
    });
  });
});
