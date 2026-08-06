import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Category } from './category.model';
import { SpecializationRole } from './specialization-role.enum';

/**
 * One of a professional's trades — GOS-14/GOS-28 follow-up. Realizes the
 * "Skill" concept `prisma/schema.prisma`'s original join-table comment
 * anticipated: a professional can be, e.g., a PRIMARY electrician and a
 * SECONDARY plumber at the same time, each with its own description and
 * years of experience. `order` reflects the position each specialization
 * was submitted in on the last `upsertProfessionalProfile` call — always
 * server-derived, never client-set directly.
 */
@ObjectType()
export class ProfessionalSpecialization {
  @Field(() => Category)
  category!: Category;

  @Field(() => SpecializationRole)
  role!: SpecializationRole;

  @Field()
  description!: string;

  @Field(() => Int, { nullable: true })
  yearsOfExperience?: number | null;

  @Field(() => Int)
  order!: number;
}
