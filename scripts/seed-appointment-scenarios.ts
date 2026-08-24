// Follow-up to GOS-59 — adds 3 Appointment ("Coordinación de Visita")
// scenarios to the EXISTING `goservice_dev` database, for visual
// verification of the new admin panel "Appointments" tab
// (`admin-panel/js/quotes.js`'s Quote detail modal).
//
// PURELY ADDITIVE on the ServiceRequest/Quote/Engagement side — this script
// never creates, updates, or deletes any ServiceRequest/Quote/Engagement row.
// It strictly REUSES the 3 Engagements already created by
// `scripts/seed-negotiation-scenarios.ts` (María/Pedro, Carlos/Sofía,
// Laura/Ana) — looked up by their marker ServiceRequest.description, never
// re-created — and only ever INSERTs brand-new Appointment rows on top of
// them.
//
// The ONE deliberate exception, same transparency posture as
// `seed-engagement-chat-scenarios.ts`'s own `ensureEngagementChatEnabled()`:
// this script creates the `customer.appointments.enabled` PlatformSetting
// row if missing (mirroring `prisma/seed.ts`'s own entry for it exactly) and
// then explicitly sets it to `'true'` — a REAL, live, platform-wide config
// change (even though `'true'` is already that key's seeded default), not
// just scoped to these 3 scenarios. Reported loudly in this script's own
// console output, never silent.
//
// Same standalone `PrismaClient` + `ts-node` pattern as
// `scripts/seed-engagement-chat-scenarios.ts`/`scripts/seed-negotiation-
// scenarios.ts` — NOT a resolver, NOT reachable via GraphQL, NOT wired into
// NestJS's DI container. Run via `npm run demo:seed:appointments` (see
// package.json). Reads DATABASE_URL from `.env` via `process.loadEnvFile` —
// never prints its value.
//
// SCOPE: targets ONLY whatever `.env`'s `DATABASE_URL` points at — this is
// meant to be run against `goservice_dev`, never `postgres_test`.
//
// Idempotency: NOT idempotent by design, same posture as its siblings.
// Guarded by `assertNotAlreadySeeded` below. Appointment has no free-text
// content field to embed a marker string in the general case, so the marker
// lives in the one CANCELLED row's `cancelReason` (Scenario C) — checked via
// a case-insensitive `contains` before doing anything else.
//
// Appointment writes below are direct Prisma calls (not the real
// `ProposeAppointmentService`/`AcceptAppointmentService`/
// `CancelAppointmentService` classes, which depend on the full Nest DI
// graph) but deliberately MIRROR each service's own invariants by hand — see
// `src/appointments/appointments.repository.ts` and
// `src/appointments/services/{propose,accept,cancel}-appointment.service.ts`
// for the shape being mirrored (denormalized `professionalProfileId`, the
// `proposedByRole`/`proposedByCustomerProfileId`/
// `proposedByProfessionalProfileId` shape CHECK constraint, `confirmedAt`
// only on CONFIRMED, `cancelledAt`+`cancelReason` only on CANCELLED).
import path from 'node:path';
import {
  AppointmentParty,
  AppointmentStatus,
  PlatformSettingValueType,
  PrismaClient,
} from '@prisma/client';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();

const APPOINTMENTS_ENABLED_KEY = 'customer.appointments.enabled';

// Marker used by assertNotAlreadySeeded — unique enough to never collide
// with any real/other-seeded Appointment.cancelReason. Appointment has no
// other free-text field to embed a marker in (unlike
// EngagementChatMessage.content/QuoteNegotiationMessage.message).
const MARKER_CANCEL_REASON_SNIPPET =
  '[seed-appointment-scenarios] reprogramado por el cliente';

/**
 * Refuses to run against a database that already has this script's own
 * marker Appointment (identified by its `cancelReason`) — this script is
 * not re-runnable (like its siblings), so a second run would silently
 * double-create Appointments. Fails loudly instead.
 */
