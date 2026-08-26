// Follow-up to GOS-46 — adds Engagement Chat ("Chat de Coordinación")
// conversations to the EXISTING `goservice_dev` database, for visual
// verification of the new admin panel "Chat de Coordinación" tab
// (`admin-panel/js/quotes.js`'s Quote detail modal).
//
// PURELY ADDITIVE on the ServiceRequest/Quote/Engagement side — this script
// never creates, updates, or deletes any ServiceRequest/Quote/Engagement row.
// It strictly REUSES the 3 Engagements already created by
// `scripts/seed-negotiation-scenarios.ts` (María/Pedro, Carlos/Sofía,
// Laura/Ana) — looked up by their marker ServiceRequest.description, never
// re-created — and only ever INSERTs brand-new EngagementChatConversation/
// EngagementChatMessage rows on top of them.
//
// The ONE deliberate exception, same transparency posture as
// `seed-negotiation-scenarios.ts`'s own `enableCustomerCanPropose()`: this
// script creates the `customer.chat.enabled` PlatformSetting row
// if missing (mirroring `prisma/seed.ts`'s own entry for it exactly) and then
// explicitly sets it to `'true'` — a REAL, live, platform-wide config change,
// not just scoped to these 3 scenarios. Reported loudly in this script's own
// console output, never silent.
//
// Same standalone `PrismaClient` + `ts-node` pattern as
// `scripts/seed-negotiation-scenarios.ts`/`scripts/seed-demo-data.ts` — NOT a
// resolver, NOT reachable via GraphQL, NOT wired into NestJS's DI container.
// Run via `npm run demo:seed:engagement-chat` (see package.json). Reads
// DATABASE_URL from `.env` via `process.loadEnvFile` — never prints its
// value.
//
// SCOPE: targets ONLY whatever `.env`'s `DATABASE_URL` points at — this is
// meant to be run against `goservice_dev`, never `postgres_test`.
//
// Idempotency: NOT idempotent by design, same posture as
// `seed-negotiation-scenarios.ts`. Guarded by `assertNotAlreadySeeded` below
// (checks for this script's own marker EngagementChatMessage content before
// doing anything else).
//
// EngagementChatConversation/EngagementChatMessage writes below are direct
// Prisma calls (not the real `SendEngagementMessageService` class, which
// depends on the full Nest DI graph) but deliberately MIRROR that service's
// own transactional invariants by hand — see
// `src/engagement-chat/engagement-chat.repository.ts`'s `upsertConversation`/
// `createMessage` and `src/engagement-chat/services/
// send-engagement-message.service.ts` for the shape being mirrored.
import path from 'node:path';
import { PlatformSettingValueType, PrismaClient } from '@prisma/client';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();

const ENGAGEMENT_CHAT_ENABLED_KEY = 'customer.chat.enabled';

// Marker used by assertNotAlreadySeeded — unique enough to never collide
// with any real/other-seeded EngagementChatMessage content.
const MARKER_MESSAGE_SNIPPET =
  '[seed-engagement-chat-scenarios] listo, nos vemos entonces';

/**
 * Refuses to run against a database that already has this script's own
 * marker EngagementChatMessage — this script is not re-runnable (like
 * `seed-negotiation-scenarios.ts`), so a second run would silently
 * double-create conversations/messages. Fails loudly instead.
 */
