import { INestApplication } from '@nestjs/common';
import {
  AdminUserStatus,
  AuthProvider,
  CountryCode,
  Permission,
  UserAccountStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanAdminUsersData,
  cleanProfilesData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';
import { waitForUpload } from './support/wait-for-upload';

const ADMIN_LOGIN = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const REQUEST_UPLOAD_URL = `
  mutation R($input: RequestUserProfilePhotoUploadUrlInput!) {
    requestUserProfilePhotoUploadUrl(input: $input) { uploadUrl publicUrl }
  }
`;

const SET_PHOTO = `
  mutation S($input: SetUserProfilePhotoInput!) {
    setUserProfilePhoto(input: $input) { id customerProfile { photoUrl } }
  }
`;

const REMOVE_PHOTO = `
  mutation Rm($input: RemoveUserProfilePhotoInput!) {
    removeUserProfilePhoto(input: $input) { id customerProfile { photoUrl } }
  }
`;

const PASSWORD = 'super-secret-admin-photo-1';

interface GqlBody<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

function uniqueEmail(prefix: string): string {
  const s = Math.random().toString(36).slice(2).padEnd(8, '0').slice(0, 8);
  return `${prefix}-${Date.now()}-${s}@example.com`;
}

describe('GraphQL /admin/graphql — admin manages a consumer profile photo (e2e, GOS-70)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdRoleIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanProfilesData(prisma);
    await cleanUsersData(prisma);
    await cleanAdminUsersData(prisma);
    await prisma.adminRole.deleteMany({
      where: { id: { in: createdRoleIds } },
    });
    await app.close();
  });

  async function seedAdmin(perms: Permission[]): Promise<string> {
    const role = await prisma.adminRole.create({
      data: { name: `PHOTO_ADMIN_${Math.random()}`, permissions: perms },
    });
    createdRoleIds.push(role.id);
    const email = uniqueEmail('photo-admin');
    await prisma.adminUser.create({
      data: {
        email,
        displayName: 'E2E',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        roleId: role.id,
        status: AdminUserStatus.ACTIVE,
      },
    });
    const res = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({
        query: ADMIN_LOGIN,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (res.body as GqlBody<{ adminLogin: { sessionToken: string } }>).data!
      .adminLogin.sessionToken;
  }

  async function seedConsumerWithCustomerProfile(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail('consumer'),
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
        customerProfile: {
          create: {
            firstName: 'Jane',
            lastName: 'Doe',
            addressLine: 'Calle 1',
            city: 'CABA',
            province: 'BA',
            country: CountryCode.AR,
          },
        },
      },
    });
    return user.id;
  }

  function adminGql(token: string | null, query: string, variables: unknown) {
    const req = request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  it('requires USER_ACCOUNTS_WRITE', async () => {
    const token = await seedAdmin([Permission.USER_ACCOUNTS_READ]);
    const res = await adminGql(token, REQUEST_UPLOAD_URL, {
      input: { fileName: 'p.png', contentType: 'image/png' },
    }).expect(200);
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'ADMIN_FORBIDDEN',
    );
  });

  it('rejects an external photoUrl on setUserProfilePhoto', async () => {
    const token = await seedAdmin([Permission.USER_ACCOUNTS_WRITE]);
    const userId = await seedConsumerWithCustomerProfile();
    const res = await adminGql(token, SET_PHOTO, {
      input: {
        userId,
        profileKind: 'CUSTOMER',
        photoUrl: 'https://evil.example.com/x.webp',
      },
    }).expect(200);
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'INVALID_PROFILE_PHOTO_URL',
    );
  });

  it('rejects a profileKind the user does not have', async () => {
    const token = await seedAdmin([Permission.USER_ACCOUNTS_WRITE]);
    const userId = await seedConsumerWithCustomerProfile();
    const req = await adminGql(token, REQUEST_UPLOAD_URL, {
      input: { fileName: 'p.png', contentType: 'image/png' },
    }).expect(200);
    const { publicUrl } = (
      req.body as GqlBody<{
        requestUserProfilePhotoUploadUrl: { publicUrl: string };
      }>
    ).data!.requestUserProfilePhotoUploadUrl;
    const res = await adminGql(token, SET_PHOTO, {
      input: { userId, profileKind: 'PROFESSIONAL', photoUrl: publicUrl },
    }).expect(200);
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'PROFESSIONAL_PROFILE_NOT_FOUND',
    );
  });

  it('uploads → attaches (WebP) → removes a customer profile photo', async () => {
    const token = await seedAdmin([Permission.USER_ACCOUNTS_WRITE]);
    const userId = await seedConsumerWithCustomerProfile();

    const reqRes = await adminGql(token, REQUEST_UPLOAD_URL, {
      input: { fileName: 'p.png', contentType: 'image/png' },
    }).expect(200);
    const { uploadUrl, publicUrl } = (
      reqRes.body as GqlBody<{
        requestUserProfilePhotoUploadUrl: {
          uploadUrl: string;
          publicUrl: string;
        };
      }>
    ).data!.requestUserProfilePhotoUploadUrl;
    expect(publicUrl).toMatch(/\.webp$/);

    const png = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();
    await request(app.getHttpServer())
      .put(uploadUrl.replace(/^https?:\/\/[^/]+/, ''))
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(200);
    await waitForUpload(
      app.getHttpServer(),
      publicUrl.replace(/^https?:\/\/[^/]+/, ''),
    );

    const setRes = await adminGql(token, SET_PHOTO, {
      input: { userId, profileKind: 'CUSTOMER', photoUrl: publicUrl },
    }).expect(200);
    const setBody = setRes.body as GqlBody<{
      setUserProfilePhoto: { customerProfile: { photoUrl: string } };
    }>;
    expect(setBody.errors).toBeUndefined();
    expect(setBody.data!.setUserProfilePhoto.customerProfile.photoUrl).toBe(
      publicUrl,
    );

    const removeRes = await adminGql(token, REMOVE_PHOTO, {
      input: { userId, profileKind: 'CUSTOMER' },
    }).expect(200);
    expect(
      (
        removeRes.body as GqlBody<{
          removeUserProfilePhoto: {
            customerProfile: { photoUrl: string | null };
          };
        }>
      ).data!.removeUserProfilePhoto.customerProfile.photoUrl,
    ).toBeNull();
  });
});
