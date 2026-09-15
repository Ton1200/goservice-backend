// Follow-up to GOS-87 + the 2026-09-14 "Payments" admin-panel follow-up —
// adds real payment/comprobante data to the EXISTING `goservice_dev`
// database, for visual verification of the new admin "Payments" panel
// (`adminLedgerEntries`/`adminCashPaymentConfirmations`,
// `admin-panel/js/payments.js`) and of `myPaymentReceipts`/
// `myPendingCashCommissionDebt`/`confirmCashPayment` on the consumer side.
//
// PURELY ADDITIVE on the User/Profile side — reuses existing Users/
// CustomerProfiles/ProfessionalProfiles from `scripts/seed-demo-data.ts`
// (María, Carlos, Laura, Pedro, Ana, Jorge, Sofía, Diego, Valentina) strictly
// by looking them up (never re-creating them), and only ever INSERTs
// brand-new ServiceRequest/Quote/Engagement/CashPaymentConfirmation/
// LedgerEntry rows. Never touches any Engagement created by another demo
// script (`seed-negotiation-scenarios.ts`/`seed-engagement-chat-scenarios.ts`/
// `seed-appointment-scenarios.ts`/`seed-review-scenarios.ts`) — every
// ServiceRequest/Quote/Engagement here is freshly created by THIS script.
//
// Covers every `LedgerEntryType` this backend currently writes:
//   - CASH_COMMISSION_DEBT (Scenario 1 — both parties confirm cash payment)
//   - CUSTOMER_CANCELLATION_FEE + PLATFORM_COMMISSION + PROFESSIONAL_NET_CREDIT
//     (Scenario 4 — Customer cancels IN_PROGRESS work; COP currency, since
//     the Customer here — Valentina — is CO)
//   - REFUND (Scenario 5 — Professional cancels)
// Plus two HALF-confirmed `CashPaymentConfirmation` rows (Scenarios 2/3) —
// visibility `adminLedgerEntries` structurally cannot provide, the exact
// gap `adminCashPaymentConfirmations`'s `onlyPending` filter exists for.
// `CUSTOMER_CHARGE` is intentionally NOT demoed — no writer exists for it
// yet (GOS-79/80, not built).
//
// Same standalone `PrismaClient` + `ts-node` pattern as every other
// `scripts/seed-*.ts`. Run via `npm run demo:seed:payments` (see
// package.json), AFTER `npm run demo:seed` (fails loudly with a clear
// instruction if any expected upstream User/Profile is missing). Reads
// DATABASE_URL from `.env` via `process.loadEnvFile` — never prints its
// value.
//
// SCOPE: targets ONLY whatever `.env`'s `DATABASE_URL` points at — this is
// meant to be run against `goservice_dev`, never `postgres_test`.
//
// ServiceRequest/Quote/Engagement/CashPaymentConfirmation/LedgerEntry
// writes below are direct Prisma calls (not the real
// `AcceptQuoteService`/`ConfirmCashPaymentService`/
// `CancelEngagementByCustomerService`/`CancelEngagementByProfessionalService`
// classes — those depend on the full Nest DI graph) but deliberately MIRROR
// each service's own transactional invariants by hand — see
// `seed-demo-data.ts`'s own header comment for the general convention this
// follows, and each helper function below for the specific service it
// mirrors. `startEngagementWork`'s real precondition (an existing CONFIRMED
// Appointment) is deliberately SKIPPED, same "mirror only what matters for
// THIS script's own purpose" posture `seed-review-scenarios.ts` already
// documents for itself.
//
// Idempotency: NOT idempotent by design, same posture as every sibling
// `seed-*-scenarios.ts` script. Guarded by `assertNotAlreadySeeded` below
// (checks for this script's own marker ServiceRequest description before
// doing anything else).
import path from 'node:path';
import {
  CashPaymentConfirmation,
  Engagement,
  EngagementStatus,
  LedgerEntryType,
  PaymentMethod,
  PrismaClient,
  QuoteStatus,
  ServiceRequestStatus,
  ServiceRequestUrgency,
} from '@prisma/client';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();

// Matches `prisma/seed.ts`'s own seeded value exactly — this script does
// NOT change this setting, only reads it to compute realistic amounts.
const COMMISSION_PERCENT = 10;

// Unique enough to never collide with any real/other-seeded ServiceRequest
// description.
const MARKER_DESCRIPTION_SNIPPET = '[seed-payment-scenarios]';

