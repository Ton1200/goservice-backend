import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './support/test-app';

const SCHEMA_FIELDS_QUERY = `
  query SchemaFields {
    __schema {
      queryType { fields { name } }
      mutationType { fields { name } }
    }
  }
`;

// Includes `types { name }` (unlike `SCHEMA_FIELDS_QUERY` above) — needed
// to check for a SCALAR's presence, since a scalar is never itself a field
// on `queryType`/`mutationType`, only referenced BY a field's type.
const SCHEMA_TYPES_QUERY = `
  query SchemaTypes {
    __schema {
      types { name }
    }
  }
`;

// Field return TYPES (not just field names) for every query/mutation field
// — `...TypeRef` unwraps up to 3 `ofType` levels of NON_NULL/LIST wrapping
// (this schema never nests deeper than `NonNull(List(NonNull(Type)))`,
// which is 3 wrapper layers around the actual named type: NON_NULL -> LIST
// -> NON_NULL -> Type) down to the underlying named type, e.g.
// `[PlatformConfigGroup!]!` -> `PlatformConfigGroup`. Used to check whether
// a given named type is
// actually REACHABLE from an operation, as opposed to merely PRESENT in
// `__schema.types` (which, per this codebase's own established distinction
// — see `PlatformAdminModule`'s header comment on the
// `OrphanedReferenceRegistry` — can also happen for an orphaned type
// definition unreachable from any operation, which is NOT the leak this
// suite defends against).
const SCHEMA_FIELD_TYPES_QUERY = `
  query SchemaFieldTypes {
    __schema {
      queryType { fields { name type { ...TypeRef } } }
      mutationType { fields { name type { ...TypeRef } } }
    }
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`;

interface SchemaFieldsResponseBody {
  data: {
    __schema: {
      queryType: { fields: { name: string }[] };
      mutationType: { fields: { name: string }[] } | null;
    };
  };
}

interface SchemaTypesResponseBody {
  data: {
    __schema: {
      types: { name: string }[];
    };
  };
}

interface TypeRef {
  kind: string;
  name: string | null;
  ofType: TypeRef | null;
}

interface SchemaFieldTypesResponseBody {
  data: {
    __schema: {
      queryType: { fields: { name: string; type: TypeRef }[] };
      mutationType: { fields: { name: string; type: TypeRef }[] } | null;
    };
  };
}

/** Unwraps NON_NULL/LIST wrapper kinds down to the underlying named type. */
function unwrappedTypeName(type: TypeRef): string | null {
  return type.name ?? (type.ofType ? unwrappedTypeName(type.ofType) : null);
}

// Fields that must NEVER appear on `/graphql` (the public, consumer
// schema) — admin-only surface.
const ADMIN_ONLY_FIELDS = [
  'adminMe',
  'adminLogin',
  'adminLogout',
  'platformSettings',
  'setPlatformSetting',
  // GOS-3x follow-up (2026-08-10) — userAccounts/updateUserAccount/
  // forceUserAccountPasswordReset.
  'userAccounts',
  'updateUserAccount',
  'forceUserAccountPasswordReset',
  // GOS-3x follow-up ("View" row action, 2026-08-11) — the admin panel's
  // Users grid detail view.
  'userAccountDetail',
  // GOS-3x follow-up (hard-delete, 2026-08-11) — replaces the prior round's
  // deactivateUserAccount/reactivateUserAccount/bulkDeactivateUserAccounts.
  'deleteUserAccount',
  'bulkDeleteUserAccounts',
];

// Fields that must NEVER appear on `/admin/graphql` — consumer-only
// surface.
const CONSUMER_ONLY_FIELDS = [
  'me',
  'login',
  'socialLogin',
  'logout',
  'register',
  'verifyEmailCode',
  'resendVerificationCode',
  'requestPasswordReset',
  'resetPassword',
  'categories',
  'myCustomerProfile',
  'myProfessionalProfile',
  'upsertCustomerProfile',
  'upsertProfessionalProfile',
  'platformConfig',
];

