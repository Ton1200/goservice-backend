import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressOwnerRole,
  AuthProvider,
  CountryCode,
  PaymentAttemptType,
  PaymentMethod,
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
const CONFIRM_CASH_PAYMENT_MUTATION = `
  mutation ConfirmCashPayment($engagementId: ID!) {
    confirmCashPayment(engagementId: $engagementId) { id }
  }
`;

const ATTEMPT_FIELDS =
  'id engagementId status method amount currency installments paymentTypeId cardBrand cardLastFour rejectionReason';
const START_RAPYD_MUTATION = `
  mutation StartEngagementRapydCheckout($engagementId: ID!) {
    startEngagementRapydCheckout(engagementId: $engagementId) { attemptId checkoutId toolkitScriptUrl }
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
    availablePaymentMethods(engagementId: $engagementId) { method kind displayName supportsSavedCards }
  }
`;
const SAVED_CARD_FIELDS =
  'id brand lastFour type expirationMonth expirationYear createdAt';
const MY_SAVED_CARDS_QUERY = `
  query MySavedCards { mySavedCards { ${SAVED_CARD_FIELDS} } }
`;
const PAY_SAVED_CARD_MUTATION = `
  mutation PayEngagementWithSavedCard($engagementId: ID!, $savedCardId: ID!) {
    payEngagementWithSavedCard(engagementId: $engagementId, savedCardId: $savedCardId) { ${ATTEMPT_FIELDS} }
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
  brand: string | null;
  lastFour: string | null;
  type: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  createdAt: string;
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
// A stateful FAKE of the parts of sandboxapi.rapyd.net that the saved-cards
// feature uses — customers, the customer vault, checkout, payments (charge with
// a card token / read / cancel) and deleting a stored card. Only `global.fetch`
// is replaced: the app is otherwise fully real (Postgres, Redis, the real
// adapter, guards and transactions). Response SHAPES mirror what was observed
// LIVE against the real Rapyd sandbox in GOS-146 (2026-09-21): a stored card is
// `{ id: 'card_…', category: 'card', last4, bin_details: { type, brand },
// expiration_month: '12', expiration_year: '30' }` and a charge without
// `payment_method_options.installments` is answered 400. THIS DOES NOT PROVE the
// real sandbox works — that was checked separately with a real browser.
// ---------------------------------------------------------------------------
type ChargeScenario =
  'paid' | 'declined' | '3ds' | 'pending' | 'outage' | 'unauthorized';
interface FakeCard {
  id: string;
  last4: string;
  brand: string;
  type: 'CREDIT' | 'DEBIT';
  month: string;
  year: string;
}
interface FakeCustomer {
  id: string;
  name: string;
  email: string;
  metadata: unknown;
  cards: FakeCard[];
}
interface FakePayment {
  id: string;
  status: string;
  paid: boolean;
  amount: number;
  currency_code: string;
  merchant_reference_id: string;
  failure_code?: string;
  next_action?: string;
  payment_method_data?: Record<string, unknown>;
}
interface FakeCheckout {
  id: string;
  status: 'NEW' | 'INP' | 'DON' | 'EXP' | 'DEC';
  amount: number;
  currency: string;
  merchantReference: string;
  customer: string | null;
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

function storedCardBody(card: FakeCard) {
  return {
    id: card.id,
    type: 'ar_visa_f_card',
    category: 'card',
    name: 'Cardholder never read',
    last4: card.last4,
    bin_details: { type: card.type, brand: card.brand, bin_number: '411111' },
    expiration_month: card.month,
    expiration_year: card.year,
    fingerprint_token: 'never-exposed',
  };
}

/**
 * e2e coverage for the GOS-146 Rapyd SAVED CARDS feature — the switch
 * (`payments.payment-methods.rapyd.saved-cards-enabled`, a feature OF the Rapyd
 * method), the Rapyd customer per GoService Customer, saving a card in the
 * widget, `mySavedCards`, `payEngagementWithSavedCard` and `deleteSavedCard`.
 * Runs against the isolated `postgres_test` database (port 5433); the `redis`
 * container must be up (@nestjs/throttler).
 */
describe('GraphQL Rapyd saved cards (GOS-146, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  const realFetch = global.fetch;
  let rapydCalls: RapydCall[];
  let customers: Map<string, FakeCustomer>;
  let checkouts: Map<string, FakeCheckout>;
  let payments: Map<string, FakePayment>;
  let chargeScenario: ChargeScenario;
  let customerCreateOutage: boolean;
  let cardDeleteOutage: boolean;
  let cardListOutage: boolean;

  function installFake(): void {
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.startsWith(RAPYD_HOST)) {
          return realFetch(input, init);
        }
        const method = init?.method ?? 'GET';
        const path = url.slice(RAPYD_HOST.length);
        const headers = Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        );
        const body = init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : null;
        rapydCalls.push({ method, path, headers, body });

        if (method === 'POST' && path === '/v1/customers') {
          if (customerCreateOutage) return json(503, {});
          const customer: FakeCustomer = {
            id: `cus_${randomBytes(16).toString('hex')}`,
            name: body?.name as string,
            email: body?.email as string,
            metadata: body?.metadata,
            cards: [],
          };
          customers.set(customer.id, customer);
          return json(200, {
            status: { status: 'SUCCESS' },
            data: { id: customer.id },
          });
        }

        const cardsMatch =
          /^\/v1\/customers\/(cus_[a-z0-9]+)\/payment_methods$/.exec(path);
        if (method === 'GET' && cardsMatch) {
          if (cardListOutage) return json(503, {});
          const customer = customers.get(cardsMatch[1]);
          return customer
            ? json(200, {
                status: { status: 'SUCCESS' },
                data: customer.cards.map(storedCardBody),
              })
            : json(404, { status: { error_code: 'ERROR_GET_CUSTOMER' } });
        }
        const cardMatch =
          /^\/v1\/customers\/(cus_[a-z0-9]+)\/payment_methods\/(card_[a-z0-9]+)$/.exec(
            path,
          );
        if (method === 'DELETE' && cardMatch) {
          if (cardDeleteOutage) return json(503, {});
          const customer = customers.get(cardMatch[1]);
          if (!customer) return json(404, { status: {} });
          customer.cards = customer.cards.filter((c) => c.id !== cardMatch[2]);
          return json(200, { status: { status: 'SUCCESS' }, data: {} });
        }

        if (method === 'POST' && path === '/v1/checkout') {
          const checkout: FakeCheckout = {
            id: `checkout_${randomBytes(8).toString('hex')}`,
            status: 'NEW',
            amount: body?.amount as number,
            currency: body?.currency as string,
            merchantReference: body?.merchant_reference_id as string,
            customer: (body?.customer as string | undefined) ?? null,
            payment: null,
          };
          checkouts.set(checkout.id, checkout);
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

        if (method === 'POST' && path === '/v1/payments') {
          if (chargeScenario === 'unauthorized') {
            return json(401, {
              status: { error_code: 'UNAUTHORIZED_API_CALL' },
            });
          }
          if (chargeScenario === 'outage') return json(503, {});
          const customer = customers.get(body?.customer as string);
          const card = customer?.cards.find(
            (c) => c.id === body?.payment_method,
          );
          // Like the REAL sandbox: the LatAm card types REQUIRE installments.
          const options = body?.payment_method_options as
            { installments?: number } | undefined;
          if (!customer || !card || options?.installments !== 1) {
            return json(400, {
              status: {
                error_code: 'INVALID_REQUIRED_PAYMENT_METHOD_FIELDS',
              },
            });
          }
          const payment: FakePayment = {
            id: `payment_${randomBytes(8).toString('hex')}`,
            status: 'CLO',
            paid: true,
            amount: body?.amount as number,
            currency_code: body?.currency as string,
            merchant_reference_id: body?.merchant_reference_id as string,
            payment_method_data: {
              last4: card.last4,
              bin_details: { brand: card.brand, type: card.type },
            },
          };
          if (chargeScenario === 'declined') {
            payment.status = 'ERR';
            payment.paid = false;
            payment.failure_code = 'ERROR_CARD_DECLINED';
          } else if (chargeScenario === '3ds') {
            payment.status = 'ACT';
            payment.paid = false;
            payment.next_action = '3d_verification';
          } else if (chargeScenario === 'pending') {
            payment.status = 'ACT';
            payment.paid = false;
          }
          payments.set(payment.id, payment);
          return json(200, { status: { status: 'SUCCESS' }, data: payment });
        }
        const paymentMatch = /^\/v1\/payments\/(payment_[a-z0-9]+)$/.exec(path);
        if (method === 'GET' && paymentMatch) {
          const payment = payments.get(paymentMatch[1]);
          return payment
            ? json(200, { status: { status: 'SUCCESS' }, data: payment })
            : json(404, { status: { error_code: 'ERROR_GET_PAYMENT' } });
        }
        if (method === 'DELETE' && paymentMatch) {
          const payment = payments.get(paymentMatch[1]);
          if (payment) {
            payment.status = 'CAN';
            payment.next_action = 'not_applicable';
          }
          return json(200, { status: { status: 'SUCCESS' }, data: {} });
        }
        return json(500, {
          message: `unexpected Rapyd call ${method} ${path}`,
        });
      },
    );
  }

  /**
   * What happens INSIDE Rapyd's widget. When the checkout is linked to a
   * customer and the Customer ticked "Save card for future payments", Rapyd
   * stores the card in that customer's vault (verified live).
   */
  function payInWidget(
    checkoutId: string,
    options?: { saveCard?: boolean },
  ): FakePayment {
    const checkout = checkouts.get(checkoutId);
    if (!checkout) throw new Error(`no fake checkout ${checkoutId}`);
    const payment: FakePayment = {
      id: `payment_${randomBytes(8).toString('hex')}`,
      status: 'CLO',
      paid: true,
      amount: checkout.amount,
      currency_code: checkout.currency,
      merchant_reference_id: checkout.merchantReference,
    };
    checkout.status = 'DON';
    checkout.payment = payment;
    payments.set(payment.id, payment);
    if (options?.saveCard && checkout.customer) {
      customers.get(checkout.customer)?.cards.push({
        id: `card_${randomBytes(16).toString('hex')}`,
        last4: '1111',
        brand: 'VISA',
        type: 'DEBIT',
        month: '12',
        year: '30',
      });
    }
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

  /** The default of every test: Rapyd ON and saved cards ON. */
  async function enable(overrides?: {
    rapydEnabled?: boolean;
    savedCardsEnabled?: boolean;
  }): Promise<void> {
    await enableTestRapydPayments(app, prisma, {
      rapydEnabled: overrides?.rapydEnabled ?? true,
      savedCardsEnabled: overrides?.savedCardsEnabled ?? true,
    });
  }

  beforeEach(async () => {
    await flushRedis();
    rapydCalls = [];
    customers = new Map();
    checkouts = new Map();
    payments = new Map();
    chargeScenario = 'paid';
    customerCreateOutage = false;
    cardDeleteOutage = false;
    cardListOutage = false;
    installFake();
    await cleanPaymentAttemptData(prisma);
    await prisma.savedPaymentCard.deleteMany();
    await prisma.paymentProviderCustomer.deleteMany();
    await enable();
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
    await cleanProfilesData(prisma); // cascades to the saved-card tables
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
    // Leave the shared settings as the seed expects: providers and saved cards
    // OFF. Kill-switch rows are reset to 'false', NOT deleted — a MISSING row is
    // fail-open in `PlatformSettingPort.isEnabled`.
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
            'payments.payment-methods.rapyd.saved-cards-enabled',
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

  // ---- seeding helpers (mirror rapyd-payment.e2e-spec.ts) --------------------

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
    const email = uniqueEmail('rapyd-saved-cards');
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

  /** An IN_PROGRESS Engagement; pass `customer` to make a SECOND one for the same person. */
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

  /** A signed Rapyd notification (the claimed status in the body is a deliberate lie). */
  function sendRapydWebhook(resourceId: string) {
    const body = JSON.stringify({
      id: `wh_${randomUUID()}`,
      type: 'PAYMENT_COMPLETED',
      data: { id: resourceId, status: 'CLO', paid: true, amount: 1 },
      status: 'NEW',
      created_at: Math.floor(Date.now() / 1000),
    });
    const salt = randomBytes(6).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const url = `${TEST_MERCADOPAGO_WALLET_PUBLIC_BASE_URL}/webhooks/rapyd`;
    const hex = createHmac('sha256', TEST_RAPYD_SECRET_KEY)
      .update(
        url +
          salt +
          timestamp +
          TEST_RAPYD_ACCESS_KEY +
          TEST_RAPYD_SECRET_KEY +
          body,
      )
      .digest('hex');
    return request(app.getHttpServer())
      .post('/webhooks/rapyd')
      .set('Content-Type', 'application/json')
      .set('salt', salt)
      .set('timestamp', timestamp)
      .set('signature', Buffer.from(hex).toString('base64'))
      .send(body);
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
  ) {
    const response = await gqlRequest(
      PAY_SAVED_CARD_MUTATION,
      { engagementId, savedCardId },
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

  async function myAttempt(engagementId: string, token: string) {
    const response = await gqlRequest(
      MY_ATTEMPT_QUERY,
      { engagementId },
      token,
    ).expect(200);
    return response.body as GqlBody<{
      myEngagementPaymentAttempt: AttemptPayload | null;
    }>;
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

  /**
   * The full real journey up to a saved card: a Customer pays engagement A in the
   * widget with "save card" ticked, Rapyd confirms by webhook, and the card is
   * then listed. Returns the Customer and the saved card as GraphQL shows it.
   */
  async function customerWithSavedCard(
    country: CountryCode = CountryCode.AR,
  ): Promise<{ customer: SeededCustomer; card: SavedCardPayload }> {
    const first = await seedInProgressEngagement({ country });
    const started = await startRapydOk(first);
    const payment = payInWidget(started.checkoutId, { saveCard: true });
    await sendRapydWebhook(payment.id).expect(200);
    const listed = await mySavedCards(first.customerToken);
    expect(listed.errors).toBeUndefined();
    expect(listed.data!.mySavedCards).toHaveLength(1);
    return { customer: first.customer, card: listed.data!.mySavedCards[0] };
  }

  async function ledgerFor(engagementId: string) {
    return prisma.ledgerEntry.findMany({
      where: { engagementId },
      orderBy: { receiptNumber: 'asc' },
    });
  }
  const sum = (rows: { amount: number }[]) =>
    rows.reduce((total, row) => total + row.amount, 0);
  const attemptsOf = (engagementId: string) =>
    prisma.paymentAttempt.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
    });
  const callsTo = (method: string, pathPrefix: string) =>
    rapydCalls.filter(
      (call) => call.method === method && call.path.startsWith(pathPrefix),
    );
  const chargeCalls = () => callsTo('POST', '/v1/payments');

  // --------------------------------------------------------------------------

  describe('the switch — a feature OF the Rapyd method', () => {
    it('with saved cards OFF (the seeded default) Rapyd checkout works exactly as before: NO Rapyd customer is created and the checkout is not linked to one', async () => {
      await enable({ savedCardsEnabled: false });
      const seeded = await seedInProgressEngagement();

      const payload = await startRapydOk(seeded);

      expect(payload.checkoutId).toMatch(/^checkout_/);
      expect(callsTo('POST', '/v1/customers')).toHaveLength(0);
      const [checkout] = callsTo('POST', '/v1/checkout');
      expect(checkout.body).not.toHaveProperty('customer');
      expect(await prisma.paymentProviderCustomer.count()).toBe(0);
    });

    it('with saved cards OFF, mySavedCards silently excludes Rapyd (GOS-149: mySavedCards now serves more than one provider, so a single provider being off is no longer an error — see ListMySavedCardsService) and payEngagementWithSavedCard on a REAL, owned card still answers RAPYD_SAVED_CARDS_DISABLED before touching Rapyd', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      await enable({ savedCardsEnabled: false });

      const listed = await mySavedCards(customer.token);
      expect(listed.errors).toBeUndefined();
      expect(listed.data!.mySavedCards).toEqual([]);

      const calls = rapydCalls.length;
      expect(
        errorCode(
          await payWithSavedCard(second.engagementId, card.id, customer.token),
        ),
      ).toBe('RAPYD_SAVED_CARDS_DISABLED');
      expect(rapydCalls).toHaveLength(calls); // no NEW Rapyd call from this check
    });

    it('with RAPYD itself OFF, saved cards are off too (RAPYD_MODULE_DISABLED) on a REAL, owned card, whatever the sub-switch says; mySavedCards silently excludes it too', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      await enable({ rapydEnabled: false, savedCardsEnabled: true });

      expect((await mySavedCards(customer.token)).data!.mySavedCards).toEqual(
        [],
      );
      expect(
        errorCode(
          await payWithSavedCard(second.engagementId, card.id, customer.token),
        ),
      ).toBe('RAPYD_MODULE_DISABLED');
    });

    it("a nonexistent/foreign savedCardId is SAVED_CARD_NOT_FOUND regardless of the switch (GOS-149: ownership/existence is now checked BEFORE the switch, since which switch applies depends on the card's own provider)", async () => {
      await enable({ savedCardsEnabled: false });
      const seeded = await seedInProgressEngagement();

      expect(
        errorCode(
          await payWithSavedCard(
            seeded.engagementId,
            randomUUID(),
            seeded.customerToken,
          ),
        ),
      ).toBe('SAVED_CARD_NOT_FOUND');
    });

    it('availablePaymentMethods says supportsSavedCards ONLY on the Rapyd option, and only while the switch is ON', async () => {
      const seeded = await seedInProgressEngagement();

      const on = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(
        on
          .data!.availablePaymentMethods.filter(
            (option) => option.supportsSavedCards,
          )
          .map((option) => option.method),
      ).toEqual(['RAPYD']);

      await enable({ savedCardsEnabled: false });
      const off = await availableMethods(
        seeded.engagementId,
        seeded.customerToken,
      );
      expect(
        off.data!.availablePaymentMethods.some(
          (option) => option.supportsSavedCards,
        ),
      ).toBe(false);
      // Rapyd itself is still offered — only the sub-feature went away.
      expect(
        off.data!.availablePaymentMethods.map((option) => option.method),
      ).toContain('RAPYD');
    });

    it('turning saved cards OFF never blocks erasing a stored card', async () => {
      const { customer, card } = await customerWithSavedCard();
      await enable({ savedCardsEnabled: false });

      const body = await deleteSavedCard(card.id, customer.token);

      expect(body.errors).toBeUndefined();
      expect(body.data!.deleteSavedCard).toBe(true);
      expect(await prisma.savedPaymentCard.count()).toBe(0);
    });
  });

  describe('a checkout linked to the Rapyd customer', () => {
    it('with the switch ON it creates ONE Rapyd customer per GoService Customer (name + email + profile id only) and links the checkout to it', async () => {
      const seeded = await seedInProgressEngagement();

      await startRapydOk(seeded);

      const [created] = callsTo('POST', '/v1/customers');
      expect(created.body).toEqual({
        name: 'Cliente de Prueba',
        email: seeded.customer.email,
        metadata: { goserviceCustomerProfileId: seeded.customer.profileId },
      });
      const links = await prisma.paymentProviderCustomer.findMany();
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        customerProfileId: seeded.customer.profileId,
        method: PaymentMethod.RAPYD,
        environment: 'sandbox',
      });
      const [checkout] = callsTo('POST', '/v1/checkout');
      expect(checkout.body).toMatchObject({
        customer: links[0].providerCustomerId,
      });
    });

    it('the same Customer is the same Rapyd customer on every later checkout — none is created twice', async () => {
      const first = await seedInProgressEngagement();
      await startRapydOk(first);
      const second = await seedInProgressEngagement({
        customer: first.customer,
      });

      await startRapydOk(second);

      expect(callsTo('POST', '/v1/customers')).toHaveLength(1);
      const [firstCheckout, secondCheckout] = callsTo('POST', '/v1/checkout');
      expect(secondCheckout.body!.customer).toBe(firstCheckout.body!.customer);
    });

    it('a Customer who already has a saved card gets an UNLINKED checkout (no "saved card" default that fails in the widget) — the card is charged with payEngagementWithSavedCard instead', async () => {
      const { customer } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });

      const payload = await startRapydOk(second);

      expect(payload.checkoutId).toMatch(/^checkout_/);
      const checkoutCalls = callsTo('POST', '/v1/checkout');
      expect(checkoutCalls).toHaveLength(2);
      expect(checkoutCalls[0].body).toHaveProperty('customer');
      expect(checkoutCalls[1].body).not.toHaveProperty('customer');
    });

    it('if the Rapyd customer cannot be created the payment is NOT blocked: the checkout is created without it', async () => {
      customerCreateOutage = true;
      const seeded = await seedInProgressEngagement();

      const payload = await startRapydOk(seeded);

      expect(payload.checkoutId).toMatch(/^checkout_/);
      const [checkout] = callsTo('POST', '/v1/checkout');
      expect(checkout.body).not.toHaveProperty('customer');
      expect(await prisma.paymentProviderCustomer.count()).toBe(0);
    });
  });

  describe('saving a card and mySavedCards', () => {
    it('a card saved in the widget shows up with NON-sensitive facts only — and no token, fingerprint or holder anywhere in the response', async () => {
      const { card } = await customerWithSavedCard();

      expect(card).toMatchObject({
        brand: 'visa',
        lastFour: '1111',
        type: 'DEBIT_CARD',
        expirationMonth: 12,
        expirationYear: 2030,
      });
      expect(JSON.stringify(card)).not.toMatch(
        /card_|never-exposed|Cardholder/,
      );
      const rows = await prisma.savedPaymentCard.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        method: PaymentMethod.RAPYD,
        environment: 'sandbox',
        type: PaymentAttemptType.DEBIT_CARD,
      });
      expect(rows[0].providerCardId).toMatch(/^card_/);
    });

    it('a Customer who never saved a card sees an empty list — without calling Rapyd', async () => {
      const seeded = await seedInProgressEngagement();

      const body = await mySavedCards(seeded.customerToken);

      expect(body.errors).toBeUndefined();
      expect(body.data!.mySavedCards).toEqual([]);
      expect(rapydCalls).toHaveLength(0);
    });

    it('you only ever see YOUR cards', async () => {
      await customerWithSavedCard();
      const stranger = await seedInProgressEngagement();

      const body = await mySavedCards(stranger.customerToken);

      expect(body.data!.mySavedCards).toEqual([]);
    });

    it("Rapyd's vault is the source of truth: a card removed on Rapyd's side disappears from the list", async () => {
      const { customer } = await customerWithSavedCard();
      for (const c of customers.values()) c.cards = [];

      const body = await mySavedCards(customer.token);

      expect(body.data!.mySavedCards).toEqual([]);
      expect(await prisma.savedPaymentCard.count()).toBe(0);
    });

    it('if Rapyd cannot be reached the LAST SYNCED list is returned instead of an error', async () => {
      const { customer, card } = await customerWithSavedCard();
      cardListOutage = true;

      const body = await mySavedCards(customer.token);

      expect(body.errors).toBeUndefined();
      expect(body.data!.mySavedCards.map((c) => c.id)).toEqual([card.id]);
    });

    it('requires a session', async () => {
      expect(errorCode(await mySavedCards(undefined))).toBe('UNAUTHENTICATED');
    });
  });

  describe('payEngagementWithSavedCard', () => {
    it('charges the stored token server-side and APPROVES: the ledger trio sums to zero, the Engagement is fixed to RAPYD and the receipt facts are filled — with SERVER-derived amount and NO card data sent', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({
        customer,
        price: 7000,
      });

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(body.errors).toBeUndefined();
      expect(body.data!.payEngagementWithSavedCard).toMatchObject({
        engagementId: second.engagementId,
        status: 'APPROVED',
        method: 'RAPYD',
        amount: 7000,
        currency: 'ARS',
        installments: 1,
        rejectionReason: null,
      });
      const [charge] = chargeCalls();
      const link = await prisma.paymentProviderCustomer.findFirstOrThrow();
      const row = await prisma.savedPaymentCard.findFirstOrThrow();
      expect(charge.body).toEqual({
        amount: 7000,
        currency: 'ARS',
        description: `GoService — Engagement ${second.engagementId}`,
        merchant_reference_id: second.engagementId,
        customer: link.providerCustomerId,
        payment_method: row.providerCardId,
        payment_method_options: { installments: 1 },
      });
      expect(charge.headers['idempotency']).toBe(
        body.data!.payEngagementWithSavedCard.id,
      );
      expect(JSON.stringify(charge.headers)).not.toContain(
        TEST_RAPYD_SECRET_KEY,
      );
      const entries = await ledgerFor(second.engagementId);
      expect(entries).toHaveLength(3);
      expect(sum(entries)).toBe(0);
      expect(
        (
          await prisma.engagement.findUnique({
            where: { id: second.engagementId },
          })
        )?.paymentMethod,
      ).toBe(PaymentMethod.RAPYD);
    });

    it('a COLOMBIAN Customer is charged in COP through the same single credential set', async () => {
      const { customer, card } = await customerWithSavedCard(CountryCode.CO);
      const second = await seedInProgressEngagement({
        customer,
        price: 30000,
        country: CountryCode.CO,
      });

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(body.data!.payEngagementWithSavedCard).toMatchObject({
        status: 'APPROVED',
        amount: 30000,
        currency: 'COP',
      });
      expect(chargeCalls()[0].headers['access_key']).toBe(
        TEST_RAPYD_ACCESS_KEY,
      );
    });

    it('a declined card leaves the attempt REJECTED with the domain reason — no ledger — and frees the slot for another try', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      chargeScenario = 'declined';

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(body.data!.payEngagementWithSavedCard).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'CARD_DECLINED',
      });
      expect(await ledgerFor(second.engagementId)).toHaveLength(0);

      chargeScenario = 'paid';
      const retry = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );
      expect(retry.data!.payEngagementWithSavedCard.status).toBe('APPROVED');
    });

    it("when the issuer demands 3D Secure nothing is charged: the attempt is REJECTED AUTHENTICATION_REQUIRED, Rapyd's payment is CANCELLED, and the client can fall back to the widget", async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      chargeScenario = '3ds';

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(body.data!.payEngagementWithSavedCard).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'AUTHENTICATION_REQUIRED',
      });
      expect(callsTo('DELETE', '/v1/payments/payment_')).toHaveLength(1);
      expect(await ledgerFor(second.engagementId)).toHaveLength(0);
      // The fallback: the normal embedded checkout is available right away.
      const fallback = await startRapyd(second.engagementId, customer.token);
      expect(fallback.errors).toBeUndefined();
      expect(fallback.data!.startEngagementRapydCheckout.checkoutId).toMatch(
        /^checkout_/,
      );
    });

    it("an undecided charge stays PENDING; Rapyd's later notification is re-read and approves it (the body is never trusted)", async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      chargeScenario = 'pending';

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );
      expect(body.data!.payEngagementWithSavedCard.status).toBe('PENDING');
      const [attempt] = await attemptsOf(second.engagementId);
      expect(attempt.providerPaymentId).toMatch(/^payment_/);
      expect(attempt.providerCheckoutId).toBeNull();

      const payment = payments.get(attempt.providerPaymentId!)!;
      payment.status = 'CLO';
      payment.paid = true;
      await sendRapydWebhook(payment.id).expect(200);

      const after = await myAttempt(second.engagementId, customer.token);
      expect(after.data!.myEngagementPaymentAttempt?.status).toBe('APPROVED');
      expect(sum(await ledgerFor(second.engagementId))).toBe(0);
    });

    it('a pending charge that Rapyd later FAILS is closed REJECTED by the notification — it must not block the Engagement forever', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      chargeScenario = 'pending';
      await payWithSavedCard(second.engagementId, card.id, customer.token);
      const [attempt] = await attemptsOf(second.engagementId);
      const payment = payments.get(attempt.providerPaymentId!)!;
      payment.status = 'ERR';
      payment.failure_code = 'ERROR_INSUFFICIENT_FUNDS';

      await sendRapydWebhook(payment.id).expect(200);

      expect((await attemptsOf(second.engagementId))[0]).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      expect(await ledgerFor(second.engagementId)).toHaveLength(0);
    });

    it('an UNKNOWN outcome (Rapyd 5xx) is PAYMENT_PROVIDER_UNAVAILABLE and the attempt is deliberately left PENDING — a charge may exist', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      chargeScenario = 'outage';

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      expect((await attemptsOf(second.engagementId))[0].status).toBe('PENDING');
    });

    it('credentials rejected by Rapyd reject the attempt (so it does not block anything) and answer PAYMENT_PROVIDER_NOT_CONFIGURED', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      chargeScenario = 'unauthorized';

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(errorCode(body)).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
      expect((await attemptsOf(second.engagementId))[0].status).toBe(
        'REJECTED',
      );
    });

    describe('ownership and preconditions', () => {
      it("another Customer's card is SAVED_CARD_NOT_FOUND and nothing is charged", async () => {
        const { card } = await customerWithSavedCard();
        const stranger = await seedInProgressEngagement();

        const body = await payWithSavedCard(
          stranger.engagementId,
          card.id,
          stranger.customerToken,
        );

        expect(errorCode(body)).toBe('SAVED_CARD_NOT_FOUND');
        expect(chargeCalls()).toHaveLength(0);
        expect(await attemptsOf(stranger.engagementId)).toHaveLength(0);
      });

      it("someone else's Engagement is the anti-enumeration ENGAGEMENT_NOT_FOUND — even with the caller's own valid card", async () => {
        const { customer, card } = await customerWithSavedCard();
        const other = await seedInProgressEngagement();

        const body = await payWithSavedCard(
          other.engagementId,
          card.id,
          customer.token,
        );

        expect(errorCode(body)).toBe('ENGAGEMENT_NOT_FOUND');
        expect(chargeCalls()).toHaveLength(0);
      });

      it('the Professional of the Engagement cannot pay it', async () => {
        const { customer, card } = await customerWithSavedCard();
        const second = await seedInProgressEngagement({ customer });

        const body = await payWithSavedCard(
          second.engagementId,
          card.id,
          second.professionalToken,
        );

        expect(errorCode(body)).toBe('ENGAGEMENT_NOT_FOUND');
        expect(chargeCalls()).toHaveLength(0);
      });

      it('requires a session', async () => {
        const seeded = await seedInProgressEngagement();

        const body = await payWithSavedCard(
          seeded.engagementId,
          randomUUID(),
          undefined,
        );

        expect(errorCode(body)).toBe('UNAUTHENTICATED');
      });

      it("a card saved in ANOTHER Rapyd environment is not chargeable with today's credentials (SAVED_CARD_NOT_FOUND)", async () => {
        const { customer, card } = await customerWithSavedCard();
        const second = await seedInProgressEngagement({ customer });
        await prisma.savedPaymentCard.update({
          where: { id: card.id },
          data: { environment: 'production' },
        });

        const body = await payWithSavedCard(
          second.engagementId,
          card.id,
          customer.token,
        );

        expect(errorCode(body)).toBe('SAVED_CARD_NOT_FOUND');
        expect(chargeCalls()).toHaveLength(0);
      });

      it('an Engagement committed to CASH is PAYMENT_METHOD_CONFLICT territory: not payable by card', async () => {
        const { customer, card } = await customerWithSavedCard();
        const second = await seedInProgressEngagement({ customer });
        await gqlRequest(
          CONFIRM_CASH_PAYMENT_MUTATION,
          { engagementId: second.engagementId },
          customer.token,
        ).expect(200);

        const body = await payWithSavedCard(
          second.engagementId,
          card.id,
          customer.token,
        );

        expect([
          'ENGAGEMENT_NOT_PAYABLE_BY_CARD',
          'PAYMENT_METHOD_CONFLICT',
        ]).toContain(errorCode(body));
        expect(chargeCalls()).toHaveLength(0);
      });
    });

    describe('the payment slot', () => {
      it('an OPEN Rapyd checkout of the same Engagement must be abandoned first (CARD_PAYMENT_ALREADY_IN_PROGRESS) — after that the saved card charges', async () => {
        const { customer, card } = await customerWithSavedCard();
        const second = await seedInProgressEngagement({ customer });
        await startRapydOk(second);

        const blocked = await payWithSavedCard(
          second.engagementId,
          card.id,
          customer.token,
        );
        expect(errorCode(blocked)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
        expect(chargeCalls()).toHaveLength(0);

        await gqlRequest(
          ABANDON_MUTATION,
          { engagementId: second.engagementId },
          customer.token,
        ).expect(200);
        const paid = await payWithSavedCard(
          second.engagementId,
          card.id,
          customer.token,
        );
        expect(paid.data!.payEngagementWithSavedCard.status).toBe('APPROVED');
      });

      it('an already-paid Engagement cannot be charged again', async () => {
        const { customer, card } = await customerWithSavedCard();
        const second = await seedInProgressEngagement({ customer });
        await payWithSavedCard(second.engagementId, card.id, customer.token);

        const again = await payWithSavedCard(
          second.engagementId,
          card.id,
          customer.token,
        );

        expect(errorCode(again)).toBe('CARD_PAYMENT_ALREADY_IN_PROGRESS');
        expect(chargeCalls()).toHaveLength(1);
        expect(await ledgerFor(second.engagementId)).toHaveLength(3);
      });
    });
  });

  describe('deleteSavedCard', () => {
    it("erases the card from Rapyd's vault AND from GoService, and the list is empty afterwards", async () => {
      const { customer, card } = await customerWithSavedCard();

      const body = await deleteSavedCard(card.id, customer.token);

      expect(body.errors).toBeUndefined();
      expect(body.data!.deleteSavedCard).toBe(true);
      expect(callsTo('DELETE', '/v1/customers/cus_')).toHaveLength(1);
      expect([...customers.values()].every((c) => c.cards.length === 0)).toBe(
        true,
      );
      expect(await prisma.savedPaymentCard.count()).toBe(0);
      expect((await mySavedCards(customer.token)).data!.mySavedCards).toEqual(
        [],
      );
    });

    it("another Customer's card is SAVED_CARD_NOT_FOUND and stays untouched", async () => {
      const { card } = await customerWithSavedCard();
      const stranger = await seedInProgressEngagement();

      const body = await deleteSavedCard(card.id, stranger.customerToken);

      expect(errorCode(body)).toBe('SAVED_CARD_NOT_FOUND');
      expect(callsTo('DELETE', '/v1/customers/cus_')).toHaveLength(0);
      expect(await prisma.savedPaymentCard.count()).toBe(1);
    });

    it('if Rapyd cannot delete it the local card is KEPT (it must not look deleted while still chargeable) and the call is retryable', async () => {
      const { customer, card } = await customerWithSavedCard();
      cardDeleteOutage = true;

      const failed = await deleteSavedCard(card.id, customer.token);
      expect(errorCode(failed)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      expect(await prisma.savedPaymentCard.count()).toBe(1);

      cardDeleteOutage = false;
      const retried = await deleteSavedCard(card.id, customer.token);
      expect(retried.data!.deleteSavedCard).toBe(true);
      expect(await prisma.savedPaymentCard.count()).toBe(0);
    });

    it('a deleted card can no longer be charged', async () => {
      const { customer, card } = await customerWithSavedCard();
      const second = await seedInProgressEngagement({ customer });
      await deleteSavedCard(card.id, customer.token);

      const body = await payWithSavedCard(
        second.engagementId,
        card.id,
        customer.token,
      );

      expect(errorCode(body)).toBe('SAVED_CARD_NOT_FOUND');
      expect(chargeCalls()).toHaveLength(0);
    });

    it('requires a session', async () => {
      expect(errorCode(await deleteSavedCard(randomUUID(), undefined))).toBe(
        'UNAUTHENTICATED',
      );
    });
  });

  it('erasing the Customer profile erases its saved cards and Rapyd customer link (cascade)', async () => {
    const customer = await seedCustomer();
    await prisma.paymentProviderCustomer.create({
      data: {
        customerProfileId: customer.profileId,
        method: PaymentMethod.RAPYD,
        environment: 'sandbox',
        providerCustomerId: 'cus_cascade',
      },
    });
    await prisma.savedPaymentCard.create({
      data: {
        customerProfileId: customer.profileId,
        method: PaymentMethod.RAPYD,
        environment: 'sandbox',
        providerCardId: 'card_cascade',
      },
    });

    await prisma.customerProfile.delete({ where: { id: customer.profileId } });

    expect(await prisma.savedPaymentCard.count()).toBe(0);
    expect(await prisma.paymentProviderCustomer.count()).toBe(0);
  });
});
