import { Field, ID, ObjectType } from '@nestjs/graphql';
import { IdentityVerificationStatus } from './identity-verification-status.enum';

/**
 * One identity-verification attempt, as exposed to the owning user —
 * `userId`/`country`/`provider`/`providerReference`/`documentType` are
 * deliberately NOT exposed here: `userId` is always implicitly "mine" (same
 * convention as `CustomerProfile`/`ProfessionalProfile`), `country` and
 * `provider`/`providerReference` are server-internal routing/correlation
 * details with no product need to surface yet, and `documentType` has no
 * confirmed product need to be shown to the user in this story either — see
 * `IdentityVerificationStatus`'s own comment for why it isn't registered as
 * a GraphQL type at all.
 *
 * `verificationUrl` is populated ONLY on `Mutation.startIdentityVerification`'s
 * own response — `Query.myIdentityVerificationStatus` always returns `null`
 * here, since the hosted session URL is not re-fetchable/re-derivable after
 * the fact (Didit's `createSession` response is the one and only place it's
 * ever handed out) and is not persisted anywhere in `IdentityVerification`.
 */
@ObjectType()
export class IdentityVerificationModel {
  @Field(() => ID)
  id!: string;

  @Field(() => IdentityVerificationStatus)
  status!: IdentityVerificationStatus;

  @Field(() => Boolean, { nullable: true })
  documentCheckPassed!: boolean | null;

  @Field(() => Boolean, { nullable: true })
  biometricCheckPassed!: boolean | null;

  @Field(() => String, { nullable: true })
  verificationUrl!: string | null;
}
