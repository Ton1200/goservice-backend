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
  CARD_PAYMENT_TEST_SETTING_KEYS,
  TEST_MERCADOPAGO_ACCESS_TOKEN,
  TEST_MERCADOPAGO_WEBHOOK_SECRET,
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
} from './support/test-app';

const PASSWORD = 'super-secret-1';
const CARD_TOKEN = 'tok_e2e_single_use_card_token';
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
const ATTEMPT_FIELDS =
  'id engagementId status method amount currency installments paymentTypeId cardBrand cardLastFour rejectionReason createdAt updatedAt';
const PAY_MUTATION = `
  mutation PayEngagementWithCard($engagementId: ID!, $cardToken: String!, $paymentMethodId: String!, $installments: Int) {
    payEngagementWithCard(engagementId: $engagementId, cardToken: $cardToken, paymentMethodId: $paymentMethodId, installments: $installments) { ${ATTEMPT_FIELDS} }
  }
`;
const FINANCIAL_SUMMARY_QUERY = `
  query EngagementFinancialSummary($engagementId: ID!) {
    engagementFinancialSummary(engagementId: $engagementId) {
      engagementId currency eventType paymentMethod viewerRole
      customer { workAmount platformFee totalCharged }
      professional { grossAmount platformCommission netAmount walletImpact }
    }
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
  installments: number;
  paymentTypeId: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  rejectionReason: string | null;
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

// ---------------------------------------------------------------------------
// A stateful FAKE of api.mercadopago.com — only `global.fetch` is replaced (the
// app is otherwise fully real: Postgres, Redis, the real adapter, real guards
// and transactions). It records every call so tests can assert what was SENT.
// The response bodies mirror the real sandbox payloads captured in the GOS-85
// live spike. THIS DOES NOT PROVE the real sandbox works — that evidence lives
// in the report of the live spike, not in this file.
// ---------------------------------------------------------------------------
interface FakeOrder {
  id: string;
  status: string;
  statusDetail: string;
  paymentDetail: string;
  externalReference: string;
  amount: string;
  currency: string;
  // What was REQUESTED — echoed back in the payment record, like the real API.
  paymentMethodId: string;
  paymentTypeId: string;
}
type Scenario = 'approved' | 'declined' | 'pending' | 'outage';
// What Mercado Pago's payments search answers about an approved order:
// - available: the payment record (like the real one, personal data included);
// - lagging: no record yet (the payment record can trail the order);
// - error: the lookup itself fails (HTTP 503).
type PaymentRecords = 'available' | 'lagging' | 'error';

// The fake charges GoService a fee and tax withholdings shaped like the real
// sandbox record (~5.82% fee, ~1.91% withholdings). For the 5000 ARS job used
// by these tests: fee 291, tax 96 (95.5 rounds up), net 4613 = 5000 - 291 - 96.
const FAKE_FEE_RATE = 0.0582;
const FAKE_TAX_RATE = 0.0191;
const FEE_5000 = 291;
const TAX_5000 = 96;
const NET_5000 = 4613;

/** A payment record shaped like Mercado Pago's real one — INCLUDING personal data that GoService must never store. */
function paymentRecordFor(order: FakeOrder) {
  const amount = Number(order.amount);
  const fee = Math.round(amount * FAKE_FEE_RATE);
  const tax = Math.round(amount * FAKE_TAX_RATE);
  return {
    id: 178687128941,
    status: 'approved',
    payment_type_id: order.paymentTypeId,
    payment_method_id: order.paymentMethodId,
    external_reference: order.externalReference,
    transaction_amount: amount,
    card: {
      first_six_digits: '401354',
      last_four_digits: '6260',
      cardholder: {
        name: 'APRO CARDHOLDER',
        identification: { type: 'CC', number: '123456789' },
      },
    },
    payer: {
      email: 'private.payer@example.com',
      first_name: 'Privado',
      phone: { number: '3001112222' },
      identification: { type: 'CC', number: '987654321' },
    },
    charges_details: [
      {
        type: 'fee',
        accounts: { from: 'collector', to: 'mp' },
        amounts: { original: fee },
      },
      {
        type: 'tax',
        accounts: { from: 'collector', to: 'mp' },
        amounts: { original: tax },
      },
    ],
    transaction_details: { net_received_amount: amount - fee - tax },
    date_approved: '2026-09-18T11:05:28.000-04:00',
    money_release_date: '2026-09-19T11:05:28.000-04:00',
    point_of_interaction: { references: [{ id: order.id, type: 'ORDER_MP' }] },
  };
}
/** Everything the record above carries that must NEVER reach GoService's database. */
const PRIVATE_RECORD_VALUES = [
  'APRO CARDHOLDER',
  '123456789',
  '987654321',
  'private.payer@example.com',
  '3001112222',
  '401354',
];

interface MpCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function orderBody(order: FakeOrder) {
  return {
    id: order.id,
    type: 'online',
    processing_mode: 'automatic',
    external_reference: order.externalReference,
    total_amount: order.amount,
    currency: order.currency,
    status: order.status,
    status_detail: order.statusDetail,
    transactions: {
      payments: [
        {
          id: `PAY_${order.id}`,
          status: order.status,
          status_detail: order.paymentDetail,
        },
      ],
    },
  };
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * e2e coverage for GOS-85 (Integración base con Mercado Pago + cobro con
 * tarjeta) — `payEngagementWithCard` and the asynchronous `order`
 * notification (`src/payments/`). Runs against the isolated `postgres_test`
 * database (port 5433), never the shared dev Postgres. The `redis` container
 * must be up (@nestjs/throttler).
 */
describe('GraphQL Card Payment (GOS-85, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  const realFetch = global.fetch;
  let mpCalls: MpCall[];
  let mpOrders: Map<string, FakeOrder>;
  let scenario: Scenario;
  let paymentRecords: PaymentRecords;
  let mpPostDelayMs: number;
  let orderCounter = 0;

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

        if (method === 'POST' && path === '/v1/orders') {
          if (mpPostDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, mpPostDelayMs));
          }
          if (scenario === 'outage') {
            return json(503, { message: 'Service Unavailable' });
          }
          const requested = body as {
            external_reference: string;
            total_amount: string;
            transactions: {
              payments: { payment_method: { id: string; type: string } }[];
            };
          };
          const requestedMethod =
            requested.transactions.payments[0].payment_method;
          const order: FakeOrder = {
            id: `ORD_E2E_${++orderCounter}`,
            externalReference: requested.external_reference,
            amount: requested.total_amount,
            currency: 'ARS',
            status: 'processed',
            statusDetail: 'accredited',
            paymentDetail: 'accredited',
            paymentMethodId: requestedMethod.id,
            paymentTypeId: requestedMethod.type,
          };
          if (scenario === 'declined') {
            order.status = 'failed';
            order.statusDetail = 'failed';
            order.paymentDetail = 'insufficient_amount';
            mpOrders.set(order.id, order);
            // Live behavior: a decline is HTTP 402 with the order under `data`.
            return json(402, {
              errors: [
                {
                  code: 'failed',
                  message: 'The following transactions failed',
                },
              ],
              data: orderBody(order),
            });
          }
          if (scenario === 'pending') {
            order.status = 'processing';
            order.statusDetail = 'in_process';
            order.paymentDetail = 'in_process';
          }
          mpOrders.set(order.id, order);
          return json(201, orderBody(order));
        }

        const getMatch = /^\/v1\/orders\/([A-Za-z0-9_-]+)$/.exec(path);
        if (method === 'GET' && getMatch) {
          const order = mpOrders.get(getMatch[1]);
          return order
            ? json(200, orderBody(order))
            : json(404, { errors: [{ code: 'not_found' }] });
        }
        // Mercado Pago's payments search — where the payment record lives.
        if (method === 'GET' && path.startsWith('/v1/payments/search?')) {
          if (paymentRecords === 'error') {
            return json(503, { message: 'Service Unavailable' });
          }
          const reference = new URL(url).searchParams.get('external_reference');
          const results =
            paymentRecords === 'lagging'
              ? []
              : [...mpOrders.values()]
                  .filter(
                    (order) =>
                      order.externalReference === reference &&
                      order.status === 'processed',
                  )
                  .map(paymentRecordFor);
          return json(200, { results, paging: { total: results.length } });
        }
        return json(500, { message: `unexpected fake call ${method} ${path}` });
      },
    );
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
    mpOrders = new Map();
    orderCounter = 0; // so the first order of every test is `ORD_E2E_1`
    scenario = 'approved';
    paymentRecords = 'available';
    mpPostDelayMs = 0;
    installFakeMercadoPago();
    // Global `paymentAttempt.count()` assertions below (e.g. "nothing was
    // created") must not see rows left by earlier tests.
    await cleanPaymentAttemptData(prisma);
    await enableTestCardPayments(app, prisma);
    // Defensive — restore the seeded default commission percentage, in case
    // another spec left it changed (same reset `cash-payment.e2e-spec.ts` does).
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
    // Leave the shared settings table as the seed expects it: card OFF. The
    // kill switch row is reset to 'false' — NOT deleted: a MISSING row is
    // fail-open in `PlatformSettingPort.isEnabled` (card would silently be ON).
    await cleanPlatformSettingsData(
      prisma,
      CARD_PAYMENT_TEST_SETTING_KEYS.filter(
        (key) => key !== 'payments.payment-methods.mercadopago.card.enabled',
      ),
    );
    await prisma.platformSetting.updateMany({
      where: { key: 'payments.payment-methods.mercadopago.card.enabled' },
      data: { value: 'false' },
    });
    // RESTORE the commission percentage. The "misconfigured commission" test
    // deliberately DELETES this row, and it runs last — without this, every
    // later e2e suite (e.g. `engagements.e2e-spec.ts`'s cancellation-charge
    // tests) inherits a database with no commission and fails with
    // LEDGER_COMMISSION_MISCONFIGURED. (A real regression this suite caused
    // during the GOS-85 full e2e run.)
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

  // ---- seeding helpers (mirror cash-payment.e2e-spec.ts) -------------------

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
    const email = uniqueEmail('card-payment');
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

  /** Full ServiceRequest -> Quote -> accept flow — a real Engagement (ACCEPTED). */
  async function seedEngagement(price = 5000): Promise<SeededEngagement> {
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

    return {
      engagementId,
      customerEmail: customer.email,
      customerToken,
      professionalToken,
      customerProfileId: customerProfile.id,
      professionalProfileId: professionalProfile.id,
    };
  }

  /** Propose (Customer) -> accept (Professional) -> startEngagementWork => IN_PROGRESS. */
  async function seedInProgressEngagement(
    price = 5000,
  ): Promise<SeededEngagement> {
    const seeded = await seedEngagement(price);
    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId: seeded.engagementId,
        input: {
          startsAt: '2027-03-01T10:00:00.000Z',
          endsAt: '2027-03-01T12:00:00.000Z',
        },
      },
      seeded.customerToken,
    ).expect(200);
    const appointmentId = (
      proposeResponse.body as { data: { proposeAppointment: { id: string } } }
    ).data.proposeAppointment.id;
    await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      seeded.professionalToken,
    ).expect(200);
    const startResponse = await gqlRequest(
      START_ENGAGEMENT_WORK_MUTATION,
      { engagementId: seeded.engagementId },
      seeded.professionalToken,
    ).expect(200);
    expect((startResponse.body as GqlBody<unknown>).errors).toBeUndefined();
    return seeded;
  }

  async function pay(
    engagementId: string,
    token: string | undefined,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await gqlRequest(
      PAY_MUTATION,
      {
        engagementId,
        cardToken: CARD_TOKEN,
        paymentMethodId: 'master',
        installments: 1,
        ...overrides,
      },
      token,
    ).expect(200);
    return response.body as GqlBody<{ payEngagementWithCard: AttemptPayload }>;
  }

  function sendWebhook(
    orderId: string,
    options?: {
      secret?: string;
      tamperSignature?: boolean;
      omitSignature?: boolean;
      // Every fixture in this file seeds an AR CustomerProfile/credentials
      // (`enableTestCardPayments`'s own default) — the webhook route segment
      // must match, since it's what tells the controller which country's
      // secret to check (2026-09-18, per-country credentials).
      country?: string;
    },
  ) {
    const ts = String(Date.now());
    const requestId = randomUUID();
    const manifest = buildMercadoPagoSignatureManifest({
      dataId: orderId,
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
    const req = request(app.getHttpServer())
      .post(
        `/webhooks/mercadopago/orders/${country}?data.id=${orderId}&type=order`,
      )
      .set('x-request-id', requestId);
    if (!options?.omitSignature) {
      req.set('x-signature', `ts=${ts},v1=${v1}`);
    }
    return req.send({
      action: 'order.processed',
      type: 'order',
      data: { id: orderId },
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
  const postOrderCalls = () =>
    mpCalls.filter((c) => c.method === 'POST' && c.path === '/v1/orders');

  // ------------------------------------------------------------------------

  describe('payEngagementWithCard — approved (synchronous)', () => {
    it('APPROVED attempt + 3 zero-sum LedgerEntry + Engagement.paymentMethod = CARD, and the provider gets exactly what it should', async () => {
      const seeded = await seedInProgressEngagement(5000);

      const body = await pay(seeded.engagementId, seeded.customerToken, {
        installments: 3,
      });

      expect(body.errors).toBeUndefined();
      expect(body.data?.payEngagementWithCard).toMatchObject({
        engagementId: seeded.engagementId,
        status: 'APPROVED',
        amount: 5000,
        currency: 'ARS',
        installments: 3,
        rejectionReason: null,
        // What the Customer can be shown about how they paid — from the
        // provider's payment record, never from anything the client sent.
        method: 'MERCADOPAGO',
        paymentTypeId: 'credit_card',
        cardBrand: 'master',
        cardLastFour: '6260',
      });

      // The persisted attempt
      const attempts = await prisma.paymentAttempt.findMany({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        status: 'APPROVED',
        method: 'MERCADOPAGO',
        amount: 5000,
        currency: 'ARS',
        providerPaymentId: 'ORD_E2E_1',
        rejectionReason: null,
        // Non-sensitive facts of the transaction, kept for follow-up:
        paymentTypeId: 'credit_card',
        cardBrand: 'master',
        cardLastFour: '6260',
        providerFeeAmount: FEE_5000,
        providerTaxAmount: TAX_5000,
        netReceivedAmount: NET_5000,
      });
      expect(attempts[0].providerApprovedAt).toEqual(
        new Date('2026-09-18T11:05:28.000-04:00'),
      );
      expect(attempts[0].moneyReleaseAt).toEqual(
        new Date('2026-09-19T11:05:28.000-04:00'),
      );
      // The card token is NEVER persisted
      expect(JSON.stringify(attempts)).not.toContain(CARD_TOKEN);
      // ...and neither is ANY personal data the provider's record carried
      // (cardholder name/document, the payer's email/phone/document, the BIN).
      for (const privateValue of PRIVATE_RECORD_VALUES) {
        expect(JSON.stringify(attempts)).not.toContain(privateValue);
      }
      // The provider's payment record was looked up by the Engagement id.
      const searches = mpCalls.filter((c) =>
        c.path.startsWith('/v1/payments/search?'),
      );
      expect(searches).toHaveLength(1);
      expect(searches[0].path).toContain(
        `external_reference=${seeded.engagementId}`,
      );

      // Exactly 3 ledger rows, ONE shared createdAt, summing to zero
      const entries = await ledgerFor(seeded.engagementId);
      expect(entries.map((e) => [e.type, e.amount])).toEqual([
        ['CUSTOMER_CHARGE', -5000],
        ['PLATFORM_COMMISSION', 500],
        ['PROFESSIONAL_NET_CREDIT', 4500],
      ]);
      expect(sum(entries)).toBe(0);
      expect(new Set(entries.map((e) => e.createdAt.getTime())).size).toBe(1);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          currency: 'ARS',
          commissionPercentApplied: 10,
          customerProfileId: seeded.customerProfileId,
          professionalProfileId: seeded.professionalProfileId,
        });
      }

      const engagement = await prisma.engagement.findUnique({
        where: { id: seeded.engagementId },
      });
      expect(engagement?.paymentMethod).toBe('MERCADOPAGO');

      // What was sent to Mercado Pago
      const calls = postOrderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].headers).toMatchObject({
        Authorization: `Bearer ${TEST_MERCADOPAGO_ACCESS_TOKEN}`, // decrypted from the encrypted setting
        'X-Idempotency-Key': attempts[0].id,
      });
      expect(calls[0].body).toMatchObject({
        type: 'online',
        processing_mode: 'automatic',
        external_reference: seeded.engagementId,
        total_amount: '5000.00', // ARS: two decimals
        payer: { email: seeded.customerEmail },
        transactions: {
          payments: [
            {
              amount: '5000.00',
              payment_method: {
                id: 'master',
                type: 'credit_card',
                token: CARD_TOKEN,
                installments: 3,
              },
            },
          ],
        },
      });
      expect(JSON.stringify(calls[0].body)).not.toMatch(
        /capture_mode|marketplace_fee|application_fee/,
      );
    });

    it.each([['debvisa'], ['debmaster']])(
      'a DEBIT card (%s) is APPROVED: sent to the provider as a debit_card with no installments, same 3 zero-sum ledger rows',
      async (paymentMethodId) => {
        const seeded = await seedInProgressEngagement(5000);

        const body = await pay(seeded.engagementId, seeded.customerToken, {
          paymentMethodId,
          installments: 1,
        });

        expect(body.errors).toBeUndefined();
        expect(body.data?.payEngagementWithCard).toMatchObject({
          status: 'APPROVED',
          installments: 1,
          // The provider's own record says it was a DEBIT card.
          paymentTypeId: 'debit_card',
          cardBrand: paymentMethodId,
          cardLastFour: '6260',
        });
        const paymentMethod = (
          postOrderCalls()[0].body as {
            transactions: { payments: { payment_method: object }[] };
          }
        ).transactions.payments[0].payment_method;
        expect(paymentMethod).toEqual({
          id: paymentMethodId,
          type: 'debit_card',
          token: CARD_TOKEN,
        });
        const entries = await ledgerFor(seeded.engagementId);
        expect(entries.map((e) => e.amount)).toEqual([-5000, 500, 4500]);
        expect(sum(entries)).toBe(0);
        expect(
          (
            await prisma.engagement.findUnique({
              where: { id: seeded.engagementId },
            })
          )?.paymentMethod,
        ).toBe('MERCADOPAGO');
      },
    );

    it('a DEBIT card with installments > 1 is REJECTED (INVALID_CARD_DATA) BEFORE any request to the provider — nothing charged, no ledger', async () => {
      const seeded = await seedInProgressEngagement(5000);

      const body = await pay(seeded.engagementId, seeded.customerToken, {
        paymentMethodId: 'debvisa',
        installments: 3,
      });

      expect(body.errors).toBeUndefined();
      expect(body.data?.payEngagementWithCard).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INVALID_CARD_DATA',
      });
      expect(postOrderCalls()).toHaveLength(0);
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      // A refused attempt never blocks the Customer from paying properly.
      const retry = await pay(seeded.engagementId, seeded.customerToken, {
        paymentMethodId: 'debvisa',
        installments: 1,
      });
      expect(retry.data?.payEngagementWithCard.status).toBe('APPROVED');
    });

    it('classifyLedgerEventRows sees a REAL DIGITAL_PAYMENT event through engagementFinancialSummary (correct amounts, both viewers)', async () => {
      const seeded = await seedInProgressEngagement(5000);
      await pay(seeded.engagementId, seeded.customerToken);

      const customerBody = (
        await gqlRequest(
          FINANCIAL_SUMMARY_QUERY,
          { engagementId: seeded.engagementId },
          seeded.customerToken,
        ).expect(200)
      ).body as GqlBody<{
        engagementFinancialSummary: {
          eventType: string;
          paymentMethod: string;
          currency: string;
          customer: {
            workAmount: number;
            platformFee: number;
            totalCharged: number;
          };
        };
      }>;
      expect(customerBody.errors).toBeUndefined();
      expect(customerBody.data?.engagementFinancialSummary).toMatchObject({
        eventType: 'DIGITAL_PAYMENT',
        paymentMethod: 'MERCADOPAGO',
        currency: 'ARS',
        customer: { workAmount: 5000, platformFee: 0, totalCharged: 5000 },
      });

      const professionalBody = (
        await gqlRequest(
          FINANCIAL_SUMMARY_QUERY,
          { engagementId: seeded.engagementId },
          seeded.professionalToken,
        ).expect(200)
      ).body as GqlBody<{
        engagementFinancialSummary: {
          eventType: string;
          professional: {
            grossAmount: number;
            platformCommission: number;
            netAmount: number;
            walletImpact: number;
          };
        };
      }>;
      // gross 5000, GoService's cut 500, net 4500 — read from the persisted rows.
      // walletImpact stays 0: the net is an accounting credit until Fund
      // Disbursement (GOS-82/GOS-139) exists.
      expect(professionalBody.data?.engagementFinancialSummary).toMatchObject({
        eventType: 'DIGITAL_PAYMENT',
        professional: {
          grossAmount: 5000,
          platformCommission: 500,
          netAmount: 4500,
          walletImpact: 0,
        },
      });
    });

    it('derives the amount from the Quote server-side and freezes the commission percent on the rows', async () => {
      await prisma.platformSetting.update({
        where: { key: 'payments.general-settings.commission.percent' },
        data: { value: '12' },
      });
      const seeded = await seedInProgressEngagement(3333);

      await pay(seeded.engagementId, seeded.customerToken);

      const entries = await ledgerFor(seeded.engagementId);
      // commission = round(3333 * 12 / 100) = round(399.96) = 400; net = remainder
      expect(entries.map((e) => e.amount)).toEqual([-3333, 400, 2933]);
      expect(sum(entries)).toBe(0);
      expect(entries.every((e) => e.commissionPercentApplied === 12)).toBe(
        true,
      );
      // A LATER admin change never rewrites what was already frozen.
      await prisma.platformSetting.update({
        where: { key: 'payments.general-settings.commission.percent' },
        data: { value: '10' },
      });
      expect(
        (await ledgerFor(seeded.engagementId)).every(
          (e) => e.commissionPercentApplied === 12,
        ),
      ).toBe(true);
    });
  });

  describe('payment details — best-effort, never blocks a payment', () => {
    it.each([
      ['the provider record is not there yet (lagging)', 'lagging' as const],
      ['the provider lookup itself fails (HTTP 503)', 'error' as const],
    ])(
      'when %s the payment is STILL approved and recorded — details simply stay null',
      async (_label, mode) => {
        paymentRecords = mode;
        const seeded = await seedInProgressEngagement(5000);

        const body = await pay(seeded.engagementId, seeded.customerToken);

        expect(body.errors).toBeUndefined();
        expect(body.data?.payEngagementWithCard).toMatchObject({
          status: 'APPROVED',
          method: 'MERCADOPAGO',
          paymentTypeId: null,
          cardBrand: null,
          cardLastFour: null,
        });
        const attempt = await prisma.paymentAttempt.findFirstOrThrow({
          where: { engagementId: seeded.engagementId },
        });
        expect(attempt).toMatchObject({
          status: 'APPROVED',
          providerPaymentId: 'ORD_E2E_1',
          paymentTypeId: null,
          cardBrand: null,
          cardLastFour: null,
          providerFeeAmount: null,
          providerTaxAmount: null,
          netReceivedAmount: null,
        });
        // The money side is complete regardless.
        expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
        expect(
          (
            await prisma.engagement.findUnique({
              where: { id: seeded.engagementId },
            })
          )?.paymentMethod,
        ).toBe('MERCADOPAGO');
      },
    );

    it("GoService's fee, taxes and net are NOT exposed to the Customer through GraphQL", async () => {
      const seeded = await seedInProgressEngagement(5000);

      for (const field of [
        'providerFeeAmount',
        'providerTaxAmount',
        'netReceivedAmount',
        'providerPaymentId',
      ]) {
        const response = await gqlRequest(
          `mutation { payEngagementWithCard(engagementId: "${seeded.engagementId}", cardToken: "${CARD_TOKEN}", paymentMethodId: "master") { ${field} } }`,
          {},
          seeded.customerToken,
        );
        // Not a field of the type => a schema validation error, before any
        // resolver (and so any charge) runs.
        expect(response.status).toBe(400);
        const [error] = (response.body as { errors: GraphQLErrorEntry[] })
          .errors;
        expect(error.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
        expect(error.message).toBe(
          `Cannot query field "${field}" on type "PaymentAttempt".`,
        );
      }
      expect(postOrderCalls()).toHaveLength(0);
    });

    it('a REJECTED attempt has no payment details, and no payment-record lookup is made for it', async () => {
      scenario = 'declined';
      const seeded = await seedInProgressEngagement(5000);

      const body = await pay(seeded.engagementId, seeded.customerToken);

      expect(body.data?.payEngagementWithCard).toMatchObject({
        status: 'REJECTED',
        method: 'MERCADOPAGO',
        paymentTypeId: null,
        cardBrand: null,
        cardLastFour: null,
      });
      expect(
        mpCalls.filter((c) => c.path.startsWith('/v1/payments/search?')),
      ).toHaveLength(0);
    });
  });

  describe('payEngagementWithCard — rejected', () => {
    it('a declined card (HTTP 402) -> REJECTED with a domain reason, NO ledger, NO paymentMethod — and the Customer can try again', async () => {
      scenario = 'declined';
      const seeded = await seedInProgressEngagement(5000);

      const body = await pay(seeded.engagementId, seeded.customerToken);

      // A decline is a normal RESULT, not a GraphQL error.
      expect(body.errors).toBeUndefined();
      expect(body.data?.payEngagementWithCard).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      // The processor's raw detail never reaches the client.
      expect(JSON.stringify(body)).not.toContain('insufficient_amount');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      expect(
        (
          await prisma.engagement.findUnique({
            where: { id: seeded.engagementId },
          })
        )?.paymentMethod,
      ).toBeNull();

      // REJECTED does not consume the Engagement's right to pay.
      scenario = 'approved';
      const retry = await pay(seeded.engagementId, seeded.customerToken);
      expect(retry.data?.payEngagementWithCard.status).toBe('APPROVED');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
      const attempts = await prisma.paymentAttempt.findMany({
        where: { engagementId: seeded.engagementId },
        orderBy: { createdAt: 'asc' },
      });
      expect(attempts.map((a) => a.status)).toEqual(['REJECTED', 'APPROVED']);
    });
  });

  describe('no double charge', () => {
    it('a second attempt while one is PENDING is rejected, and the provider is NOT called again', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement();

      const first = await pay(seeded.engagementId, seeded.customerToken);
      expect(first.data?.payEngagementWithCard.status).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);

      const second = await pay(seeded.engagementId, seeded.customerToken);

      expect(errorCode(second)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
      expect(postOrderCalls()).toHaveLength(1);
      expect(
        await prisma.paymentAttempt.count({
          where: { engagementId: seeded.engagementId },
        }),
      ).toBe(1);
    });

    it('a second attempt after an APPROVED one is rejected — no second charge, ledger still 3 rows', async () => {
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);

      const second = await pay(seeded.engagementId, seeded.customerToken);

      expect(errorCode(second)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
      expect(postOrderCalls()).toHaveLength(1);
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('two CONCURRENT submits: the database (partial unique index) lets exactly one through', async () => {
      mpPostDelayMs = 400; // keep the first request in flight while the second arrives
      const seeded = await seedInProgressEngagement();

      const [a, b] = await Promise.all([
        pay(seeded.engagementId, seeded.customerToken),
        pay(seeded.engagementId, seeded.customerToken),
      ]);

      const outcomes = [a, b].map((r) =>
        r.errors ? errorCode(r) : r.data?.payEngagementWithCard.status,
      );
      expect(outcomes.sort()).toEqual([
        'APPROVED',
        'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      ]);
      expect(postOrderCalls()).toHaveLength(1); // ONE charge, not two
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });
  });

  describe('asynchronous notification (order webhook)', () => {
    it('approval notification on a PENDING attempt -> the SAME end state as a synchronous approval', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement(5000);
      const first = await pay(seeded.engagementId, seeded.customerToken);
      expect(first.data?.payEngagementWithCard.status).toBe('PENDING');

      // Mercado Pago resolves the payment later.
      const order = mpOrders.get('ORD_E2E_1')!;
      order.status = 'processed';
      order.statusDetail = 'accredited';
      order.paymentDetail = 'accredited';
      const webhook = await sendWebhook('ORD_E2E_1');

      expect(webhook.status).toBe(200);
      expect(webhook.body).toEqual({ received: true });
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempt).toMatchObject({
        status: 'APPROVED',
        providerPaymentId: 'ORD_E2E_1',
        amount: 5000,
        currency: 'ARS',
        // The asynchronous path stores the SAME transaction facts as the
        // synchronous one — one shared function, not two copies.
        paymentTypeId: 'credit_card',
        cardBrand: 'master',
        cardLastFour: '6260',
        providerFeeAmount: FEE_5000,
        providerTaxAmount: TAX_5000,
        netReceivedAmount: NET_5000,
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
      // The handler RE-READ the order from the provider instead of trusting the body.
      expect(
        mpCalls.some(
          (c) => c.method === 'GET' && c.path === '/v1/orders/ORD_E2E_1',
        ),
      ).toBe(true);
    });

    it('a REPEATED notification is a no-op: no rewrite, no duplicated ledger', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);
      const order = mpOrders.get('ORD_E2E_1')!;
      order.status = 'processed';
      order.statusDetail = 'accredited';
      order.paymentDetail = 'accredited';

      await sendWebhook('ORD_E2E_1').expect(200);
      const afterFirst = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      const entriesAfterFirst = await ledgerFor(seeded.engagementId);

      await sendWebhook('ORD_E2E_1').expect(200);
      await sendWebhook('ORD_E2E_1').expect(200);

      const afterRepeat = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(afterRepeat.updatedAt).toEqual(afterFirst.updatedAt); // not rewritten
      const entriesAfterRepeat = await ledgerFor(seeded.engagementId);
      expect(entriesAfterRepeat).toHaveLength(3);
      expect(entriesAfterRepeat.map((e) => e.id)).toEqual(
        entriesAfterFirst.map((e) => e.id),
      );
    });

    it('a notification that arrives AFTER a synchronous approval is a no-op too', async () => {
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);

      await sendWebhook('ORD_E2E_1').expect(200);

      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('a rejection notification resolves a PENDING attempt to REJECTED: no ledger, no paymentMethod', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);
      const order = mpOrders.get('ORD_E2E_1')!;
      order.status = 'failed';
      order.statusDetail = 'failed';
      order.paymentDetail = 'rejected_by_issuer';

      await sendWebhook('ORD_E2E_1').expect(200);

      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(attempt).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'CARD_DECLINED',
      });
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      expect(
        (
          await prisma.engagement.findUnique({
            where: { id: seeded.engagementId },
          })
        )?.paymentMethod,
      ).toBeNull();
    });

    it('a notification while the provider still reports it processing leaves the attempt PENDING', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);

      await sendWebhook('ORD_E2E_1').expect(200);

      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('reconciles a LOST create response: the attempt (no provider id) is found via external_reference = Engagement.id and approved', async () => {
      scenario = 'outage';
      const seeded = await seedInProgressEngagement(5000);
      const outage = await pay(seeded.engagementId, seeded.customerToken);
      expect(errorCode(outage)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      // Unknown outcome => left PENDING, provider id never recorded, and it blocks a blind retry.
      const stuck = await prisma.paymentAttempt.findFirstOrThrow({
        where: { engagementId: seeded.engagementId },
      });
      expect(stuck).toMatchObject({
        status: 'PENDING',
        providerPaymentId: null,
      });
      expect(
        errorCode(await pay(seeded.engagementId, seeded.customerToken)),
      ).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');

      // In reality Mercado Pago DID create and approve the order.
      mpOrders.set('ORD_LOST_1', {
        id: 'ORD_LOST_1',
        externalReference: seeded.engagementId,
        amount: '5000.00',
        currency: 'ARS',
        status: 'processed',
        statusDetail: 'accredited',
        paymentDetail: 'accredited',
        paymentMethodId: 'visa',
        paymentTypeId: 'credit_card',
      });
      await sendWebhook('ORD_LOST_1').expect(200);

      expect(
        await prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: stuck.id },
        }),
      ).toMatchObject({ status: 'APPROVED', providerPaymentId: 'ORD_LOST_1' });
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(3);
    });

    it('refuses to approve an order whose amount differs from what was charged', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement(5000);
      await pay(seeded.engagementId, seeded.customerToken);
      const order = mpOrders.get('ORD_E2E_1')!;
      order.status = 'processed';
      order.statusDetail = 'accredited';
      order.amount = '4999.00';

      await sendWebhook('ORD_E2E_1').expect(200);

      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('acknowledges (200, no-op) a notification for an order that is not ours / unknown to the provider', async () => {
      const response = await sendWebhook('ORD_NOT_OURS');

      expect(response.status).toBe(200);
      expect(await prisma.paymentAttempt.count()).toBe(0);
    });

    it('rejects a notification with a TAMPERED signature (401) and changes nothing', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);
      mpOrders.get('ORD_E2E_1')!.status = 'processed';
      mpOrders.get('ORD_E2E_1')!.statusDetail = 'accredited';
      const callsBefore = mpCalls.length;

      await sendWebhook('ORD_E2E_1', { tamperSignature: true }).expect(401);
      await sendWebhook('ORD_E2E_1', { secret: 'the-wrong-secret' }).expect(
        401,
      );
      await sendWebhook('ORD_E2E_1', { omitSignature: true }).expect(401);

      expect(mpCalls.length).toBe(callsBefore); // never even reached the provider
      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('FAILS CLOSED (401) when no webhook secret is configured, even for a "valid-looking" signature', async () => {
      await prisma.platformSetting.deleteMany({
        where: {
          key: 'payments.payment-methods.mercadopago.ar.webhook-secret',
        },
      });

      await sendWebhook('ORD_E2E_1').expect(401);
    });

    it('is NOT behind the card kill switch: a notification still resolves a charge already in flight', async () => {
      scenario = 'pending';
      const seeded = await seedInProgressEngagement();
      await pay(seeded.engagementId, seeded.customerToken);
      await enableTestCardPayments(app, prisma, { cardEnabled: false });
      const order = mpOrders.get('ORD_E2E_1')!;
      order.status = 'processed';
      order.statusDetail = 'accredited';

      await sendWebhook('ORD_E2E_1').expect(200);

      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('APPROVED');
    });
  });

  describe('guards and preconditions', () => {
    it('with payments.payment-methods.mercadopago.card.enabled = false: rejected with CARD_PAYMENT_MODULE_DISABLED, nothing created, provider never called', async () => {
      const seeded = await seedInProgressEngagement();
      await enableTestCardPayments(app, prisma, { cardEnabled: false });

      const body = await pay(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('CARD_PAYMENT_MODULE_DISABLED');
      expect(mpCalls).toHaveLength(0);
      expect(await prisma.paymentAttempt.count()).toBe(0);
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it('requires a session (UNAUTHENTICATED)', async () => {
      const seeded = await seedInProgressEngagement();

      const body = await pay(seeded.engagementId, undefined);

      expect(errorCode(body)).toBe('UNAUTHENTICATED');
      expect(mpCalls).toHaveLength(0);
    });

    it("the Engagement's PROFESSIONAL cannot pay — same anti-enumeration ENGAGEMENT_NOT_FOUND", async () => {
      const seeded = await seedInProgressEngagement();

      const body = await pay(seeded.engagementId, seeded.professionalToken);

      expect(errorCode(body)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(mpCalls).toHaveLength(0);
    });

    it("another Customer cannot pay someone else's Engagement, and a nonexistent id looks identical", async () => {
      const seeded = await seedInProgressEngagement();
      const stranger = await seedInProgressEngagement();

      const notMine = await pay(seeded.engagementId, stranger.customerToken);
      const missing = await pay(randomUUID(), seeded.customerToken);

      expect(errorCode(notMine)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(missing)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(notMine.errors?.[0].message).toBe(missing.errors?.[0].message);
      expect(mpCalls).toHaveLength(0);
    });

    it.each([['ACCEPTED'], ['CANCELLED']] as const)(
      'an Engagement that is %s cannot be paid (ENGAGEMENT_NOT_PAYABLE_BY_CARD)',
      async (status) => {
        const seeded = await seedEngagement(); // ACCEPTED
        if (status === 'CANCELLED') {
          await prisma.engagement.update({
            where: { id: seeded.engagementId },
            data: { status: 'CANCELLED' },
          });
        }

        const body = await pay(seeded.engagementId, seeded.customerToken);

        expect(errorCode(body)).toBe('ENGAGEMENT_NOT_PAYABLE_BY_CARD');
        expect(mpCalls).toHaveLength(0);
        expect(await prisma.paymentAttempt.count()).toBe(0);
      },
    );

    it('an Engagement whose payment method is already CASH cannot be paid by card', async () => {
      const seeded = await seedInProgressEngagement();
      await prisma.engagement.update({
        where: { id: seeded.engagementId },
        data: { paymentMethod: 'CASH' },
      });

      const body = await pay(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('ENGAGEMENT_NOT_PAYABLE_BY_CARD');
      expect(mpCalls).toHaveLength(0);
    });

    it.each([
      ['a blank card token', { cardToken: '  ' }],
      ['a malformed payment method id', { paymentMethodId: 'visa; DROP' }],
      ['zero installments', { installments: 0 }],
    ])(
      'rejects %s with INVALID_CARD_PAYMENT_INPUT before anything is created',
      async (_label, overrides) => {
        const seeded = await seedInProgressEngagement();

        const body = await pay(
          seeded.engagementId,
          seeded.customerToken,
          overrides,
        );

        expect(errorCode(body)).toBe('INVALID_CARD_PAYMENT_INPUT');
        expect(mpCalls).toHaveLength(0);
        expect(await prisma.paymentAttempt.count()).toBe(0);
      },
    );
  });

  describe('provider failures', () => {
    it('a provider OUTAGE leaves the attempt PENDING (never assumed rejected) and reports PAYMENT_PROVIDER_UNAVAILABLE', async () => {
      scenario = 'outage';
      const seeded = await seedInProgressEngagement();

      const body = await pay(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
    });

    it.each([
      [
        'no access token',
        'payments.payment-methods.mercadopago.ar.access-token',
      ],
      ['no environment', 'payments.payment-methods.mercadopago.ar.environment'],
    ])(
      'with %s configured: fails closed with PAYMENT_PROVIDER_MISCONFIGURED, sends nothing, and does NOT leave a blocking PENDING attempt',
      async (_label, key) => {
        const seeded = await seedInProgressEngagement();
        await prisma.platformSetting.deleteMany({ where: { key } });

        const body = await pay(seeded.engagementId, seeded.customerToken);

        expect(errorCode(body)).toBe('PAYMENT_PROVIDER_MISCONFIGURED');
        expect(mpCalls).toHaveLength(0);
        const attempts = await prisma.paymentAttempt.findMany({
          where: { engagementId: seeded.engagementId },
        });
        expect(attempts.map((a) => [a.status, a.rejectionReason])).toEqual([
          ['REJECTED', 'PROVIDER_ERROR'],
        ]);

        // Once configured, the Customer can pay — the failed attempt did not block them.
        await enableTestCardPayments(app, prisma);
        expect(
          (await pay(seeded.engagementId, seeded.customerToken)).data
            ?.payEngagementWithCard.status,
        ).toBe('APPROVED');
      },
    );

    it('a misconfigured commission percentage rolls the WHOLE approval back (no APPROVED attempt without a ledger event)', async () => {
      const seeded = await seedInProgressEngagement();
      await prisma.platformSetting.deleteMany({
        where: { key: 'payments.general-settings.commission.percent' },
      });

      const body = await pay(seeded.engagementId, seeded.customerToken);

      expect(errorCode(body)).toBe('LEDGER_COMMISSION_MISCONFIGURED');
      expect(
        (
          await prisma.paymentAttempt.findFirstOrThrow({
            where: { engagementId: seeded.engagementId },
          })
        ).status,
      ).toBe('PENDING');
      expect(await ledgerFor(seeded.engagementId)).toHaveLength(0);
      expect(
        (
          await prisma.engagement.findUnique({
            where: { id: seeded.engagementId },
          })
        )?.paymentMethod,
      ).toBeNull();
    });
  });
});