/**
 * Refuses to run against a database that already has this script's own
 * marker ServiceRequest — this script is not re-runnable (same posture as
 * `seed-negotiation-scenarios.ts`), so a second run would silently
 * double-create scenarios. Fails loudly instead.
 */
async function assertNotAlreadySeeded(): Promise<void> {
  const marker = await prisma.serviceRequest.findFirst({
    where: { description: { contains: MARKER_DESCRIPTION_SNIPPET } },
  });
  if (marker) {
    throw new Error(
      'seed-payment-scenarios: this database already has this script\'s ' +
        'marker ServiceRequest seeded — this script is not re-runnable. ' +
        'Nothing was changed this run.',
    );
  }
}

async function getUserByEmail(email: string): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(
      `seed-payment-scenarios: expected user "${email}" to already exist ` +
        '(run "npm run demo:seed" first) — aborting, nothing was changed.',
    );
  }
  return user;
}

async function getCustomerProfileByUserEmail(
  email: string,
): Promise<{ id: string; country: 'AR' | 'CO' }> {
  const user = await getUserByEmail(email);
  const profile = await prisma.customerProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) {
    throw new Error(
      `seed-payment-scenarios: expected a CustomerProfile for "${email}" ` +
        'to already exist — aborting, nothing was changed.',
    );
  }
  return { id: profile.id, country: profile.country };
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
      `seed-payment-scenarios: expected a ProfessionalProfile for "${email}" ` +
        'to already exist — aborting, nothing was changed.',
    );
  }
  return { id: profile.id };
}

async function getCategoryByName(name: string): Promise<{ id: string }> {
  const category = await prisma.category.findUnique({ where: { name } });
  if (!category) {
    throw new Error(
      `seed-payment-scenarios: category "${name}" not found — run "npm run prisma:seed" first.`,
    );
  }
  return category;
}

const CURRENCY_BY_COUNTRY: Record<'AR' | 'CO', string> = { AR: 'ARS', CO: 'COP' };

/**
 * Mirrors `AcceptQuoteService`'s single transaction (create a SENT Quote,
 * accept it, create the Engagement) collapsed into one call for this
 * script's own purposes — every ServiceRequest/Quote created here is
 * accepted immediately, never left OPEN/SENT to negotiate.
 */
async function createAcceptedEngagement(params: {
  description: string;
  urgency: ServiceRequestUrgency;
  categoryName: string;
  customerProfileId: string;
  professionalProfileId: string;
  price: number;
}): Promise<Engagement> {
  const category = await getCategoryByName(params.categoryName);

  return prisma.$transaction(async (tx) => {
    const serviceRequest = await tx.serviceRequest.create({
      data: {
        customerProfileId: params.customerProfileId,
        categoryId: category.id,
        description: params.description,
        urgency: params.urgency,
        status: ServiceRequestStatus.OPEN,
      },
    });

    const quote = await tx.quote.create({
      data: {
        serviceRequestId: serviceRequest.id,
        professionalProfileId: params.professionalProfileId,
        price: params.price,
        message: 'Puedo hacerlo, quedo a disposición.',
        status: QuoteStatus.SENT,
      },
    });

    await tx.serviceRequest.update({
      where: { id: serviceRequest.id },
      data: { status: ServiceRequestStatus.ENGAGED, acceptedQuoteId: quote.id },
    });
    await tx.quote.update({
      where: { id: quote.id },
      data: { status: QuoteStatus.ACCEPTED, acceptedAt: new Date() },
    });

    return tx.engagement.create({
      data: {
        serviceRequestId: serviceRequest.id,
        quoteId: quote.id,
        customerProfileId: params.customerProfileId,
        professionalProfileId: params.professionalProfileId,
      },
    });
  });
}

/**
 * Mirrors `StartEngagementWorkService`'s status write only (ACCEPTED ->
 * IN_PROGRESS, stamping `startedAt`) — the real CONFIRMED-Appointment
 * precondition is deliberately skipped, see this file's own header comment.
 */
function advanceToInProgress(engagementId: string): Promise<Engagement> {
  return prisma.engagement.update({
    where: { id: engagementId },
    data: { status: EngagementStatus.IN_PROGRESS, startedAt: new Date() },
  });
}

/**
 * Mirrors `ConfirmCashPaymentService` + `CashPaymentRepository.upsertConfirmation`
 * by hand: stamps the calling role's own confirmation timestamp (creating
 * the row on first call), and assigns `Engagement.paymentMethod = CASH` if
 * unset. Does NOT itself decide whether to write the `CASH_COMMISSION_DEBT`
 * entry — see `recordCashCommissionDebtIfBothConfirmed` below, called
 * separately once both confirmations exist, same two-step shape as the real
 * service.
 */