/**
 * The automated proof that the two isolated `GraphQLModule.forRoot()`
 * registrations (`/graphql`, `/admin/graphql` — see `src/app.module.ts`)
 * produce genuinely separate schemas with no cross-leakage, in EITHER
 * direction — the exact risk named in the platform-admin plan's spike
 * section, and the two additional transitive-import leaks
 * (`PlatformSettingsModule`→`AuthModule`, `UsersModule`→`PlatformAdminModule`)
 * discovered and fixed while implementing Slice 1 (see
 * `src/platform-admin/platform-settings/platform-settings.module.ts` and
 * `src/platform-admin/platform-admin.module.ts`'s header comments). Also
 * covers the Slice-3 consumer-facing `platformConfig` query (the
 * grouped replacement for the former flat `platformPublicSettings`,
 * 2026-08-09; itself renamed from `platformPublicFeatures` later the same
 * day — pure rename, no behavior change, dropping the redundant "Public"
 * now that the schema isolation itself already communicates "consumer-facing
 * subset") — deliberately reachable from `/graphql` and absent from
 * `/admin/graphql`, the OPPOSITE direction from every other check in this
 * file.
 *
 * Also covers `platformConfig`'s SECOND reshape, same day: from
 * `[PlatformConfigGroup!]!` (one entry per feature, each with a flat
 * `fields: JSON!` map) to a single bare `JSON!` scalar for the whole
 * response — this introduced this codebase's SECOND custom scalar (`JSON`,
 * see `src/common/graphql/json.scalar.ts`) and, in this later reshape,
 * `PlatformConfigGroup` was deleted entirely (no longer used anywhere).
 * While `PlatformConfigGroup` existed, `@nestjs/graphql`'s code-first
 * schema builder kept it as a PROCESS-WIDE "orphaned type" force-included
 * into the ADMIN schema's SDL too, which required `JsonScalar` to ALSO be
 * registered on `PlatformAdminModule` just for the admin schema to finish
 * BUILDING. Re-investigated after `PlatformConfigGroup`'s deletion (see
 * `PlatformAdminModule`'s own header comment for the empirical finding):
 * that dual registration is no longer needed — `JsonScalar` is registered
 * ONLY on the public schema's module now, and `JSON` no longer appears in
 * the admin schema's `__schema.types` at all (checked explicitly below,
 * alongside the still-relevant, stronger property that `JSON` must never be
 * the RETURN TYPE of any REACHABLE admin query/mutation field).
 */
