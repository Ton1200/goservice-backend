import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { AuthProvider } from './auth-provider.enum';
import { UserAccountStatus } from './user-account-status.enum';

/**
 * Admin-facing GraphQL type for `userAccounts`/`updateUserAccount`
 * (`/admin/graphql` only — never the consumer schema). Deliberately scoped
 * to base account identity fields only, per this round's explicit human
 * decision — NO `CustomerProfile`/`ProfessionalProfile`-specific fields
 * (trades, addresses, verification, ratings): `hasCustomerProfile`/
 * `hasProfessionalProfile` are the only signal this type carries about
 * those relations, purely presence booleans, never their content. A
 * profile-specific admin detail view is a deliberate, separate future
 * capability, not columns bolted onto this grid.
 *
 * `passwordHash`/`socialProviderSubject` are NEVER fields here — and, more
 * importantly, are never even selected out of Postgres in the first place;
 * see `UsersRepository`'s `ADMIN_USER_ACCOUNT_SELECT` for the structural
 * guardrail this relies on (the same defense-in-depth principle
 * `PlatformSettingModel`'s `rawValue` split already uses).
 */
@ObjectType()
export class UserAccountModel {
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
}
