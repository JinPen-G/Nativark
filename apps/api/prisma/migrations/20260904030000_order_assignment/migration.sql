-- Assignment lifecycle is independent of main order and physical asset state.
ALTER TABLE `rental_orders` ADD COLUMN `assignment` JSON NULL;
ALTER TABLE `rental_allocations` ADD COLUMN `metadata` JSON NULL;
