-- GOS-70 — purely additive: new enum + new table + one index + one FK.
-- Mirrors ServiceRequestAttachmentUploadRef (20260818205201_...) minus the
-- serviceRequestId link. No changes to CustomerProfile/ProfessionalProfile
-- (photoUrl already exists as a nullable TEXT column) — see the GOS-70
-- domain-model note.

-- CreateEnum
CREATE TYPE "ProfilePhotoUploadRefStatus" AS ENUM ('PENDING', 'CONSUMED');

-- CreateTable
CREATE TABLE "ProfilePhotoUploadRef" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "ProfilePhotoUploadRefStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePhotoUploadRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfilePhotoUploadRef_userId_status_idx" ON "ProfilePhotoUploadRef"("userId", "status");

-- AddForeignKey
ALTER TABLE "ProfilePhotoUploadRef" ADD CONSTRAINT "ProfilePhotoUploadRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
