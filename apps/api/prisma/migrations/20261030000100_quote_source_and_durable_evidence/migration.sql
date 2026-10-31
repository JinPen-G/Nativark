-- Incremental nullable evidence only. Never infer historical creators, addresses
-- or rental allocations from current accounts/configuration. No data backfill.
ALTER TABLE `rental_quotes`
  ADD COLUMN `sourceSnapshot` JSON NULL,
  ADD COLUMN `deliveryAddressSnapshot` JSON NULL,
  ADD COLUMN `rentalLineAmounts` JSON NULL;
