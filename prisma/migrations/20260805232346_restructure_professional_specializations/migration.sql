/*
  Warnings:

  - You are about to drop the column `yearsOfExperience` on the `ProfessionalProfile` table. All the data in the column will be lost.
  - You are about to drop the `ProfessionalProfileCategory` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SpecializationRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- DropForeignKey
ALTER TABLE "ProfessionalProfileCategory" DROP CONSTRAINT "ProfessionalProfileCategory_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "ProfessionalProfileCategory" DROP CONSTRAINT "ProfessionalProfileCategory_professionalProfileId_fkey";

-- AlterTable
ALTER TABLE "ProfessionalProfile" DROP COLUMN "yearsOfExperience";

-- DropTable
DROP TABLE "ProfessionalProfileCategory";

-- CreateTable
CREATE TABLE "ProfessionalSpecialization" (
    "professionalProfileId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "role" "SpecializationRole" NOT NULL,
    "description" TEXT NOT NULL,
    "yearsOfExperience" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalSpecialization_pkey" PRIMARY KEY ("professionalProfileId","categoryId")
);

-- CreateIndex
CREATE INDEX "ProfessionalSpecialization_categoryId_idx" ON "ProfessionalSpecialization"("categoryId");

-- AddForeignKey
ALTER TABLE "ProfessionalSpecialization" ADD CONSTRAINT "ProfessionalSpecialization_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalSpecialization" ADD CONSTRAINT "ProfessionalSpecialization_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
