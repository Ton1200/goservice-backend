import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressOwnerRole,
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
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CARD_PAYMENT_TEST_SETTING_KEYS,
  RAPYD_PAYMENT_TEST_SETTING_KEYS,
  TEST_MERCADOPAGO_WALLET_PUBLIC_BASE_URL,
  TEST_RAPYD_ACCESS_KEY,
  TEST_RAPYD_SECRET_KEY,
  cleanAppointmentsData,
  cleanLedgerData,
  cleanPaymentAttemptData,
  cleanPlatformSettingsData,
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
  enableTestCardPayments,
  enableTestRapydPayments,
} from './support/test-app';

const PASSWORD = 'super-secret-1';
const RAPYD_HOST = 'https://sandboxapi.rapyd.net';
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
    payEngagementWithCard(engagementId: $engagementId, cardToken: $cardToken, paymentMethodId: $paymentMethodId) { id status method }
  }
`;
const CONFIRM_CASH_PAYMENT_MUTATION = `
  mutation ConfirmCashPayment($engagementId: ID!) {
    confirmCashPayment(engagementId: $engagementId) { id }
  }
`;

const ATTEMPT_FIELDS =
  'id engagementId status method amount currency installments paymentTypeId cardBrand cardLastFour rejectionReason';
const START_RAPYD_MUTATION = `
  mutation StartEngagementRapydCheckout($engagementId: ID!) {
    startEngagementRapydCheckout(engagementId: $engagementId) {
      attemptId
      checkoutId
      toolkitScriptUrl
    }
  }
`;
const ABANDON_MUTATION = `
  mutation AbandonEngagementPaymentAttempt($engagementId: ID!) {
    abandonEngagementPaymentAttempt(engagementId: $engagementId) { ${ATTEMPT_FIELDS} }
  }
`;
const MY_ATTEMPT_QUERY = `
  query MyEngagementPaymentAttempt($engagementId: ID!) {
    myEngagementPaymentAttempt(engagementId: $engagementId) { ${ATTEMPT_FIELDS} }
  }
`;
const AVAILABLE_METHODS_QUERY = `
  query AvailablePaymentMethods($engagementId: ID!) {
    availablePaymentMethods(engagementId: $engagementId) { method kind displayName }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}
