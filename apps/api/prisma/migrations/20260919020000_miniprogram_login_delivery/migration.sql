-- MP-02A/02B/06：小程序渠道能力补齐。纯新增结构，不改动、不回填任何既有行。
--
-- 1. 验证码挑战增加 purpose：证明只能用于创建时声明的用途（registration / login / account_closure），
--    存量行默认 registration，与既有语义一致。
-- 2. 小程序渠道增加客服时段与协议正文地址：启动配置直接展示商户提供的文档，不内置占位协议。
-- 3. 新增客户配送地址簿（不是联系人表）与报价/订单配送地址快照表。

ALTER TABLE `client_registration_challenges`
  ADD COLUMN `purpose` VARCHAR(32) NOT NULL DEFAULT 'registration' AFTER `method`;

ALTER TABLE `mini_program_channels`
  ADD COLUMN `customerServiceHours` VARCHAR(64) NULL AFTER `customerServicePhone`,
  ADD COLUMN `userAgreementUrl` VARCHAR(512) NULL AFTER `userAgreementVersion`,
  ADD COLUMN `privacyPolicyUrl` VARCHAR(512) NULL AFTER `privacyPolicyVersion`;

CREATE TABLE `customer_delivery_addresses` (
  `id`          VARCHAR(191) NOT NULL,
  `tenantId`    VARCHAR(191) NOT NULL,
  `customerId`  VARCHAR(191) NOT NULL,
  `recipient`   VARCHAR(120) NOT NULL,
  `phone`       VARCHAR(32) NOT NULL,
  `phoneMasked` VARCHAR(32) NOT NULL,
  `countryCode` VARCHAR(8) NOT NULL DEFAULT 'CN',
  `province`    VARCHAR(64) NOT NULL,
  `city`        VARCHAR(64) NOT NULL,
  `district`    VARCHAR(64) NULL,
  `detail`      VARCHAR(255) NOT NULL,
  `postalCode`  VARCHAR(16) NULL,
  `latitude`    DECIMAL(10, 7) NULL,
  `longitude`   DECIMAL(10, 7) NULL,
  `isDefault`   BOOLEAN NOT NULL DEFAULT false,
  `status`      VARCHAR(16) NOT NULL DEFAULT 'active',
  `revision`    INTEGER NOT NULL DEFAULT 1,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `customer_delivery_addresses_owner_idx` (`tenantId`, `customerId`, `status`),
  CONSTRAINT `customer_delivery_addresses_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 地址必须落在同租户客户主档上，杜绝跨租户引用。
  CONSTRAINT `customer_delivery_addresses_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `client_order_delivery_snapshots` (
  `id`          VARCHAR(191) NOT NULL,
  `tenantId`    VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `customerId`  VARCHAR(191) NOT NULL,
  `quoteId`     VARCHAR(191) NOT NULL,
  `orderId`     VARCHAR(191) NULL,
  `addressId`   VARCHAR(191) NULL,
  `snapshot`    JSON NOT NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_order_delivery_snapshots_quote_key` (`quoteId`),
  UNIQUE KEY `client_order_delivery_snapshots_order_key` (`orderId`),
  KEY `client_order_delivery_snapshots_customer_idx` (`tenantId`, `customerId`),
  CONSTRAINT `client_order_delivery_snapshots_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `client_order_delivery_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `client_order_delivery_snapshots_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
