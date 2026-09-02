// Demo-data seed for manual frontend testing against a freshly-reset
// `goservice_dev` database (0 rows in every domain table, only the
// Category catalog + PlatformSetting flags seeded via `npm run
// prisma:seed`). NOT a resolver, NOT reachable via GraphQL, NOT wired into
// NestJS's DI container — same standalone `PrismaClient` + `ts-node`
// pattern as `scripts/bootstrap-super-admin.ts`/`scripts/create-admin-user.ts`.
//
// Run via `npm run demo:seed` (see package.json). Reads DATABASE_URL from
// `.env` via `process.loadEnvFile` — never prints its value.
//
// SCOPE: targets ONLY whatever `.env`'s `DATABASE_URL` points at — this is
// meant to be run against `goservice_dev`, never `postgres_test`. Not
// idempotent — designed to run exactly once against a clean database (see
// `assertDatabaseIsEmpty` below); re-running against an already-seeded DB
// aborts loudly rather than creating duplicates.
//
// Password hashing: reuses the REAL `Argon2PasswordHasherAdapter`
// (argon2id) — the same class `LoginService`/`SocialLoginService` verify
// against — so every seeded account can actually log in through the real
// `login` GraphQL mutation, not a look-alike hash scheme.
//
// Admin bootstrap: shells out to `npm run admin:bootstrap` (the real
// script, with its own env vars set for this run) rather than
// re-implementing the `AdminRole`/`AdminUser` seeding logic here — that
// avoids a second, competing copy of the permission grants that could
// silently drift from `scripts/bootstrap-super-admin.ts`'s own list (see
// that script's own "PERMISSIONS GUARANTEE" header comment on exactly this
// kind of drift risk).
//
// Quote/Engagement/QuoteNegotiation writes below are direct Prisma calls
// (not the real `AcceptQuoteService`/`PostQuoteNegotiationMessageService`/
// `AcceptQuotePriceProposalService`/`RejectQuotePriceProposalService`
// classes — those depend on the full Nest DI graph) but deliberately
// MIRROR each service's own transactional invariants by hand:
//   - AcceptQuoteService: ServiceRequest.status OPEN->ENGAGED +
//     acceptedQuoteId set, Quote.status SENT->ACCEPTED, every SENT sibling
//     Quote on the same ServiceRequest -> REJECTED, one Engagement row.
//   - PostQuoteNegotiationMessageService: a price-bearing message first
//     supersedes any existing PENDING QuotePriceProposal on that Quote,
//     THEN creates the new one (at most one PENDING per Quote at a time).
//   - AcceptQuotePriceProposalService: QuotePriceProposal PENDING->ACCEPTED
//     (resolvedBy* = the COUNTERPARTY of proposedByRole) + Quote.negotiatedPrice
//     set to that proposal's price. Quote.price (the original) is never
//     touched.
//   - RejectQuotePriceProposalService: QuotePriceProposal PENDING->REJECTED
//     (same resolvedBy* counterparty rule) — Quote.negotiatedPrice stays
//     untouched (null).
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  AuthProvider,
  CountryCode,
  PrismaClient,
  ProfessionalVerificationStatus,
  QuoteNegotiationParty,
  QuotePriceProposalStatus,
  QuoteStatus,
  ServiceRequestStatus,
  ServiceRequestUrgency,
  SpecializationRole,
  UserAccountStatus,
} from '@prisma/client';
import { Argon2PasswordHasherAdapter } from '../src/users/adapters/argon2-password-hasher.adapter';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();
const passwordHasher = new Argon2PasswordHasherAdapter();

// The one shared dev password for every seeded consumer account (Customers,
// Professionals, mixed, and the two earlier-lifecycle accounts alike) —
// keeps the credentials table simple, per this task's own instruction.
const DEV_PASSWORD = 'DevTest123!';

// Distinct from DEV_PASSWORD — the platform-admin panel login is a wholly
// separate credential space (`AdminUser`, not `User`).
const ADMIN_BOOTSTRAP_EMAIL = 'admin@goservice.dev';
const ADMIN_BOOTSTRAP_PASSWORD = 'DevAdminPanel123!';
const ADMIN_BOOTSTRAP_DISPLAY_NAME = 'Demo Super Admin';

