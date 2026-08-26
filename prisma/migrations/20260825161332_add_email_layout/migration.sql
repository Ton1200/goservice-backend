-- CreateTable
CREATE TABLE "EmailLayout" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "headerHtml" TEXT NOT NULL,
    "footerHtml" TEXT NOT NULL,
    "headerText" TEXT NOT NULL,
    "footerText" TEXT NOT NULL,
    "updatedByAdminUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLayout_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EmailLayout" ADD CONSTRAINT "EmailLayout_updatedByAdminUserId_fkey" FOREIGN KEY ("updatedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