async function assertNotAlreadySeeded(): Promise<void> {
  const marker = await prisma.appointment.findFirst({
    where: {
      cancelReason: {
        contains: MARKER_CANCEL_REASON_SNIPPET,
        mode: 'insensitive',
      },
    },
  });
  if (marker) {
    throw new Error(
      'seed-appointment-scenarios: this database already has this ' +
        "script's marker Appointment seeded — this script is not " +
        're-runnable. Nothing was changed this run.',
    );
  }
}

/**
 * Looks up one of `seed-negotiation-scenarios.ts`'s 3 already-accepted
 * Engagements by its ServiceRequest's marker description snippet — never
 * creates one. Throws a clear, actionable error if it's missing (i.e.
 * `seed-negotiation-scenarios.ts` was never run against this database).
 *
 * `mode: 'insensitive'` and the "pick the oldest, warn on duplicates"
 * behavior below are copied verbatim from
 * `seed-engagement-chat-scenarios.ts`'s own helper of the same name — see
 * that file's header comment for the full root-cause write-up.
 */
async function getEngagementByServiceRequestMarker(marker: string): Promise<{
  id: string;
  customerProfileId: string;
  professionalProfileId: string;
}> {
  const matches = await prisma.engagement.findMany({
    where: {
      serviceRequest: {
        description: { contains: marker, mode: 'insensitive' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (matches.length === 0) {
    throw new Error(
      `seed-appointment-scenarios: expected an Engagement whose ` +
        `ServiceRequest.description contains "${marker}" to already exist ` +
        '(run "npm run demo:seed:negotiation" first) — aborting, nothing was changed.',
    );
  }
  if (matches.length > 1) {
    console.warn(
      `seed-appointment-scenarios: WARNING — ${matches.length} Engagements ` +
        `match marker "${marker}" (expected exactly 1) — likely duplicate demo ` +
        'data from a prior re-run of "npm run demo:seed:negotiation". Using the ' +
        `oldest one (id ${matches[0].id}). This does not affect correctness of ` +
        'this run, but the duplicates are worth cleaning up separately.',
    );
  }
  const engagement = matches[0];
  return {
    id: engagement.id,
    customerProfileId: engagement.customerProfileId,
    professionalProfileId: engagement.professionalProfileId,
  };
}

type PartyRef =
  | { role: 'CUSTOMER'; customerProfileId: string }
  | { role: 'PROFESSIONAL'; professionalProfileId: string };

/**
 * Mirrors `ProposeAppointmentService.propose`'s write by hand (see this
 * file's own header comment): a single, ungated `create` — no CAS needed,
 * `engagementId` is deliberately NOT `@unique` (an Engagement may
 * accumulate several Appointment rows over its life).
 */
async function proposeAppointment(params: {
  engagementId: string;
  professionalProfileId: string;
  startsAt: Date;
  endsAt: Date;
  proposedBy: PartyRef;
}) {
  const appointment = await prisma.appointment.create({
    data: {
      engagementId: params.engagementId,
      professionalProfileId: params.professionalProfileId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      proposedByRole:
        params.proposedBy.role === 'CUSTOMER'
          ? AppointmentParty.CUSTOMER
          : AppointmentParty.PROFESSIONAL,
      proposedByCustomerProfileId:
        params.proposedBy.role === 'CUSTOMER'
          ? params.proposedBy.customerProfileId
          : null,
      proposedByProfessionalProfileId:
        params.proposedBy.role === 'PROFESSIONAL'
          ? params.proposedBy.professionalProfileId
          : null,
    },
  });
  console.log(
    `seed-appointment-scenarios: created Appointment ${appointment.id} ` +
      `(status=${appointment.status}, startsAt=${appointment.startsAt.toISOString()}, ` +
      `endsAt=${appointment.endsAt.toISOString()})`,
  );
  return appointment;
}

/**
 * Mirrors `AppointmentsRepository.confirmIfPending`'s write by hand: sets
 * `status: CONFIRMED` + `confirmedAt`. No CAS needed here — this script
 * fully controls its own rows and runs single-threaded.
 */
async function confirmAppointment(appointmentId: string) {
  const appointment = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: AppointmentStatus.CONFIRMED, confirmedAt: new Date() },
  });
  console.log(
    `seed-appointment-scenarios: confirmed Appointment ${appointment.id} ` +
      `(status=${appointment.status}, confirmedAt=${appointment.confirmedAt?.toISOString()})`,
  );
  return appointment;
}

/**
 * Mirrors `AppointmentsRepository.cancelIfActive`'s write by hand: sets
 * `status: CANCELLED` + `cancelledAt` + `cancelReason`.
 */
async function cancelAppointment(appointmentId: string, cancelReason: string) {
  const appointment = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: AppointmentStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason,
    },
  });
  console.log(
    `seed-appointment-scenarios: cancelled Appointment ${appointment.id} ` +
      `(status=${appointment.status}, cancelledAt=${appointment.cancelledAt?.toISOString()}, ` +
      `cancelReason="${appointment.cancelReason}")`,
  );
  return appointment;
}

