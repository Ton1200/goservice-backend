import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanProfilesData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';
import { waitForUpload } from './support/wait-for-upload';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) { login(input: $input) { sessionToken } }
`;

const REQUEST_PROFILE_PHOTO_UPLOAD_URL_MUTATION = `
  mutation RequestProfilePhotoUploadUrl($input: RequestProfilePhotoUploadUrlInput!) {
    requestProfilePhotoUploadUrl(input: $input) { ref uploadUrl fileUrl expiresAt }
  }
`;

const UPSERT_CUSTOMER_PROFILE_MUTATION = `
  mutation UpsertCustomerProfile($input: UpsertCustomerProfileInput!) {
    upsertCustomerProfile(input: $input) { id photoUrl }
  }
`;

const UPSERT_PROFESSIONAL_PROFILE_MUTATION = `
  mutation UpsertProfessionalProfile($input: UpsertProfessionalProfileInput!) {
    upsertProfessionalProfile(input: $input) { id photoUrl }
  }
`;

const MY_CUSTOMER_PROFILE_QUERY = `
  query { myCustomerProfile { photoUrl } }
`;

const PASSWORD = 'super-secret-1';

interface GqlBody<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function customerInput(): Record<string, unknown> {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    addressLine: 'Av. Siempreviva 742',
    city: 'CABA',
    province: 'Buenos Aires',
  };
}

async function pngBytes(width = 20, height = 20): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe('GraphQL profile-photo upload flow (e2e, GOS-70)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    // Restore the toggle in case a test left it off.
    await prisma.platformSetting
      .updateMany({
        where: { key: 'storage.profile-photo-upload.enabled' },
        data: { value: 'true' },
      })
      .catch(() => undefined);
    await cleanProfilesData(prisma);
    await cleanUsersData(prisma);
    const redisConfig = app.get(ConfigService<AppConfig, true>).get('redis', {
      infer: true,
    });
    const redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    });
    await redis.flushdb();
    await redis.quit();
    await app.close();
  });

  async function seedUser(): Promise<string> {
    const email = uniqueEmail('profiles-photo');
    await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    return email;
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (res.body as GqlBody<{ login: { sessionToken: string } }>).data!
      .login.sessionToken;
  }

  function gql(
    query: string,
    variables: Record<string, unknown>,
    token?: string,
  ) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.expect(200);
  }

  async function requestAndUpload(
    token: string,
    contentType: string,
    bytes: Buffer,
  ): Promise<{ ref: string; fileUrl: string }> {
    const res = await gql(
      REQUEST_PROFILE_PHOTO_UPLOAD_URL_MUTATION,
      {
        input: { fileName: `photo.${contentType.split('/')[1]}`, contentType },
      },
      token,
    );
    const body = res.body as GqlBody<{
      requestProfilePhotoUploadUrl: {
        ref: string;
        uploadUrl: string;
        fileUrl: string;
      };
    }>;
    expect(body.errors).toBeUndefined();
    const { ref, uploadUrl, fileUrl } = body.data!.requestProfilePhotoUploadUrl;
    expect(fileUrl).toMatch(/\.webp$/);
    await request(app.getHttpServer())
      .put(uploadUrl.replace(/^https?:\/\/[^/]+/, ''))
      .set('Content-Type', contentType)
      .send(bytes)
      .expect(200);
    return { ref, fileUrl };
  }

  it('round-trips a PNG into a WebP customer profile photo via photoUploadRef', async () => {
    const email = await seedUser();
    const token = await login(email);

    const { ref, fileUrl } = await requestAndUpload(
      token,
      'image/png',
      await pngBytes(2000, 1500),
    );

    const upsert = await gql(
      UPSERT_CUSTOMER_PROFILE_MUTATION,
      { input: { ...customerInput(), photoUploadRef: ref } },
      token,
    );
    const upsertBody = upsert.body as GqlBody<{
      upsertCustomerProfile: { photoUrl: string };
    }>;
    expect(upsertBody.errors).toBeUndefined();
    expect(upsertBody.data!.upsertCustomerProfile.photoUrl).toBe(fileUrl);

    const my = await gql(MY_CUSTOMER_PROFILE_QUERY, {}, token);
    expect(
      (my.body as GqlBody<{ myCustomerProfile: { photoUrl: string } }>).data!
        .myCustomerProfile.photoUrl,
    ).toBe(fileUrl);

    const get = await waitForUpload(
      app.getHttpServer(),
      fileUrl.replace(/^https?:\/\/[^/]+/, ''),
    );
    expect(get.headers['content-type']).toContain('image/webp');
    const meta = await sharp(get.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      2048,
    );
  });

  it('round-trips a GIF into a WebP professional profile photo via photoUploadRef', async () => {
    const email = await seedUser();
    const token = await login(email);
    const category = await prisma.category.create({
      data: { name: `Cat ${Math.random()}`, displayOrder: 0 },
    });

    const gif = await sharp({
      create: {
        width: 30,
        height: 30,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .gif()
      .toBuffer();
    const { ref, fileUrl } = await requestAndUpload(token, 'image/gif', gif);

    const upsert = await gql(
      UPSERT_PROFESSIONAL_PROFILE_MUTATION,
      {
        input: {
          firstName: 'Juan',
          lastName: 'Perez',
          city: 'CABA',
          serviceAreaDescription: 'CABA',
          bio: 'Trabajo en el rubro.',
          specializations: [
            {
              categoryId: category.id,
              role: 'PRIMARY',
              description: 'Trabajo.',
            },
          ],
          photoUploadRef: ref,
        },
      },
      token,
    );
    const body = upsert.body as GqlBody<{
      upsertProfessionalProfile: { photoUrl: string };
    }>;
    expect(body.errors).toBeUndefined();
    expect(body.data!.upsertProfessionalProfile.photoUrl).toBe(fileUrl);

    const get = await waitForUpload(
      app.getHttpServer(),
      fileUrl.replace(/^https?:\/\/[^/]+/, ''),
    );
    expect((await sharp(get.body as Buffer).metadata()).format).toBe('webp');

    await prisma.professionalSpecialization.deleteMany();
    await prisma.category.delete({ where: { id: category.id } });
  });

  it('rejects a reused ref with INVALID_PROFILE_PHOTO_UPLOAD_REF', async () => {
    const email = await seedUser();
    const token = await login(email);
    const { ref } = await requestAndUpload(
      token,
      'image/png',
      await pngBytes(),
    );

    await gql(
      UPSERT_CUSTOMER_PROFILE_MUTATION,
      { input: { ...customerInput(), photoUploadRef: ref } },
      token,
    );
    const second = await gql(
      UPSERT_CUSTOMER_PROFILE_MUTATION,
      { input: { ...customerInput(), city: 'Cordoba', photoUploadRef: ref } },
      token,
    );
    expect(
      (second.body as GqlBody<unknown>).errors?.[0]?.extensions?.code,
    ).toBe('INVALID_PROFILE_PHOTO_UPLOAD_REF');
  });

  it("rejects another user's ref with INVALID_PROFILE_PHOTO_UPLOAD_REF", async () => {
    const ownerToken = await login(await seedUser());
    const { ref } = await requestAndUpload(
      ownerToken,
      'image/png',
      await pngBytes(),
    );
    const otherToken = await login(await seedUser());

    const res = await gql(
      UPSERT_CUSTOMER_PROFILE_MUTATION,
      { input: { ...customerInput(), photoUploadRef: ref } },
      otherToken,
    );
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'INVALID_PROFILE_PHOTO_UPLOAD_REF',
    );
  });

  it('rejects application/pdf at requestProfilePhotoUploadUrl', async () => {
    const token = await login(await seedUser());
    const res = await gql(
      REQUEST_PROFILE_PHOTO_UPLOAD_URL_MUTATION,
      { input: { fileName: 'x.pdf', contentType: 'application/pdf' } },
      token,
    );
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE',
    );
  });

  it('requires a session', async () => {
    const res = await gql(REQUEST_PROFILE_PHOTO_UPLOAD_URL_MUTATION, {
      input: { fileName: 'x.png', contentType: 'image/png' },
    });
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('returns PROFILE_PHOTO_UPLOAD_DISABLED when the admin toggle is off (request AND upsert)', async () => {
    // Turn the feature off directly at the DB (the dedicated admin mutation
    // is covered by admin-storage-settings.e2e-spec.ts).
    await prisma.platformSetting.upsert({
      where: { key: 'storage.profile-photo-upload.enabled' },
      update: { value: 'false' },
      create: {
        key: 'storage.profile-photo-upload.enabled',
        description: 'test',
        valueType: 'BOOLEAN',
        isEncrypted: false,
        isPublic: false,
        value: 'false',
      },
    });

    try {
      const token = await login(await seedUser());

      const reqRes = await gql(
        REQUEST_PROFILE_PHOTO_UPLOAD_URL_MUTATION,
        { input: { fileName: 'x.png', contentType: 'image/png' } },
        token,
      );
      expect(
        (reqRes.body as GqlBody<unknown>).errors?.[0]?.extensions?.code,
      ).toBe('PROFILE_PHOTO_UPLOAD_DISABLED');

      // A pre-existing ref (created while it was on) also can't be consumed
      // while the feature is off: use any uuid — the toggle check runs first.
      const upsertRes = await gql(
        UPSERT_CUSTOMER_PROFILE_MUTATION,
        {
          input: {
            ...customerInput(),
            photoUploadRef: '00000000-0000-0000-0000-000000000000',
          },
        },
        token,
      );
      expect(
        (upsertRes.body as GqlBody<unknown>).errors?.[0]?.extensions?.code,
      ).toBe('PROFILE_PHOTO_UPLOAD_DISABLED');
    } finally {
      await prisma.platformSetting.updateMany({
        where: { key: 'storage.profile-photo-upload.enabled' },
        data: { value: 'true' },
      });
    }
  });
});
