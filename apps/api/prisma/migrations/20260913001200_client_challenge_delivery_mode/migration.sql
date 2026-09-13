ALTER TABLE `client_registration_challenges`
  ADD COLUMN `deliveryMode` VARCHAR(24) NOT NULL DEFAULT 'development' AFTER `status`;
