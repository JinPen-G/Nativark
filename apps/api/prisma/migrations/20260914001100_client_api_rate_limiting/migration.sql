CREATE TABLE `client_api_rate_buckets` (
  `id` VARCHAR(191) NOT NULL,
  `scopeKey` CHAR(64) NOT NULL,
  `bucketStart` DATETIME(3) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `client_api_rate_bucket_key` (`scopeKey`, `bucketStart`),
  INDEX `client_api_rate_bucket_expiry_idx` (`bucketStart`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