async function confirmCashPayment(params: {
  engagementId: string;
  role: 'CUSTOMER' | 'PROFESSIONAL';
}): Promise<CashPaymentConfirmation> {
  await prisma.engagement.updateMany({
    where: { id: params.engagementId, paymentMethod: null },
    data: { paymentMethod: PaymentMethod.CASH },
  });

  const stamp =
    params.role === 'CUSTOMER'
      ? { customerConfirmedAt: new Date() }
      : { professionalConfirmedAt: new Date() };

  return prisma.cashPaymentConfirmation.upsert({
    where: { engagementId: params.engagementId },
    update: stamp,
    create: { engagementId: params.engagementId, ...stamp },
  });
}

/**
 * Mirrors `RecordCashCommissionDebtService`: writes exactly ONE
 * `CASH_COMMISSION_DEBT` `LedgerEntry` — `commission = round(quotedPrice *
 * commissionPercent / 100)` — and flips `commissionDebtRecorded`. Call only
 * once BOTH `confirmCashPayment` calls above have run for this Engagement.
 */
async function recordCashCommissionDebt(params: {
  engagementId: string;
  quotedPrice: number;
  currency: string;
  customerProfileId: string;
  professionalProfileId: string;
}): Promise<void> {
  const commission = Math.round(
    (params.quotedPrice * COMMISSION_PERCENT) / 100,
  );
  await prisma.$transaction(async (tx) => {
    await tx.cashPaymentConfirmation.update({
      where: { engagementId: params.engagementId },
      data: { commissionDebtRecorded: true },
    });
    await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: commission,
        currency: params.currency,
        engagementId: params.engagementId,
        customerProfileId: params.customerProfileId,
        professionalProfileId: params.professionalProfileId,
        commissionPercentApplied: COMMISSION_PERCENT,
      },
    });
  });
}

/**
 * Mirrors `CancelEngagementByCustomerService` + `RecordCustomerCancellationChargeService`
 * for the `IN_PROGRESS` case (DEC-008 point 3): CAS to `CANCELLED`, then 3
 * zero-sum `LedgerEntry` rows (`CUSTOMER_CANCELLATION_FEE` negative,
 * `PLATFORM_COMMISSION` + `PROFESSIONAL_NET_CREDIT` positive, summing to 0
 * with the fee).
 */
async function cancelByCustomerInProgress(params: {
  engagementId: string;
  quotedPrice: number;
  currency: string;
  customerProfileId: string;
  professionalProfileId: string;
  reason: string;
}): Promise<void> {
  const feeAmount = Math.round(
    (params.quotedPrice * COMMISSION_PERCENT) / 100,
  );
  const commissionAmount = Math.round((feeAmount * COMMISSION_PERCENT) / 100);
  const netAmount = feeAmount - commissionAmount;

  await prisma.$transaction(async (tx) => {
    await tx.engagement.update({
      where: { id: params.engagementId },
      data: {
        status: EngagementStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: params.reason,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
        amount: -feeAmount,
        currency: params.currency,
        engagementId: params.engagementId,
        customerProfileId: params.customerProfileId,
        professionalProfileId: params.professionalProfileId,
        commissionPercentApplied: COMMISSION_PERCENT,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: commissionAmount,
        currency: params.currency,
        engagementId: params.engagementId,
        customerProfileId: params.customerProfileId,
        professionalProfileId: params.professionalProfileId,
        commissionPercentApplied: COMMISSION_PERCENT,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: netAmount,
        currency: params.currency,
        engagementId: params.engagementId,
        customerProfileId: params.customerProfileId,
        professionalProfileId: params.professionalProfileId,
        commissionPercentApplied: COMMISSION_PERCENT,
      },
    });
  });
}

/**
 * Mirrors `CancelEngagementByProfessionalService` +
 * `RecordProfessionalCancellationRefundService` (DEC-008: "full refund,
 * no charge") — CAS to `CANCELLED`, then exactly ONE `REFUND` row for the
 * full quoted price, no `commissionPercentApplied` (nothing was split).
 */
