-- CLIENT-01：客户端认证、注册挑战与空间会话。
CREATE TABLE `client_registration_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `identifierHash` CHAR(64) NOT NULL,
    `maskedDestination` VARCHAR(64) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending_verification',
    `requestKey` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verificationTokenHash` CHAR(64) NULL,
    `consumedAt` DATETIME(3) NULL,
    `registrationId` VARCHAR(191) NULL,
    `registeredCustomerId` VARCHAR(191) NULL,
    `registrationResult` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `client_registration_challenges_scope_request_key` (`tenantId`, `workspaceId`, `requestKey`),
    INDEX `client_registration_challenges_lookup_idx` (`tenantId`, `workspaceId`, `identifierHash`, `createdAt`),
    INDEX `client_registration_challenges_expiry_idx` (`expiresAt`, `status`),
    CONSTRAINT `client_registration_challenges_tenantId_fkey`
      FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `client_registration_challenges_tenantId_workspaceId_fkey`
      FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `client_auth_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `refreshTokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `client_auth_sessions_refreshTokenHash_key` (`refreshTokenHash`),
    INDEX `client_auth_sessions_customer_idx` (`tenantId`, `customerId`, `revokedAt`),
    INDEX `client_auth_sessions_workspace_idx` (`tenantId`, `workspaceId`, `revokedAt`),
    CONSTRAINT `client_auth_sessions_tenantId_fkey`
      FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `client_auth_sessions_tenantId_customerId_fkey`
      FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `client_auth_sessions_tenantId_workspaceId_fkey`
      FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
