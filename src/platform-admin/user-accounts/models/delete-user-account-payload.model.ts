import { Field, ObjectType } from '@nestjs/graphql';

/**
 * `deleteUserAccount` payload (GOS-3x follow-up, hard-delete, 2026-08-11)
 * — mirrors `ForceUserAccountPasswordResetPayload`'s minimal shape exactly
 * (a single `success: Boolean!`). Unlike `updateUserAccount`/the former
 * `deactivateUserAccount`, there is no `UserAccountModel` to return here —
 * the row is gone by the time this resolves.
 */
@ObjectType()
export class DeleteUserAccountPayload {
  @Field()
  success!: boolean;
}
