// Follow-up to GOS-121 — adds mutual Engagement Reviews to the EXISTING
// `goservice_dev` database, for visual/manual verification of the new
// `adminReviews`/`moderateEngagementReviewComment` admin surface (no
// admin-panel UI page exists yet for this — query the admin GraphQL endpoint
// directly, e.g. Apollo Sandbox/Postman, against `/admin/graphql`) and of
// `myReceivedReviews`/`submitEngagementReview`/`ProfessionalProfile.
// averageRating`/`.reviewCount` on the consumer side (`/graphql`).
//
// PURELY ADDITIVE on the ServiceRequest/Quote/Engagement side, same posture
// as `seed-engagement-chat-scenarios.ts` — this script never creates,
// updates, or deletes any ServiceRequest/Quote row. It strictly REUSES 5
// Engagements already created by earlier demo scripts (looked up by their
// ServiceRequest's marker `description`, never re-created):
//   - 3 from `scripts/seed-negotiation-scenarios.ts` (María/Pedro,
//     Carlos/Sofía, Laura/Ana — same 3 this script's own sibling
//     `seed-engagement-chat-scenarios.ts` already reuses)
//   - 2 from `scripts/seed-demo-data.ts` (Laura/Sofía's SR3 painting job,
//     María/Jorge's SR4 carpentry job — both left ENGAGED/ACCEPTED by that
//     script, never advanced further)
// It DOES advance each of those 5 Engagements' `status` all the way to
// `COMPLETED` (stamping `startedAt`/`finishedAt`/`completedAt`) — the one
// piece of state this script mutates beyond just adding rows. This is safe:
// no other demo script reads/depends on any of these 5 Engagements still
// being `ACCEPTED` (`seed-engagement-chat-scenarios.ts` posts chat messages
// regardless of status; `seed-appointment-scenarios.ts` operates on
// different Engagements' Appointments).
//
// Deliberately SKIPPED: the real `startEngagementWork` precondition ("at
// least one CONFIRMED Appointment on the Engagement" — see
// `StartEngagementWorkService`) is NOT replicated here. This script isn't
// exercising that gate — it only needs each Engagement to reach `COMPLETED`
// so `submitEngagementReview`/`moderateEngagementReviewComment` have
// something real to operate on. Same "mirror the invariants that matter for
// THIS script's own purpose, not every precondition of every service in the
// chain" posture already documented in `seed-demo-data.ts`'s own header
// comment.
//
// `Review`/`AdminAuditLog` writes below are direct Prisma calls (not the
// real `SubmitEngagementReviewService`/`ModerateEngagementReviewCommentService`
// classes, which depend on the full Nest DI graph) but deliberately MIRROR
// each service's own invariants by hand — see `submitReview`/`moderateReview`
// below, and `src/reviews/reviews.repository.ts` /
// `src/platform-admin/reviews/services/moderate-engagement-review-comment.service.ts`
// for the shape being mirrored (including the exact `AdminAuditLog.action`
// strings, `REVIEW_COMMENT_APPROVED`/`REVIEW_COMMENT_REJECTED`).
//
// `moderateReview` needs a real `AdminUser` id for `moderatedByAdminUserId`/
// `AdminAuditLog.actorAdminUserId` — reuses the Super Admin `npm run
// demo:seed` already bootstraps (`admin@goservice.dev`), looked up by email,
// never created here.
//
// Same standalone `PrismaClient` + `ts-node` pattern as every other
// `scripts/seed-*.ts`. Run via `npm run demo:seed:reviews` (see
// package.json), AFTER `npm run demo:seed` and `npm run demo:seed:negotiation`
// (this script fails loudly with a clear instruction if either dependency is
// missing). Reads DATABASE_URL from `.env` via `process.loadEnvFile` — never
// prints its value.
//
// SCOPE: targets ONLY whatever `.env`'s `DATABASE_URL` points at — this is
// meant to be run against `goservice_dev`, never `postgres_test`.
//
// Idempotency: NOT idempotent by design, same posture as
// `seed-negotiation-scenarios.ts`/`seed-engagement-chat-scenarios.ts`.
// Guarded by `assertNotAlreadySeeded` below (checks for this script's own
// marker Review comment before doing anything else).
import path from 'node:path';
import {
  AdminUser,
  Engagement,
  EngagementReviewParty,
  EngagementStatus,
  PrismaClient,
  Review,
  ReviewCommentModerationStatus,
} from '@prisma/client';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();