async function cancelByProfessional(params: {
  engagementId: string;
  quotedPrice: number;
  currency: string;
  customerProfileId: string;
  reason: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.engagement.update({
      where: { id: params.engagementId },
      data: {
        status: EngagementStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: params.reason,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.REFUND,
        amount: params.quotedPrice,
        currency: params.currency,
        engagementId: params.engagementId,
        customerProfileId: params.customerProfileId,
        commissionPercentApplied: null,
      },
    });
  });
}

async function main(): Promise<void> {
  await assertNotAlreadySeeded();

  console.log('seed-payment-scenarios: looking up existing Users/Profiles...');

  const mariaCustomer = await getCustomerProfileByUserEmail(
    'maria.customer1@goservice.dev',
  );
  const pedroProfessional = await getProfessionalProfileByUserEmail(
    'pedro.plumber@goservice.dev',
  );
  const carlosCustomer = await getCustomerProfileByUserEmail(
    'carlos.customer2@goservice.dev',
  );
  const anaProfessional = await getProfessionalProfileByUserEmail(
    'ana.electric@goservice.dev',
  );
  const lauraCustomer = await getCustomerProfileByUserEmail(
    'laura.customer3@goservice.dev',
  );
  const sofiaProfessional = await getProfessionalProfileByUserEmail(
    'sofia.painter@goservice.dev',
  );
  const valentinaCustomer = await getCustomerProfileByUserEmail(
    'valentina.mixed2@goservice.dev',
  ); // Colombia — gives this script a real COP scenario, not just ARS.
  const jorgeProfessional = await getProfessionalProfileByUserEmail(
    'jorge.carpenter@goservice.dev',
  );
  const diegoProfessional = await getProfessionalProfileByUserEmail(
    'diego.mixed1@goservice.dev',
  );

  // ==========================================================================
  // Scenario 1 — plumbing (María/Pedro): BOTH parties confirm cash payment,
  // in order (Customer first, then Professional) → exactly ONE
  // CASH_COMMISSION_DEBT LedgerEntry, commissionDebtRecorded = true.
  // ==========================================================================
  console.log('seed-payment-scenarios: Scenario 1 (plomería, cash, ambos confirman)...');
  const plumbingPrice = 8000;
  const plumbing = await createAcceptedEngagement({
    description: `${MARKER_DESCRIPTION_SNIPPET} Se rompió una cañería y pierde agua en la cocina.`,
    urgency: ServiceRequestUrgency.URGENT,
    categoryName: 'Plomería',
    customerProfileId: mariaCustomer.id,
    professionalProfileId: pedroProfessional.id,
    price: plumbingPrice,
  });
  await advanceToInProgress(plumbing.id);
  await confirmCashPayment({ engagementId: plumbing.id, role: 'CUSTOMER' });
  await confirmCashPayment({ engagementId: plumbing.id, role: 'PROFESSIONAL' });
  await recordCashCommissionDebt({
    engagementId: plumbing.id,
    quotedPrice: plumbingPrice,
    currency: CURRENCY_BY_COUNTRY[mariaCustomer.country],
    customerProfileId: mariaCustomer.id,
    professionalProfileId: pedroProfessional.id,
  });

  // ==========================================================================
  // Scenario 2 — electrical (Carlos/Ana): ONLY the Customer confirmed cash
  // payment so far — a real half-confirmed row for "Efectivo pendiente".
  // ==========================================================================
  console.log('seed-payment-scenarios: Scenario 2 (electricidad, cash, solo Cliente confirmó)...');
  const electricalPrice = 6000;
  const electrical = await createAcceptedEngagement({
    description: `${MARKER_DESCRIPTION_SNIPPET} Cambiar varios tomacorrientes en el living.`,
    urgency: ServiceRequestUrgency.THIS_WEEK,
    categoryName: 'Electricidad',
    customerProfileId: carlosCustomer.id,
    professionalProfileId: anaProfessional.id,
    price: electricalPrice,
  });
  await advanceToInProgress(electrical.id);
  await confirmCashPayment({ engagementId: electrical.id, role: 'CUSTOMER' });
  // Ana (PROFESSIONAL) deliberately does NOT confirm yet in this scenario.

  // ==========================================================================
  // Scenario 3 — painting (Laura/Sofía): ONLY the Professional confirmed —
  // the mirror-image half-confirmed row.
  // ==========================================================================
  console.log('seed-payment-scenarios: Scenario 3 (pintura, cash, solo Profesional confirmó)...');
  const paintingPrice = 9000;
  const painting = await createAcceptedEngagement({
    description: `${MARKER_DESCRIPTION_SNIPPET} Pintar el frente de la casa.`,
    urgency: ServiceRequestUrgency.FLEXIBLE,
    categoryName: 'Pintura',
    customerProfileId: lauraCustomer.id,
    professionalProfileId: sofiaProfessional.id,
    price: paintingPrice,
  });
  await advanceToInProgress(painting.id);
  await confirmCashPayment({ engagementId: painting.id, role: 'PROFESSIONAL' });
  // Laura (CUSTOMER) deliberately does NOT confirm yet in this scenario.

  // ==========================================================================
  // Scenario 4 — carpentry (Valentina/Jorge): Customer cancels IN_PROGRESS
  // work → 3 zero-sum LedgerEntry rows, in COP (Valentina's CustomerProfile
  // is Colombia) — the first non-ARS ledger data in this dev database.
  // ==========================================================================
  console.log('seed-payment-scenarios: Scenario 4 (carpintería, cancelación por Cliente IN_PROGRESS, COP)...');
  const carpentryPrice = 5000;
  const carpentry = await createAcceptedEngagement({
    description: `${MARKER_DESCRIPTION_SNIPPET} Reparar puertas de placard corredizas.`,
    urgency: ServiceRequestUrgency.FLEXIBLE,
    categoryName: 'Carpintería',
    customerProfileId: valentinaCustomer.id,
    professionalProfileId: jorgeProfessional.id,
    price: carpentryPrice,
  });
  await advanceToInProgress(carpentry.id);
  await cancelByCustomerInProgress({
    engagementId: carpentry.id,
    quotedPrice: carpentryPrice,
    currency: CURRENCY_BY_COUNTRY[valentinaCustomer.country],
    customerProfileId: valentinaCustomer.id,
    professionalProfileId: jorgeProfessional.id,
    reason: 'Se solucionó de otra forma, ya no lo necesito.',
  });

  // ==========================================================================
  // Scenario 5 — electrical again (María/Diego): Professional cancels
  // (any stage) → exactly ONE REFUND row, full price, no commission split.
  // ==========================================================================
  console.log('seed-payment-scenarios: Scenario 5 (electricidad, cancelación por Profesional, REFUND)...');
  const refundPrice = 4000;
  const refundJob = await createAcceptedEngagement({
    description: `${MARKER_DESCRIPTION_SNIPPET} Instalar un ventilador de techo.`,
    urgency: ServiceRequestUrgency.FLEXIBLE,
    categoryName: 'Electricidad',
    customerProfileId: mariaCustomer.id,
    professionalProfileId: diegoProfessional.id,
    price: refundPrice,
  });
  await cancelByProfessional({
    engagementId: refundJob.id,
    quotedPrice: refundPrice,
    currency: CURRENCY_BY_COUNTRY[mariaCustomer.country],
    customerProfileId: mariaCustomer.id,
    reason: 'Surgió un imprevisto y no puedo cumplir con el trabajo.',
  });

  console.log('seed-payment-scenarios: done.');
  console.log(
    JSON.stringify(
      {
        devPassword: 'DevTest123! (same as npm run demo:seed)',
        adminLogin: {
          email: 'admin@goservice.dev',
          password: '(same as npm run demo:seed printed)',
        },
        scenarios: {
          scenario1_cash_bothConfirmed_oneCashCommissionDebt: {
            engagementId: plumbing.id,
          },
          scenario2_cash_onlyCustomerConfirmed_pending: {
            engagementId: electrical.id,
          },
          scenario3_cash_onlyProfessionalConfirmed_pending: {
            engagementId: painting.id,
          },
          scenario4_customerCancellation_inProgress_threeRows_COP: {
            engagementId: carpentry.id,
          },
          scenario5_professionalCancellation_refund: {
            engagementId: refundJob.id,
          },
        },
        whereToLook: {
          adminPanel:
            'Reload admin-panel > Payments — "Comprobantes" shows all 5 LedgerEntry-writing scenarios (1, 4x3, 5), "Efectivo pendiente" shows scenarios 2 and 3 (toggle "Solo pendientes" off to also see scenario 1, already fully confirmed).',
          consumer_myPaymentReceipts:
            'query { myPaymentReceipts { id receiptNumber type amount currency engagementId createdAt } } — run against /graphql, logged in as maria.customer1@goservice.dev / pedro.plumber@goservice.dev / etc.',
          consumer_myPendingCashCommissionDebt:
            'query { myPendingCashCommissionDebt } — logged in as pedro.plumber@goservice.dev, should include scenario 1\'s 800 ARS.',
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
