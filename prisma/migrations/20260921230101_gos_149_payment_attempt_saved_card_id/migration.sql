-- GOS-149 — disambiguates ReadAttemptProviderStateService's SAVED_CARDS
-- dispatch branch: provider capability alone is no longer sufficient once a
-- provider (Mercado Pago) has SAVED_CARDS *and* CARD_TOKEN/WALLET_REDIRECT,
-- all of which can produce a providerPaymentId with no providerCheckoutId.
-- Purely additive; nullable; onDelete SET NULL so deleting a saved card never
-- cascades into (or is blocked by) a historical PaymentAttempt.
ALTER TABLE "PaymentAttempt" ADD COLUMN "savedCardId" UUID;

CREATE INDEX "PaymentAttempt_savedCardId_idx" ON "PaymentAttempt"("savedCardId");

ALTER TABLE "PaymentAttempt"
    ADD CONSTRAINT "PaymentAttempt_savedCardId_fkey"
    FOREIGN KEY ("savedCardId") REFERENCES "SavedPaymentCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