interface GqlBody<T> {
  data: T | null;
  errors?: GraphQLErrorEntry[];
}
interface AttemptPayload {
  id: string;
  engagementId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  method: 'CASH' | 'MERCADOPAGO' | 'RAPYD';
  amount: number;
  currency: string;
  installments: number;
  paymentTypeId: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  rejectionReason: string | null;
}
interface StartRapydPayload {
  attemptId: string;
  checkoutId: string;
  toolkitScriptUrl: string;
}
interface OptionPayload {
  method: string;
  kind: string;
  displayName: string;
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
// A stateful FAKE of sandboxapi.rapyd.net's checkout + payments endpoints (and
// the two Mercado Pago endpoints the cross-provider tests need) — only
// `global.fetch` is replaced (the app is otherwise fully real: Postgres,
// Redis, the real adapters, real guards and transactions). Shapes mirror the
// GOS-75 PoC's live observations (`NEW` + empty nested payment → `DON` +
// `CLO`/`paid:true`; `ACT` awaiting 3DS) plus the documented EXP/DEC/INP
// checkout statuses. THIS DOES NOT PROVE the real Rapyd sandbox works end to
// end, and the failed-payment / card-detail field names are UNVERIFIED guesses.
// ---------------------------------------------------------------------------
type RapydScenario = 'ok' | 'outage' | 'timeout' | 'unauthorized';
interface FakePayment {
  id: string;
  status: string;
  paid: boolean;
  amount: number;
  currency_code: string;
  merchant_reference_id: string;
  failure_code?: string;
  payment_method_data?: Record<string, unknown>;
}
interface FakeCheckout {
  id: string;
  status: 'NEW' | 'INP' | 'DON' | 'EXP' | 'DEC';
  amount: number;
  currency: string;
  merchantReference: string;
  payment: FakePayment | null;
}
interface RapydCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function checkoutBody(checkout: FakeCheckout) {
  return {
    status: { status: 'SUCCESS', error_code: '' },
    data: {
      id: checkout.id,
      status: checkout.status,
      amount: checkout.amount,
      currency: checkout.currency,
      merchant_reference_id: checkout.merchantReference,
      payment: checkout.payment ?? {
        id: null,
        status: null,
        paid: false,
        amount: checkout.amount,
        currency_code: checkout.currency,
        merchant_reference_id: null,
      },
    },
  };
}

/**
 * e2e coverage for GOS-146 (Rapyd, embedded Checkout Toolkit, multi-provider) —
 * `startEngagementRapydCheckout`, `abandonEngagementPaymentAttempt`,
 * `availablePaymentMethods`, `myEngagementPaymentAttempt` (Rapyd
 * reconciliation) and `POST /webhooks/rapyd` (`src/payments/`). Runs
 * against the isolated `postgres_test` database (port 5433), never the shared
 * dev Postgres. The `redis` container must be up (@nestjs/throttler).
 */
describe('GraphQL Rapyd Payment + multi-provider (GOS-146, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  const realFetch = global.fetch;
  let rapydCalls: RapydCall[];
  let mpCalls: { method: string; path: string }[];
  let checkouts: Map<string, FakeCheckout>;
  let payments: Map<string, FakePayment>;
  let rapydScenario: RapydScenario;
  let mpOrderStatus: 'approved' | 'pending';

  function installFakes(): void {
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const method = init?.method ?? 'GET';
        const headers = Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        );

        if (url.startsWith(MP_HOST)) {
          const path = url.slice(MP_HOST.length);
          mpCalls.push({ method, path });
          if (method === 'POST' && path === '/v1/orders') {
            const body = JSON.parse(init?.body as string) as {
              external_reference: string;
              total_amount: string;
            };
            return json(201, {
              id: `ORD_E2E_${mpCalls.length}`,
              status: mpOrderStatus === 'approved' ? 'processed' : 'processing',
              status_detail:
                mpOrderStatus === 'approved' ? 'accredited' : 'in_process',
              external_reference: body.external_reference,
              total_amount: body.total_amount,
              currency: 'ARS',
            });
          }
          if (method === 'GET' && path.startsWith('/v1/payments/search?')) {
            return json(200, { results: [] });
          }
          return json(500, { message: `unexpected MP call ${method} ${path}` });
        }

        if (!url.startsWith(RAPYD_HOST)) {
          return realFetch(input, init);
        }
        const path = url.slice(RAPYD_HOST.length);
        const body = init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : null;
        rapydCalls.push({ method, path, headers, body });

        if (method === 'POST' && path === '/v1/checkout') {
          if (rapydScenario === 'unauthorized') {
            return json(401, {
              status: { error_code: 'UNAUTHORIZED_API_CALL' },
            });
          }
          if (rapydScenario === 'outage') {
            return json(503, {});
          }
          // Like the REAL sandbox (verified live 2026-09-21): the `idempotency`
          // header is NOT honored on POST /v1/checkout — every create makes a
          // NEW checkout, even with the same key.
          const checkout: FakeCheckout = {
            id: `checkout_${randomBytes(8).toString('hex')}`,
            status: 'NEW',
            amount: body?.amount as number,
            currency: body?.currency as string,
            merchantReference: body?.merchant_reference_id as string,
            payment: null,
          };
          checkouts.set(checkout.id, checkout);
          if (rapydScenario === 'timeout') {
            // Rapyd CREATED it, but the response never made it back.
            throw new DOMException('aborted', 'TimeoutError');
          }
          return json(200, checkoutBody(checkout));
        }

        const checkoutMatch = /^\/v1\/checkout\/(checkout_[a-z0-9]+)$/.exec(
          path,
        );
        if (method === 'GET' && checkoutMatch) {
          const checkout = checkouts.get(checkoutMatch[1]);
          return checkout
            ? json(200, checkoutBody(checkout))
            : json(404, { status: { error_code: 'ERROR_GET_CHECKOUT' } });
        }
        const paymentMatch = /^\/v1\/payments\/(payment_[a-z0-9]+)$/.exec(path);
        if (method === 'GET' && paymentMatch) {
          const payment = payments.get(paymentMatch[1]);
          return payment
            ? json(200, { status: { status: 'SUCCESS' }, data: payment })
            : json(404, { status: { error_code: 'ERROR_GET_PAYMENT' } });
        }
        return json(500, {
          message: `unexpected Rapyd call ${method} ${path}`,
        });
      },
    );
  }

  /** What happens INSIDE Rapyd's widget — the only way an outcome becomes knowable. */
  function payInWidget(
    checkoutId: string,
    kind: 'paid' | '3ds' | 'declined',
    overrides?: { amount?: number },
  ): FakePayment {
    const checkout = checkouts.get(checkoutId);
    if (!checkout) throw new Error(`no fake checkout ${checkoutId}`);
    const payment: FakePayment = {
      id: `payment_${randomBytes(8).toString('hex')}`,
      status: 'CLO',
      paid: true,
      amount: overrides?.amount ?? checkout.amount,
      currency_code: checkout.currency,
      merchant_reference_id: checkout.merchantReference,
      payment_method_data: {
        last4: '1111',
        bin_details: { brand: 'VISA', type: 'CREDIT' },
      },
    };
    if (kind === '3ds') {
      payment.status = 'ACT';
      payment.paid = false;
      checkout.status = 'INP';
    } else if (kind === 'declined') {
      payment.status = 'ERR';
      payment.paid = false;
      payment.failure_code = 'ERROR_CARD_DECLINED';
      // The widget lets the Customer retry inside the SAME checkout.
      checkout.status = 'NEW';
    } else {
      checkout.status = 'DON';
    }
    checkout.payment = payment;
    payments.set(payment.id, payment);
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

  async function setFlag(key: string, value: boolean): Promise<void> {
    await prisma.platformSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: {
        key,
        description: 'e2e flag',
        valueType: 'BOOLEAN',
        isPublic: false,
        value: String(value),
      },
    });
  }

  async function ensureCommission(): Promise<void> {
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
  }

  beforeEach(async () => {
    await flushRedis();
    rapydCalls = [];
    mpCalls = [];
    checkouts = new Map();
    payments = new Map();
    rapydScenario = 'ok';
    mpOrderStatus = 'approved';
    installFakes();
    await cleanPaymentAttemptData(prisma);
    await enableTestRapydPayments(app, prisma);
    await enableTestCardPayments(app, prisma);
    await ensureCommission();
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
    // Leave the shared settings table as the seed expects it: both providers
    // OFF. The kill-switch rows are reset to 'false' — NOT deleted: a MISSING
    // row is fail-open in `PlatformSettingPort.isEnabled`.
    await cleanPlatformSettingsData(
      prisma,
      [
        ...RAPYD_PAYMENT_TEST_SETTING_KEYS,
        ...CARD_PAYMENT_TEST_SETTING_KEYS,
      ].filter(
        (key) =>
          key !== 'payments.payment-methods.rapyd.enabled' &&
          key !== 'payments.payment-methods.mercadopago.card.enabled',
      ),
    );
    await prisma.platformSetting.updateMany({
      where: {
        key: {
          in: [
            'payments.payment-methods.rapyd.enabled',
            'payments.payment-methods.mercadopago.card.enabled',
          ],
        },
      },
      data: { value: 'false' },
    });
    await ensureCommission();
    await flushRedis();
    await app.close();
  });

  // ---- seeding helpers (mirror wallet-payment.e2e-spec.ts) -------------------

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
    const email = uniqueEmail('rapyd-payment');
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
    customerToken: string;
    professionalToken: string;
  }

  async function seedInProgressEngagement(
    price = 5000,
    country: CountryCode = CountryCode.AR,
  ): Promise<SeededEngagement> {
    const categoryId = await seedCategory();

    const customer = await seedUser();
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId: customer.userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country,
      },
    });
    // GOS-155 — publishServiceRequest now requires a resolvable addressId;
    // this seeds the caller's own default Address so it can fall back to it.
    await prisma.address.create({
      data: {
        ownerRole: AddressOwnerRole.CUSTOMER,
        customerProfileId: customerProfile.id,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        placeId: `place-${Date.now()}-${Math.random()}`,
        latitude: -34.6037,
        longitude: -58.3816,
        isDefault: true,
      },
    });
    const professional = await seedUser();
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId: professional.userId,
        firstName: 'Profesional',
        lastName: 'de Prueba',
        country,
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

    return { engagementId, customerToken, professionalToken };
  }

  async function startRapyd(engagementId: string, token: string | undefined) {
    const response = await gqlRequest(
      START_RAPYD_MUTATION,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      startEngagementRapydCheckout: StartRapydPayload;
    }>;
  }

  async function startRapydOk(
    seeded: SeededEngagement,
  ): Promise<StartRapydPayload> {
    const body = await startRapyd(seeded.engagementId, seeded.customerToken);
    expect(body.errors).toBeUndefined();
    return body.data!.startEngagementRapydCheckout;
  }

  async function myAttempt(engagementId: string, token: string | undefined) {
    const response = await gqlRequest(
      MY_ATTEMPT_QUERY,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      myEngagementPaymentAttempt: AttemptPayload | null;
    }>;
  }

  async function abandon(engagementId: string, token: string | undefined) {
    const response = await gqlRequest(
      ABANDON_MUTATION,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      abandonEngagementPaymentAttempt: AttemptPayload;
    }>;
  }

  async function payMercadoPagoCard(
    engagementId: string,
    token: string | undefined,
  ) {
    const response = await gqlRequest(
      PAY_CARD_MUTATION,
      { engagementId, cardToken: 'tok_e2e', paymentMethodId: 'visa' },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      payEngagementWithCard: { id: string; status: string; method: string };
    }>;
  }

  async function availableMethods(
    engagementId: string,
    token: string | undefined,
  ) {
    const response = await gqlRequest(
      AVAILABLE_METHODS_QUERY,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      availablePaymentMethods: OptionPayload[];
    }>;
  }

  /**
   * A Rapyd notification, signed EXACTLY per the documented webhook formula
   * (url_path + salt + timestamp + access_key + secret_key + body). The claimed
   * status in the body is deliberately a lie (`CLO`, `paid`, amount 1): the
   * backend must ignore it and re-read Rapyd.
   */
  function sendRapydWebhook(
    resourceId: string,
    options?: {
      secret?: string;
      tamperSignature?: boolean;
      omitSignature?: boolean;
    },
  ) {
    const body = JSON.stringify({
      id: `wh_${randomUUID()}`,
      type: 'PAYMENT_COMPLETED',
      data: { id: resourceId, status: 'CLO', paid: true, amount: 1 },
      status: 'NEW',
      created_at: Math.floor(Date.now() / 1000),
    });
    const salt = randomBytes(6).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = options?.secret ?? TEST_RAPYD_SECRET_KEY;
    // ONE webhook URL for the whole (multi-country) Rapyd account.
    const url = `${TEST_MERCADOPAGO_WALLET_PUBLIC_BASE_URL}/webhooks/rapyd`;
    const hex = createHmac('sha256', secret)
      .update(url + salt + timestamp + TEST_RAPYD_ACCESS_KEY + secret + body)
      .digest('hex');
    let signature = Buffer.from(hex).toString('base64');
    if (options?.tamperSignature) {
      signature = signature.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    }
    const req = request(app.getHttpServer())
      .post('/webhooks/rapyd')
      .set('Content-Type', 'application/json')
      .set('salt', salt)
      .set('timestamp', timestamp);
    if (!options?.omitSignature) {
      req.set('signature', signature);
    }
    return req.send(body);
  }

  async function ledgerFor(engagementId: string) {
    return prisma.ledgerEntry.findMany({
      where: { engagementId },
      orderBy: { receiptNumber: 'asc' },
    });
  }
  const sum = (rows: { amount: number }[]) =>
    rows.reduce((total, row) => total + row.amount, 0);
  const createCalls = () =>
    rapydCalls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout');
  const attemptsOf = (engagementId: string) =>
    prisma.paymentAttempt.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
    });
  const engagementMethod = async (engagementId: string) =>
    (await prisma.engagement.findUnique({ where: { id: engagementId } }))
      ?.paymentMethod;

  // --------------------------------------------------------------------------

  describe('startEngagementRapydCheckout', () => {
    it('creates a RAPYD PENDING attempt (instalments 1) with its checkout id, and returns the checkout id + SANDBOX toolkit script — no redirect URL', async () => {
      const seeded = await seedInProgressEngagement(5000);

      const payload = await startRapydOk(seeded);

      expect(payload.checkoutId).toMatch(/^checkout_/);
      expect(payload.toolkitScriptUrl).toBe(
        'https://sandboxcheckouttoolkit.rapyd.net',
      );
      expect(payload).not.toHaveProperty('redirectUrl');
      const attempts = await attemptsOf(seeded.engagementId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        id: payload.attemptId,
        method: 'RAPYD',
        status: 'PENDING',
        amount: 5000,
        currency: 'ARS',
        installments: 1,
        providerCheckoutId: payload.checkoutId,
        providerPaymentId: null,
      });
      expect(await engagementMethod(seeded.engagementId)).toBeNull();
    });

    it('sends the checkout request with SERVER-derived values, the Engagement id as merchant reference and the attempt id as idempotency key — never a method restriction, fake redirect URLs or escrow', async () => {
      const seeded = await seedInProgressEngagement(5000);

      const payload = await startRapydOk(seeded);

      expect(createCalls()).toHaveLength(1);
      const [call] = createCalls();
      expect(call.headers['access_key']).toBe(TEST_RAPYD_ACCESS_KEY);
      expect(call.headers['idempotency']).toBe(payload.attemptId);
      expect(call.headers['signature']).toBeTruthy();
      expect(JSON.stringify(call.headers)).not.toContain(TEST_RAPYD_SECRET_KEY);
      expect(call.body).toMatchObject({
        amount: 5000,
        currency: 'ARS',
        country: 'AR',
        merchant_reference_id: seeded.engagementId,
      });
      for (const forbidden of [
        'payment_method_types_include',
        'complete_checkout_url',
        'error_checkout_url',
        'escrow',
      ]) {
        expect(call.body).not.toHaveProperty(forbidden);
      }
    });

    it('a COLOMBIAN Customer pays through the SAME single credential set: the checkout carries country CO / COP and is signed with the one account key (no per-country keys exist)', async () => {
      const seeded = await seedInProgressEngagement(30000, CountryCode.CO);

      const payload = await startRapydOk(seeded);

      const [call] = createCalls();
      expect(call.body).toMatchObject({
        amount: 30000,
        currency: 'COP',
        country: 'CO',
      });
      expect(call.headers['access_key']).toBe(TEST_RAPYD_ACCESS_KEY);
      const payment = payInWidget(payload.checkoutId, 'paid');
      await sendRapydWebhook(payment.id).expect(200);
      expect((await attemptsOf(seeded.engagementId))[0]).toMatchObject({
        status: 'APPROVED',
        currency: 'COP',
      });
    });

    it('the provider ids and fees are NOT exposed through GraphQL', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startRapydOk(seeded);

      for (const field of [
        'providerPaymentId',
        'providerCheckoutId',
        'providerFeeAmount',
        'netReceivedAmount',
      ]) {
        const response = await gqlRequest(
          `query { myEngagementPaymentAttempt(engagementId: "${seeded.engagementId}") { ${field} } }`,
          {},
          seeded.customerToken,
        );
        expect(response.status).toBe(400);
        expect(
          (response.body as { errors: GraphQLErrorEntry[] }).errors[0]
            .extensions?.code,
        ).toBe('GRAPHQL_VALIDATION_FAILED');
      }
    });

    it('is Customer-only: the Professional, a stranger and no session are all refused, and nothing is created', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const stranger = await seedUser();
      const strangerToken = await loginSessionToken(stranger.email);

      const asProfessional = await startRapyd(
        seeded.engagementId,
        seeded.professionalToken,
      );
      const asStranger = await startRapyd(seeded.engagementId, strangerToken);
      const anonymous = await startRapyd(seeded.engagementId, undefined);

      expect(errorCode(asProfessional)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(asStranger)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(anonymous)).toBe('UNAUTHENTICATED');
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(0);
      expect(rapydCalls).toHaveLength(0);
    });

    it('is refused once the Engagement is committed to CASH', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId: seeded.engagementId },
        seeded.customerToken,
      ).expect(200);

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect([
        'ENGAGEMENT_NOT_PAYABLE_BY_CARD',
        'PAYMENT_METHOD_CONFLICT',
      ]).toContain(errorCode(body));
      expect(createCalls()).toHaveLength(0);
    });
  });

  describe('the Rapyd webhook resolves the PENDING attempt (it re-reads Rapyd, never trusts the body)', () => {
    it('APPROVED: CREDIT_CARD type, brand + last four, the 3 zero-sum ledger rows and Engagement.paymentMethod = RAPYD', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, 'paid');

      const webhook = await sendRapydWebhook(payment.id);

      expect(webhook.status).toBe(200);
      expect(webhook.body).toEqual({ received: true });
      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt).toMatchObject({
        status: 'APPROVED',
        method: 'RAPYD',
        providerPaymentId: payment.id,
        providerCheckoutId: checkoutId,
        type: 'CREDIT_CARD',
        paymentTypeId: 'credit_card',
        cardBrand: 'visa',
        cardLastFour: '1111',
      });
      const entries = await ledgerFor(seeded.engagementId);
      expect(entries.map((e) => [e.type, e.amount])).toEqual([
        ['CUSTOMER_CHARGE', -5000],
        ['PLATFORM_COMMISSION', 500],
        ['PROFESSIONAL_NET_CREDIT', 4500],
      ]);
      expect(sum(entries)).toBe(0);
      expect(await engagementMethod(seeded.engagementId)).toBe('RAPYD');
      // It re-read Rapyd's real state.
      expect(
        rapydCalls.some(
          (c) => c.method === 'GET' && c.path === `/v1/checkout/${checkoutId}`,
        ),
      ).toBe(true);
    });

    it('a CHECKOUT-id notification approves the same way', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      payInWidget(checkoutId, 'paid');

      await sendRapydWebhook(checkoutId).expect(200);

      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt.status).toBe('APPROVED');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('the body claiming CLO/paid is IGNORED when Rapyd says the checkout is unpaid — the attempt stays PENDING', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      // Nobody paid anything in the widget.

      await sendRapydWebhook(checkoutId).expect(200);

      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt.status).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('a PAYMENT awaiting 3D Secure keeps the attempt PENDING (and records its payment id)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, '3ds');

      await sendRapydWebhook(payment.id).expect(200);

      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt.status).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('REJECTED when the checkout itself ended without a payment (blocked/expired): no ledger, no paymentMethod, and the Customer can start again', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      checkouts.get(checkoutId)!.status = 'DEC';

      await sendRapydWebhook(checkoutId).expect(200);

      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt.status).toBe('REJECTED');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      expect(await engagementMethod(seeded.engagementId)).toBeNull();

      const retry = await startRapyd(seeded.engagementId, seeded.customerToken);
      expect(retry.errors).toBeUndefined();
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(2);
    });

    it('a FAILED payment inside a still-open checkout does NOT reject the attempt — the Customer retries in the same widget and the successful retry is recorded (no charge is ever lost)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const failed = payInWidget(checkoutId, 'declined');

      await sendRapydWebhook(failed.id).expect(200);
      const [afterFailure] = await attemptsOf(seeded.engagementId);
      expect(afterFailure.status).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);

      const retry = payInWidget(checkoutId, 'paid');
      await sendRapydWebhook(retry.id).expect(200);

      const [afterRetry] = await attemptsOf(seeded.engagementId);
      expect(afterRetry).toMatchObject({
        status: 'APPROVED',
        providerPaymentId: retry.id,
      });
      expect(sum(await ledgerFor(seeded.engagementId))).toBe(0);
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('a repeated / duplicated notification is a NO-OP — exactly one ledger event', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, 'paid');

      await sendRapydWebhook(payment.id).expect(200);
      await sendRapydWebhook(payment.id).expect(200);
      await sendRapydWebhook(checkoutId).expect(200);

      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(1);
    });

    it('an amount that does not reconcile is NOT approved — the attempt stays PENDING, no ledger', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, 'paid', { amount: 1 });

      await sendRapydWebhook(payment.id).expect(200);

      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt.status).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('a payment for a Rapyd id GoService does not know is ignored (200, nothing written)', async () => {
      await sendRapydWebhook('payment_deadbeefdeadbeef').expect(200);
      await sendRapydWebhook('checkout_deadbeefdeadbeef').expect(200);

      expect(await prisma.paymentAttempt.count()).toBe(0);
    });

    it.each([
      ['a tampered signature', { tamperSignature: true }],
      ['a missing signature', { omitSignature: true }],
      ['a signature made with another secret', { secret: 'not-the-secret' }],
    ])(
      'answers a generic 401 for %s and applies nothing',
      async (_l, options) => {
        const seeded = await seedInProgressEngagement(5000);
        const { checkoutId } = await startRapydOk(seeded);
        const payment = payInWidget(checkoutId, 'paid');

        const webhook = await sendRapydWebhook(payment.id, options);

        expect(webhook.status).toBe(401);
        const [attempt] = await attemptsOf(seeded.engagementId);
        expect(attempt.status).toBe('PENDING');
        expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      },
    );

    it('answers 401 — and never calls Rapyd — when the keys or the public URL are not configured (fails closed)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, 'paid');
      rapydCalls.length = 0;

      for (const key of [
        'payments.payment-methods.rapyd.secret-key',
        'payments.general-settings.callbacks.public-base-url',
      ]) {
        const row = await prisma.platformSetting.findUniqueOrThrow({
          where: { key },
        });
        await prisma.platformSetting.delete({ where: { key } });

        const webhook = await sendRapydWebhook(payment.id);

        expect(webhook.status).toBe(401);
        await prisma.platformSetting.create({
          data: {
            key: row.key,
            description: row.description,
            valueType: row.valueType,
            isEncrypted: row.isEncrypted,
            isPublic: row.isPublic,
            value: row.value,
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.authTag,
            maskedPreview: row.maskedPreview,
            provider: row.provider,
          },
        });
      }
      expect(rapydCalls).toHaveLength(0);
      expect((await attemptsOf(seeded.engagementId))[0].status).toBe('PENDING');
    });

    it('is NOT behind the module kill switch — a payment already in flight is still resolved when Rapyd is switched off', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, 'paid');
      await setFlag('payments.payment-methods.rapyd.enabled', false);

      await sendRapydWebhook(payment.id).expect(200);

      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt.status).toBe('APPROVED');
    });
  });

  describe('myEngagementPaymentAttempt reconciles a Rapyd attempt that only has a checkout id', () => {
    it('no webhook, no payment id: the query re-reads the checkout and applies the paid result', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const [before] = await attemptsOf(seeded.engagementId);
      expect(before.providerPaymentId).toBeNull();
      payInWidget(checkoutId, 'paid');

      const body = await myAttempt(seeded.engagementId, seeded.customerToken);

      expect(body.errors).toBeUndefined();
      expect(body.data?.myEngagementPaymentAttempt).toMatchObject({
        status: 'APPROVED',
        method: 'RAPYD',
        cardBrand: 'visa',
        cardLastFour: '1111',
      });
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
      expect(await engagementMethod(seeded.engagementId)).toBe('RAPYD');
    });

    it('still PENDING (nobody paid) returns the attempt untouched; a Rapyd outage NEVER fails the query', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startRapydOk(seeded);

      const unpaid = await myAttempt(seeded.engagementId, seeded.customerToken);
      expect(unpaid.data?.myEngagementPaymentAttempt?.status).toBe('PENDING');

      global.fetch = jest.fn(() =>
        Promise.reject(new TypeError('fetch failed')),
      );
      const outage = await myAttempt(seeded.engagementId, seeded.customerToken);
      expect(outage.errors).toBeUndefined();
      expect(outage.data?.myEngagementPaymentAttempt?.status).toBe('PENDING');
    });
  });

  describe('failures while creating the checkout', () => {
    it('a timeout (outcome unknown) leaves the attempt PENDING and answers PAYMENT_PROVIDER_UNAVAILABLE; a restart REUSES that attempt and records the new checkout id (Rapyd does not dedupe, so the timed-out call leaves an orphan checkout — documented)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      rapydScenario = 'timeout';

      const first = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect(errorCode(first)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      const [pending] = await attemptsOf(seeded.engagementId);
      expect(pending).toMatchObject({
        status: 'PENDING',
        providerCheckoutId: null,
      });

      rapydScenario = 'ok';
      const second = await startRapydOk(seeded);

      expect(await attemptsOf(seeded.engagementId)).toHaveLength(1);
      expect(second.attemptId).toBe(pending.id);
      // Rapyd does NOT honor the idempotency header (verified live): the checkout
      // the timed-out call made is an ORPHAN next to the one now on the attempt.
      expect(checkouts.size).toBe(2);
      const [resumed] = await attemptsOf(seeded.engagementId);
      expect(resumed.providerCheckoutId).toBe(second.checkoutId);
    });

    it('a 5xx is also "unknown": the attempt stays PENDING', async () => {
      const seeded = await seedInProgressEngagement(5000);
      rapydScenario = 'outage';

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      expect((await attemptsOf(seeded.engagementId))[0].status).toBe('PENDING');
    });

    it('credentials rejected by Rapyd -> the attempt is REJECTED (so it does not block the Engagement) and the country misconfiguration error', async () => {
      const seeded = await seedInProgressEngagement(5000);
      rapydScenario = 'unauthorized';

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
      const [attempt] = await attemptsOf(seeded.engagementId);
      expect(attempt).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'PROVIDER_ERROR',
      });
    });

    it('missing keys -> nothing is sent, the attempt is REJECTED and the misconfiguration error', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await prisma.platformSetting.deleteMany({
        where: { key: 'payments.payment-methods.rapyd.secret-key' },
      });

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
      expect(rapydCalls).toHaveLength(0);
      expect((await attemptsOf(seeded.engagementId))[0]).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'PROVIDER_ERROR',
      });
    });
  });

  describe('the abandoned attempt', () => {
    it('restarting an unpaid, still-valid checkout returns the SAME checkoutId — one attempt, one checkout', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const first = await startRapydOk(seeded);

      const second = await startRapydOk(seeded);

      expect(second.checkoutId).toBe(first.checkoutId);
      expect(second.attemptId).toBe(first.attemptId);
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(1);
      expect(createCalls()).toHaveLength(1);
    });

    it('restarting after the checkout EXPIRED closes that attempt as REJECTED and creates a NEW attempt and checkout', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const first = await startRapydOk(seeded);
      checkouts.get(first.checkoutId)!.status = 'EXP';

      const second = await startRapydOk(seeded);

      expect(second.checkoutId).not.toBe(first.checkoutId);
      const attempts = await attemptsOf(seeded.engagementId);
      expect(attempts.map((a) => a.status)).toEqual(['REJECTED', 'PENDING']);
      expect(attempts[1].id).toBe(second.attemptId);
    });

    it('restarting a checkout that was PAID meanwhile records the payment and answers the already-paid conflict — no new attempt', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const first = await startRapydOk(seeded);
      payInWidget(first.checkoutId, 'paid');

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
      const attempts = await attemptsOf(seeded.engagementId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('APPROVED');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('abandonEngagementPaymentAttempt frees the slot (REJECTED / ABANDONED) and the Customer can then pay with Mercado Pago', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startRapydOk(seeded);
      // While the Rapyd attempt is PENDING, Mercado Pago is refused…
      const blocked = await payMercadoPagoCard(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(errorCode(blocked)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');

      const abandoned = await abandon(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(abandoned.errors).toBeUndefined();
      expect(abandoned.data?.abandonEngagementPaymentAttempt).toMatchObject({
        status: 'REJECTED',
        method: 'RAPYD',
        rejectionReason: 'ABANDONED',
      });
      const paid = await payMercadoPagoCard(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(paid.errors).toBeUndefined();
      expect(paid.data?.payEngagementWithCard).toMatchObject({
        status: 'APPROVED',
        method: 'MERCADOPAGO',
      });
      expect(await engagementMethod(seeded.engagementId)).toBe('MERCADOPAGO');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('abandon is REFUSED when a payment already exists inside the checkout (3D Secure pending) — the attempt stays PENDING', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      payInWidget(checkoutId, '3ds');

      const body = await abandon(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_ATTEMPT_NOT_ABANDONABLE');
      expect((await attemptsOf(seeded.engagementId))[0].status).toBe('PENDING');
    });

    it('abandon of a checkout that was actually PAID records the payment and is refused', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      payInWidget(checkoutId, 'paid');

      const body = await abandon(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_ATTEMPT_NOT_ABANDONABLE');
      expect((await attemptsOf(seeded.engagementId))[0].status).toBe(
        'APPROVED',
      );
    });

    it('abandon changes NOTHING when Rapyd cannot be read', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startRapydOk(seeded);
      global.fetch = jest.fn(() =>
        Promise.reject(new TypeError('fetch failed')),
      );

      const body = await abandon(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_CHECKOUT_UNAVAILABLE');
      expect((await attemptsOf(seeded.engagementId))[0].status).toBe('PENDING');
    });

    it('abandon has nothing to drop for an Engagement with no active attempt, a cash attempt or a Mercado Pago one; it is Customer-only; and it works with Rapyd switched OFF', async () => {
      const none = await seedInProgressEngagement(5000);
      expect(
        errorCode(await abandon(none.engagementId, none.customerToken)),
      ).toBe('PAYMENT_ATTEMPT_NOT_ABANDONABLE');

      mpOrderStatus = 'pending';
      const mp = await seedInProgressEngagement(5000);
      await payMercadoPagoCard(mp.engagementId, mp.customerToken);
      expect(errorCode(await abandon(mp.engagementId, mp.customerToken))).toBe(
        'PAYMENT_ATTEMPT_NOT_ABANDONABLE',
      );

      const own = await seedInProgressEngagement(5000);
      await startRapydOk(own);
      expect(
        errorCode(await abandon(own.engagementId, own.professionalToken)),
      ).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(await abandon(own.engagementId, undefined))).toBe(
        'UNAUTHENTICATED',
      );

      await setFlag('payments.payment-methods.rapyd.enabled', false);
      const off = await abandon(own.engagementId, own.customerToken);
      expect(off.errors).toBeUndefined();
      expect(off.data?.abandonEngagementPaymentAttempt.status).toBe('REJECTED');
    });
  });

  describe('a second active attempt across providers', () => {
    it('Rapyd PENDING -> a Mercado Pago card payment is rejected, and no Mercado Pago call is made', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await startRapydOk(seeded);

      const body = await payMercadoPagoCard(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(errorCode(body)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
      expect(mpCalls).toHaveLength(0);
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(1);
    });

    it('Mercado Pago PENDING -> a Rapyd checkout is rejected, and Rapyd is not called', async () => {
      mpOrderStatus = 'pending';
      const seeded = await seedInProgressEngagement(5000);
      const paid = await payMercadoPagoCard(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(paid.data?.payEngagementWithCard.status).toBe('PENDING');

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
      expect(rapydCalls).toHaveLength(0);
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(1);
    });

    it('a Rapyd-paid Engagement can no longer be confirmed as cash (PAYMENT_METHOD_CONFLICT)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);
      const payment = payInWidget(checkoutId, 'paid');
      await sendRapydWebhook(payment.id).expect(200);

      const body = (
        await gqlRequest(
          CONFIRM_CASH_PAYMENT_MUTATION,
          { engagementId: seeded.engagementId },
          seeded.customerToken,
        ).expect(200)
      ).body as GqlBody<unknown>;

      expect(errorCode(body)).toBe('PAYMENT_METHOD_CONFLICT');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });
  });

  describe('flags and configuration', () => {
    it('Rapyd switched OFF: the mutation is refused (RAPYD_MODULE_DISABLED), Rapyd is not called, and Mercado Pago keeps working', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await setFlag('payments.payment-methods.rapyd.enabled', false);

      const body = await startRapyd(seeded.engagementId, seeded.customerToken);
      expect(errorCode(body)).toBe('RAPYD_MODULE_DISABLED');
      expect(rapydCalls).toHaveLength(0);
      expect(await attemptsOf(seeded.engagementId)).toHaveLength(0);

      const mp = await payMercadoPagoCard(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(mp.errors).toBeUndefined();
      expect(mp.data?.payEngagementWithCard.status).toBe('APPROVED');
    });

    it("Mercado Pago's card switch OFF does not touch Rapyd — they are independent", async () => {
      const seeded = await seedInProgressEngagement(5000);
      await setFlag('payments.payment-methods.mercadopago.card.enabled', false);

      const rapyd = await startRapyd(seeded.engagementId, seeded.customerToken);
      const mp = await payMercadoPagoCard(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(rapyd.errors).toBeUndefined();
      expect(errorCode(mp)).toBe('CARD_PAYMENT_MODULE_DISABLED');
    });
  });

  describe('availablePaymentMethods', () => {
    const kinds = (
      body: GqlBody<{ availablePaymentMethods: OptionPayload[] }>,
    ) => body.data?.availablePaymentMethods.map((o) => o.kind);

    beforeEach(async () => {
      await setFlag('payments.payment-methods.cash.enabled', true);
      await setFlag(
        'payments.payment-methods.mercadopago.wallet.enabled',
        false,
      );
    });

    it('lists cash, the Mercado Pago card token and the Rapyd embedded checkout with the KIND the client must open', async () => {
      const seeded = await seedInProgressEngagement(5000);

      const body = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(body.errors).toBeUndefined();
      // Names are the admin-configurable labels (fallbacks when unseeded) — the
      // point here is method + KIND, in display order.
      expect(
        body.data?.availablePaymentMethods.map((o) => [o.method, o.kind]),
      ).toEqual([
        ['CASH', 'CASH'],
        ['MERCADOPAGO', 'CARD_TOKEN'],
        ['RAPYD', 'EMBEDDED_CHECKOUT'],
      ]);
      expect(
        body.data?.availablePaymentMethods.every(
          (o) => o.displayName.trim() !== '',
        ),
      ).toBe(true);
    });

    it('Rapyd OFF -> it is not listed (and Mercado Pago still is)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await setFlag('payments.payment-methods.rapyd.enabled', false);

      const body = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(kinds(body)).toEqual(['CASH', 'CARD_TOKEN']);
    });

    it('ONE Rapyd credential set serves every country: a Colombian Customer is offered Rapyd too (but not Mercado Pago, which has no Colombian keys here)', async () => {
      const seeded = await seedInProgressEngagement(5000, CountryCode.CO);

      const body = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(kinds(body)).toContain('EMBEDDED_CHECKOUT');
      expect(kinds(body)).not.toContain('CARD_TOKEN'); // Mercado Pago's keys are per country: none for CO
    });

    it('incomplete credentials (a missing secret key) also hide Rapyd', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await prisma.platformSetting.deleteMany({
        where: { key: 'payments.payment-methods.rapyd.secret-key' },
      });

      const body = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );

      expect(kinds(body)).not.toContain('EMBEDDED_CHECKOUT');
    });

    it('after Rapyd is PAID the Engagement offers nothing more; while it is merely PENDING the options stay (switch provider via abandon)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      const { checkoutId } = await startRapydOk(seeded);

      const pending = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(kinds(pending)).toContain('EMBEDDED_CHECKOUT');

      const payment = payInWidget(checkoutId, 'paid');
      await sendRapydWebhook(payment.id).expect(200);
      const paid = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(paid.data?.availablePaymentMethods).toEqual([]);
    });

    it('is Customer-only and needs a session', async () => {
      const seeded = await seedInProgressEngagement(5000);

      expect(
        errorCode(
          await availableMethods(seeded.engagementId, seeded.professionalToken),
        ),
      ).toBe('ENGAGEMENT_NOT_FOUND');
      expect(
        errorCode(await availableMethods(seeded.engagementId, undefined)),
      ).toBe('UNAUTHENTICATED');
    });
  });
});
