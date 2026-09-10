import { registerEnumType } from '@nestjs/graphql';
import { MediaUploadRefIntendedUse } from '@prisma/client';

/**
 * Registers the Prisma-generated `MediaUploadRefIntendedUse` enum directly
 * as a GraphQL enum type — same "GraphQL and persistence shapes are meant to
 * be identical" reasoning as `QuoteStatus`/`QuoteNegotiationParty`.
 *
 * GOS-72 — the single discriminator that lets ONE `requestMediaUploadUrl`
 * mutation + ONE shared `MediaUploadRef` table serve all three of this
 * ticket's image-attachment points. A ref is only ever spendable on the kind
 * of target it was requested for: consume-time validation filters on this
 * value, so a `QUOTE_ATTACHMENT` ref passed to `sendEngagementMessage`
 * simply fails to match (see `INVALID_MEDIA_UPLOAD_REF`).
 */
registerEnumType(MediaUploadRefIntendedUse, {
  name: 'MediaUploadRefIntendedUse',
  description:
    'What a requested media upload slot is intended to be consumed by — QUOTE_ATTACHMENT (addQuoteAttachment), QUOTE_NEGOTIATION_MESSAGE_IMAGE (postQuoteNegotiationMessage) or ENGAGEMENT_CHAT_MESSAGE_IMAGE (sendEngagementMessage).',
});

export { MediaUploadRefIntendedUse };
