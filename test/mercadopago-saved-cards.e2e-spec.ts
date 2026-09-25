import { randomBytes } from 'node:crypto';
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
} from './support/test-app';

const PASSWORD = 'super-secret-1';
const CARD_TOKEN = 'tok_e2e_single_use_card_token';
const CVV_RETOKENIZED_TOKEN = 'tok_e2e_cvv_retokenized';
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
  'id engagementId status method amount currency installments paymentTypeId cardBrand cardLastFour rejectionReason';
const PAY_CARD_MUTATION = `
  mutation PayEngagementWithCard($engagementId: ID!, $cardToken: String!, $paymentMethodId: String!, $installments: Int, $saveCard: Boolean) {
    payEngagementWithCard(engagementId: $engagementId, cardToken: $cardToken, paymentMethodId: $paymentMethodId, installments: $installments, saveCard: $saveCard) { ${ATTEMPT_FIELDS} }
  }
`;
const AVAILABLE_METHODS_QUERY = `
  query AvailablePaymentMethods($engagementId: ID!) {
    availablePaymentMethods(engagementId: $engagementId) { method kind displayName supportsSavedCards }
  }
`;
const SAVED_CARD_FIELDS =
  'id method brand lastFour type expirationMonth expirationYear providerCardId createdAt';
const MY_SAVED_CARDS_QUERY = `
  query MySavedCards { mySavedCards { ${SAVED_CARD_FIELDS} } }
`;
const PAY_SAVED_CARD_MUTATION = `
  mutation PayEngagementWithSavedCard($engagementId: ID!, $savedCardId: ID!, $providerToken: String) {
    payEngagementWithSavedCard(engagementId: $engagementId, savedCardId: $savedCardId, providerToken: $providerToken) { ${ATTEMPT_FIELDS} }
  }
`;
const DELETE_SAVED_CARD_MUTATION = `
  mutation DeleteSavedCard($savedCardId: ID!) {
    deleteSavedCard(savedCardId: $savedCardId)
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
interface SavedCardPayload {
  id: string;
  method: 'CASH' | 'MERCADOPAGO' | 'RAPYD';
  brand: string | null;
  lastFour: string | null;
  type: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  providerCardId: string | null;
  createdAt: string;
}
interface OptionPayload {
  method: string;
  kind: string;
  displayName: string;
  supportsSavedCards: boolean;
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
// A stateful FAKE of api.mercadopago.com covering the Orders API (charge) AND
// the Customers/Cards API the saved-cards feature (GOS-149) uses. Only
// `global.fetch` is replaced — the app is otherwise fully real (Postgres,
// Redis, the real adapter, guards and transactions). Response SHAPES are
// written against Mercado Pago's documentation only — NOT verified live (see
// `MercadoPagoPaymentAdapter`'s own header comment for that caveat, same
// posture as the wallet flow's unconfirmed parts).
// ---------------------------------------------------------------------------
type ChargeScenario = 'approved' | 'declined' | 'pending' | 'outage';
interface FakeOrder {
  id: string;
  status: string;
  statusDetail: string;
  externalReference: string;
  amount: string;
}
interface FakeCard {
  id: string;
  brand: string;
  lastFour: string;
  type: 'credit_card' | 'debit_card';
  month: number;
  year: number;
}
interface FakeCustomer {
  id: string;
  email: string;
  cards: FakeCard[];
}
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
    currency: 'ARS',
    status: order.status,
    status_detail: order.statusDetail,
    transactions: {
      payments: [{ status: order.status, status_detail: order.statusDetail }],
    },
  };
}
function storedCardBody(card: FakeCard) {
  return {
    id: card.id,
    last_four_digits: card.lastFour,
    expiration_month: card.month,
    expiration_year: card.year,
    payment_method: { id: card.brand, payment_type_id: card.type },
  };
}

/**
 * e2e coverage for the GOS-149 Mercado Pago SAVED CARDS feature — the switch
 * (`payments.payment-methods.mercadopago.card.saved-cards-enabled`, a feature
 * OF the Mercado Pago card method), the Mercado Pago customer per GoService
 * Customer, saving a card as a side effect of `payEngagementWithCard(saveCard:
 * true)` (Mercado Pago has no "save card" widget of its own, unlike Rapyd),
 * `mySavedCards`, `payEngagementWithSavedCard` (CVV re-tokenized client-side
 * into `providerToken`) and `deleteSavedCard`. Runs against the isolated
 * `postgres_test` database (port 5433); the `redis` container must be up
 * (@nestjs/throttler).
 */
describe('GraphQL Mercado Pago saved cards (GOS-149, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  const realFetch = global.fetch;
  let mpCalls: MpCall[];
  let orders: Map<string, FakeOrder>;
  let customers: Map<string, FakeCustomer>;
  let chargeScenario: ChargeScenario;
  let associateOutage: boolean;
  let orderCounter: number;
  let customerCounter: number;
  let cardCounter: number;

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
          if (chargeScenario === 'outage') return json(503, {});
          const requested = body as {
            external_reference: string;
            total_amount: string;
          };
          const order: FakeOrder = {
            id: `ORD_E2E_${++orderCounter}`,
            externalReference: requested.external_reference,
            amount: requested.total_amount,
            status: 'processed',
            statusDetail: 'accredited',
          };
          if (chargeScenario === 'declined') {
            order.status = 'failed';
            order.statusDetail = 'failed';
            orders.set(order.id, order);
            return json(402, {
              errors: [{ code: 'failed' }],
              data: orderBody(order),
            });
          }
          if (chargeScenario === 'pending') {
            order.status = 'processing';
            order.statusDetail = 'in_process';
          }
          orders.set(order.id, order);
          return json(201, orderBody(order));
        }
        const getOrderMatch = /^\/v1\/orders\/([A-Za-z0-9_-]+)$/.exec(path);
        if (method === 'GET' && getOrderMatch) {
          const order = orders.get(getOrderMatch[1]);
          return order
            ? json(200, orderBody(order))
            : json(404, { errors: [{ code: 'not_found' }] });
        }

        if (method === 'POST' && path === '/v1/customers') {
          const customer: FakeCustomer = {
            id: `cus_${++customerCounter}_${randomBytes(4).toString('hex')}`,
            email: body?.email as string,
            cards: [],
          };
          customers.set(customer.id, customer);
          return json(201, { id: customer.id });
        }
        const cardsMatch = /^\/v1\/customers\/(cus_[^/]+)\/cards$/.exec(path);
        if (method === 'GET' && cardsMatch) {
          const customer = customers.get(cardsMatch[1]);
          return customer
            ? json(200, customer.cards.map(storedCardBody))
            : json(404, { message: 'not found' });
        }
        if (method === 'POST' && cardsMatch) {
          if (associateOutage) return json(503, {});
          const customer = customers.get(cardsMatch[1]);
          if (!customer) return json(404, { message: 'not found' });
          const card: FakeCard = {
            id: `card_${++cardCounter}_${randomBytes(4).toString('hex')}`,
            brand: 'visa',
            lastFour: '1111',
            type: 'credit_card',
            month: 12,
            year: 2030,
          };
          customer.cards.push(card);
          return json(201, storedCardBody(card));
        }
        const cardMatch =
          /^\/v1\/customers\/(cus_[^/]+)\/cards\/(card_[^/]+)$/.exec(path);
        if (method === 'DELETE' && cardMatch) {
          const customer = customers.get(cardMatch[1]);
          if (customer) {
            customer.cards = customer.cards.filter(
              (c) => c.id !== cardMatch[2],
            );
          }
          return json(200, {});
        }
        return json(500, {
          message: `unexpected Mercado Pago call ${method} ${path}`,
        });
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

  /** The default of every test: the Mercado Pago card method ON and saved cards ON. */
  async function enable(overrides?: {
    cardEnabled?: boolean;
    savedCardsEnabled?: boolean;
  }): Promise<void> {
    await enableTestCardPayments(app, prisma, {
      cardEnabled: overrides?.cardEnabled ?? true,
      savedCardsEnabled: overrides?.savedCardsEnabled ?? true,
    });
  }

  beforeEach(async () => {
    await flushRedis();
    mpCalls = [];
    orders = new Map();
    customers = new Map();
    chargeScenario = 'approved';
    associateOutage = false;
    orderCounter = 0;
    customerCounter = 0;
    cardCounter = 0;
    installFakeMercadoPago();
    await cleanPaymentAttemptData(prisma);
    await prisma.savedPaymentCard.deleteMany();
    await prisma.paymentProviderCustomer.deleteMany();
    await enable();
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
    await cleanProfilesData(prisma); // cascades to the saved-card tables
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
    // Leave the shared settings as the seed expects: OFF. Kill-switch rows are
    // reset to 'false', NOT deleted — a MISSING row is fail-open in
    // `PlatformSettingPort.isEnabled`.
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
    await ensureCommission();
    await flushRedis();
    await app.close();
  });

  // ---- seeding helpers (mirror rapyd-saved-cards.e2e-spec.ts) --------------

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
    const email = uniqueEmail('mp-saved-cards');
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

  interface SeededCustomer {
    email: string;
    userId: string;
    profileId: string;
    token: string;
  }
  interface SeededEngagement {
    engagementId: string;
    customer: SeededCustomer;
    customerToken: string;
    professionalToken: string;
  }

  async function seedCustomer(
    country: CountryCode = CountryCode.AR,
  ): Promise<SeededCustomer> {
    const user = await seedUser();
    const profile = await prisma.customerProfile.create({
      data: {
        userId: user.userId,
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
        customerProfileId: profile.id,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        placeId: `place-${Date.now()}-${Math.random()}`,
        latitude: -34.6037,
        longitude: -58.3816,
        isDefault: true,
      },
    });
    return {
      ...user,
      profileId: profile.id,
      token: await loginSessionToken(user.email),
    };
  }

  async function seedInProgressEngagement(options?: {
    price?: number;
    country?: CountryCode;
    customer?: SeededCustomer;
  }): Promise<SeededEngagement> {
    const price = options?.price ?? 5000;
    const country = options?.country ?? CountryCode.AR;
    const categoryId = await seedCategory();
    const customer = options?.customer ?? (await seedCustomer(country));

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
      customer.token,
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
      customer.token,
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
      customer.token,
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
      customer,
      customerToken: customer.token,
      professionalToken,
    };
  }

  async function payWithCard(
    engagementId: string,
    token: string | undefined,
    options?: { saveCard?: boolean },
  ) {
    const response = await gqlRequest(
      PAY_CARD_MUTATION,
      {
        engagementId,
        cardToken: CARD_TOKEN,
        paymentMethodId: 'visa',
        installments: 1,
        saveCard: options?.saveCard,
      },
      token,
    ).expect(200);
    return response.body as GqlBody<{ payEngagementWithCard: AttemptPayload }>;
  }

  async function mySavedCards(token: string | undefined) {
    const response = await gqlRequest(MY_SAVED_CARDS_QUERY, {}, token).expect(
      200,
    );
    return response.body as GqlBody<{ mySavedCards: SavedCardPayload[] }>;
  }

  async function payWithSavedCard(
    engagementId: string,
    savedCardId: string,
    token: string | undefined,
    providerToken?: string,
  ) {
    const response = await gqlRequest(
      PAY_SAVED_CARD_MUTATION,
      { engagementId, savedCardId, providerToken },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      payEngagementWithSavedCard: AttemptPayload;
    }>;
  }

  async function deleteSavedCard(
    savedCardId: string,
    token: string | undefined,
  ) {
    const response = await gqlRequest(
      DELETE_SAVED_CARD_MUTATION,
      { savedCardId },
      token,
    ).expect(200);
    return response.body as GqlBody<{ deleteSavedCard: boolean }>;
  }

  async function availableMethods(engagementId: string, token: string) {
    const response = await gqlRequest(
      AVAILABLE_METHODS_QUERY,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      availablePaymentMethods: OptionPayload[];
    }>;
  }

  /** The full real journey to a saved card: pay once with saveCard: true. */
  async function customerWithSavedCard(
    country: CountryCode = CountryCode.AR,
  ): Promise<{ seeded: SeededEngagement; card: SavedCardPayload }> {
    const seeded = await seedInProgressEngagement({ country });
    const paid = await payWithCard(seeded.engagementId, seeded.customerToken, {
      saveCard: true,
    });
    expect(paid.errors).toBeUndefined();
    expect(paid.data!.payEngagementWithCard.status).toBe('APPROVED');
    const listed = await mySavedCards(seeded.customerToken);
    expect(listed.data!.mySavedCards).toHaveLength(1);
    return { seeded, card: listed.data!.mySavedCards[0] };
  }

  async function ledgerFor(engagementId: string) {
    return prisma.ledgerEntry.findMany({
      where: { engagementId },
      orderBy: { receiptNumber: 'asc' },
    });
  }
  const sum = (rows: { amount: number }[]) =>
    rows.reduce((total, row) => total + row.amount, 0);
  const customerCreateCalls = () =>
    mpCalls.filter((c) => c.method === 'POST' && c.path === '/v1/customers');
  const associateCalls = () =>
    mpCalls.filter(
      (c) =>
        c.method === 'POST' && /\/v1\/customers\/[^/]+\/cards$/.test(c.path),
    );

  // --------------------------------------------------------------------------

  describe('the switch — a feature OF the Mercado Pago card method', () => {
    it('with saved cards OFF (the seeded default), saveCard: true on a normal charge is silently a no-op: the payment still approves, no customer or card is created', async () => {
      await enable({ savedCardsEnabled: false });
      const seeded = await seedInProgressEngagement();

      const paid = await payWithCard(
        seeded.engagementId,
        seeded.customerToken,
        {
          saveCard: true,
        },
      );

      expect(paid.data!.payEngagementWithCard.status).toBe('APPROVED');
      expect(customerCreateCalls()).toHaveLength(0);
      expect(associateCalls()).toHaveLength(0);
      const listed = await mySavedCards(seeded.customerToken);
      expect(listed.data!.mySavedCards).toEqual([]);
    });

    it('with saved cards OFF, the card stays LISTED (still manageable) but payEngagementWithSavedCard answers MERCADOPAGO_SAVED_CARDS_DISABLED', async () => {
      const { seeded, card } = await customerWithSavedCard();
      await enable({ savedCardsEnabled: false });

      const listed = await mySavedCards(seeded.customerToken);
      expect(listed.errors).toBeUndefined();
      // GOS-150 follow-up: still visible, so the Customer can erase it.
      expect(listed.data!.mySavedCards.map((c) => c.id)).toEqual([card.id]);

      const paid = await payWithSavedCard(
        seeded.engagementId,
        card.id,
        seeded.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );
      expect(errorCode(paid)).toBe('MERCADOPAGO_SAVED_CARDS_DISABLED');
    });

    it('with the Mercado Pago card method itself OFF, saved cards are off too (CARD_PAYMENT_MODULE_DISABLED)', async () => {
      const { seeded, card } = await customerWithSavedCard();
      await enable({ cardEnabled: false, savedCardsEnabled: true });

      const paid = await payWithSavedCard(
        seeded.engagementId,
        card.id,
        seeded.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );
      expect(errorCode(paid)).toBe('CARD_PAYMENT_MODULE_DISABLED');
    });

    it('availablePaymentMethods says supportsSavedCards ONLY on the Mercado Pago card option, and only while the switch is ON', async () => {
      const seeded = await seedInProgressEngagement();

      const on = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );
      const cardOptionOn = on.data!.availablePaymentMethods.find(
        (o) => o.kind === 'CARD_TOKEN',
      );
      expect(cardOptionOn?.supportsSavedCards).toBe(true);
      const walletOptionOn = on.data!.availablePaymentMethods.find(
        (o) => o.kind === 'WALLET_REDIRECT',
      );
      expect(walletOptionOn).toBeUndefined(); // not configured in this test, unrelated to saved cards

      await enable({ savedCardsEnabled: false });
      const off = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(
        off.data!.availablePaymentMethods.find((o) => o.kind === 'CARD_TOKEN')
          ?.supportsSavedCards,
      ).toBe(false);
    });

    it('turning saved cards OFF never blocks erasing a stored card', async () => {
      const { seeded, card } = await customerWithSavedCard();
      await enable({ savedCardsEnabled: false });

      const deleted = await deleteSavedCard(card.id, seeded.customerToken);

      expect(deleted.errors).toBeUndefined();
      expect(deleted.data!.deleteSavedCard).toBe(true);
      const listed = await mySavedCards(seeded.customerToken);
      expect(listed.data!.mySavedCards).toEqual([]);
    });
  });

  describe('saving a card via payEngagementWithCard(saveCard: true)', () => {
    it('creates the Mercado Pago customer, associates the just-charged token, and the card then appears with NON-sensitive facts only', async () => {
      const { card } = await customerWithSavedCard();

      expect(customerCreateCalls()).toHaveLength(1);
      expect(associateCalls()).toHaveLength(1);
      expect(card).toMatchObject({
        method: 'MERCADOPAGO',
        brand: 'visa',
        lastFour: '1111',
        type: 'CREDIT_CARD',
        expirationMonth: 12,
        expirationYear: 2030,
      });
      // GOS-150 follow-up: Mercado Pago's own card id — the card_id the client
      // re-tokenizes with the CVV — never the token that was charged.
      expect(card.providerCardId).toMatch(/^card_/);
      expect(JSON.stringify(card)).not.toContain(CARD_TOKEN);
    });

    it('the SAME Customer is the same Mercado Pago customer on every later save — none is created twice', async () => {
      const { seeded } = await customerWithSavedCard();
      const secondEngagement = await seedInProgressEngagement({
        customer: seeded.customer,
      });

      const second = await payWithCard(
        secondEngagement.engagementId,
        seeded.customerToken,
        {
          saveCard: true,
        },
      );
      expect(second.errors).toBeUndefined();
      expect(second.data!.payEngagementWithCard.status).toBe('APPROVED');

      expect(customerCreateCalls()).toHaveLength(1); // still just one
    });

    it('does not save anything when saveCard is omitted — a normal card payment is untouched', async () => {
      const seeded = await seedInProgressEngagement();

      const paid = await payWithCard(seeded.engagementId, seeded.customerToken);

      expect(paid.data!.payEngagementWithCard.status).toBe('APPROVED');
      expect(customerCreateCalls()).toHaveLength(0);
      const listed = await mySavedCards(seeded.customerToken);
      expect(listed.data!.mySavedCards).toEqual([]);
    });

    it('the payment still APPROVES even when associating the card fails — a save failure never affects the charge that already succeeded', async () => {
      associateOutage = true;
      const seeded = await seedInProgressEngagement();

      const paid = await payWithCard(
        seeded.engagementId,
        seeded.customerToken,
        {
          saveCard: true,
        },
      );

      expect(paid.data!.payEngagementWithCard.status).toBe('APPROVED');
      const listed = await mySavedCards(seeded.customerToken);
      expect(listed.data!.mySavedCards).toEqual([]); // the save genuinely failed, but the charge did not
    });

    it('you only ever see YOUR cards', async () => {
      await customerWithSavedCard();
      const other = await seedCustomer();

      const listed = await mySavedCards(other.token);

      expect(listed.data!.mySavedCards).toEqual([]);
    });

    it('requires a session', async () => {
      const response = await mySavedCards(undefined);
      expect(response.errors?.[0]?.extensions?.code).toBeDefined();
    });
  });

  describe('payEngagementWithSavedCard', () => {
    it('charges via the re-tokenized providerToken and APPROVES: the ledger trio sums to zero, the Engagement is fixed to MERCADOPAGO', async () => {
      const { seeded, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({
        customer: seeded.customer,
      });

      const paid = await payWithSavedCard(
        second.engagementId,
        card.id,
        second.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );

      expect(paid.errors).toBeUndefined();
      expect(paid.data!.payEngagementWithSavedCard).toMatchObject({
        status: 'APPROVED',
        method: 'MERCADOPAGO',
      });
      expect(JSON.stringify(paid)).not.toContain(CVV_RETOKENIZED_TOKEN);
      const ledger = await ledgerFor(second.engagementId);
      expect(ledger.length).toBeGreaterThan(0);
      expect(sum(ledger)).toBe(0);
    });

    it('without a providerToken (no CVV) the charge is rejected INVALID_CARD_DATA — nothing charged', async () => {
      const { seeded, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({
        customer: seeded.customer,
      });

      const paid = await payWithSavedCard(
        second.engagementId,
        card.id,
        second.customerToken,
      );

      expect(paid.data!.payEngagementWithSavedCard).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INVALID_CARD_DATA',
      });
    });

    it('a declined card leaves the attempt REJECTED — no ledger — and frees the slot for another try', async () => {
      const { seeded, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({
        customer: seeded.customer,
      });
      chargeScenario = 'declined';

      const paid = await payWithSavedCard(
        second.engagementId,
        card.id,
        second.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );

      expect(paid.data!.payEngagementWithSavedCard.status).toBe('REJECTED');
      expect(await ledgerFor(second.engagementId)).toEqual([]);

      chargeScenario = 'approved';
      const retry = await payWithSavedCard(
        second.engagementId,
        card.id,
        second.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );
      expect(retry.data!.payEngagementWithSavedCard.status).toBe('APPROVED');
    });

    it('an UNKNOWN outcome (Mercado Pago 5xx) is PAYMENT_PROVIDER_UNAVAILABLE and the attempt is left PENDING', async () => {
      const { seeded, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({
        customer: seeded.customer,
      });
      chargeScenario = 'outage';

      const paid = await payWithSavedCard(
        second.engagementId,
        card.id,
        second.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );

      expect(errorCode(paid)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { engagementId: second.engagementId },
      });
      expect(attempt?.status).toBe('PENDING');
    });

    describe('ownership and preconditions', () => {
      it("another Customer's card is SAVED_CARD_NOT_FOUND and nothing is charged", async () => {
        const { card } = await customerWithSavedCard();
        const stranger = await seedInProgressEngagement();

        const paid = await payWithSavedCard(
          stranger.engagementId,
          card.id,
          stranger.customerToken,
          CVV_RETOKENIZED_TOKEN,
        );

        expect(errorCode(paid)).toBe('SAVED_CARD_NOT_FOUND');
      });

      it('the Professional of the Engagement cannot pay it', async () => {
        const { seeded, card } = await customerWithSavedCard();
        const second = await seedInProgressEngagement({
          customer: seeded.customer,
        });

        const paid = await payWithSavedCard(
          second.engagementId,
          card.id,
          second.professionalToken,
          CVV_RETOKENIZED_TOKEN,
        );

        expect(errorCode(paid)).toBe('ENGAGEMENT_NOT_FOUND');
      });

      it('requires a session', async () => {
        const { seeded, card } = await customerWithSavedCard();

        const paid = await payWithSavedCard(
          seeded.engagementId,
          card.id,
          undefined,
          CVV_RETOKENIZED_TOKEN,
        );

        expect(paid.errors?.[0]?.extensions?.code).toBeDefined();
      });
    });
  });

  describe('deleteSavedCard', () => {
    it("erases the card from Mercado Pago's vault AND from GoService, and the list is empty afterwards", async () => {
      const { seeded, card } = await customerWithSavedCard();

      const deleted = await deleteSavedCard(card.id, seeded.customerToken);

      expect(deleted.data!.deleteSavedCard).toBe(true);
      const listed = await mySavedCards(seeded.customerToken);
      expect(listed.data!.mySavedCards).toEqual([]);
    });

    it("another Customer's card is SAVED_CARD_NOT_FOUND and stays untouched", async () => {
      const { card } = await customerWithSavedCard();
      const stranger = await seedCustomer();

      const deleted = await deleteSavedCard(card.id, stranger.token);

      expect(errorCode(deleted)).toBe('SAVED_CARD_NOT_FOUND');
    });

    it('a deleted card can no longer be charged', async () => {
      const { seeded, card } = await customerWithSavedCard();
      await deleteSavedCard(card.id, seeded.customerToken);
      const second = await seedInProgressEngagement({
        customer: seeded.customer,
      });

      const paid = await payWithSavedCard(
        second.engagementId,
        card.id,
        second.customerToken,
        CVV_RETOKENIZED_TOKEN,
      );

      expect(errorCode(paid)).toBe('SAVED_CARD_NOT_FOUND');
    });
  });

  describe('addSavedCard — saving a card without a payment (GOS-150)', () => {
    const ADD_SAVED_CARD_MUTATION = `
      mutation AddSavedCard($cardToken: String!) {
        addSavedCard(cardToken: $cardToken) { ${SAVED_CARD_FIELDS} }
      }
    `;
    const CAN_ADD_QUERY = `query CanAddSavedCard { canAddSavedCard }`;

    async function addSavedCard(cardToken: string, token: string | undefined) {
      const response = await gqlRequest(
        ADD_SAVED_CARD_MUTATION,
        { cardToken },
        token,
      ).expect(200);
      return response.body as GqlBody<{ addSavedCard: SavedCardPayload }>;
    }

    async function canAdd(token: string) {
      const response = await gqlRequest(CAN_ADD_QUERY, {}, token).expect(200);
      return response.body as GqlBody<{ canAddSavedCard: boolean }>;
    }

    it('saves the card to the caller’s own Mercado Pago customer and lists it — no PaymentAttempt, nothing charged', async () => {
      const customer = await seedCustomer();

      const added = await addSavedCard(CARD_TOKEN, customer.token);

      expect(added.errors).toBeUndefined();
      expect(added.data!.addSavedCard).toMatchObject({
        method: 'MERCADOPAGO',
        lastFour: '1111',
        expirationMonth: 12,
        expirationYear: 2030,
      });
      expect(added.data!.addSavedCard.providerCardId).toMatch(/^card_/);
      expect(customerCreateCalls()).toHaveLength(1);
      expect(associateCalls()).toHaveLength(1);
      expect(mpCalls.some((c) => c.path === '/v1/orders')).toBe(false);
      expect(await prisma.paymentAttempt.count()).toBe(0);

      const listed = await mySavedCards(customer.token);
      expect(listed.data!.mySavedCards.map((c) => c.id)).toEqual([
        added.data!.addSavedCard.id,
      ]);
    });

    it('with saved cards OFF it is refused (canAddSavedCard false) — while delete still works', async () => {
      const customer = await seedCustomer();
      const added = await addSavedCard(CARD_TOKEN, customer.token);
      await enable({ savedCardsEnabled: false });

      expect((await canAdd(customer.token)).data!.canAddSavedCard).toBe(false);
      const refused = await addSavedCard(CARD_TOKEN, customer.token);
      expect(errorCode(refused)).toBe('MERCADOPAGO_SAVED_CARDS_DISABLED');

      const deleted = await deleteSavedCard(
        added.data!.addSavedCard.id,
        customer.token,
      );
      expect(deleted.data!.deleteSavedCard).toBe(true);
    });

    it('canAddSavedCard is true for a Customer while the feature is ON', async () => {
      const customer = await seedCustomer();

      expect((await canAdd(customer.token)).data!.canAddSavedCard).toBe(true);
    });

    it('a malformed token never reaches Mercado Pago', async () => {
      const customer = await seedCustomer();

      const refused = await addSavedCard('4509 9535', customer.token);

      expect(errorCode(refused)).toBe('INVALID_CARD_PAYMENT_INPUT');
      expect(mpCalls).toHaveLength(0);
    });

    it('requires a session', async () => {
      const response = await addSavedCard(CARD_TOKEN, undefined);
      expect(response.errors).toBeDefined();
    });
  });
});
