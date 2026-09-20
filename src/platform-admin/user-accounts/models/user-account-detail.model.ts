import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { CustomerProfile } from '../../../profiles/models/customer-profile.model';
import { ProfessionalProfile } from '../../../profiles/models/professional-profile.model';
import { UserAccountStatus } from '../../../users/models/user-account-status.enum';
import { AuthProvider } from './auth-provider.enum';

/**
 * Admin-facing GraphQL type for `userAccountDetail` (`/admin/graphql` only —
 * never the consumer schema), gated by the SAME `Permission.USER_ACCOUNTS_READ`
 * as `userAccounts`. Deliberately a SEPARATE type from `UserAccountModel`
 * (the list/grid row shape), not a superset reused in place of it: the grid
 * (`userAccounts`, up to 200 rows per page) intentionally stays lightweight
 * (`hasCustomerProfile`/`hasProfessionalProfile` presence booleans only),
 * while this one-user detail view carries the FULL `CustomerProfile`/
 * `ProfessionalProfile` content an admin needs to inspect one account
 * closely — see `UsersRepository.findByIdForAdminWithProfiles`'s own header
 * comment for why that select is intentionally NOT reused for the list
 * query.
 *
 * `customerProfile`/`professionalProfile` reuse the EXACT SAME GraphQL
 * classes (`src/profiles/models/customer-profile.model.ts`/
 * `professional-profile.model.ts`) the CONSUMER schema's
 * `myCustomerProfile`/`myProfessionalProfile` queries already return —
 * confirmed both classes' types were already present (as orphaned,
 * previously-unreachable type definitions — see
 * `PlatformAdminModule`'s own header comment on
 * `OrphanedReferenceRegistry`) in `src/admin-schema.gql`'s generated SDL
 * before this field ever existed. This field is what makes them REACHABLE
 * from the admin schema for the first time; the two schemas still expose
 * zero shared QUERY/MUTATION fields (the actual isolation property
 * `admin-schema-isolation.e2e-spec.ts` defends — see that suite's own header
 * comment for the documented distinction between "type definition present"
 * and "field reachable").
 *
 * Still never exposes `passwordHash`/`socialProviderSubject` — see
 * `UsersRepository`'s `ADMIN_USER_ACCOUNT_DETAIL_SELECT` for the same
 * structural guardrail `ADMIN_USER_ACCOUNT_SELECT` already established.
 */
@ObjectType()
export class UserAccountDetailModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  firstName!: string | null;

  @Field(() => String, { nullable: true })
  lastName!: string | null;

  @Field()
  email!: string;

  @Field(() => String, { nullable: true })
  phoneCountryCode!: string | null;

  @Field(() => String, { nullable: true })
  phoneNumber!: string | null;

  @Field(() => UserAccountStatus)
  accountStatus!: UserAccountStatus;

  @Field(() => AuthProvider)
  authProvider!: AuthProvider;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  /** Derived from whether a `CustomerProfile` relation exists — presence only. */
  @Field()
  hasCustomerProfile!: boolean;

  /** Derived from whether a `ProfessionalProfile` relation exists — presence only. */
  @Field()
  hasProfessionalProfile!: boolean;

  /** Full `CustomerProfile` content, or null if this user never created one. */
  @Field(() => CustomerProfile, { nullable: true })
  customerProfile!: CustomerProfile | null;

  /** Full `ProfessionalProfile` content (with specializations), or null if this user never created one. */
  @Field(() => ProfessionalProfile, { nullable: true })
  professionalProfile!: ProfessionalProfile | null;

  // This user's CURRENT payment balance (2026-09-19, human-requested — "en
  // cada usuario con perfil profesional... para tener info a la mano"), if
  // they have a ProfessionalProfile — `null` otherwise. Same figure
  // `myPaymentBalance`/`AdminLedgerProfessional.balance` compute
  // (`LedgerRepository.sumProfessionalBalance`): net digital credits minus
  // cash commission debt, computed fresh on every read, never cached. A
  // DELIBERATELY SEPARATE field on this admin-only type, never added to the
  // shared `ProfessionalProfile` class above — that class is reused
  // as-is by the CONSUMER schema's `myProfessionalProfile` (see this
  // model's own header comment), and this figure has no business leaking
  // there through a different query than `myPaymentBalance` itself.
  @Field(() => Int, { nullable: true })
  professionalPaymentBalance!: number | null;
}