// Matches `scripts/seed-demo-data.ts`'s own `ADMIN_BOOTSTRAP_EMAIL` constant
// exactly — that script is this one's dependency for a real `AdminUser` to
// attribute moderation decisions to. Not re-exported from that file (a
// standalone script, not a shared module), so duplicated here deliberately.
const ADMIN_BOOTSTRAP_EMAIL = 'admin@goservice.dev';

// Unique enough to never collide with any real/other-seeded Review comment.
const MARKER_COMMENT_SNIPPET = '[seed-review-scenarios] trabajo prolijo';

/**
 * Refuses to run against a database that already has this script's own
 * marker Review comment — this script is not re-runnable (same posture as
 * `seed-engagement-chat-scenarios.ts`), so a second run would either violate
 * the `@@unique([engagementId, authorRole])` constraint outright (loudly, but
 * mid-script, leaving partial state) or double-create scenarios. Fails
 * loudly up front instead.
 */
async function assertNotAlreadySeeded(): Promise<void> {
  const marker = await prisma.review.findFirst({
    where: { comment: { contains: MARKER_COMMENT_SNIPPET } },
  });
  if (marker) {
    throw new Error(
      'seed-review-scenarios: this database already has this script\'s ' +
        'marker Review seeded — this script is not re-runnable. Nothing was ' +
        'changed this run.',
    );
  }
}

/**
 * Same lookup-by-marker pattern as `seed-engagement-chat-scenarios.ts`'s own
 * `getEngagementByServiceRequestMarker` — case-insensitive `contains` on the
 * owning ServiceRequest's `description` (see that function's own comment for
 * why `mode: 'insensitive'` matters here). Throws a clear, actionable error
 * if the expected upstream demo script was never run.
 */
async function getEngagementByServiceRequestMarker(
  marker: string,
  upstreamCommand: string,
): Promise<Engagement> {
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
      `seed-review-scenarios: expected an Engagement whose ServiceRequest.` +
        `description contains "${marker}" to already exist (run "${upstreamCommand}" ` +
        'first) — aborting, nothing was changed.',
    );
  }
  if (matches.length > 1) {
    console.warn(
      `seed-review-scenarios: WARNING — ${matches.length} Engagements match ` +
        `marker "${marker}" (expected exactly 1) — using the oldest one (id ` +
        `${matches[0].id}).`,
    );
  }
  return matches[0];
}

async function getBootstrapAdminUser(): Promise<AdminUser> {
  const admin = await prisma.adminUser.findUnique({
    where: { email: ADMIN_BOOTSTRAP_EMAIL },
  });
  if (!admin) {
    throw new Error(
      `seed-review-scenarios: expected an AdminUser "${ADMIN_BOOTSTRAP_EMAIL}" ` +
        'to already exist (run "npm run demo:seed" first, which bootstraps it) ' +
        '— aborting, nothing was changed.',
    );
  }
  return admin;
}

/**
 * Advances one Engagement straight to `COMPLETED`, stamping
 * `startedAt`/`finishedAt`/`completedAt` in a single write (this script
 * doesn't need the real guarded-CAS-per-transition machinery — see this
 * file's own header comment on what's deliberately skipped).
 * `completedAt` is the caller-supplied `daysAgo` — the one knob that decides
 * whether GOS-121's 14-day time-based double-blind fallback has already
 * kicked in for this scenario or not.
 */
