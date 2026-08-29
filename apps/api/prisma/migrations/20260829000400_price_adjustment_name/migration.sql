ALTER TABLE `rental_price_adjustment_plans`
  ADD COLUMN `name` VARCHAR(191) NULL AFTER `code`;

UPDATE `rental_price_adjustment_plans`
SET `name` = `code`
WHERE `name` IS NULL OR TRIM(`name`) = '';

ALTER TABLE `rental_price_adjustment_plans`
  MODIFY COLUMN `name` VARCHAR(191) NOT NULL;
