CREATE TABLE `ai_platform_model_connections` (
  `profileId` VARCHAR(36) NOT NULL,
  `configRevision` INTEGER UNSIGNED NOT NULL,
  `baseUrl` VARCHAR(2048) NOT NULL,
  `maxOutputTokens` INTEGER UNSIGNED NOT NULL,
  `credentialsEncrypted` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`profileId`),
  CONSTRAINT `ai_platform_model_connections_profile_fk` FOREIGN KEY (`profileId`)
    REFERENCES `ai_provider_profiles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
