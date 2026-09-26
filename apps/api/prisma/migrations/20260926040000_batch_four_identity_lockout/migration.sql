CREATE TABLE `auth_login_failures` (
  `id` VARCHAR(191) NOT NULL COMMENT '登录失败保护记录主键',
  `loginKeyHash` CHAR(64) NOT NULL COMMENT '服务端密钥摘要后的登录标识，不保存租户编码或账号原文',
  `failureCount` INTEGER NOT NULL DEFAULT 0 COMMENT '当前失败窗口内的失败次数',
  `firstFailedAt` DATETIME(3) NOT NULL COMMENT '当前失败窗口起始时间',
  `lockedUntil` DATETIME(3) NULL COMMENT '账号锁定截止时间',
  `expiresAt` DATETIME(3) NOT NULL COMMENT '失败保护记录过期清理时间',
  `revision` INTEGER NOT NULL DEFAULT 1 COMMENT '并发更新修订号',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',
  `updatedAt` DATETIME(3) NOT NULL COMMENT '记录更新时间',
  UNIQUE INDEX `auth_login_failures_login_key_hash_key` (`loginKeyHash`),
  INDEX `auth_login_failures_expires_idx` (`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='运营账号跨实例登录失败保护状态';

CREATE TABLE `customer_identity_verifications` (
  `id` VARCHAR(191) NOT NULL COMMENT '实名核验记录主键',
  `tenantId` VARCHAR(191) NOT NULL COMMENT '所属租户 ID',
  `customerId` VARCHAR(191) NOT NULL COMMENT '客户主档 ID',
  `credentialType` VARCHAR(32) NOT NULL COMMENT '核验使用的证件类型',
  `result` VARCHAR(16) NOT NULL COMMENT '核验结论：verified、rejected 或 revoked',
  `evidenceFileAssetIds` JSON NOT NULL COMMENT '实名核验证据文件资产 ID 列表',
  `reason` VARCHAR(500) NOT NULL COMMENT '核验说明或撤销原因',
  `reviewerUserId` VARCHAR(191) NOT NULL COMMENT '执行核验的运营账号 ID',
  `reviewerName` VARCHAR(120) NOT NULL COMMENT '执行核验的运营人名称快照',
  `reviewedAt` DATETIME(3) NOT NULL COMMENT '核验操作时间',
  `verifiedAt` DATETIME(3) NULL COMMENT '核验通过时间；非通过结论为空',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',
  INDEX `customer_identity_verifications_customer_time_idx` (`tenantId`, `customerId`, `reviewedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `customer_identity_verifications_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_identity_verifications_tenantId_customerId_fkey`
    FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='租户内客户实名核验只追加审核记录';
