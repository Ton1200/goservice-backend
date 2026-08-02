import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const REGISTER_MUTATION = `
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      userId
      emailVerificationRequired
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface RegisterResponseBody {
  data: {
    register: { userId: string; emailVerificationRequired: boolean };
  } | null;
  errors?: GraphQLErrorEntry[];
}

function validVariables(overrides?: Record<string, unknown>) {
  return {
    input: {
      firstName: 'Jane',
      lastName: 'Doe',
      email: `jane-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'super-secret-1',
      phoneCountryCode: '+54',
      phoneNumber: '91123456789',
      dateOfBirth: '1990-05-21',
      acceptedTermsAndPrivacy: true,
      ...overrides,
    },
  };
}

describe('GraphQL register (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    await app.close();
  });

  it('registers successfully and never echoes the plaintext password', async () => {
    const variables = validVariables();

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: REGISTER_MUTATION, variables })
      .expect(200);
    const body = response.body as RegisterResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.register).toEqual({
      userId: expect.any(String) as unknown,
      emailVerificationRequired: true,
    });
    expect(JSON.stringify(body)).not.toContain('super-secret-1');

    const created = await prisma.user.findUnique({
      where: { id: body.data?.register.userId },
    });
    expect(created?.accountStatus).toBe('PENDING_EMAIL_VERIFICATION');
    expect(created?.passwordHash).not.toBe('super-secret-1');
  });

  it('rejects a duplicate email with the generic REGISTRATION_FAILED code', async () => {
    const variables = validVariables();
    await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: REGISTER_MUTATION, variables })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: REGISTER_MUTATION, variables })
      .expect(200);
    const body = response.body as RegisterResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('REGISTRATION_FAILED');
  });

  it('rejects registration with an invalid phone number', async () => {
    const variables = validVariables({ phoneCountryCode: 'not-a-code' });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: REGISTER_MUTATION, variables })
      .expect(200);
    const body = response.body as RegisterResponseBody;

    expect(body.errors?.[0].extensions?.code).toBe('INVALID_PHONE_NUMBER');
  });

  it('rejects registration when terms are not accepted', async () => {
    const variables = validVariables({ acceptedTermsAndPrivacy: false });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: REGISTER_MUTATION, variables })
      .expect(200);
    const body = response.body as RegisterResponseBody;

    expect(body.errors?.[0].extensions?.code).toBe('TERMS_NOT_ACCEPTED');
  });

  it('rejects a mass-assignment attempt (unknown field on RegisterInput)', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `
          mutation Register($input: RegisterInput!) {
            register(input: $input) { userId }
          }
        `,
        variables: {
          input: {
            ...validVariables().input,
            accountStatus: 'APPROVED', // not a declared RegisterInput field
          },
        },
      });
    const body = response.body as RegisterResponseBody;

    // GraphQL's own type system rejects an undeclared input field before
    // the resolver (and its ValidationPipe) ever runs — the input type is
    // structurally closed, per CLAUDE.md's mass-assignment expectations.
    // Apollo Server returns this as an HTTP 400 (document validation
    // failure), unlike a resolver-level execution error (which is HTTP 200
    // with a populated `errors` array) — assert on the error content, not
    // a specific transport status code.
    expect([200, 400]).toContain(response.status);
    expect(body.errors).toBeDefined();
    expect(body.errors?.[0].message).toMatch(/accountStatus/i);
  });
});
