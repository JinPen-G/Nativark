-- Merchant coordination opinion only. Original material, subjects, funds and grants remain unchanged.
ALTER TABLE `enterprise_rental_handoff_requests`
  ADD COLUMN `merchantReviewReason` VARCHAR(500) NULL,
  ADD COLUMN `reviewedBy` VARCHAR(191) NULL,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL;
