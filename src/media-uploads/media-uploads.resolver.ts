import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { DocumentUploadUrlModel } from '../service-requests/models/document-upload-url.model';
import { RequestMediaUploadUrlInput } from './models/request-media-upload-url-input.model';
import { RequestMediaUploadUrlService } from './services/request-media-upload-url.service';

/**
 * Thin delivery adapter — no business logic here. GOS-72's single generic
 * "request an image upload slot" mutation, reused by all three of this
 * ticket's image-attachment points. Requires `SessionGuard` only (a
 * draft-prep step, exactly like `requestServiceRequestAttachmentUploadUrl` /
 * `requestProfilePhotoUploadUrl`). `userId` is always derived from
 * `@CurrentUser()`, never an argument.
 */
@Resolver()
export class MediaUploadsResolver {
  constructor(
    private readonly requestMediaUploadUrlService: RequestMediaUploadUrlService,
  ) {}

  @UseGuards(SessionGuard)
  @Mutation(() => DocumentUploadUrlModel, {
    description:
      'Issues a signed, single-use, expiring image upload slot for one of the GOS-72 image-attachment points (chosen via intendedUse). PUT the bytes to uploadUrl, then pass the returned ref to addQuoteAttachment / postQuoteNegotiationMessage / sendEngagementMessage.',
  })
  requestMediaUploadUrl(
    @CurrentUser() userId: string,
    @Args('input') input: RequestMediaUploadUrlInput,
  ): Promise<DocumentUploadUrlModel> {
    return this.requestMediaUploadUrlService.requestUploadUrl(userId, input);
  }
}
