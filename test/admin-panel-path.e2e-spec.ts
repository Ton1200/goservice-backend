import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './support/test-app';

interface TypenameResponseBody {
  data?: { __typename?: string } | null;
  errors?: unknown[];
}

/**
 * Security-hardening coverage: `ADMIN_PANEL_PATH` (see
 * `src/config/configuration.ts`'s `adminPanelPath` doc comment and
 * `src/app.module.ts`'s `ServeStaticModule.forRootAsync()` /
 * second `GraphQLModule.forRootAsync()` registrations) must actually work
 * end to end for BOTH the default value and a non-default, operator-chosen
 * value — static files serve, the GraphQL endpoint resolves at
 * `${adminPanelPath}/graphql`, and `exclude` still correctly protects that
 * GraphQL route from being shadowed by static-file serving.
 *
 * Uses `{ __typename }` (a GraphQL meta-field always available regardless
 * of the `graphqlIntrospectionEnabled` setting — unlike `__schema`/`__type`,
 * which introspection gates) as a schema-agnostic way to prove "this really
 * is the GraphQL endpoint responding, not a 404 or a static asset."
 */
describe('ADMIN_PANEL_PATH is configurable end-to-end (e2e)', () => {
  describe('default value (/admin)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      const ctx = await createTestApp();
      app = ctx.app;
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves the static admin panel at /admin/', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/html');
      expect(response.text).toContain('GoService Admin');
    });

    it('resolves the isolated GraphQL endpoint at /admin/graphql', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/graphql')
        .send({ query: '{ __typename }' })
        .expect(200);

      const body = response.body as TypenameResponseBody;
      expect(body.data?.__typename).toBe('Query');
    });
  });

  describe('custom value (ADMIN_PANEL_PATH=/panel-test)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      const ctx = await createTestApp({ adminPanelPath: '/panel-test' });
      app = ctx.app;
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves the static admin panel at the custom mount path', async () => {
      const response = await request(app.getHttpServer())
        .get('/panel-test/')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/html');
      expect(response.text).toContain('GoService Admin');
    });

    it('resolves the isolated GraphQL endpoint at the custom mount path, derived from the same value', async () => {
      const response = await request(app.getHttpServer())
        .post('/panel-test/graphql')
        .send({ query: '{ __typename }' })
        .expect(200);

      const body = response.body as TypenameResponseBody;
      expect(body.data?.__typename).toBe('Query');
    });

    it('no longer serves anything at the default /admin path once overridden', async () => {
      await request(app.getHttpServer()).get('/admin/').expect(404);
      await request(app.getHttpServer())
        .post('/admin/graphql')
        .send({ query: '{ __typename }' })
        .expect(404);
    });
  });
});
