import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaUploadsRepository } from './media-uploads.repository';
import { MediaUploadsResolver } from './media-uploads.resolver';
import { RequestMediaUploadUrlService } from './services/request-media-upload-url.service';
import './models/media-upload-ref-intended-use.enum';

/**
 * GOS-72 — one shared "request an image upload slot" surface for all three
 * of this ticket's image-attachment points (Quote attachments, Quote
 * negotiation message images, Engagement chat message images), backed by one
 * shared `MediaUploadRef` table.
 *
 * `PrismaModule` and `StorageModule` are both `@Global()`, so `PrismaService`
 * / `StoragePort` don't need to be imported here. `AuthModule` is imported
 * for `SessionGuard` (the only guard `requestMediaUploadUrl` uses — see the
 * resolver's own comment for why it's not also `AccountApprovedGuard`).
 *
 * `MediaUploadsRepository` is exported so the three consuming modules
 * (`QuotesModule`, `QuoteNegotiationModule`, `EngagementChatModule`) can
 * reuse it as a CONCRETE provider — same "reuse the concrete repository
 * class directly, never import the resolver-bearing module" pattern the rest
 * of the backend already establishes (avoids pulling `MediaUploadsResolver`
 * into those modules' schemas).
 */
@Module({
  imports: [AuthModule],
  providers: [
    MediaUploadsResolver,
    MediaUploadsRepository,
    RequestMediaUploadUrlService,
  ],
  exports: [MediaUploadsRepository],
})
export class MediaUploadsModule {}
