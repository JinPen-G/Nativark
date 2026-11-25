CREATE TABLE `ai_gateway_price_records` (
  `id` CHAR(64) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `configurationHash` CHAR(64) NOT NULL,
  `priceVersion` VARCHAR(64) NOT NULL,
  `sourceReference` VARCHAR(191) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_price_records_scope_id` (`scopeId`, `id`),
  UNIQUE INDEX `ai_gateway_price_records_version` (`scopeId`, `configurationHash`, `priceVersion`),
  UNIQUE INDEX `ai_gateway_price_records_source` (`scopeId`, `sourceReference`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_gateway_input_bound_records` (
  `id` CHAR(64) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `invocationId` VARCHAR(36) NOT NULL,
  `priceRecordId` CHAR(64) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_input_bounds_invocation` (`scopeId`, `invocationId`),
  CONSTRAINT `ai_gateway_input_bound_records_scopeId_priceRecordId_fkey`
    FOREIGN KEY (`scopeId`, `priceRecordId`) REFERENCES `ai_gateway_price_records` (`scopeId`, `id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
