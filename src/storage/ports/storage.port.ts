/**
 * Provider-agnostic seam for issuing attachment upload slots — same
 * Port/Adapter shape already established elsewhere in this backend
 * (`SessionPort`, `EmailClientPort`, `IdentityVerificationPort`). No prior
 * "pre-signed upload URL" pattern exists anywhere in this codebase to reuse
 * (confirmed by an exhaustive search — see the GOS-38 plan's "Hallazgo
 * crítico" section); this port and its only current implementation
 * (`LocalDevStorageAdapter`) are designed from scratch for this story.
 *
 * The real object-storage provider (S3/Cloudinary/Azure Blob/other) is an
 * explicitly OPEN infrastructure decision (see infrastructure.md) — out of
 * scope for GOS-38. Swapping `LocalDevStorageAdapter` for a real provider
 * adapter later is one new class + one `useClass`/`useExisting` change in
 * `src/storage/storage.module.ts`, never a resolver/service/schema change.
 *
 * Relocated from `src/service-requests/` to its own top-level `src/storage/`
 * module (GOS-70, 2026-09-02) — it was always a cross-cutting, multi-consumer
 * seam, not a service-requests concern.
 */
export interface CreateAttachmentUploadUrlCommand {
  fileName: string;
  contentType: string;
}

/** What issuing one upload slot gives back. */
export interface AttachmentUploadTarget {
  /** Where the client PUTs the raw file bytes — short-lived, signed. */
  uploadUrl: string;
  /** The URL the file is reachable at once uploaded — this is the value
   * that ends up on `ServiceRequestAttachment.url` once a
   * `ServiceRequestAttachmentUploadRef` referencing it is consumed by
   * `publishServiceRequest`. */
  publicUrl: string;
  /** `uploadUrl` stops accepting a PUT after this instant. */
  expiresAt: Date;
}

export abstract class StoragePort {
  abstract createUploadUrl(
    command: CreateAttachmentUploadUrlCommand,
  ): Promise<AttachmentUploadTarget>;
}
