import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './support/test-app';

// Matches `DEFAULT_CORS_ALLOWED_ORIGINS` in `src/config/configuration.ts`
// (the Expo Web dev server default) — a real, allowed origin for this
// suite's assertions.
const ALLOWED_ORIGIN = 'http://localhost:8081';

/**
 * Security-hardening coverage: CORS must be scoped to ONLY the public
 * consumer `/graphql` endpoint (see
 * `src/bootstrap/apply-security-middleware.ts`) — never applied globally.
 * The platform-admin panel and its isolated GraphQL endpoint
 * (`${adminPanelPath}` / `${adminPanelPath}/graphql`) are same-origin with
 * zero legitimate cross-origin callers, and must receive NO
 * `Access-Control-Allow-Origin` header at all, so a real browser blocks any
 * cross-origin request to them by default.
 *
 * `curl`/`supertest` (this suite) don't themselves enforce CORS — this test
 * only proves the RESPONSE HEADER is present/absent as expected; it's the
 * browser's own same-origin policy that turns "header absent" into an
 * actual block for a real cross-origin caller.
 */
describe('CORS is scoped to /graphql only, not /admin/graphql (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets Access-Control-Allow-Origin for an allowed origin on the public /graphql endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Origin', ALLOWED_ORIGIN)
      .send({ query: '{ __typename }' })
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      ALLOWED_ORIGIN,
    );
  });

  it('sets no Access-Control-Allow-Origin header at all on /admin/graphql, even for the same allowed origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .set('Origin', ALLOWED_ORIGIN)
      .send({ query: '{ __typename }' })
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets no Access-Control-Allow-Origin header at all on the static admin panel', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
