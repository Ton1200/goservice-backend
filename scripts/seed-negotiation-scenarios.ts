// Follow-up to GOS-53 — adds 3 NEW, self-contained, multi-turn negotiation
// scenarios to the EXISTING `goservice_dev` database, for visual
// verification of the (recently redesigned) admin panel now that
// `acceptQuote` correctly blocks on an unresolved PENDING proposal and
// `Quote.negotiatedPrice`/`finalPrice` correctly reflects the negotiated
// price.
//
// PURELY ADDITIVE — this script never wipes/resets/updates any pre-existing
// row from a prior `scripts/seed-demo-data.ts` run. It reuses existing
// Users/CustomerProfiles/ProfessionalProfiles (María, Carlos, Laura, Pedro,
// Ana, Sofía) strictly by looking them up (never re-creating them) and only
// ever INSERTs brand-new ServiceRequest/Quote/QuoteNegotiationMessage/
// QuotePriceProposal/Engagement rows. The one exception is a single, explicit
// UPDATE of the pre-existing
// `quote-negotiation.price-edit.customer-can-propose` PlatformSetting row
// (flipped 'false' -> 'true', see Scenario C below and this script's own
// console output) — a deliberate, real config change, not silently done.
//
// Same standalone `PrismaClient` + `ts-node` pattern as
// `scripts/seed-demo-data.ts`/`scripts/bootstrap-super-admin.ts` — NOT a
// resolver, NOT reachable via GraphQL, NOT wired into NestJS's DI
// container. Run via `npm run demo:seed:negotiation` (see package.json).
// Reads DATABASE_URL from `.env` via `process.loadEnvFile` — never prints
// its value.
//
// SCOPE: targets ONLY whatever `.env`'s `DATABASE_URL` points at — this is
// meant to be run against `goservice_dev`, never `postgres_test`.
//
// Idempotency: NOT idempotent by design, same posture as
// `seed-demo-data.ts` — re-running this script would create duplicate
// ServiceRequests/Quotes. Guarded by `assertNotAlreadySeeded` below (checks
// for this script's own marker ServiceRequest descriptions before doing
// anything else).
//
// Quote/Engagement/QuoteNegotiation writes below are direct Prisma calls
// (not the real `AcceptQuoteService`/`PostQuoteNegotiationMessageService`/
// `AcceptQuotePriceProposalService` classes — those depend on the full Nest
// DI graph) but deliberately MIRROR each service's own transactional
// invariants by hand — see `seed-demo-data.ts`'s own header comment for the
// full breakdown (this script reuses the exact same helper functions,
// copied rather than imported to keep this script fully standalone).
import path from 'node:path';
import {
  PrismaClient,
  QuotePriceProposalStatus,
  QuoteStatus,
  ServiceRequestStatus,
  ServiceRequestUrgency,
} from '@prisma/client';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();

const CUSTOMER_CAN_PROPOSE_KEY =
  'quote-negotiation.price-edit.customer-can-propose';

// Marker used by assertNotAlreadySeeded — unique enough to never collide
// with any real/other-seeded ServiceRequest description.
const MARKER_DESCRIPTION_SNIPPET =
  'se me está saliendo agua de la llave del patio';

/**
 * Refuses to run against a database that already has this script's own
 * scenario A ServiceRequest — this script is not re-runnable (like
 * `seed-demo-data.ts`), so a second run would silently double-create
 * scenarios. Fails loudly instead.
 *
 * BUGFIX (2026-08-22, human-reported): `MARKER_DESCRIPTION_SNIPPET` starts
 * lowercase ("se me está...") but the real seeded description starts
 * mid-sentence-capitalized ("Se me está..."). Prisma's `contains` compiles
 * to a case-SENSITIVE Postgres `LIKE` by default (no `mode: 'insensitive'`),
 * so this check silently matched ZERO rows on every run, never blocking a
 * second run — confirmed two duplicate copies of every scenario existed in
 * `goservice_dev` before this fix (`SELECT ... WHERE description LIKE
 * '%se me está...%'` → 0 rows; the same query with `ILIKE` → 2 rows).
 * `mode: 'insensitive'` makes this check actually case-insensitive, matching
 * the plain-English intent of "already seeded", regardless of casing.
 */