async function assertNotAlreadySeeded(): Promise<void> {
  const marker = await prisma.engagementChatMessage.findFirst({
    where: { content: { contains: MARKER_MESSAGE_SNIPPET } },
  });
  if (marker) {
    throw new Error(
      'seed-engagement-chat-scenarios: this database already has this ' +
        "script's marker EngagementChatMessage seeded — this script is not " +
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
 * `mode: 'insensitive'` (2026-08-22 fix, human-reported): a case-sensitive
 * `contains` (Prisma's default on Postgres) silently found zero matches for
 * Scenario A's marker (stored description starts "Se me..." capitalized,
 * mid-sentence; the marker was written lowercase) — the same root-cause bug
 * `assertNotAlreadySeeded` in `seed-negotiation-scenarios.ts` had, which let
 * that script's own duplicate-guard never fire. Applied to all 3 markers
 * here defensively, not just Scenario A's.
 *
 * Deterministic pick + a loud (non-fatal) warning if more than one
 * Engagement matches: `seed-negotiation-scenarios.ts` was confirmed to have
 * been run twice against this database (its own case-sensitivity bug above
 * let a second run slip through), so more than one matching Engagement may
 * exist per scenario. Any one of them is a valid, real, accepted Engagement
 * for that customer/professional pair — this script doesn't need to pick a
 * SPECIFIC one, just a consistent one (oldest, by `createdAt`) rather than
 * whatever Postgres happens to return first.
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
      `seed-engagement-chat-scenarios: expected an Engagement whose ` +
        `ServiceRequest.description contains "${marker}" to already exist ` +
        '(run "npm run demo:seed:negotiation" first) — aborting, nothing was changed.',
    );
  }
  if (matches.length > 1) {
    console.warn(
      `seed-engagement-chat-scenarios: WARNING — ${matches.length} Engagements ` +
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
 * Mirrors `SendEngagementMessageService.sendMessage`'s transaction by hand
 * (see this file's own header comment): idempotent upsert-by-`engagementId`
 * Conversation + a new Message, in one transaction. Returns the
 * Conversation id so subsequent calls for the same Engagement reuse it
 * (matching the upsert's own idempotent-creation guarantee).
 */
async function postEngagementMessage(params: {
  engagementId: string;
  author: PartyRef;
  content: string;
}): Promise<{ conversationId: string; messageId: string }> {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.engagementChatConversation.upsert({
      where: { engagementId: params.engagementId },
      create: { engagementId: params.engagementId },
      update: {},
    });

    const message = await tx.engagementChatMessage.create({
      data: {
        conversationId: conversation.id,
        senderRole: params.author.role,
        senderCustomerProfileId:
          params.author.role === 'CUSTOMER'
            ? params.author.customerProfileId
            : null,
        senderProfessionalProfileId:
          params.author.role === 'PROFESSIONAL'
            ? params.author.professionalProfileId
            : null,
        content: params.content,
      },
    });

    return { conversationId: conversation.id, messageId: message.id };
  });
}

/**
 * Creates the `customer.chat.enabled` PlatformSetting row if
 * missing (mirroring `prisma/seed.ts`'s own entry for it exactly), then
 * explicitly sets it to `'true'` — a REAL, live, platform-wide config
 * change, reported clearly in this script's console output. Required for
 * these seeded scenarios (and the admin panel's new "Chat de Coordinación"
 * tab / the mobile chat UI, once built) to actually be reachable — the
 * feature is fail-open when this row is missing entirely (see
 * `PrismaPlatformSettingAdapter.isEnabled`), but this script makes the state
 * explicit rather than relying on that fail-open default.
 */
async function ensureEngagementChatEnabled(): Promise<{
  existedBefore: boolean;
  oldValue: string | null;
}> {
  const before = await prisma.platformSetting.findUnique({
    where: { key: ENGAGEMENT_CHAT_ENABLED_KEY },
  });

  if (!before) {
    await prisma.platformSetting.create({
      data: {
        key: ENGAGEMENT_CHAT_ENABLED_KEY,
        description:
          'Global kill switch for the Engagement Chat capability (sendEngagementMessage/engagementMessages). Does not gate adminEngagementChatThread.',
        valueType: PlatformSettingValueType.BOOLEAN,
        isEncrypted: false,
        isPublic: false,
        value: 'true',
      },
    });
    return { existedBefore: false, oldValue: null };
  }

  await prisma.platformSetting.update({
    where: { key: ENGAGEMENT_CHAT_ENABLED_KEY },
    data: { value: 'true' },
  });
  return { existedBefore: true, oldValue: before.value };
}

async function main(): Promise<void> {
  await assertNotAlreadySeeded();

  console.log(
    'seed-engagement-chat-scenarios: enabling ' +
      `"${ENGAGEMENT_CHAT_ENABLED_KEY}" (real, live, platform-wide config change)...`,
  );
  const flagChange = await ensureEngagementChatEnabled();
  if (!flagChange.existedBefore) {
    console.log(
      `seed-engagement-chat-scenarios: PlatformSetting "${ENGAGEMENT_CHAT_ENABLED_KEY}" ` +
        'did not exist — created it with value "true".',
    );
  } else {
    console.log(
      `seed-engagement-chat-scenarios: PlatformSetting "${ENGAGEMENT_CHAT_ENABLED_KEY}" ` +
        `changed: "${flagChange.oldValue}" -> "true". Engagement Chat is now ` +
        'enabled platform-wide for ALL Engagements, not just these 3 scenarios.',
    );
  }

  console.log(
    'seed-engagement-chat-scenarios: looking up existing Engagements...',
  );

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
  // Scenario A — plumbing (María/Pedro): coordinate visit time + patio access.
  // ==========================================================================
  console.log(
    'seed-engagement-chat-scenarios: Scenario A (plomería, María/Pedro)...',
  );

  await postEngagementMessage({
    engagementId: engagementA.id,
    author: {
      role: 'CUSTOMER',
      customerProfileId: engagementA.customerProfileId,
    },
    content: 'Hola Pedro! ¿Cuándo podrías pasar a arreglar la llave del patio?',
  });
  await postEngagementMessage({
    engagementId: engagementA.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementA.professionalProfileId,
    },
    content:
      'Hola María, puedo pasar mañana a la tarde, ¿te queda bien a partir de las 15hs?',
  });
  await postEngagementMessage({
    engagementId: engagementA.id,
    author: {
      role: 'CUSTOMER',
      customerProfileId: engagementA.customerProfileId,
    },
    content:
      'Perfecto, te espero a esa hora. El patio tiene una reja, te dejo el portón sin llave.',
  });
  await postEngagementMessage({
    engagementId: engagementA.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementA.professionalProfileId,
    },
    content: `${MARKER_MESSAGE_SNIPPET}, nos vemos mañana a las 15hs.`,
  });

  // ==========================================================================
  // Scenario B — gardening (Carlos/Sofía): confirm day + whether Carlos
  // needs to be home.
  // ==========================================================================
  console.log(
    'seed-engagement-chat-scenarios: Scenario B (jardinería, Carlos/Sofía)...',
  );

  await postEngagementMessage({
    engagementId: engagementB.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementB.professionalProfileId,
    },
    content:
      'Hola Carlos, ¿qué día de esta semana te viene mejor para el mantenimiento del jardín?',
  });
  await postEngagementMessage({
    engagementId: engagementB.id,
    author: {
      role: 'CUSTOMER',
      customerProfileId: engagementB.customerProfileId,
    },
    content:
      'El jueves a la mañana estaría bien. ¿Necesitás que esté yo en casa?',
  });
  await postEngagementMessage({
    engagementId: engagementB.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementB.professionalProfileId,
    },
    content:
      'No hace falta, con que me dejes acceso al jardín delantero alcanza. Llevo mis propias herramientas.',
  });
  await postEngagementMessage({
    engagementId: engagementB.id,
    author: {
      role: 'CUSTOMER',
      customerProfileId: engagementB.customerProfileId,
    },
    content:
      'Genial, jueves a la mañana entonces. Cualquier cosa te aviso por acá.',
  });

  // ==========================================================================
  // Scenario C — electrical (Laura/Ana): confirm materials + morning vs.
  // afternoon.
  // ==========================================================================
  console.log(
    'seed-engagement-chat-scenarios: Scenario C (electricidad, Laura/Ana)...',
  );

  await postEngagementMessage({
    engagementId: engagementC.id,
    author: {
      role: 'CUSTOMER',
      customerProfileId: engagementC.customerProfileId,
    },
    content:
      'Hola Ana, ya compré los tomacorrientes nuevos, son de la marca que me recomendaste.',
  });
  await postEngagementMessage({
    engagementId: engagementC.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementC.professionalProfileId,
    },
    content:
      'Perfecto, así no tengo que llevarlos yo. ¿Preferís a la mañana o a la tarde?',
  });
  await postEngagementMessage({
    engagementId: engagementC.id,
    author: {
      role: 'CUSTOMER',
      customerProfileId: engagementC.customerProfileId,
    },
    content:
      'A la mañana mejor, tengo que salir a trabajar después del mediodía.',
  });
  await postEngagementMessage({
    engagementId: engagementC.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: engagementC.professionalProfileId,
    },
    content: 'Dale, paso el viernes a las 9hs entonces. Nos vemos!',
  });

  console.log('seed-engagement-chat-scenarios: done.');
  console.log(
    JSON.stringify(
      {
        engagementChatEnabled: {
          key: ENGAGEMENT_CHAT_ENABLED_KEY,
          existedBefore: flagChange.existedBefore,
          oldValue: flagChange.oldValue,
          newValue: 'true',
        },
        scenarioA: { engagementId: engagementA.id },
        scenarioB: { engagementId: engagementB.id },
        scenarioC: { engagementId: engagementC.id },
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
