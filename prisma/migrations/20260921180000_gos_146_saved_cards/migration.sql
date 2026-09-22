-- GOS-146 — saved cards (Rapyd Card on File). Purely additive: two new tables.
--
-- "PaymentProviderCustomer": the provider's own customer record for a GoService
-- Customer, one per (Customer, provider, environment) — a provider customer id
-- only exists inside one environment, so the environment is part of the key.
CREATE TABLE "PaymentProviderCustomer" (
    "id" UUID NOT NULL,
    "customerProfileId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "environment" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentProviderCustomer_customerProfileId_method_environmen_key"
    ON "PaymentProviderCustomer"("customerProfileId", "method", "environment");

ALTER TABLE "PaymentProviderCustomer"
    ADD CONSTRAINT "PaymentProviderCustomer_customerProfileId_fkey"
    FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "SavedPaymentCard": ONLY non-sensitive facts about a saved card (brand, last
-- four, credit/debit, expiry) plus the provider's own card token id.
CREATE TABLE "SavedPaymentCard" (
    "id" UUID NOT NULL,
    "customerProfileId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "environment" TEXT NOT NULL,
    "providerCardId" TEXT NOT NULL,
    "brand" TEXT,
    "lastFour" TEXT,
    "type" "PaymentAttemptType",
    "expirationMonth" INTEGER,
    "expirationYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedPaymentCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedPaymentCard_method_environment_providerCardId_key"
    ON "SavedPaymentCard"("method", "environment", "providerCardId");

CREATE INDEX "SavedPaymentCard_customerProfileId_idx" ON "SavedPaymentCard"("customerProfileId");

ALTER TABLE "SavedPaymentCard"
    ADD CONSTRAINT "SavedPaymentCard_customerProfileId_fkey"
    FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
