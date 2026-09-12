-- GOS-125 — extends `engagement_chat_message_sender_shape_check` (added in
-- 20260821214625_add_engagement_chat) with a third branch: a SYSTEM message
-- requires BOTH sender-profile columns to be null. Must run strictly after
-- 20260912100000_gos_125_add_system_engagement_chat_party (the previous
-- migration), since Postgres does not allow a newly-added enum value to be
-- used in the same transaction that added it.
ALTER TABLE "EngagementChatMessage" DROP CONSTRAINT "engagement_chat_message_sender_shape_check";

ALTER TABLE "EngagementChatMessage" ADD CONSTRAINT "engagement_chat_message_sender_shape_check" CHECK (
  (
    "senderRole" = 'CUSTOMER'
    AND "senderCustomerProfileId" IS NOT NULL
    AND "senderProfessionalProfileId" IS NULL
  )
  OR (
    "senderRole" = 'PROFESSIONAL'
    AND "senderProfessionalProfileId" IS NOT NULL
    AND "senderCustomerProfileId" IS NULL
  )
  OR (
    "senderRole" = 'SYSTEM'
    AND "senderCustomerProfileId" IS NULL
    AND "senderProfessionalProfileId" IS NULL
  )
);