async function assertNotAlreadySeeded(): Promise<void> {
  const marker = await prisma.serviceRequest.findFirst({
    where: {
      description: {
        contains: MARKER_DESCRIPTION_SNIPPET,
        mode: 'insensitive',
      },
    },
  });
  if (marker) {
    throw new Error(
      'seed-negotiation-scenarios: this database already has this ' +
        "script's scenario A ServiceRequest seeded — this script is not " +
        're-runnable. Nothing was changed this run.',
    );
  }
}

async function getUserByEmail(email: string): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(
      `seed-negotiation-scenarios: expected user "${email}" to already ` +
        'exist (run "npm run demo:seed" first) — aborting, nothing was changed.',
    );
  }
  return user;
}

async function getCustomerProfileByUserEmail(
  email: string,
): Promise<{ id: string }> {
  const user = await getUserByEmail(email);
  const profile = await prisma.customerProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) {
    throw new Error(
      `seed-negotiation-scenarios: expected a CustomerProfile for "${email}" ` +
        'to already exist — aborting, nothing was changed.',
    );
  }
  return profile;
}

async function getProfessionalProfileByUserEmail(
  email: string,
): Promise<{ id: string }> {
  const user = await getUserByEmail(email);
  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) {
    throw new Error(
      `seed-negotiation-scenarios: expected a ProfessionalProfile for ` +
        `"${email}" to already exist — aborting, nothing was changed.`,
    );
  }
  return profile;
}

async function getCategoryByName(name: string): Promise<{ id: string }> {
  const category = await prisma.category.findUnique({ where: { name } });
  if (!category) {
    throw new Error(
      `seed-negotiation-scenarios: category "${name}" not found — run "npm run prisma:seed" first.`,
    );
  }
  return category;
}

async function createServiceRequest(data: {
  customerProfileId: string;
  categoryName: string;
  description: string;
  urgency: ServiceRequestUrgency;
}) {
  const category = await getCategoryByName(data.categoryName);
  return prisma.serviceRequest.create({
    data: {
      customerProfileId: data.customerProfileId,
      categoryId: category.id,
      description: data.description,
      urgency: data.urgency,
    },
  });
}

function createQuote(data: {
  serviceRequestId: string;
  professionalProfileId: string;
  price: number;
  message: string;
}) {
  return prisma.quote.create({ data: { ...data, status: QuoteStatus.SENT } });
}

type PartyRef =
  | { role: 'CUSTOMER'; customerProfileId: string }
  | { role: 'PROFESSIONAL'; professionalProfileId: string };

/**
 * Mirrors `PostQuoteNegotiationMessageService`'s real transaction (see this
 * file's own header comment).
 */
async function postNegotiationMessage(params: {
  quoteId: string;
  author: PartyRef;
  message: string;
  proposedPrice?: number;
}): Promise<{ messageId: string; proposalId: string | null }> {
  return prisma.$transaction(async (tx) => {
    const message = await tx.quoteNegotiationMessage.create({
      data: {
        quoteId: params.quoteId,
        authorRole: params.author.role,
        authorCustomerProfileId:
          params.author.role === 'CUSTOMER'
            ? params.author.customerProfileId
            : null,
        authorProfessionalProfileId:
          params.author.role === 'PROFESSIONAL'
            ? params.author.professionalProfileId
            : null,
        message: params.message,
      },
    });

    if (params.proposedPrice === undefined) {
      return { messageId: message.id, proposalId: null };
    }

    await tx.quotePriceProposal.updateMany({
      where: {
        quoteId: params.quoteId,
        status: QuotePriceProposalStatus.PENDING,
      },
      data: { status: QuotePriceProposalStatus.SUPERSEDED },
    });

    const proposal = await tx.quotePriceProposal.create({
      data: {
        quoteId: params.quoteId,
        negotiationMessageId: message.id,
        proposedByRole: params.author.role,
        proposedByCustomerProfileId:
          params.author.role === 'CUSTOMER'
            ? params.author.customerProfileId
            : null,
        proposedByProfessionalProfileId:
          params.author.role === 'PROFESSIONAL'
            ? params.author.professionalProfileId
            : null,
        proposedPrice: params.proposedPrice,
      },
    });

    return { messageId: message.id, proposalId: proposal.id };
  });
}

/**
 * Mirrors `AcceptQuotePriceProposalService`: CAS PENDING->ACCEPTED
 * (resolvedBy* = the COUNTERPARTY of proposedByRole, matching the real
 * service's `party.role === proposal.proposedByRole` self-resolve-forbidden
 * check) + `Quote.negotiatedPrice` set, in one transaction.
 */
