import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface SystemStatusQueryResponse {
  data: {
    systemStatus: {
      backendStatus: string;
      databaseStatus: string;
      serverTimestamp: string;
    };
  };
}

describe('GraphQL systemStatus (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('resolves systemStatus with the expected shape over the real GraphQL endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `
          query {
            systemStatus {
              backendStatus
              databaseStatus
              serverTimestamp
            }
          }
        `,
      })
      .expect(200);

    const body = response.body as SystemStatusQueryResponse;
    const { systemStatus } = body.data;
    expect(systemStatus).toBeDefined();
    expect(['OK', 'UNAVAILABLE']).toContain(systemStatus.backendStatus);
    expect(['OK', 'UNAVAILABLE']).toContain(systemStatus.databaseStatus);
    expect(Number.isNaN(Date.parse(systemStatus.serverTimestamp))).toBe(false);
  });
});