describe('GraphQL schema isolation between /graphql and /admin/graphql (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Introspection defaults to OFF (security-review fix — see
    // `graphql-introspection.e2e-spec.ts`); this suite's whole purpose is
    // to inspect `__schema`, so it explicitly opts back in for its own app
    // instance only.
    const ctx = await createTestApp({ graphqlIntrospectionEnabled: true });
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('the public /graphql schema contains none of the admin-only fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: SCHEMA_FIELDS_QUERY })
      .expect(200);
    const body = response.body as SchemaFieldsResponseBody;

    const allFieldNames = [
      ...body.data.__schema.queryType.fields.map((f) => f.name),
      ...(body.data.__schema.mutationType?.fields.map((f) => f.name) ?? []),
    ];

    for (const adminField of ADMIN_ONLY_FIELDS) {
      expect(allFieldNames).not.toContain(adminField);
    }
  });

  it('the admin /admin/graphql schema contains none of the consumer-only fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: SCHEMA_FIELDS_QUERY })
      .expect(200);
    const body = response.body as SchemaFieldsResponseBody;

    const allFieldNames = [
      ...body.data.__schema.queryType.fields.map((f) => f.name),
      ...(body.data.__schema.mutationType?.fields.map((f) => f.name) ?? []),
    ];

    for (const consumerField of CONSUMER_ONLY_FIELDS) {
      expect(allFieldNames).not.toContain(consumerField);
    }
  });

  it('the admin schema exposes exactly the expected Slice-1+2+3+UserAccounts+SoftDelete surface', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: SCHEMA_FIELDS_QUERY })
      .expect(200);
    const body = response.body as SchemaFieldsResponseBody;

    expect(
      body.data.__schema.queryType.fields.map((f) => f.name).sort(),
    ).toEqual(
      [
        'adminMe',
        'platformSettings',
        'userAccounts',
        // GOS-3x follow-up ("View" row action, 2026-08-11).
        'userAccountDetail',
      ].sort(),
    );
    expect(
      body.data.__schema.mutationType?.fields.map((f) => f.name).sort(),
    ).toEqual(
      [
        'adminLogin',
        'adminLogout',
        'setPlatformSetting',
        'updateUserAccount',
        'forceUserAccountPasswordReset',
        // GOS-3x follow-up (hard-delete, 2026-08-11) — replaces the prior
        // round's deactivateUserAccount/reactivateUserAccount/
        // bulkDeactivateUserAccounts.
        'deleteUserAccount',
        'bulkDeleteUserAccounts',
      ].sort(),
    );
  });

  it("UserAccountModel/UpdateUserAccountInput/ForceUserAccountPasswordResetPayload/DeleteUserAccountPayload/BulkDeleteUserAccountsPayload are never the REACHABLE type of any PUBLIC schema field, even though (like every other admin-only type — CustomerProfile, RegisterPayload, etc. — already visible in admin-schema.gql's own SDL) the type DEFINITION may still appear in the public schema's `__schema.types` as a process-wide orphaned type — see `PlatformAdminModule`'s own header comment on `OrphanedReferenceRegistry` for why that specific class of leak is a known, accepted @nestjs/graphql code-first artifact, not the property this suite defends against", async () => {
    const publicFieldTypesResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: SCHEMA_FIELD_TYPES_QUERY })
      .expect(200);
    const publicFieldTypesBody =
      publicFieldTypesResponse.body as SchemaFieldTypesResponseBody;

    const queryFieldTypeNames =
      publicFieldTypesBody.data.__schema.queryType.fields.map((f) =>
        unwrappedTypeName(f.type),
      );
    const mutationFieldTypeNames = (
      publicFieldTypesBody.data.__schema.mutationType?.fields ?? []
    ).map((f) => unwrappedTypeName(f.type));

    for (const adminOnlyTypeName of [
      'UserAccountModel',
      'UserAccountsPageModel',
      'UpdateUserAccountInput',
      'ForceUserAccountPasswordResetPayload',
      'DeleteUserAccountPayload',
      'BulkDeleteUserAccountsPayload',
      // GOS-3x follow-up ("View" row action, 2026-08-11).
      'UserAccountDetailModel',
    ]) {
      expect(queryFieldTypeNames).not.toContain(adminOnlyTypeName);
      expect(mutationFieldTypeNames).not.toContain(adminOnlyTypeName);
    }
  });

  it('platformConfig is reachable from /graphql (public) and absent from /admin/graphql', async () => {
    const publicResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: SCHEMA_FIELDS_QUERY })
      .expect(200);
    const publicBody = publicResponse.body as SchemaFieldsResponseBody;
    expect(
      publicBody.data.__schema.queryType.fields.map((f) => f.name),
    ).toContain('platformConfig');

    const adminResponse = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: SCHEMA_FIELDS_QUERY })
      .expect(200);
    const adminBody = adminResponse.body as SchemaFieldsResponseBody;
    expect(
      adminBody.data.__schema.queryType.fields.map((f) => f.name),
    ).not.toContain('platformConfig');
  });

  it('the JSON scalar is a genuinely reachable type on the public schema, directly backing platformConfig itself', async () => {
    const publicResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: SCHEMA_TYPES_QUERY })
      .expect(200);
    const publicBody = publicResponse.body as SchemaTypesResponseBody;
    expect(publicBody.data.__schema.types.map((t) => t.name)).toContain('JSON');
    // `PlatformConfigGroup` no longer exists at all (deleted the same day
    // `platformConfig` was reshaped from `[PlatformConfigGroup!]!` to a bare
    // `JSON!` scalar) — confirms it left no dangling type definition behind.
    expect(publicBody.data.__schema.types.map((t) => t.name)).not.toContain(
      'PlatformConfigGroup',
    );

    const publicFieldTypesResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: SCHEMA_FIELD_TYPES_QUERY })
      .expect(200);
    const publicFieldTypesBody =
      publicFieldTypesResponse.body as SchemaFieldTypesResponseBody;
    const platformConfigField =
      publicFieldTypesBody.data.__schema.queryType.fields.find(
        (f) => f.name === 'platformConfig',
      );
    // `platformConfig`'s return type IS `JSON` directly now (unwrapped
    // through the `NonNull` wrapper) — the tree shape itself is covered
    // end-to-end by `test/platform-config.e2e-spec.ts`.
    expect(platformConfigField).toBeDefined();
    expect(unwrappedTypeName(platformConfigField!.type)).toBe('JSON');
  });

  it('the JSON scalar type definition is entirely ABSENT from the admin schema now — `PlatformConfigGroup` (the only reason it was ever force-included there as a process-wide orphaned type) no longer exists', async () => {
    const adminTypesResponse = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: SCHEMA_TYPES_QUERY })
      .expect(200);
    const adminTypesBody = adminTypesResponse.body as SchemaTypesResponseBody;
    expect(adminTypesBody.data.__schema.types.map((t) => t.name)).not.toContain(
      'JSON',
    );
    expect(adminTypesBody.data.__schema.types.map((t) => t.name)).not.toContain(
      'PlatformConfigGroup',
    );

    const adminFieldTypesResponse = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: SCHEMA_FIELD_TYPES_QUERY })
      .expect(200);
    const adminFieldTypesBody =
      adminFieldTypesResponse.body as SchemaFieldTypesResponseBody;

    const queryFieldTypeNames =
      adminFieldTypesBody.data.__schema.queryType.fields.map((f) =>
        unwrappedTypeName(f.type),
      );
    const mutationFieldTypeNames = (
      adminFieldTypesBody.data.__schema.mutationType?.fields ?? []
    ).map((f) => unwrappedTypeName(f.type));

    // Redundant with the `types` check above given JSON/PlatformConfigGroup
    // are absent entirely now, but kept as the still-relevant, stronger
    // property this suite has always actually defended: neither is ever
    // the RETURN TYPE of any REACHABLE admin query/mutation field.
    expect(queryFieldTypeNames).not.toContain('JSON');
    expect(mutationFieldTypeNames).not.toContain('JSON');
    expect(queryFieldTypeNames).not.toContain('PlatformConfigGroup');
    expect(mutationFieldTypeNames).not.toContain('PlatformConfigGroup');
  });
});