async function acceptProposal(params: {
  proposalId: string;
  quoteId: string;
  proposedPrice: number;
  resolvedBy: PartyRef;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const cas = await tx.quotePriceProposal.updateMany({
      where: {
        id: params.proposalId,
        status: QuotePriceProposalStatus.PENDING,
      },
      data: {
        status: QuotePriceProposalStatus.ACCEPTED,
        resolvedAt: new Date(),
        resolvedByCustomerProfileId:
          params.resolvedBy.role === 'CUSTOMER'
            ? params.resolvedBy.customerProfileId
            : null,
        resolvedByProfessionalProfileId:
          params.resolvedBy.role === 'PROFESSIONAL'
            ? params.resolvedBy.professionalProfileId
            : null,
      },
    });
    if (cas.count !== 1) {
      throw new Error(
        `seed-negotiation-scenarios: failed to accept proposal ${params.proposalId}`,
      );
    }
    await tx.quote.update({
      where: { id: params.quoteId },
      data: { negotiatedPrice: params.proposedPrice },
    });
  });
}

/**
 * Mirrors `AcceptQuoteService`'s real invariants by hand (see
 * `seed-demo-data.ts`'s own header comment): CAS ServiceRequest
 * OPEN->ENGAGED + acceptedQuoteId, CAS Quote SENT->ACCEPTED, every OTHER
 * SENT sibling Quote on the same ServiceRequest -> REJECTED (none exist for
 * these brand-new single-Quote ServiceRequests, but run for parity with the
 * real service), one Engagement row created — all inside one transaction.
 * Pre-transaction check mirrors the real service's own pre-read: refuses to
 * proceed if a PENDING proposal is still open on this Quote.
 */
async function acceptQuote(params: {
  serviceRequestId: string;
  quoteId: string;
  customerProfileId: string;
  professionalProfileId: string;
}): Promise<void> {
  const pendingProposal = await prisma.quotePriceProposal.findFirst({
    where: {
      quoteId: params.quoteId,
      status: QuotePriceProposalStatus.PENDING,
    },
  });
  if (pendingProposal) {
    throw new Error(
      `seed-negotiation-scenarios: refusing to accept Quote ${params.quoteId} — ` +
        `it still has a PENDING price proposal (${pendingProposal.id}), same ` +
        'invariant AcceptQuoteService enforces via quoteHasPendingPriceProposal().',
    );
  }

  await prisma.$transaction(async (tx) => {
    const srCas = await tx.serviceRequest.updateMany({
      where: { id: params.serviceRequestId, status: ServiceRequestStatus.OPEN },
      data: {
        status: ServiceRequestStatus.ENGAGED,
        acceptedQuoteId: params.quoteId,
      },
    });
    if (srCas.count !== 1) {
      throw new Error(
        `seed-negotiation-scenarios: ServiceRequest ${params.serviceRequestId} was not OPEN.`,
      );
    }

    const quoteCas = await tx.quote.updateMany({
      where: {
        id: params.quoteId,
        serviceRequestId: params.serviceRequestId,
        status: QuoteStatus.SENT,
      },
      data: { status: QuoteStatus.ACCEPTED, acceptedAt: new Date() },
    });
    if (quoteCas.count !== 1) {
      throw new Error(
        `seed-negotiation-scenarios: Quote ${params.quoteId} was not SENT.`,
      );
    }

    await tx.quote.updateMany({
      where: {
        serviceRequestId: params.serviceRequestId,
        status: QuoteStatus.SENT,
        id: { not: params.quoteId },
      },
      data: { status: QuoteStatus.REJECTED, rejectedAt: new Date() },
    });

    await tx.engagement.create({
      data: {
        serviceRequestId: params.serviceRequestId,
        quoteId: params.quoteId,
        customerProfileId: params.customerProfileId,
        professionalProfileId: params.professionalProfileId,
      },
    });
  });
}

/**
 * Flips the pre-existing `quote-negotiation.price-edit.customer-can-propose`
 * PlatformSetting row 'false' -> 'true' via a direct UPDATE on that exact
 * row (never a new row) — required for Scenario C (a Customer proposing a
 * price) to be reachable at all, since `PostQuoteNegotiationMessageService`
 * checks this exact flag via `PlatformSettingPort.isEnabled()` before
 * allowing a Customer-authored `proposedPrice`. This is a real, deliberate
 * behavior change, not an incidental one — reported clearly in this
 * script's console output.
 */
