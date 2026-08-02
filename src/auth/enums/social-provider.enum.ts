import { registerEnumType } from '@nestjs/graphql';

/**
 * Social identity providers accepted by `socialLogin`. Deliberately mirrors
 * (but is a distinct type from) the Prisma `AuthProvider` enum, which also
 * includes `PASSWORD` — `SocialProvider` only exists at the GraphQL layer
 * for `SocialLoginInput.provider`, since a password account can never be
 * the target of `socialLogin`.
 */
export enum SocialProvider {
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
}

registerEnumType(SocialProvider, {
  name: 'SocialProvider',
  description: 'Social identity provider used for socialLogin.',
});
