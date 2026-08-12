-- SaaS tenant lifecycle and identity/session foundation.
ALTER TABLE `Tenant`
  ADD COLUMN `statusReason` VARCHAR(512) NULL,
  ADD COLUMN `statusChangedAt` DATETIME(3) NULL,
  ADD COLUMN `statusChangedBy` VARCHAR(191) NULL;

ALTER TABLE `User`
  ADD COLUMN `isSaasAdmin` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `passwordChangedAt` DATETIME(3) NULL,
  ADD COLUMN `lastLoginAt` DATETIME(3) NULL;

CREATE TABLE `auth_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `refreshTokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `lastUsedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `auth_sessions_refreshTokenHash_key` (`refreshTokenHash`),
  INDEX `auth_sessions_userId_expiresAt_revokedAt_idx` (`userId`, `expiresAt`, `revokedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `auth_sessions_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
