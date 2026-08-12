import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * One id's failure detail within a `bulkDeleteUserAccounts` call (GOS-3x
 * follow-up, hard-delete, 2026-08-11 — renamed from the former
 * `BulkDeactivateFailure`, same shape) — `reason` is a short,
 * human-readable message (mirrors the corresponding `DomainException`'s own
 * message: `USER_ACCOUNT_NOT_FOUND`, or a generic fallback for any
 * unexpected per-id failure), not a machine `extensions.code`-shaped value
 * — this payload is a normal GraphQL field, never a thrown
 * `DomainException`, since the whole point of this shape is that ONE bad id
 * must never abort the batch or surface as a top-level GraphQL error.
 */
@ObjectType()
export class BulkDeleteFailure {
  @Field(() => ID)
  id!: string;

  @Field()
  reason!: string;
}

/**
 * `bulkDeleteUserAccounts` deliberately never throws for a per-id failure
 * (not-found, or any other unexpected error) — every id in the input is
 * processed INDEPENDENTLY, and BOTH its outcome (success or failure, with a
 * reason) are always observable here, never collapsed into a single
 * aggregate boolean. `succeededIds` and `failed` together always account
 * for every id in the input exactly once. Renamed from the former
 * `BulkDeactivateUserAccountsPayload` — same shape.
 */
@ObjectType()
export class BulkDeleteUserAccountsPayload {
  @Field(() => [ID])
  succeededIds!: string[];

  @Field(() => [BulkDeleteFailure])
  failed!: BulkDeleteFailure[];
}
