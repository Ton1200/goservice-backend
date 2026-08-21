import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ServiceRequestUrgency } from './service-request-urgency.enum';

/**
 * Structurally closed input — no `customerProfileId`/`userId` field. The
 * owning `CustomerProfile` is ALWAYS resolved server-side from
 * `@CurrentUser()` (see `PublishServiceRequestService`) — a client cannot
 * publish a `ServiceRequest` on behalf of another user because there is no
 * field to attempt it with, and the global `ValidationPipe({
 * forbidNonWhitelisted: true })` would reject the attempt even if one were
 * smuggled in as an extra GraphQL variable.
 *
 * `min(1)`/`max(2000)` on `description` are reasonable defaults, NOT a
 * confirmed business rule — no length convention is documented anywhere in
 * this project for this kind of free text (see the GOS-38 plan's
 * "Decisiones pendientes").
 *
 * Cross-field checks that cannot be expressed as decorators
 * (`indicativeBudgetMin <= indicativeBudgetMax`, category existence,
 * attachment-ref ownership/expiration/consumption) are left to
 * `PublishServiceRequestService` — same convention
 * `UpsertProfessionalProfileService` already establishes for
 * `CATEGORY_NOT_FOUND`/`PRIMARY_SPECIALIZATION_REQUIRED`.
 */
@InputType()
export class PublishServiceRequestInput {
  @Field(() => ID)
  @IsUUID('4')
  category!: string;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @Field(() => ServiceRequestUrgency)
  @IsEnum(ServiceRequestUrgency)
  urgency!: ServiceRequestUrgency;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  indicativeBudgetMin?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  indicativeBudgetMax?: number;

  // Duplicates rejected at the DTO layer (`@ArrayUnique`) before ever
  // touching the database — see `PublishServiceRequestService` for the
  // ownership/expiration/consumption checks that can't be expressed here.
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attachmentUploadRefs?: string[];
}
