-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "addressLatitude" DOUBLE PRECISION,
ADD COLUMN     "addressLongitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "approximateLatitude" DOUBLE PRECISION,
ADD COLUMN     "approximateLongitude" DOUBLE PRECISION,
ADD COLUMN     "serviceAreaLatitude" DOUBLE PRECISION,
ADD COLUMN     "serviceAreaLongitude" DOUBLE PRECISION,
ADD COLUMN     "serviceAreaRadiusKm" INTEGER;

-- CreateIndex
CREATE INDEX "ProfessionalProfile_approximateLatitude_approximateLongitud_idx" ON "ProfessionalProfile"("approximateLatitude", "approximateLongitude");
