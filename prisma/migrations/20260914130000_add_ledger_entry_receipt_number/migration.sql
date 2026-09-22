-- 2026-09-14 follow-up (human-requested) — a human-facing "comprobante
-- interno" sequential number on LedgerEntry: one per row, never reused. A
-- plain Postgres SEQUENCE-backed autoincrement column, NOT the primary key
-- (`id` stays the UUID PK). Any pre-existing row gets backfilled with the
-- next sequence value automatically — Postgres evaluates a volatile DEFAULT
-- (nextval(...)) per row when ADD COLUMN forces a table rewrite.

-- CreateSequence
CREATE SEQUENCE "LedgerEntry_receiptNumber_seq" AS INTEGER;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "receiptNumber" INTEGER NOT NULL DEFAULT nextval('"LedgerEntry_receiptNumber_seq"');

-- AddSequenceOwnership
ALTER SEQUENCE "LedgerEntry_receiptNumber_seq" OWNED BY "LedgerEntry"."receiptNumber";

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_receiptNumber_key" ON "LedgerEntry"("receiptNumber");
