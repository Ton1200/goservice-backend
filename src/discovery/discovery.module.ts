import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { DiscoveryRepository } from './discovery.repository';
import { DiscoveryResolver } from './discovery.resolver';
import { ListNearbyProfessionalsService } from './services/list-nearby-professionals.service';

/** Wires up the Proximity Discovery feature (`nearbyProfessionals`). */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    ProfilesModule,
    UsersModule,
  ],
  providers: [
    DiscoveryResolver,
    DiscoveryRepository,
    ListNearbyProfessionalsService,
  ],
})
export class DiscoveryModule {}
