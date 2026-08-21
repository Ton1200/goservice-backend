import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminServiceRequestModel } from './admin-service-request.model';

/**
 * Real, bounded pagination for `serviceRequests` — same DELIBERATE,
 * DOCUMENTED phase-1 scope boundary as `UserAccountsPageModel`: `limit`/
 * `offset` only (server-enforced max page size), no server-side
 * filter/sort arguments yet. The admin panel's Tabulator grid does its own
 * client-side filtering/sorting on the fetched page — including filtering
 * by the `customer.email`/`customer.displayName` columns, which is how an
 * admin finds "this customer's requests" without a dedicated filter arg.
 */
@ObjectType()
export class AdminServiceRequestsPageModel {
  @Field(() => [AdminServiceRequestModel])
  items!: AdminServiceRequestModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