async function advanceEngagementToCompleted(
  engagementId: string,
  completedDaysAgo: number,
): Promise<Date> {
  const completedAt = new Date(
    Date.now() - completedDaysAgo * 24 * 60 * 60 * 1000,
  );
  const startedAt = new Date(completedAt.getTime() - 2 * 24 * 60 * 60 * 1000);
  const finishedAt = new Date(completedAt.getTime() - 60 * 60 * 1000);

  await prisma.engagement.update({
    where: { id: engagementId },
    data: {
      status: EngagementStatus.COMPLETED,
      startedAt,
      finishedAt,
      completedAt,
    },
  });

  return completedAt;
}

type PartyRef =
  | { role: 'CUSTOMER'; customerProfileId: string }
  | { role: 'PROFESSIONAL'; professionalProfileId: string };

/**
 * Mirrors `SubmitEngagementReviewService`'s single write by hand (see this
 * file's own header comment): `commentModerationStatus` is `PENDING` the
 * instant a non-empty `comment` is provided, `null` otherwise — never set to
 * `APPROVED`/`REJECTED` here directly (that only ever happens via
 * `moderateReview` below, mirroring the real moderation mutation).
 */
function submitReview(params: {
  engagementId: string;
  author: PartyRef;
  rating: number;
  comment?: string;
}): Promise<Review> {
  return prisma.review.create({
    data: {
      engagementId: params.engagementId,
      authorRole: params.author.role as EngagementReviewParty,
      authorCustomerProfileId:
        params.author.role === 'CUSTOMER' ? params.author.customerProfileId : null,
      authorProfessionalProfileId:
        params.author.role === 'PROFESSIONAL'
          ? params.author.professionalProfileId
          : null,
      rating: params.rating,
      comment: params.comment ?? null,
      commentModerationStatus: params.comment
        ? ReviewCommentModerationStatus.PENDING
        : null,
    },
  });
}

/**
 * Mirrors `ModerateEngagementReviewCommentService`/
 * `ReviewsRepository.updateModeration` by hand: updates the `Review` and
 * writes an `AdminAuditLog` row in the SAME transaction, same exact
 * `action`/`targetType`/`targetKey`/`metadata` shape as the real service.
 */
async function moderateReview(params: {
  reviewId: string;
  engagementId: string;
  decision: 'APPROVE' | 'REJECT';
  adminUserId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.review.update({
      where: { id: params.reviewId },
      data: {
        commentModerationStatus:
          params.decision === 'APPROVE'
            ? ReviewCommentModerationStatus.APPROVED
            : ReviewCommentModerationStatus.REJECTED,
        moderatedByAdminUserId: params.adminUserId,
        moderatedAt: new Date(),
      },
    });

    await tx.adminAuditLog.create({
      data: {
        actorAdminUserId: params.adminUserId,
        action:
          params.decision === 'APPROVE'
            ? 'REVIEW_COMMENT_APPROVED'
            : 'REVIEW_COMMENT_REJECTED',
        targetType: 'Review',
        targetKey: params.reviewId,
        metadata: {
          engagementId: params.engagementId,
          previousStatus: 'PENDING',
        },
      },
    });
  });
}