const AR_BIRTHDATE = new Date('1990-05-14');

function runAdminBootstrap(): void {
  console.log('seed-demo-data: running npm run admin:bootstrap...');
  execSync('npm run admin:bootstrap', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      ADMIN_BOOTSTRAP_EMAIL,
      ADMIN_BOOTSTRAP_PASSWORD,
      ADMIN_BOOTSTRAP_DISPLAY_NAME,
    },
  });
}

/**
 * Refuses to run against a database that already has any of this script's
 * own seeded Users — this script is not idempotent (unlike
 * `bootstrap-super-admin.ts`), so a second run would either violate the
 * `User.email` unique constraint outright or silently double-create
 * ServiceRequests/Quotes. Fails loudly with a clear instruction instead.
 */
async function assertNotAlreadySeeded(): Promise<void> {
  const marker = await prisma.user.findUnique({
    where: { email: 'maria.customer1@goservice.dev' },
  });
  if (marker) {
    throw new Error(
      'seed-demo-data: this database already has seeded demo users ' +
        '(maria.customer1@goservice.dev exists) — this script is not ' +
        're-runnable. Reset goservice_dev first if you want a fresh run.',
    );
  }
}

async function getCategoryByName(name: string): Promise<{ id: string }> {
  const category = await prisma.category.findUnique({ where: { name } });
  if (!category) {
    throw new Error(
      `seed-demo-data: category "${name}" not found — run "npm run prisma:seed" first.`,
    );
  }
  return category;
}

async function createUser(data: {
  email: string;
  firstName: string;
  lastName: string;
  phoneCountryCode: string;
  phoneNumber: string;
  accountStatus: UserAccountStatus;
  passwordHash: string;
}) {
  return prisma.user.create({
    data: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      passwordHash: data.passwordHash,
      phoneCountryCode: data.phoneCountryCode,
      phoneNumber: data.phoneNumber,
      dateOfBirth: AR_BIRTHDATE,
      acceptedTermsAndPrivacy: true,
      authProvider: AuthProvider.PASSWORD,
      accountStatus: data.accountStatus,
    },
  });
}

function createCustomerProfile(
  userId: string,
  data: {
    firstName: string;
    lastName: string;
    addressLine: string;
    city: string;
    province: string;
    country: CountryCode;
  },
) {
  return prisma.customerProfile.create({ data: { userId, ...data } });
}

async function createProfessionalProfile(
  userId: string,
  data: {
    firstName: string;
    lastName: string;
    // Optional "nombre comercial" — most demo professionals trade under
    // their own name and leave it unset; a couple set it to exercise the
    // now-nullable column.
    displayName?: string;
    city: string;
    country: CountryCode;
    serviceAreaDescription: string;
    bio: string;
    languages: string[];
    verificationStatus: ProfessionalVerificationStatus;
    specializations: {
      categoryName: string;
      role: SpecializationRole;
      description: string;
      yearsOfExperience: number;
    }[];
  },
) {
  const profile = await prisma.professionalProfile.create({
    data: {
      userId,
      firstName: data.firstName,
      lastName: data.lastName,
      displayName: data.displayName ?? null,
      city: data.city,
      country: data.country,
      serviceAreaDescription: data.serviceAreaDescription,
      bio: data.bio,
      languages: data.languages,
      verificationStatus: data.verificationStatus,
    },
  });

  let order = 0;
  for (const spec of data.specializations) {
    const category = await getCategoryByName(spec.categoryName);
    await prisma.professionalSpecialization.create({
      data: {
        professionalProfileId: profile.id,
        categoryId: category.id,
        role: spec.role,
        description: spec.description,
        yearsOfExperience: spec.yearsOfExperience,
        order: order++,
      },
    });
  }

  return profile;
}

