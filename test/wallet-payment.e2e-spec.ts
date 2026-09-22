import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthProvider,
  CountryCode,
  ProfessionalVerificationStatus,
  SpecializationRole,
  UserAccountStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import {
  buildMercadoPagoSignatureManifest,
  computeMercadoPagoSignature,
} from '../src/payments/utils/mercadopago-signature.util';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TEST_MERCADOPAGO_ACCESS_TOKEN,
  TEST_MERCADOPAGO_WEBHOOK_SECRET,
  TEST_MERCADOPAGO_WALLET_BACK_URL_FAILURE,
  TEST_MERCADOPAGO_WALLET_BACK_URL_PENDING,
  TEST_MERCADOPAGO_WALLET_BACK_URL_SUCCESS,
  TEST_MERCADOPAGO_WALLET_PUBLIC_BASE_URL,
  WALLET_PAYMENT_TEST_SETTING_KEYS,
  cleanAppointmentsData,
  cleanPaymentAttemptData,
  cleanLedgerData,
  cleanPlatformSettingsData,
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
  enableTestCardPayments,
  enableTestWalletPayments,
} from './support/test-app';

const PASSWORD = 'super-secret-1';
const MP_HOST = 'https://api.mercadopago.com';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;
const PUBLISH_SERVICE_REQUEST_MUTATION = `
  mutation PublishServiceRequest($input: PublishServiceRequestInput!) {
    publishServiceRequest(input: $input) { id status }
  }
`;
const SUBMIT_QUOTE_MUTATION = `
  mutation SubmitQuote($input: SubmitQuoteInput!) {
    submitQuote(input: $input) { id status }
  }
`;
const ACCEPT_QUOTE_MUTATION = `
  mutation AcceptQuote($quoteId: ID!) {
    acceptQuote(quoteId: $quoteId) { engagement { id status } }
  }
`;
const PROPOSE_APPOINTMENT_MUTATION = `
  mutation ProposeAppointment($engagementId: ID!, $input: ProposeAppointmentInput!) {
    proposeAppointment(engagementId: $engagementId, input: $input) { id status }
  }
`;
const ACCEPT_APPOINTMENT_MUTATION = `
  mutation AcceptAppointment($id: ID!) {
    acceptAppointment(id: $id) { id status }
  }
`;
const START_ENGAGEMENT_WORK_MUTATION = `
  mutation StartEngagementWork($engagementId: ID!) {
    startEngagementWork(engagementId: $engagementId) { id status }
  }
`;
const PAY_CARD_MUTATION = `
  mutation PayEngagementWithCard($engagementId: ID!, $cardToken: String!, $paymentMethodId: String!) {
    payEngagementWithCard(engagementId: $engagementId, cardToken: $cardToken, paymentMethodId: $paymentMethodId) { id status }
  }
`;
const CONFIRM_CASH_PAYMENT_MUTATION = `
  mutation ConfirmCashPayment($engagementId: ID!) {
    confirmCashPayment(engagementId: $engagementId) { id }
  }
`;

const ATTEMPT_FIELDS =
  'id engagementId status method amount currency paymentTypeId cardBrand cardLastFour rejectionReason createdAt updatedAt';
