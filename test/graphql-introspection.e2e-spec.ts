import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './support/test-app';

const INTROSPECTION_QUERY = `
  query Introspection {
    __schema {
      types { name }
    }
  }
`;

interface IntrospectionResponseBody {
  data?: { __schema?: { types: { name: string }[] } } | null;
  errors?: unknown[];
}

/**
 * Security-review fix: GraphQL introspection must be disabled by default on
 * BOTH the public `/graphql` endpoint and the isolated `/admin/graphql`
 * endpoint — see `src/app.module.ts`'s `GraphQLModule.forRootAsync()`
 * registrations and `graphqlIntrospectionEnabled` in
 * `src/config/configuration.ts`. Apollo Server's own default
 * (introspection on whenever `NODE_ENV !== 'production'`) is the same class
 * of framework default `includeStacktraceInErrorResponses` already refuses
 * to trust — this suite is the regression guard for that.
 *
 * Deliberately uses the PLAIN `createTestApp()` (no
 * `graphqlIntrospectionEnabled` override) so it exercises the real default,
 * not a test-only opt-in — compare `admin-schema-isolation.e2e-spec.ts`,
 * which explicitly opts INTO introspection because inspecting `__schema` is
 * that suite's whole purpose.
 */
describe('GraphQL introspection is disabled by default (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an introspection query on the public /graphql endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: INTROSPECTION_QUERY });

    const body = response.body as IntrospectionResponseBody;
    expect(body.errors).toBeDefined();
    expect(body.data?.__schema).toBeUndefined();
  });

  it('rejects an introspection query on the /admin/graphql endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: INTROSPECTION_QUERY });

    const body = response.body as IntrospectionResponseBody;
    expect(body.errors).toBeDefined();
    expect(body.data?.__schema).toBeUndefined();
  });
});