/**
 * Creates the `customer.appointments.enabled` PlatformSetting row if missing
 * (mirroring `prisma/seed.ts`'s own entry for it exactly), then explicitly
 * sets it to `'true'` — a REAL, live, platform-wide config change, reported
 * clearly in this script's console output. Required for these seeded
 * scenarios (and the consumer-facing `proposeAppointment`/
 * `acceptAppointment`/`cancelAppointment`/`appointmentsByEngagement`
 * operations) to actually be reachable — the feature is fail-open when this
 * row is missing entirely (same `PlatformSettingPort.isEnabled` fail-open
 * default as `customer.chat.enabled`), and `'true'` is already this key's
 * seeded default (`prisma/seed.ts`), but this script makes the state
 * explicit rather than relying on either the fail-open default or the seed
 * file having already run — same transparency posture as
 * `seed-engagement-chat-scenarios.ts`'s `ensureEngagementChatEnabled()`.
 */
async function ensureAppointmentsEnabled(): Promise<{
  existedBefore: boolean;
  oldValue: string | null;
}> {
  const before = await prisma.platformSetting.findUnique({
    where: { key: APPOINTMENTS_ENABLED_KEY },
  });

  if (!before) {
    await prisma.platformSetting.create({
      data: {
        key: APPOINTMENTS_ENABLED_KEY,
        description:
          'Global kill switch for the Appointment capability (proposeAppointment/acceptAppointment/cancelAppointment/appointmentsByEngagement).',
        valueType: PlatformSettingValueType.BOOLEAN,
        isEncrypted: false,
        isPublic: false,
        value: 'true',
      },
    });
    return { existedBefore: false, oldValue: null };
  }

  await prisma.platformSetting.update({
    where: { key: APPOINTMENTS_ENABLED_KEY },
    data: { value: 'true' },
  });
  return { existedBefore: true, oldValue: before.value };
}

