import { Injectable } from '@nestjs/common';
import { SocialProvider } from '../enums/social-provider.enum';
import {
  SocialIdentityValidationPort,
  ValidatedSocialIdentity,
} from '../ports/social-identity-validation.port';

/**
 * Named explicitly in the GOS-22 task (kept 1:1 with the encargo's naming)
 * — thin application-service wrapper around `SocialIdentityValidationPort`
 * so `SocialLoginService` depends on an application service rather than a
 * port directly, mirroring how the other three mutations are structured.
 */
@Injectable()
export class SocialIdentityValidationService {
  constructor(
    private readonly socialIdentityValidationPort: SocialIdentityValidationPort,
  ) {}

  validate(
    provider: SocialProvider,
    identityToken: string,
  ): Promise<ValidatedSocialIdentity> {
    return this.socialIdentityValidationPort.validate(provider, identityToken);
  }
}
