-- Dispatch authority is appended before the single object read and is never released.
-- Lost acknowledgements, failures and expiry keep the original key unknown; no TTL retry.
-- Existing completed rows retain their original evidence with both claim columns NULL.
ALTER TABLE `rental_exchange_inspection_media`
  ADD COLUMN `completionClaimId` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN `completionClaimedAt` DATETIME(3) NULL;
