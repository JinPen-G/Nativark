-- AlterTable
ALTER TABLE `rental_orders` ADD COLUMN `capabilityRequirementsSnapshot` JSON NULL;

-- AlterTable
ALTER TABLE `rental_quotes` ADD COLUMN `capabilityRequirementsSnapshot` JSON NULL;
