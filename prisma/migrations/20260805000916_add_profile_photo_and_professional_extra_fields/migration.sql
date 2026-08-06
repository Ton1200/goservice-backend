-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "yearsOfExperience" INTEGER;