/** A near-future Date, N days out from `now`, at a fixed local hour/minute. */
function daysFromNowAt(days: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function main(): Promise<void> {
  await assertNotAlreadySeeded();

  console.log(
    'seed-appointment-scenarios: enabling ' +
      `"${APPOINTMENTS_ENABLED_KEY}" (real, live, platform-wide config change)...`,
  );
  const flagChange = await ensureAppointmentsEnabled();
  if (!flagChange.existedBefore) {
    console.log(
      `seed-appointment-scenarios: PlatformSetting "${APPOINTMENTS_ENABLED_KEY}" ` +
        'did not exist — created it with value "true".',
    );
  } else {
    console.log(
      `seed-appointment-scenarios: PlatformSetting "${APPOINTMENTS_ENABLED_KEY}" ` +
        `changed: "${flagChange.oldValue}" -> "true". Appointment is now ` +
        'enabled platform-wide for ALL Engagements, not just these 3 scenarios.',
    );
  }

  console.log('seed-appointment-scenarios: looking up existing Engagements...');

  const engagementA = await getEngagementByServiceRequestMarker(
    'se me está saliendo agua de la llave del patio',
  ); // María (CUSTOMER) / Pedro (PROFESSIONAL) — plumbing
  const engagementB = await getEngagementByServiceRequestMarker(
    'mantenimiento del jardín delantero',
  ); // Carlos (CUSTOMER) / Sofía (PROFESSIONAL) — gardening
  const engagementC = await getEngagementByServiceRequestMarker(
    'cambiar varios tomacorrientes en la cocina',
  ); // Laura (CUSTOMER) / Ana (PROFESSIONAL) — electrical

  // ==========================================================================
  // Scenario A — plumbing (María/Pedro): Professional proposes, then it gets
  // CONFIRMED.
  // ==========================================================================
  console.log(
    'seed-appointment-scenarios: Scenario A (plomería, María/Pedro) -> CONFIRMED...',
  );

  const appointmentA = await proposeAppointment({
    engagementId: engagementA.id,
    professionalProfileId: engagementA.professionalProfileId,
    startsAt: daysFromNowAt(1, 15),
    endsAt: daysFromNowAt(1, 17),
    proposedBy: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementA.professionalProfileId,
    },
  });
  await confirmAppointment(appointmentA.id);

  // ==========================================================================
  // Scenario B — gardening (Carlos/Sofía): Customer proposes, still PENDING
  // (awaiting Sofía's confirmation).
  // ==========================================================================
  console.log(
    'seed-appointment-scenarios: Scenario B (jardinería, Carlos/Sofía) -> PENDING...',
  );

  await proposeAppointment({
    engagementId: engagementB.id,
    professionalProfileId: engagementB.professionalProfileId,
    startsAt: daysFromNowAt(3, 9),
    endsAt: daysFromNowAt(3, 11),
    proposedBy: {
      role: 'CUSTOMER',
      customerProfileId: engagementB.customerProfileId,
    },
  });

  // ==========================================================================
  // Scenario C — electrical (Laura/Ana): Professional proposes, gets
  // CANCELLED (marker cancelReason), then Customer re-proposes a new slot —
  // still PENDING. Demonstrates cancel-then-repropose on the same
  // Engagement (`engagementId` deliberately NOT @unique).
  // ==========================================================================
  console.log(
    'seed-appointment-scenarios: Scenario C (electricidad, Laura/Ana) -> CANCELLED then re-proposed PENDING...',
  );

  const appointmentC1 = await proposeAppointment({
    engagementId: engagementC.id,
    professionalProfileId: engagementC.professionalProfileId,
    startsAt: daysFromNowAt(2, 9),
    endsAt: daysFromNowAt(2, 11),
    proposedBy: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementC.professionalProfileId,
    },
  });
  await cancelAppointment(
    appointmentC1.id,
    `${MARKER_CANCEL_REASON_SNIPPET}, surgió un imprevisto.`,
  );

  const appointmentC2 = await proposeAppointment({
    engagementId: engagementC.id,
    professionalProfileId: engagementC.professionalProfileId,
    startsAt: daysFromNowAt(5, 9),
    endsAt: daysFromNowAt(5, 11),
    proposedBy: {
      role: 'CUSTOMER',
      customerProfileId: engagementC.customerProfileId,
    },
  });

  console.log('seed-appointment-scenarios: done.');
  console.log(
    JSON.stringify(
      {
        appointmentsEnabled: {
          key: APPOINTMENTS_ENABLED_KEY,
          existedBefore: flagChange.existedBefore,
          oldValue: flagChange.oldValue,
          newValue: 'true',
        },
        scenarioA: {
          engagementId: engagementA.id,
          appointmentId: appointmentA.id,
          status: 'CONFIRMED',
        },
        scenarioB: {
          engagementId: engagementB.id,
          status: 'PENDING',
        },
        scenarioC: {
          engagementId: engagementC.id,
          cancelledAppointmentId: appointmentC1.id,
          reproposedAppointmentId: appointmentC2.id,
          status: 'CANCELLED then PENDING',
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
