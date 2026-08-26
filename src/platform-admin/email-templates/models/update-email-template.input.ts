import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `@IsString()`/`@IsNotEmpty()`/`@MaxLength()` are load-bearing, not
 * decorative — `ValidationPipe`'s `whitelist: true` (see `main.ts`) strips/
 * rejects any DTO property with ZERO class-validator decorators, even when
 * `@Field()` alone would be enough for the GraphQL schema itself to accept
 * the input shape — same confirmed-live gotcha `SetPlatformSettingInput`'s
 * own comment documents.
 *
 * Max lengths are a generous, sane ceiling, not a validated real-world
 * measurement: `htmlBody` (100_000) comfortably fits a full table-based
 * email layout with inline styles; `textBody` (20_000) comfortably fits the
 * plain-text equivalent; `subject` (200) exceeds what any real mail client
 * meaningfully displays.
 */
@InputType()
export class UpdateEmailTemplateInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  htmlBody!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  textBody!: string;
}