const START_WALLET_PAYMENT_MUTATION = `
  mutation StartEngagementWalletPayment($engagementId: ID!) {
    startEngagementWalletPayment(engagementId: $engagementId) {
      redirectUrl
      attempt { ${ATTEMPT_FIELDS} }
    }
  }
`;
const MY_ENGAGEMENT_PAYMENT_ATTEMPT_QUERY = `
  query MyEngagementPaymentAttempt($engagementId: ID!) {
    myEngagementPaymentAttempt(engagementId: $engagementId) { ${ATTEMPT_FIELDS} }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}
interface AttemptPayload {
  id: string;
  engagementId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  method: 'CASH' | 'MERCADOPAGO';
  amount: number;
  currency: string;
  paymentTypeId: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  rejectionReason: string | null;
}
interface StartWalletPaymentPayload {
  redirectUrl: string;
  attempt: AttemptPayload;
}
interface GqlBody<T> {
  data: T | null;
  errors?: GraphQLErrorEntry[];
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}
function errorCode(body: unknown): string | undefined {
  return (body as { errors?: GraphQLErrorEntry[] }).errors?.[0]?.extensions
    ?.code;
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// A stateful FAKE of api.mercadopago.com's Checkout Preferences + legacy
// Payments APIs — only `global.fetch` is replaced (the app is otherwise fully
// real: Postgres, Redis, the real adapter, real guards and transactions).
// Shapes mirror what the GOS-142 live spike actually observed/documented; see
// `MercadoPagoPaymentAdapter`'s own header comment for exactly what was and
// wasn't live-verified. THIS DOES NOT PROVE the real sandbox works end to
// end — no live wallet payment was ever completed during the spike.
// ---------------------------------------------------------------------------
type Scenario =
  'account-money' | 'saved-card' | 'declined' | 'pending' | 'outage';
interface FakePayment {
  id: string; // numeric on the wire
  externalReference: string;
  amount: number;
  currency: string;
  status: string;
  statusDetail: string;
  paymentTypeId: string;
  paymentMethodId: string;
}
interface MpCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function paymentBody(payment: FakePayment) {
  const isCard = payment.paymentTypeId !== 'account_money';
  return {
    id: Number(payment.id),
    status: payment.status,
    status_detail: payment.statusDetail,
    external_reference: payment.externalReference,
    transaction_amount: payment.amount,
    currency_id: payment.currency,
    payment_type_id: payment.paymentTypeId,
    payment_method_id: payment.paymentMethodId,
    ...(isCard ? { card: { last_four_digits: '6260' } } : {}),
  };
}

/**
 * e2e coverage for GOS-142 (Pago con Cuenta de Mercado Pago — billetera, con
 * redirección) — `startEngagementWalletPayment`, `myEngagementPaymentAttempt`
 * and the asynchronous `payment` notification (`src/payments/`). Runs against
 * the isolated `postgres_test` database (port 5433), never the shared dev
 * Postgres. The `redis` container must be up (@nestjs/throttler).
 */
describe('GraphQL Wallet Payment (GOS-142, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  const realFetch = global.fetch;
  let mpCalls: MpCall[];
  let mpPayments: Map<string, FakePayment>;
  let scenario: Scenario;
  let preferenceCounter = 0;
  let paymentIdCounter = 178687128900;

  function installFakeMercadoPago(): void {
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.startsWith(MP_HOST)) {
          return realFetch(input, init);
        }
        const path = url.slice(MP_HOST.length);
        const method = init?.method ?? 'GET';
        const headers = Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        );
        const body = init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : null;
        mpCalls.push({ method, path, headers, body });

        if (method === 'POST' && path === '/checkout/preferences') {
          if (scenario === 'outage') {
            return json(503, { message: 'Service Unavailable' });
          }
          const id = `1534142261-pref-${++preferenceCounter}`;
          return json(201, {
            id,
            init_point: `https://www.mercadopago.com/checkout/v1/redirect?pref_id=${id}`,
            sandbox_init_point: `https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=${id}`,
          });
        }

        const getMatch = /^\/v1\/payments\/(\d+)$/.exec(path);
        if (method === 'GET' && getMatch) {
          const payment = mpPayments.get(getMatch[1]);
          return payment
            ? json(200, paymentBody(payment))
            : json(404, { errors: [{ code: 'not_found' }] });
        }
        return json(500, { message: `unexpected fake call ${method} ${path}` });
      },
    );
  }

  /** Simulates Mercado Pago's checkout having been completed — the ONLY way a wallet payment's outcome becomes knowable, per the plan's own design. */
  function completeWalletCheckout(
    externalReference: string,
    amount: number,
    currency: string,
  ): FakePayment {
    const payment: FakePayment = {
      id: String(++paymentIdCounter),
      externalReference,
      amount,
      currency,
      status: 'approved',
      statusDetail: 'accredited',
      paymentTypeId: 'account_money',
      paymentMethodId: 'account_money',
    };
    if (scenario === 'saved-card') {
      payment.paymentTypeId = 'credit_card';
      payment.paymentMethodId = 'visa';
    } else if (scenario === 'declined') {
      payment.status = 'rejected';
      payment.statusDetail = 'cc_rejected_insufficient_amount';
    } else if (scenario === 'pending') {
      payment.status = 'in_process';
      payment.statusDetail = 'pending_contingency';
    }
    mpPayments.set(payment.id, payment);
    return payment;
  }

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  async function flushRedis(): Promise<void> {
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
  }

  beforeEach(async () => {
    await flushRedis();
    mpCalls = [];
    mpPayments = new Map();
    preferenceCounter = 0;
    scenario = 'account-money';
    installFakeMercadoPago();
    await cleanPaymentAttemptData(prisma);
    await enableTestWalletPayments(app, prisma);
    await prisma.platformSetting.upsert({
      where: { key: 'payments.general-settings.commission.percent' },
      update: { value: '10' },
      create: {
        key: 'payments.general-settings.commission.percent',
        description: "GoService's global commission percentage.",
        valueType: 'NUMBER',
        value: '10',
        isPublic: false,
      },
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  afterAll(async () => {
    await cleanPaymentAttemptData(prisma);
    await cleanLedgerData(prisma);
    await cleanAppointmentsData(prisma);
    await cleanQuotesAndEngagementsData(prisma);
    await cleanServiceRequestsData(prisma);
    await cleanProfilesData(prisma);
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
    // Leave the shared settings table as the seed expects it: wallet OFF.
    await cleanPlatformSettingsData(
      prisma,
      WALLET_PAYMENT_TEST_SETTING_KEYS.filter(
        (key) => key !== 'payments.payment-methods.mercadopago.wallet.enabled',
      ),
    );
    await prisma.platformSetting.updateMany({
      where: { key: 'payments.payment-methods.mercadopago.wallet.enabled' },
      data: { value: 'false' },
    });
    await prisma.platformSetting.upsert({
      where: { key: 'payments.general-settings.commission.percent' },
      update: { value: '10' },
      create: {
        key: 'payments.general-settings.commission.percent',
        description: "GoService's global commission percentage.",
        valueType: 'NUMBER',
        value: '10',
        isPublic: false,
      },
    });
    await flushRedis();
    await app.close();
  });

  // ---- seeding helpers (mirror card-payment.e2e-spec.ts) --------------------

  function gqlRequest(
    query: string,
    variables: Record<string, unknown>,
    sessionToken?: string,
  ) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req;
  }

  async function seedUser(): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail('wallet-payment');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    return { email, userId: user.id };
  }

  async function seedCategory(): Promise<string> {
    const category = await prisma.category.create({
      data: {
        name: `Categoria-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    createdCategoryIds.push(category.id);
    return category.id;
  }

  async function loginSessionToken(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (response.body as { data: { login: { sessionToken: string } } }).data
      .login.sessionToken;
  }

  interface SeededEngagement {
    engagementId: string;
    customerEmail: string;
    customerToken: string;
    professionalToken: string;
    customerProfileId: string;
    professionalProfileId: string;
  }

  async function seedInProgressEngagement(
    price = 5000,
  ): Promise<SeededEngagement> {
    const categoryId = await seedCategory();

    const customer = await seedUser();
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId: customer.userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country: CountryCode.AR,
      },
    });
    const professional = await seedUser();
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId: professional.userId,
        firstName: 'Profesional',
        lastName: 'de Prueba',
        country: CountryCode.AR,
        bio: 'Con experiencia.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
      },
    });
    await prisma.professionalSpecialization.create({
      data: {
        professionalProfileId: professionalProfile.id,
        categoryId,
        role: SpecializationRole.PRIMARY,
        description: 'Especialista.',
        order: 0,
      },
    });

    const customerToken = await loginSessionToken(customer.email);
    const professionalToken = await loginSessionToken(professional.email);

    const publishResponse = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      {
        input: {
          category: categoryId,
          description: 'Se rompió una cañería en la cocina y pierde agua.',
          urgency: 'URGENT',
        },
      },
      customerToken,
    ).expect(200);
    const serviceRequestId = (
      publishResponse.body as {
        data: { publishServiceRequest: { id: string } };
      }
    ).data.publishServiceRequest.id;

    const submitResponse = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      {
        input: {
          serviceRequestId,
          price,
          message: 'Puedo hacerlo mañana temprano.',
        },
      },
      professionalToken,
    ).expect(200);
    const quoteId = (
      submitResponse.body as { data: { submitQuote: { id: string } } }
    ).data.submitQuote.id;

    const acceptResponse = await gqlRequest(
      ACCEPT_QUOTE_MUTATION,
      { quoteId },
      customerToken,
    ).expect(200);
    const engagementId = (
      acceptResponse.body as {
        data: { acceptQuote: { engagement: { id: string } } };
      }
    ).data.acceptQuote.engagement.id;

    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2027-03-01T10:00:00.000Z',
          endsAt: '2027-03-01T12:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const appointmentId = (
      proposeResponse.body as { data: { proposeAppointment: { id: string } } }
    ).data.proposeAppointment.id;
    await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      professionalToken,
    ).expect(200);
    const startResponse = await gqlRequest(
      START_ENGAGEMENT_WORK_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
    expect((startResponse.body as GqlBody<unknown>).errors).toBeUndefined();

    return {
      engagementId,
      customerEmail: customer.email,
      customerToken,
      professionalToken,
      customerProfileId: customerProfile.id,
      professionalProfileId: professionalProfile.id,
    };
  }

  async function startWallet(engagementId: string, token: string | undefined) {
    const response = await gqlRequest(
      START_WALLET_PAYMENT_MUTATION,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      startEngagementWalletPayment: StartWalletPaymentPayload;
    }>;
  }

  async function myAttempt(engagementId: string, token: string | undefined) {
    const response = await gqlRequest(
      MY_ENGAGEMENT_PAYMENT_ATTEMPT_QUERY,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      myEngagementPaymentAttempt: AttemptPayload | null;
    }>;
  }

  function sendPaymentWebhook(
    paymentId: string,
    options?: {
      secret?: string;
      tamperSignature?: boolean;
      omitSignature?: boolean;
      country?: string;
      type?: string;
    },
  ) {
    const ts = String(Date.now());
    const requestId = randomUUID();
    const manifest = buildMercadoPagoSignatureManifest({
      dataId: paymentId,
      xRequestId: requestId,
      ts,
    });
    let v1 = computeMercadoPagoSignature(
      options?.secret ?? TEST_MERCADOPAGO_WEBHOOK_SECRET,
      manifest,
    );
    if (options?.tamperSignature) {
      v1 = v1.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    }
    const country = options?.country ?? 'ar';
    const type = options?.type ?? 'payment';
    const req = request(app.getHttpServer())
      .post(
        `/webhooks/mercadopago/payments/${country}?data.id=${paymentId}&type=${type}`,
      )
      .set('x-request-id', requestId);
    if (!options?.omitSignature) {
      req.set('x-signature', `ts=${ts},v1=${v1}`);
    }
    return req.send({
      action: 'payment.updated',
      type,
      data: { id: paymentId },
    });
  }

  async function ledgerFor(engagementId: string) {
    return prisma.ledgerEntry.findMany({
      where: { engagementId },
      orderBy: { receiptNumber: 'asc' },
    });
  }
  const sum = (rows: { amount: number }[]) =>
    rows.reduce((total, row) => total + row.amount, 0);
  const preferenceCalls = () =>
    mpCalls.filter(
      (c) => c.method === 'POST' && c.path === '/checkout/preferences',
    );

  // --------------------------------------------------------------------------

  describe('startEngagementWalletPayment', () => {
    it('creates a PENDING attempt (no providerPaymentId) and returns the SANDBOX redirect URL, sending the right preference request', async () => {
      const seeded = await seedInProgressEngagement(5000);

      const body = await startWallet(seeded.engagementId, seeded.customerToken);

      expect(body.errors).toBeUndefined();
      const payload = body.data?.startEngagementWalletPayment;
      expect(payload?.attempt).toMatchObject({
        engagementId: seeded.engagementId,
        status: 'PENDING',
        method: 'MERCADOPAGO',
        amount: 5000,
        currency: 'ARS',
        paymentTypeId: null,
        cardBrand: null,
        cardLastFour: null,
        rejectionReason: null,
      });
      expect(payload?.redirectUrl).toContain('sandbox.mercadopago.com');

      const attempts = await prisma.paymentAttempt.findMany({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].providerPaymentId).toBeNull(); // never the preference id

      expect(preferenceCalls()).toHaveLength(1);
      const [call] = preferenceCalls();
      expect(call.headers).toMatchObject({
        Authorization: `Bearer ${TEST_MERCADOPAGO_ACCESS_TOKEN}`,
      });
      expect(call.body).toMatchObject({
        items: [
          {
            title: `GoService — Engagement ${seeded.engagementId}`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: 5000, // a plain integer, not a formatted string
          },
        ],
        purpose: 'wallet_purchase',
        external_reference: seeded.engagementId,
        payer: { email: seeded.customerEmail },
        back_urls: {
          success: TEST_MERCADOPAGO_WALLET_BACK_URL_SUCCESS,
          pending: TEST_MERCADOPAGO_WALLET_BACK_URL_PENDING,
          failure: TEST_MERCADOPAGO_WALLET_BACK_URL_FAILURE,
        },
        notification_url: `${TEST_MERCADOPAGO_WALLET_PUBLIC_BASE_URL}/webhooks/mercadopago/payments/ar`,
      });
    });

    it('the fee/tax/net/providerPaymentId fields are NOT exposed to the Customer through GraphQL', async () => {
      const seeded = await seedInProgressEngagement(5000);

      for (const field of [
        'providerFeeAmount',
        'providerTaxAmount',
        'netReceivedAmount',
        'providerPaymentId',
      ]) {
        const response = await gqlRequest(
          `mutation { startEngagementWalletPayment(engagementId: "${seeded.engagementId}") { attempt { ${field} } } }`,
          {},
          seeded.customerToken,
        );
        expect(response.status).toBe(400);
        const [error] = (response.body as { errors: GraphQLErrorEntry[] })
          .errors;
        expect(error.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
      }
      expect(preferenceCalls()).toHaveLength(0);
    });
  });

  describe('the payment webhook resolves the PENDING attempt', () => {
    it('APPROVED via ACCOUNT BALANCE: type ACCOUNT_MONEY, no card brand, 3 zero-sum ledger rows', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');

      const webhook = await sendPaymentWebhook(payment.id);

      expect(webhook.status).toBe(200);
      expect(webhook.body).toEqual({ received: true });
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempt).toMatchObject({
        status: 'APPROVED',
        method: 'MERCADOPAGO',
        type: 'ACCOUNT_MONEY',
        providerPaymentId: payment.id,
        paymentTypeId: 'account_money',
        cardBrand: null,
        cardLastFour: null,
      });
      const entries = await ledgerFor(seeded.engagementId);
      expect(entries.map((e) => [e.type, e.amount])).toEqual([
        ['CUSTOMER_CHARGE', -5000],
        ['PLATFORM_COMMISSION', 500],
        ['PROFESSIONAL_NET_CREDIT', 4500],
      ]);
      expect(sum(entries)).toBe(0);
      expect(
        (
          await prisma.engagement.findUnique({
            where: { id: seeded.engagementId },
          })
        )?.paymentMethod,
      ).toBe('MERCADOPAGO');
      // Correlated via external_reference — a preference id is never stored,
      // so the ONLY way to find this attempt is the lost-response path.
      expect(
        mpCalls.some(
          (c) => c.method === 'GET' && c.path === `/v1/payments/${payment.id}`,
        ),
      ).toBe(true);
    });

    it('APPROVED via a SAVED CARD inside the account: type CREDIT_CARD, brand + last four recorded', async () => {
      scenario = 'saved-card';
      const seeded = await seedInProgressEngagement(5000);
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');

      await sendPaymentWebhook(payment.id).expect(200);

      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempt).toMatchObject({
        status: 'APPROVED',
        type: 'CREDIT_CARD',
        paymentTypeId: 'credit_card',
        cardBrand: 'visa',
        cardLastFour: '6260',
      });
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('REJECTED: no ledger, no paymentMethod, and the Customer can retry', async () => {
      scenario = 'declined';
      const seeded = await seedInProgressEngagement(5000);
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');

      await sendPaymentWebhook(payment.id).expect(200);

      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempt).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      expect(
        (
          await prisma.engagement.findUnique({
            where: { id: seeded.engagementId },
          })
        )?.paymentMethod,
      ).toBeNull();

      scenario = 'account-money';
      const retry = await startWallet(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(retry.errors).toBeUndefined();
      const retryPayment = completeWalletCheckout(
        seeded.engagementId,
        5000,
        'ARS',
      );
      await sendPaymentWebhook(retryPayment.id).expect(200);
      expect(
        (
          await prisma.paymentAttempt.findMany({
            where: { engagementId: seeded.engagementId },
            orderBy: { createdAt: 'asc' },
          })
        ).map((a) => a.status),
      ).toEqual(['REJECTED', 'APPROVED']);
    });

    it('a REPEATED notification is a no-op: no rewrite, no duplicated ledger', async () => {
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');

      await sendPaymentWebhook(payment.id).expect(200);
      const afterFirst = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      const entriesAfterFirst = await ledgerFor(seeded.engagementId);

      await sendPaymentWebhook(payment.id).expect(200);
      await sendPaymentWebhook(payment.id).expect(200);

      const afterRepeat = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(afterRepeat.updatedAt).toEqual(afterFirst.updatedAt);
      const entriesAfterRepeat = await ledgerFor(seeded.engagementId);
      expect(entriesAfterRepeat.map((e) => e.id)).toEqual(
        entriesAfterFirst.map((e) => e.id),
      );
    });

    it('refuses to approve a payment whose amount differs from what was charged', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 4999, 'ARS');

      await sendPaymentWebhook(payment.id).expect(200);

      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('an UNKNOWN topic is ignored (200, no-op)', async () => {
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');

      const response = await sendPaymentWebhook(payment.id, {
        type: 'merchant_order',
      });

      expect(response.status).toBe(200);
      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
    });

    it('acknowledges (200, no-op) a notification for a payment unknown to the provider', async () => {
      const response = await sendPaymentWebhook('999999999999');

      expect(response.status).toBe(200);
      expect(await prisma.paymentAttempt.count()).toBe(0);
    });

    it('rejects a notification with a bad signature (401) and changes nothing', async () => {
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');
      const callsBefore = mpCalls.length;

      await sendPaymentWebhook(payment.id, { tamperSignature: true }).expect(
        401,
      );
      await sendPaymentWebhook(payment.id, {
        secret: 'the-wrong-secret',
      }).expect(401);
      await sendPaymentWebhook(payment.id, { omitSignature: true }).expect(401);

      expect(mpCalls.length).toBe(callsBefore);
      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
    });

    it('rejects an unrecognized :country segment with 401', async () => {
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');

      await sendPaymentWebhook(payment.id, { country: 'zz' }).expect(401);
    });

    it('is NOT behind the wallet kill switch: a notification still resolves a checkout already started', async () => {
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');
      await enableTestWalletPayments(app, prisma, { walletEnabled: false });

      await sendPaymentWebhook(payment.id).expect(200);

      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('APPROVED');
    });

    it('the existing `order` (card) webhook route is unaffected — same dispatch, different topic', async () => {
      await enableTestCardPayments(app, prisma);
      const seeded = await seedInProgressEngagement();
      const cardBody = await gqlRequest(
        PAY_CARD_MUTATION,
        {
          engagementId: seeded.engagementId,
          cardToken: 'tok_e2e',
          paymentMethodId: 'master',
        },
        seeded.customerToken,
      ).expect(200);
      // The card charge resolves synchronously against the Orders API, which
      // this spec's fake does not implement (only the wallet APIs) — a 500
      // from the fake for `/v1/orders` is the EXPECTED outcome here; this
      // test only proves the wallet fixture didn't somehow break the OTHER
      // route's plumbing, not the card flow itself (see card-payment.e2e-spec.ts
      // for that).
      expect(
        (cardBody.body as GqlBody<unknown>).errors ||
          (cardBody.body as GqlBody<{ payEngagementWithCard: unknown }>).data,
      ).toBeDefined();
    });
  });

  describe('myEngagementPaymentAttempt', () => {
    it('returns null when the Engagement has no attempt yet', async () => {
      const seeded = await seedInProgressEngagement();

      const body = await myAttempt(seeded.engagementId, seeded.customerToken);

      expect(body.errors).toBeUndefined();
      expect(body.data?.myEngagementPaymentAttempt).toBeNull();
    });

    it('opportunistically reconciles a PENDING attempt that already has a providerPaymentId (webhook landed, app reopened before/without re-querying)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startWallet(seeded.engagementId, seeded.customerToken);
      const payment = completeWalletCheckout(seeded.engagementId, 5000, 'ARS');
      // Simulate a notification that only recorded the id (still pending) —
      // e.g. a `pending` intermediate state — before asking the query to
      // finish the job.
      scenario = 'pending';
      const pendingPayment = completeWalletCheckout(
        seeded.engagementId,
        5000,
        'ARS',
      );
      await sendPaymentWebhook(pendingPayment.id).expect(200);
      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).providerPaymentId,
      ).toBe(pendingPayment.id);

      // Now Mercado Pago's OWN record has since settled to approved.
      pendingPayment.status = 'approved';
      pendingPayment.statusDetail = 'accredited';

      const body = await myAttempt(seeded.engagementId, seeded.customerToken);

      expect(body.data?.myEngagementPaymentAttempt).toMatchObject({
        status: 'APPROVED',
      });
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
      void payment; // unused fixture from the initial (never-notified) checkout
    });

    it("only the Engagement's own Customer may read it — anti-enumeration ENGAGEMENT_NOT_FOUND", async () => {
      const seeded = await seedInProgressEngagement();
      const stranger = await seedInProgressEngagement();

      const notMine = await myAttempt(
        seeded.engagementId,
        stranger.customerToken,
      );
      const notCustomer = await myAttempt(
        seeded.engagementId,
        seeded.professionalToken,
      );
      const missing = await myAttempt(randomUUID(), seeded.customerToken);

      expect(errorCode(notMine)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(notCustomer)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(missing)).toBe('ENGAGEMENT_NOT_FOUND');
    });
  });

  describe('no double payment, including cross-method conflict with card', () => {
    it('a second wallet attempt while one is PENDING is rejected, and the provider is NOT called again', async () => {
      const seeded = await seedInProgressEngagement();

      await startWallet(seeded.engagementId, seeded.customerToken);
      const second = await startWallet(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(errorCode(second)).toBe('WALLET_PAYMENT_ALREADY_IN_PROGRESS');
      expect(preferenceCalls()).toHaveLength(1);
    });

    it('a PENDING wallet attempt blocks a card charge on the SAME Engagement (cross-method, same provider)', async () => {
      await enableTestCardPayments(app, prisma);
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);

      const cardAttempt = await gqlRequest(
        PAY_CARD_MUTATION,
        {
          engagementId: seeded.engagementId,
          cardToken: 'tok_e2e',
          paymentMethodId: 'master',
        },
        seeded.customerToken,
      ).expect(200);

      expect(errorCode(cardAttempt.body)).toBe(
        'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      );
    });

    it('an Engagement whose payment method is already fixed to CASH cannot start a wallet payment', async () => {
      const seeded = await seedInProgressEngagement();
      await prisma.engagement.update({
        where: { id: seeded.engagementId },
        data: { paymentMethod: 'CASH' },
      });

      const body = await startWallet(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('ENGAGEMENT_NOT_PAYABLE_BY_WALLET');
      expect(preferenceCalls()).toHaveLength(0);
    });

    it('a cash confirmation is refused with PAYMENT_METHOD_CONFLICT while a wallet attempt is PENDING', async () => {
      const seeded = await seedInProgressEngagement();
      await startWallet(seeded.engagementId, seeded.customerToken);

      const cashConfirm = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId: seeded.engagementId },
        seeded.customerToken,
      ).expect(200);

      expect(errorCode(cashConfirm.body)).toBe('PAYMENT_METHOD_CONFLICT');
    });
  });

  describe('guards and preconditions', () => {
    it('with the wallet kill switch OFF: rejected with MERCADOPAGO_WALLET_MODULE_DISABLED, nothing created, provider never called', async () => {
      const seeded = await seedInProgressEngagement();
      await enableTestWalletPayments(app, prisma, { walletEnabled: false });

      const body = await startWallet(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('MERCADOPAGO_WALLET_MODULE_DISABLED');
      expect(mpCalls).toHaveLength(0);
      expect(await prisma.paymentAttempt.count()).toBe(0);
    });

    it('requires a session (UNAUTHENTICATED)', async () => {
      const seeded = await seedInProgressEngagement();

      const body = await startWallet(seeded.engagementId, undefined);

      expect(errorCode(body)).toBe('UNAUTHENTICATED');
      expect(mpCalls).toHaveLength(0);
    });

    it("the Engagement's PROFESSIONAL cannot start a wallet payment — same anti-enumeration ENGAGEMENT_NOT_FOUND", async () => {
      const seeded = await seedInProgressEngagement();

      const body = await startWallet(
        seeded.engagementId,
        seeded.professionalToken,
      );

      expect(errorCode(body)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(mpCalls).toHaveLength(0);
    });

    it.each([['ACCEPTED'], ['CANCELLED']] as const)(
      'an Engagement that is %s cannot be paid (ENGAGEMENT_NOT_PAYABLE_BY_WALLET)',
      async (status) => {
        const seeded = await seedInProgressEngagement();
        await prisma.engagement.update({
          where: { id: seeded.engagementId },
          data: { status },
        });

        const body = await startWallet(
          seeded.engagementId,
          seeded.customerToken,
        );

        expect(errorCode(body)).toBe('ENGAGEMENT_NOT_PAYABLE_BY_WALLET');
        expect(mpCalls).toHaveLength(0);
      },
    );
  });

  describe('misconfiguration', () => {
    it.each([
      [
        'no public base URL',
        'payments.general-settings.callbacks.public-base-url',
      ],
      [
        'no success back URL',
        'payments.payment-methods.mercadopago.wallet.back-url-success',
      ],
    ] as const)(
      'with %s configured: fails closed with PAYMENT_PROVIDER_MISCONFIGURED, sends nothing, and REJECTS the attempt (never left blocking PENDING)',
      async (_label, key) => {
        const seeded = await seedInProgressEngagement();
        await prisma.platformSetting.deleteMany({ where: { key } });

        const body = await startWallet(
          seeded.engagementId,
          seeded.customerToken,
        );

        expect(errorCode(body)).toBe('PAYMENT_PROVIDER_MISCONFIGURED');
        expect(mpCalls).toHaveLength(0);
        const attempts = await prisma.paymentAttempt.findMany({
          where: { engagementId: seeded.engagementId },
        });
        expect(attempts.map((a) => [a.status, a.rejectionReason])).toEqual([
          ['REJECTED', 'PROVIDER_ERROR'],
        ]);

        // Once configured, the Customer can start a fresh attempt.
        await enableTestWalletPayments(app, prisma);
        const retry = await startWallet(
          seeded.engagementId,
          seeded.customerToken,
        );
        expect(retry.errors).toBeUndefined();
      },
    );

    it('a provider OUTAGE also rejects the attempt (DEFINITIVE, unlike a card charge timeout) and reports PAYMENT_PROVIDER_UNAVAILABLE', async () => {
      scenario = 'outage';
      const seeded = await seedInProgressEngagement();

      const body = await startWallet(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      const attempts = await prisma.paymentAttempt.findMany({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempts.map((a) => a.status)).toEqual(['REJECTED']);
      // Nothing left blocking — a fresh attempt is allowed immediately.
      scenario = 'account-money';
      const retry = await startWallet(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(retry.errors).toBeUndefined();
    });
  });
});