async function main(): Promise<void> {
  await assertNotAlreadySeeded();
  const admin = await getBootstrapAdminUser();

  console.log('seed-review-scenarios: looking up existing Engagements...');

  const plumbing = await getEngagementByServiceRequestMarker(
    'se me está saliendo agua de la llave del patio',
    'npm run demo:seed:negotiation',
  ); // María (CUSTOMER) / Pedro (PROFESSIONAL)
  const gardening = await getEngagementByServiceRequestMarker(
    'mantenimiento del jardín delantero',
    'npm run demo:seed:negotiation',
  ); // Carlos (CUSTOMER) / Sofía (PROFESSIONAL)
  const electrical = await getEngagementByServiceRequestMarker(
    'cambiar varios tomacorrientes en la cocina',
    'npm run demo:seed:negotiation',
  ); // Laura (CUSTOMER) / Ana (PROFESSIONAL)
  const painting = await getEngagementByServiceRequestMarker(
    'pintar living y dormitorio principal',
    'npm run demo:seed',
  ); // Laura (CUSTOMER) / Sofía (PROFESSIONAL) — SR3
  const carpentry = await getEngagementByServiceRequestMarker(
    'reparar puertas de placard corredizas',
    'npm run demo:seed',
  ); // María (CUSTOMER) / Jorge (PROFESSIONAL) — SR4

  // ==========================================================================
  // Scenario 1 — plumbing (María/Pedro): BOTH rated, rating-only, no
  // comments. Simplest possible case — both sides see each other's rating
  // immediately, nothing ever pending moderation.
  // ==========================================================================
  console.log('seed-review-scenarios: Scenario 1 (plomería, María/Pedro)...');
  await advanceEngagementToCompleted(plumbing.id, 3);
  await submitReview({
    engagementId: plumbing.id,
    author: { role: 'CUSTOMER', customerProfileId: plumbing.customerProfileId },
    rating: 5,
  });
  await submitReview({
    engagementId: plumbing.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: plumbing.professionalProfileId,
    },
    rating: 5,
  });

  // ==========================================================================
  // Scenario 2 — gardening (Carlos/Sofía): ONLY Sofía (PROFESSIONAL) rated,
  // with a comment left PENDING. Carlos (CUSTOMER) has NOT rated yet, and
  // completedAt is recent (2 days ago) — double-blind is NOT resolved from
  // either side yet. Demonstrates: a PENDING comment sitting in the admin
  // moderation queue, and `myReceivedReviews` returning NOTHING for this
  // Engagement to Carlos (the whole Review is withheld, not just the
  // comment — see `ListMyReceivedReviewsService`'s own header comment for
  // this reading).
  // ==========================================================================
  console.log('seed-review-scenarios: Scenario 2 (jardinería, Carlos/Sofía)...');
  await advanceEngagementToCompleted(gardening.id, 2);
  await submitReview({
    engagementId: gardening.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: gardening.professionalProfileId,
    },
    rating: 5,
    comment:
      'Excelente cliente, todo clarísimo desde el primer mensaje. Volvería a trabajar con él sin dudarlo.',
  });
  // Carlos deliberately does NOT submit a review in this scenario.

  // ==========================================================================
  // Scenario 3 — electrical (Laura/Ana): BOTH rated (double-blind resolved
  // for both). Laura's comment gets APPROVED by the admin — demonstrates the
  // full "comment visible to the counterparty" end state.
  // ==========================================================================
  console.log('seed-review-scenarios: Scenario 3 (electricidad, Laura/Ana)...');
  await advanceEngagementToCompleted(electrical.id, 5);
  const lauraToAnaReview = await submitReview({
    engagementId: electrical.id,
    author: { role: 'CUSTOMER', customerProfileId: electrical.customerProfileId },
    rating: 4,
    comment: `Buen trabajo, algo demorado pero prolijo. ${MARKER_COMMENT_SNIPPET} y explicó todo bien.`,
  });
  await submitReview({
    engagementId: electrical.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: electrical.professionalProfileId,
    },
    rating: 5,
  });
  await moderateReview({
    reviewId: lauraToAnaReview.id,
    engagementId: electrical.id,
    decision: 'APPROVE',
    adminUserId: admin.id,
  });

  // ==========================================================================
  // Scenario 4 — painting (Laura/Sofía, SR3): BOTH rated (double-blind
  // resolved). Sofía's comment gets REJECTED by the admin — demonstrates:
  // admin still sees the full rejected text (and WHO rejected it/when), but
  // Laura (the counterparty) never sees the comment, only Sofía's rating.
  // ==========================================================================
  console.log('seed-review-scenarios: Scenario 4 (pintura, Laura/Sofía)...');
  await advanceEngagementToCompleted(painting.id, 4);
  const sofiaToLauraReview = await submitReview({
    engagementId: painting.id,
    author: {
      role: 'PROFESSIONAL',
      professionalProfileId: painting.professionalProfileId,
    },
    rating: 3,
    comment:
      'Cliente algo difícil, tardó bastante en confirmar los horarios y cambió de opinión varias veces.',
  });
  await submitReview({
    engagementId: painting.id,
    author: { role: 'CUSTOMER', customerProfileId: painting.customerProfileId },
    rating: 5,
  });
  await moderateReview({
    reviewId: sofiaToLauraReview.id,
    engagementId: painting.id,
    decision: 'REJECT',
    adminUserId: admin.id,
  });

  // ==========================================================================
  // Scenario 5 — carpentry (María/Jorge, SR4): ONLY María (CUSTOMER) rated,
  // no comment. Jorge (PROFESSIONAL) never rates. completedAt is backdated
  // 20 days ago (> the 14-day window) — double-blind resolves via the
  // TIME-BASED fallback despite Jorge never rating. Demonstrates that path
  // distinctly from Scenario 2's "still within the window" case, AND that
  // Jorge's `ProfessionalProfile.averageRating`/`.reviewCount` already
  // counts María's rating regardless (aggregation never waits on
  // double-blind or moderation — see `ReviewsRepository.
  // getAverageRatingForProfessional`'s own comment).
  // ==========================================================================
  console.log('seed-review-scenarios: Scenario 5 (carpintería, María/Jorge)...');
  await advanceEngagementToCompleted(carpentry.id, 20);
  await submitReview({
    engagementId: carpentry.id,
    author: { role: 'CUSTOMER', customerProfileId: carpentry.customerProfileId },
    rating: 5,
  });
  // Jorge deliberately does NOT submit a review in this scenario.

  console.log('seed-review-scenarios: done.');
  console.log(
    JSON.stringify(
      {
        adminLogin: { email: ADMIN_BOOTSTRAP_EMAIL, password: '(same as npm run demo:seed printed)' },
        devPassword: 'DevTest123! (same as npm run demo:seed)',
        scenarios: {
          scenario1_plumbing_bothRated_noComments: { engagementId: plumbing.id },
          scenario2_gardening_onlyProfessionalRated_commentPending: {
            engagementId: gardening.id,
          },
          scenario3_electrical_bothRated_commentApproved: {
            engagementId: electrical.id,
            reviewId: lauraToAnaReview.id,
          },
          scenario4_painting_bothRated_commentRejected: {
            engagementId: painting.id,
            reviewId: sofiaToLauraReview.id,
          },
          scenario5_carpentry_onlyCustomerRated_timeBasedDoubleBlind: {
            engagementId: carpentry.id,
          },
        },
        suggestedQueries: {
          admin_adminReviews:
            'query { adminReviews(limit: 20) { items { id engagementId authorRole rating comment commentModerationStatus moderatedAt } totalCount } }  — run against /admin/graphql after `login` as the admin (REVIEWS_READ)',
          admin_moderatePending:
            'mutation { moderateEngagementReviewComment(reviewId: "<scenario2 review id from adminReviews>", decision: APPROVE) { id commentModerationStatus } }',
          consumer_myReceivedReviews:
            'query { myReceivedReviews { id engagementId authorRole rating comment createdAt } }  — run against /graphql, logged in as maria.customer1@goservice.dev / carlos.customer2@goservice.dev / laura.customer3@goservice.dev / pedro.plumber@goservice.dev / sofia.painter@goservice.dev / ana.electric@goservice.dev / jorge.carpenter@goservice.dev',
          consumer_averageRating:
            'query { myProfessionalProfile { averageRating reviewCount } }  — run against /graphql, logged in as pedro.plumber@goservice.dev / sofia.painter@goservice.dev / ana.electric@goservice.dev / jorge.carpenter@goservice.dev',
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
