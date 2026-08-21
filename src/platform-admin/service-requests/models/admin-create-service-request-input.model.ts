import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ServiceRequestUrgency } from '../../../service-requests/models/service-request-urgency.enum';

/**
 * Input for `createServiceRequestForCustomer` — same field set/validation
 * as the consumer-facing `PublishServiceRequestInput`
 * (`src/service-requests/models/`), plus `userId`: the ONLY way this
 * mutation knows which Customer to create the `ServiceRequest` for (an
 * admin, not the target customer, is the caller — there is no session to
 * derive ownership from here, unlike the consumer mutation).
 * `CreateServiceRequestForCustomerService` re-validates server-side that
 * `userId` resolves to an APPROVED account with a `CustomerProfile` —
 * never trusts the picker (`eligibleServiceRequestCustomers`) alone.
 *
 * No `attachmentUploadRefs` field — admin-created requests never carry
 * attachments (no upload-ref flow exists in the admin panel).
 */
@InputType()
export class AdminCreateServiceRequestInput {
  @Field(() => ID)
  @IsUUID('4')
  userId!: string;

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
}
