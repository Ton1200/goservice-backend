-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('PASSWORD', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('PENDING_EMAIL_VERIFICATION', 'EMAIL_VERIFIED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phoneCountryCode" TEXT,
    "phoneNumber" TEXT,
    "dateOfBirth" DATE,
    "acceptedTermsAndPrivacy" BOOLEAN NOT NULL DEFAULT false,
    "authProvider" "AuthProvider" NOT NULL,
    "socialProviderSubject" TEXT,
    "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'PENDING_EMAIL_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_authProvider_socialProviderSubject_idx" ON "User"("authProvider", "socialProviderSubject");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_userId_consumedAt_invalidatedAt_idx" ON "EmailVerificationCode"("userId", "consumedAt", "invalidatedAt");

-- AddForeignKey
ALTER TABLE "EmailVerificationCode" ADD CONSTRAINT "EmailVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