async function enableCustomerCanPropose(): Promise<{
  oldValue: string | null;
}> {
  const before = await prisma.platformSetting.findUnique({
    where: { key: CUSTOMER_CAN_PROPOSE_KEY },
  });
  if (!before) {
    throw new Error(
      `seed-negotiation-scenarios: expected PlatformSetting "${CUSTOMER_CAN_PROPOSE_KEY}" ` +
        'to already exist (seeded by "npm run prisma:seed") — aborting, nothing was changed.',
    );
  }
  await prisma.platformSetting.update({
    where: { key: CUSTOMER_CAN_PROPOSE_KEY },
    data: { value: 'true' },
  });
  return { oldValue: before.value };
}

async function main(): Promise<void> {
  await assertNotAlreadySeeded();

  console.log('seed-negotiation-scenarios: looking up existing profiles...');

  const mariaProfile = await getCustomerProfileByUserEmail(
    'maria.customer1@goservice.dev',
  );
  const carlosProfile = await getCustomerProfileByUserEmail(
    'carlos.customer2@goservice.dev',
  );
  const lauraProfile = await getCustomerProfileByUserEmail(
    'laura.customer3@goservice.dev',
  );

  const pedroProfile = await getProfessionalProfileByUserEmail(
    'pedro.plumber@goservice.dev',
  );
  const sofiaProfile = await getProfessionalProfileByUserEmail(
    'sofia.painter@goservice.dev',
  );
  const anaProfile = await getProfessionalProfileByUserEmail(
    'ana.electric@goservice.dev',
  );

  // ==========================================================================
  // Scenario A — plumbing, professional proposes, full accept flow.
  // ==========================================================================
  console.log(
    'seed-negotiation-scenarios: Scenario A (plomería, Maria/Pedro)...',
  );

  const srA = await createServiceRequest({
    customerProfileId: mariaProfile.id,
    categoryName: 'Plomería',
    description:
      'Se me está saliendo agua de la llave del patio, necesito que la revisen y arreglen.',
    urgency: ServiceRequestUrgency.URGENT,
  });
  const quoteA = await createQuote({
    serviceRequestId: srA.id,
    professionalProfileId: pedroProfile.id,
    price: 100000,
    message:
      'Cotización incluye todos los materiales necesarios para el arreglo completo de la llave.',
  });
  await postNegotiationMessage({
    quoteId: quoteA.id,
    author: { role: 'CUSTOMER', customerProfileId: mariaProfile.id },
    message:
      'Yo tengo todos los materiales necesarios, ¿cuánto cuesta solo el arreglo?',
  });
  const proposalA = await postNegotiationMessage({
    quoteId: quoteA.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: pedroProfile.id },
    message: 'Sin materiales lo hago por $80.000',
    proposedPrice: 80000,
  });
  if (!proposalA.proposalId) {
    throw new Error(
      'seed-negotiation-scenarios: expected a proposal id for Scenario A',
    );
  }
  await acceptProposal({
    proposalId: proposalA.proposalId,
    quoteId: quoteA.id,
    proposedPrice: 80000,
    // Counterparty of PROFESSIONAL (the proposer) is CUSTOMER (Maria).
    resolvedBy: { role: 'CUSTOMER', customerProfileId: mariaProfile.id },
  });
  await acceptQuote({
    serviceRequestId: srA.id,
    quoteId: quoteA.id,
    customerProfileId: mariaProfile.id,
    professionalProfileId: pedroProfile.id,
  });

  // ==========================================================================
  // Scenario B — gardening, professional proposes after a discount ask, full
  // accept flow.
  // ==========================================================================
  console.log(
    'seed-negotiation-scenarios: Scenario B (jardinería, Carlos/Sofia)...',
  );

  const srB = await createServiceRequest({
    customerProfileId: carlosProfile.id,
    categoryName: 'Jardinería',
    description:
      'Necesito mantenimiento del jardín delantero, pasto alto y poda de arbustos',
    urgency: ServiceRequestUrgency.FLEXIBLE,
  });
  const quoteB = await createQuote({
    serviceRequestId: srB.id,
    professionalProfileId: sofiaProfile.id,
    price: 200000,
    message: 'Cotización para mantenimiento completo del jardín delantero.',
  });
  await postNegotiationMessage({
    quoteId: quoteB.id,
    author: { role: 'CUSTOMER', customerProfileId: carlosProfile.id },
    message: '¿Me podés hacer un descuento?',
  });
  const proposalB = await postNegotiationMessage({
    quoteId: quoteB.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: sofiaProfile.id },
    message: 'Te lo dejo en $150.000',
    proposedPrice: 150000,
  });
  if (!proposalB.proposalId) {
    throw new Error(
      'seed-negotiation-scenarios: expected a proposal id for Scenario B',
    );
  }
  await acceptProposal({
    proposalId: proposalB.proposalId,
    quoteId: quoteB.id,
    proposedPrice: 150000,
    // Counterparty of PROFESSIONAL (the proposer) is CUSTOMER (Carlos).
    resolvedBy: { role: 'CUSTOMER', customerProfileId: carlosProfile.id },
  });
  await acceptQuote({
    serviceRequestId: srB.id,
    quoteId: quoteB.id,
    customerProfileId: carlosProfile.id,
    professionalProfileId: sofiaProfile.id,
  });

  // ==========================================================================
  // Scenario C — CUSTOMER proposes a price (requires flipping
  // quote-negotiation.price-edit.customer-can-propose 'false' -> 'true'
  // first).
  // ==========================================================================
  console.log(
    'seed-negotiation-scenarios: flipping PlatformSetting ' +
      `"${CUSTOMER_CAN_PROPOSE_KEY}" false -> true (required for Scenario C)...`,
  );
  const flagChange = await enableCustomerCanPropose();
  console.log(
    `seed-negotiation-scenarios: PlatformSetting "${CUSTOMER_CAN_PROPOSE_KEY}" ` +
      `changed: "${flagChange.oldValue}" -> "true". This is a REAL, live ` +
      'config change — Customers can now attach a price proposal to a ' +
      'negotiation message platform-wide, not just for this scenario.',
  );

  console.log(
    'seed-negotiation-scenarios: Scenario C (electricidad, Laura/Ana)...',
  );

  const srC = await createServiceRequest({
    customerProfileId: lauraProfile.id,
    categoryName: 'Electricidad',
    description: 'Necesito cambiar varios tomacorrientes en la cocina',
    urgency: ServiceRequestUrgency.THIS_WEEK,
  });
  const quoteC = await createQuote({
    serviceRequestId: srC.id,
    professionalProfileId: anaProfile.id,
    price: 60000,
    message: 'Cotización para el cambio de tomacorrientes en la cocina.',
  });
  await postNegotiationMessage({
    quoteId: quoteC.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: anaProfile.id },
    message: 'Hola, ¿cuándo necesitás que pase?',
  });
  const proposalC = await postNegotiationMessage({
    quoteId: quoteC.id,
    author: { role: 'CUSTOMER', customerProfileId: lauraProfile.id },
    message: '¿Lo podés hacer por $50.000? Puedo pagar en efectivo.',
    proposedPrice: 50000,
  });
  if (!proposalC.proposalId) {
    throw new Error(
      'seed-negotiation-scenarios: expected a proposal id for Scenario C',
    );
  }
  await postNegotiationMessage({
    quoteId: quoteC.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: anaProfile.id },
    message: 'Dale, cerramos en $50.000.',
  });
  await acceptProposal({
    proposalId: proposalC.proposalId,
    quoteId: quoteC.id,
    proposedPrice: 50000,
    // Counterparty of CUSTOMER (the proposer, Laura) is PROFESSIONAL (Ana).
    resolvedBy: { role: 'PROFESSIONAL', professionalProfileId: anaProfile.id },
  });
  await acceptQuote({
    serviceRequestId: srC.id,
    quoteId: quoteC.id,
    customerProfileId: lauraProfile.id,
    professionalProfileId: anaProfile.id,
  });

  console.log('seed-negotiation-scenarios: done.');
  console.log(
    JSON.stringify(
      {
        scenarioA: { serviceRequestId: srA.id, quoteId: quoteA.id },
        scenarioB: { serviceRequestId: srB.id, quoteId: quoteB.id },
        scenarioC: { serviceRequestId: srC.id, quoteId: quoteC.id },
        platformSettingChanged: {
          key: CUSTOMER_CAN_PROPOSE_KEY,
          oldValue: flagChange.oldValue,
          newValue: 'true',
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