async function createServiceRequest(data: {
  customerProfileId: string;
  categoryName: string;
  description: string;
  urgency: ServiceRequestUrgency;
  indicativeBudgetMin?: number;
  indicativeBudgetMax?: number;
}) {
  const category = await getCategoryByName(data.categoryName);
  return prisma.serviceRequest.create({
    data: {
      customerProfileId: data.customerProfileId,
      categoryId: category.id,
      description: data.description,
      urgency: data.urgency,
      indicativeBudgetMin: data.indicativeBudgetMin,
      indicativeBudgetMax: data.indicativeBudgetMax,
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

async function withdrawQuote(quoteId: string): Promise<void> {
  const result = await prisma.quote.updateMany({
    where: { id: quoteId, status: QuoteStatus.SENT },
    data: { status: QuoteStatus.WITHDRAWN, withdrawnAt: new Date() },
  });
  if (result.count !== 1) {
    throw new Error(`seed-demo-data: failed to withdraw quote ${quoteId}`);
  }
}

/**
 * Mirrors `AcceptQuoteService`'s real invariants by hand (see this file's
 * own header comment): CAS ServiceRequest OPEN->ENGAGED + acceptedQuoteId,
 * CAS Quote SENT->ACCEPTED, every OTHER SENT sibling Quote on the same
 * ServiceRequest -> REJECTED, one Engagement row created — all inside one
 * transaction.
 */
async function acceptQuote(params: {
  serviceRequestId: string;
  quoteId: string;
  customerProfileId: string;
  professionalProfileId: string;
}): Promise<void> {
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
        `seed-demo-data: ServiceRequest ${params.serviceRequestId} was not OPEN.`,
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
      throw new Error(`seed-demo-data: Quote ${params.quoteId} was not SENT.`);
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

async function cancelServiceRequest(serviceRequestId: string): Promise<void> {
  const result = await prisma.serviceRequest.updateMany({
    where: { id: serviceRequestId, status: ServiceRequestStatus.OPEN },
    data: {
      status: ServiceRequestStatus.CANCELLED,
      cancelledAt: new Date(),
    },
  });
  if (result.count !== 1) {
    throw new Error(
      `seed-demo-data: failed to cancel ServiceRequest ${serviceRequestId}`,
    );
  }
}

type PartyRef =
  | { role: 'CUSTOMER'; customerProfileId: string }
  | { role: 'PROFESSIONAL'; professionalProfileId: string };

/**
 * Mirrors `PostQuoteNegotiationMessageService`'s real transaction (see this
 * file's own header comment): creates the message, and — only if a price
 * was proposed — supersedes any existing PENDING proposal on this Quote
 * first, then creates the new PENDING one.
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
        authorRole: params.author.role as QuoteNegotiationParty,
        authorCustomerProfileId:
          params.author.role === 'CUSTOMER' ? params.author.customerProfileId : null,
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
      where: { quoteId: params.quoteId, status: QuotePriceProposalStatus.PENDING },
      data: { status: QuotePriceProposalStatus.SUPERSEDED },
    });

    const proposal = await tx.quotePriceProposal.create({
      data: {
        quoteId: params.quoteId,
        negotiationMessageId: message.id,
        proposedByRole: params.author.role as QuoteNegotiationParty,
        proposedByCustomerProfileId:
          params.author.role === 'CUSTOMER' ? params.author.customerProfileId : null,
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
 * (resolvedBy* = the counterparty of proposedByRole) + Quote.negotiatedPrice
 * set, in one transaction.
 */
async function acceptProposal(params: {
  proposalId: string;
  quoteId: string;
  proposedPrice: number;
  resolvedBy: PartyRef;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const cas = await tx.quotePriceProposal.updateMany({
      where: { id: params.proposalId, status: QuotePriceProposalStatus.PENDING },
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
        `seed-demo-data: failed to accept proposal ${params.proposalId}`,
      );
    }
    await tx.quote.update({
      where: { id: params.quoteId },
      data: { negotiatedPrice: params.proposedPrice },
    });
  });
}

/**
 * Mirrors `RejectQuotePriceProposalService`: CAS PENDING->REJECTED
 * (resolvedBy* = the counterparty of proposedByRole). Quote.negotiatedPrice
 * is deliberately never touched here.
 */
async function rejectProposal(params: {
  proposalId: string;
  resolvedBy: PartyRef;
}): Promise<void> {
  const cas = await prisma.quotePriceProposal.updateMany({
    where: { id: params.proposalId, status: QuotePriceProposalStatus.PENDING },
    data: {
      status: QuotePriceProposalStatus.REJECTED,
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
      `seed-demo-data: failed to reject proposal ${params.proposalId}`,
    );
  }
}

async function main(): Promise<void> {
  await assertNotAlreadySeeded();
  runAdminBootstrap();

  const passwordHash = await passwordHasher.hash(DEV_PASSWORD);

  console.log('seed-demo-data: creating Users + Profiles...');

  // ---- 3 pure Customers ----
  const maria = await createUser({
    email: 'maria.customer1@goservice.dev',
    firstName: 'María',
    lastName: 'Fernández',
    phoneCountryCode: '+54',
    phoneNumber: '91122334455',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const mariaProfile = await createCustomerProfile(maria.id, {
    firstName: 'María',
    lastName: 'Fernández',
    addressLine: 'Av. Corrientes 1234',
    city: 'Buenos Aires',
    province: 'Buenos Aires',
    country: CountryCode.AR,
  });

  const carlos = await createUser({
    email: 'carlos.customer2@goservice.dev',
    firstName: 'Carlos',
    lastName: 'Gómez',
    phoneCountryCode: '+54',
    phoneNumber: '93511223344',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const carlosProfile = await createCustomerProfile(carlos.id, {
    firstName: 'Carlos',
    lastName: 'Gómez',
    addressLine: 'Bv. San Juan 567',
    city: 'Córdoba',
    province: 'Córdoba',
    country: CountryCode.AR,
  });

  const laura = await createUser({
    email: 'laura.customer3@goservice.dev',
    firstName: 'Laura',
    lastName: 'Ramírez',
    phoneCountryCode: '+57',
    phoneNumber: '3101234567',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const lauraProfile = await createCustomerProfile(laura.id, {
    firstName: 'Laura',
    lastName: 'Ramírez',
    addressLine: 'Calle 85 #12-34',
    city: 'Bogotá',
    province: 'Bogotá D.C.',
    country: CountryCode.CO,
  });

  // ---- 4 pure Professionals ----
  const pedro = await createUser({
    email: 'pedro.plumber@goservice.dev',
    firstName: 'Pedro',
    lastName: 'Suárez',
    phoneCountryCode: '+54',
    phoneNumber: '91145678901',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const pedroProfile = await createProfessionalProfile(pedro.id, {
    firstName: 'Pedro',
    lastName: 'Suárez',
    city: 'Buenos Aires',
    country: CountryCode.AR,
    serviceAreaDescription: 'Zona Capital Federal y GBA Norte',
    bio: 'Plomero matriculado, especializado en reparación e instalación de calefones y cañerías.',
    languages: ['es'],
    verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
    specializations: [
      {
        categoryName: 'Plomería',
        role: SpecializationRole.PRIMARY,
        description: 'Reparación e instalación de cañerías, grifería y calefones.',
        yearsOfExperience: 8,
      },
    ],
  });

  const ana = await createUser({
    email: 'ana.electric@goservice.dev',
    firstName: 'Ana',
    lastName: 'López',
    phoneCountryCode: '+54',
    phoneNumber: '93417654321',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const anaProfile = await createProfessionalProfile(ana.id, {
    firstName: 'Ana',
    lastName: 'López',
    city: 'Rosario',
    country: CountryCode.AR,
    serviceAreaDescription: 'Rosario y alrededores',
    bio: 'Electricista con 10 años de experiencia en instalaciones domiciliarias e industriales.',
    languages: ['es', 'en'],
    verificationStatus: ProfessionalVerificationStatus.VERIFIED,
    specializations: [
      {
        categoryName: 'Electricidad',
        role: SpecializationRole.PRIMARY,
        description: 'Instalaciones eléctricas domiciliarias y tableros.',
        yearsOfExperience: 10,
      },
      {
        categoryName: 'Mantenimiento general',
        role: SpecializationRole.SECONDARY,
        description: 'Mantenimiento preventivo de instalaciones.',
        yearsOfExperience: 5,
      },
    ],
  });

  const jorge = await createUser({
    email: 'jorge.carpenter@goservice.dev',
    firstName: 'Jorge',
    lastName: 'Martínez',
    phoneCountryCode: '+54',
    phoneNumber: '92615556677',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const jorgeProfile = await createProfessionalProfile(jorge.id, {
    firstName: 'Jorge',
    lastName: 'Martínez',
    city: 'Mendoza',
    country: CountryCode.AR,
    serviceAreaDescription: 'Ciudad de Mendoza y Godoy Cruz',
    bio: 'Carpintero especializado en muebles a medida, con conocimientos básicos de plomería.',
    languages: ['es'],
    verificationStatus: ProfessionalVerificationStatus.PENDING_REVIEW,
    specializations: [
      {
        categoryName: 'Carpintería',
        role: SpecializationRole.PRIMARY,
        description: 'Muebles a medida, placares y reparación de puertas.',
        yearsOfExperience: 12,
      },
      {
        categoryName: 'Plomería',
        role: SpecializationRole.SECONDARY,
        description: 'Reparaciones básicas de plomería.',
        yearsOfExperience: 3,
      },
    ],
  });

  const sofia = await createUser({
    email: 'sofia.painter@goservice.dev',
    firstName: 'Sofía',
    lastName: 'Castro',
    phoneCountryCode: '+57',
    phoneNumber: '3201234567',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  const sofiaProfile = await createProfessionalProfile(sofia.id, {
    firstName: 'Sofía',
    lastName: 'Castro',
    city: 'Medellín',
    country: CountryCode.CO,
    serviceAreaDescription: 'Medellín y área metropolitana',
    bio: 'Pintora de interiores/exteriores, con experiencia adicional en diseño de jardines.',
    languages: ['es'],
    verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
    specializations: [
      {
        categoryName: 'Pintura',
        role: SpecializationRole.PRIMARY,
        description: 'Pintura de interiores y exteriores.',
        yearsOfExperience: 6,
      },
      {
        categoryName: 'Jardinería',
        role: SpecializationRole.SECONDARY,
        description: 'Diseño y mantenimiento de jardines.',
        yearsOfExperience: 4,
      },
    ],
  });

  // ---- 2 mixed Users (both CustomerProfile AND ProfessionalProfile) ----
  const diego = await createUser({
    email: 'diego.mixed1@goservice.dev',
    firstName: 'Diego',
    lastName: 'Torres',
    phoneCountryCode: '+54',
    phoneNumber: '91133445566',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  await createCustomerProfile(diego.id, {
    firstName: 'Diego',
    lastName: 'Torres',
    addressLine: 'Av. Rivadavia 4500',
    city: 'Buenos Aires',
    province: 'Buenos Aires',
    country: CountryCode.AR,
  });
  const diegoProProfile = await createProfessionalProfile(diego.id, {
    firstName: 'Diego',
    lastName: 'Torres',
    // Optional "nombre comercial" — one of two demo professionals that set it.
    displayName: 'Diego Torres - Limpieza y Electricidad',
    city: 'Buenos Aires',
    country: CountryCode.AR,
    serviceAreaDescription: 'Zona Capital Federal y alrededores',
    bio: 'Ofrezco servicios de limpieza profesional y reparaciones eléctricas menores.',
    languages: ['es'],
    verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
    specializations: [
      {
        categoryName: 'Limpieza',
        role: SpecializationRole.PRIMARY,
        description: 'Limpieza profunda de hogares y oficinas.',
        yearsOfExperience: 5,
      },
      {
        categoryName: 'Electricidad',
        role: SpecializationRole.SECONDARY,
        description: 'Reparaciones eléctricas menores.',
        yearsOfExperience: 2,
      },
    ],
  });

  const valentina = await createUser({
    email: 'valentina.mixed2@goservice.dev',
    firstName: 'Valentina',
    lastName: 'Ríos',
    phoneCountryCode: '+57',
    phoneNumber: '3151234567',
    accountStatus: UserAccountStatus.APPROVED,
    passwordHash,
  });
  await createCustomerProfile(valentina.id, {
    firstName: 'Valentina',
    lastName: 'Ríos',
    addressLine: 'Cra 45 #26-85',
    city: 'Bogotá',
    province: 'Bogotá D.C.',
    country: CountryCode.CO,
  });
  const valentinaProProfile = await createProfessionalProfile(valentina.id, {
    firstName: 'Valentina',
    lastName: 'Ríos',
    // Optional "nombre comercial" — one of two demo professionals that set it.
    displayName: 'Valentina Ríos - Electrodomésticos',
    city: 'Bogotá',
    country: CountryCode.CO,
    serviceAreaDescription: 'Bogotá y zona metropolitana',
    bio: 'Técnica especializada en reparación de electrodomésticos, con retoques de pintura.',
    languages: ['es'],
    verificationStatus: ProfessionalVerificationStatus.VERIFIED,
    specializations: [
      {
        categoryName: 'Reparación de electrodomésticos',
        role: SpecializationRole.PRIMARY,
        description: 'Reparación de heladeras, lavarropas y hornos.',
        yearsOfExperience: 7,
      },
      {
        categoryName: 'Pintura',
        role: SpecializationRole.SECONDARY,
        description: 'Retoques de pintura interior.',
        yearsOfExperience: 3,
      },
    ],
  });

  // ---- 2 deliberately earlier-lifecycle accounts ----
  await createUser({
    email: 'nuevo.sinperfil@goservice.dev',
    firstName: 'Nuevo',
    lastName: 'SinPerfil',
    phoneCountryCode: '+54',
    phoneNumber: '91100000001',
    accountStatus: UserAccountStatus.EMAIL_VERIFIED,
    passwordHash,
  });
  // Deliberately no CustomerProfile/ProfessionalProfile — demonstrates the
  // EMAIL_VERIFIED boundary: can log in (isLoginEligibleStatus includes
  // EMAIL_VERIFIED) but has created neither profile yet.

  const pendiente = await createUser({
    email: 'pendiente.aprobacion@goservice.dev',
    firstName: 'Pendiente',
    lastName: 'Aprobación',
    phoneCountryCode: '+54',
    phoneNumber: '91100000002',
    accountStatus: UserAccountStatus.PENDING_APPROVAL,
    passwordHash,
  });
  await createCustomerProfile(pendiente.id, {
    firstName: 'Pendiente',
    lastName: 'Aprobación',
    addressLine: 'Calle Falsa 123',
    city: 'Rosario',
    province: 'Santa Fe',
    country: CountryCode.AR,
  });
  // Has a CustomerProfile (as if they just submitted it) but the account is
  // still PENDING_APPROVAL — can log in/browse (login-eligible) but is not
  // yet APPROVED, e.g. not eligible for the admin "create ServiceRequest for
  // a customer" picker (which requires APPROVED).

  console.log('seed-demo-data: creating ServiceRequests + Quotes...');

  // ---- SR1: OPEN, Plomería, customer=maria ----
  const sr1 = await createServiceRequest({
    customerProfileId: mariaProfile.id,
    categoryName: 'Plomería',
    description: 'Pérdida de agua en la cocina, necesito reparación urgente.',
    urgency: ServiceRequestUrgency.URGENT,
    indicativeBudgetMin: 20000,
    indicativeBudgetMax: 40000,
  });
  const sr1q1 = await createQuote({
    serviceRequestId: sr1.id,
    professionalProfileId: pedroProfile.id,
    price: 25000,
    message: 'Puedo ir mañana a la mañana a revisar la pérdida.',
  });
  const sr1q2 = await createQuote({
    serviceRequestId: sr1.id,
    professionalProfileId: jorgeProfile.id,
    price: 27000,
    message: 'Tengo disponibilidad esta semana para hacer el arreglo.',
  });
  await withdrawQuote(sr1q2.id);

  // ---- SR2: OPEN, Electricidad, customer=carlos ----
  const sr2 = await createServiceRequest({
    customerProfileId: carlosProfile.id,
    categoryName: 'Electricidad',
    description: 'Instalación de tablero eléctrico nuevo.',
    urgency: ServiceRequestUrgency.THIS_WEEK,
    indicativeBudgetMin: 15000,
    indicativeBudgetMax: 25000,
  });
  const sr2q1 = await createQuote({
    serviceRequestId: sr2.id,
    professionalProfileId: anaProfile.id,
    price: 18000,
    message: 'Puedo instalar un tablero de 12 bocas con protección diferencial.',
  });
  const sr2q2 = await createQuote({
    serviceRequestId: sr2.id,
    professionalProfileId: diegoProProfile.id,
    price: 20500,
    message: 'Trabajo con materiales de primera calidad, incluye certificación.',
  });

  // ---- SR3: ENGAGED, Pintura, customer=laura ----
  const sr3 = await createServiceRequest({
    customerProfileId: lauraProfile.id,
    categoryName: 'Pintura',
    description: 'Pintar living y dormitorio principal.',
    urgency: ServiceRequestUrgency.FLEXIBLE,
  });
  const sr3q1 = await createQuote({
    serviceRequestId: sr3.id,
    professionalProfileId: sofiaProfile.id,
    price: 30000,
    message: 'Incluye pintura látex de primera calidad y dos manos.',
  });
  const sr3q2 = await createQuote({
    serviceRequestId: sr3.id,
    professionalProfileId: valentinaProProfile.id,
    price: 28000,
    message: 'Puedo empezar la próxima semana.',
  });
  await acceptQuote({
    serviceRequestId: sr3.id,
    quoteId: sr3q1.id,
    customerProfileId: lauraProfile.id,
    professionalProfileId: sofiaProfile.id,
  });

  // ---- SR4: ENGAGED, Carpintería, customer=maria ----
  const sr4 = await createServiceRequest({
    customerProfileId: mariaProfile.id,
    categoryName: 'Carpintería',
    description: 'Reparar puertas de placard corredizas.',
    urgency: ServiceRequestUrgency.THIS_WEEK,
  });
  const sr4q1 = await createQuote({
    serviceRequestId: sr4.id,
    professionalProfileId: jorgeProfile.id,
    price: 35000,
    message: 'Cambio los rieles y ajusto las puertas, quedan como nuevas.',
  });
  await acceptQuote({
    serviceRequestId: sr4.id,
    quoteId: sr4q1.id,
    customerProfileId: mariaProfile.id,
    professionalProfileId: jorgeProfile.id,
  });

  // ---- SR5: CANCELLED, Jardinería, customer=carlos ----
  const sr5 = await createServiceRequest({
    customerProfileId: carlosProfile.id,
    categoryName: 'Jardinería',
    description: 'Poda de árboles y limpieza de fondo.',
    urgency: ServiceRequestUrgency.FLEXIBLE,
  });
  await cancelServiceRequest(sr5.id);

  // ---- SR6: OPEN, Jardinería, customer=maria ----
  const sr6 = await createServiceRequest({
    customerProfileId: mariaProfile.id,
    categoryName: 'Jardinería',
    description: 'Diseño y mantenimiento de jardín delantero.',
    urgency: ServiceRequestUrgency.FLEXIBLE,
  });
  const sr6q1 = await createQuote({
    serviceRequestId: sr6.id,
    professionalProfileId: sofiaProfile.id,
    price: 15000,
    message: 'Puedo armar un diseño simple con plantas nativas.',
  });

  console.log('seed-demo-data: building Quote Negotiation threads...');

  // ---- Thread on sr1q1 (Plomería, pedro): plain comments + one PENDING proposal ----
  await postNegotiationMessage({
    quoteId: sr1q1.id,
    author: { role: 'CUSTOMER', customerProfileId: mariaProfile.id },
    message: '¿Podés venir mañana a la mañana?',
  });
  await postNegotiationMessage({
    quoteId: sr1q1.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: pedroProfile.id },
    message: 'Sí, puedo ir a las 9am. Te aviso el precio final cuando vea la pérdida.',
  });
  await postNegotiationMessage({
    quoteId: sr1q1.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: pedroProfile.id },
    message: 'Revisando las fotos que me mandaste, el trabajo lleva más repuestos de lo esperado.',
    proposedPrice: 27000,
  });
  // Left PENDING deliberately.

  // ---- Thread on sr2q1 (Electricidad, ana): SUPERSEDED chain ----
  await postNegotiationMessage({
    quoteId: sr2q1.id,
    author: { role: 'CUSTOMER', customerProfileId: carlosProfile.id },
    message: '¿El precio incluye los materiales?',
  });
  const sr2q1FirstProposal = await postNegotiationMessage({
    quoteId: sr2q1.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: anaProfile.id },
    message: 'Con materiales incluidos serían $19.500.',
    proposedPrice: 19500,
  });
  await postNegotiationMessage({
    quoteId: sr2q1.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: anaProfile.id },
    message: 'Revisando mejor, el tablero que necesitás es más grande: $21.000.',
    proposedPrice: 21000,
  });
  if (!sr2q1FirstProposal.proposalId) {
    throw new Error('seed-demo-data: expected a proposal id for sr2q1 first proposal');
  }
  const supersededProposal = await prisma.quotePriceProposal.findUniqueOrThrow({
    where: { id: sr2q1FirstProposal.proposalId },
  });
  if (supersededProposal.status !== QuotePriceProposalStatus.SUPERSEDED) {
    throw new Error(
      `seed-demo-data: expected proposal ${sr2q1FirstProposal.proposalId} to be SUPERSEDED, got ${supersededProposal.status}`,
    );
  }
  // The second proposal (created above) is left PENDING.

  // ---- Thread on sr2q2 (Electricidad, diego): ACCEPTED proposal ----
  await postNegotiationMessage({
    quoteId: sr2q2.id,
    author: { role: 'CUSTOMER', customerProfileId: carlosProfile.id },
    message: '¿Podrías bajar un poco el precio?',
  });
  const sr2q2Proposal = await postNegotiationMessage({
    quoteId: sr2q2.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: diegoProProfile.id },
    message: 'Puedo hacerlo por $19.000 si me confirmás hoy.',
    proposedPrice: 19000,
  });
  if (!sr2q2Proposal.proposalId) {
    throw new Error('seed-demo-data: expected a proposal id for sr2q2 proposal');
  }
  await acceptProposal({
    proposalId: sr2q2Proposal.proposalId,
    quoteId: sr2q2.id,
    proposedPrice: 19000,
    resolvedBy: { role: 'CUSTOMER', customerProfileId: carlosProfile.id },
  });

  // ---- Thread on sr6q1 (Jardinería, sofia): REJECTED proposal ----
  await postNegotiationMessage({
    quoteId: sr6q1.id,
    author: { role: 'CUSTOMER', customerProfileId: mariaProfile.id },
    message: '¿Cuánto tarda el trabajo?',
  });
  const sr6q1Proposal = await postNegotiationMessage({
    quoteId: sr6q1.id,
    author: { role: 'PROFESSIONAL', professionalProfileId: sofiaProfile.id },
    message: 'Sumando el diseño del cantero, sería $16.000.',
    proposedPrice: 16000,
  });
  if (!sr6q1Proposal.proposalId) {
    throw new Error('seed-demo-data: expected a proposal id for sr6q1 proposal');
  }
  await rejectProposal({
    proposalId: sr6q1Proposal.proposalId,
    resolvedBy: { role: 'CUSTOMER', customerProfileId: mariaProfile.id },
  });

  console.log('seed-demo-data: done.');
  console.log(
    JSON.stringify(
      {
        adminLogin: {
          email: ADMIN_BOOTSTRAP_EMAIL,
          password: ADMIN_BOOTSTRAP_PASSWORD,
        },
        devPassword: DEV_PASSWORD,
        serviceRequests: { sr1: sr1.id, sr2: sr2.id, sr3: sr3.id, sr4: sr4.id, sr5: sr5.id, sr6: sr6.id },
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
