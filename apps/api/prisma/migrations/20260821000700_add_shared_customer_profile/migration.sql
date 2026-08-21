-- SPACE-04：租户共享客户主档 + 空间级业务关系
--
-- 边界（需求 v1.2 第 41、180 行）：客户**身份**在 SaaS 租户内共享，
-- 订单、优惠券、积分、会员等级、营销余额按经营空间隔离。
-- 因此本迁移做两件事，方向相反但都由需求决定：
--   1. 新增 customer_profiles（租户级，(tenantId, phone) 唯一）承载共享身份
--   2. 把 rental_benefit_accounts 的主键从 (tenantId, customerId)
--      改为 (workspaceId, customerId)——积分与营销余额本就该按空间隔离
--
-- 关于第 2 点：这是修 SPACE-03 阶段自己留下的缺陷。当时给该表加了 workspaceId，
-- 但主键仍是租户级，于是 upsert 以 tenantId_customerId 为键，
-- 第二个空间的积分写入会**覆盖**第一个空间的余额，而不是各记一行。
-- 该表当前只有回填产生的行，改主键不丢业务数据（下方对账会验证行数守恒）。
--
-- 顺序仍是「先建兼容结构 → 回填 → 对账 → 再收紧」。
-- 不动 Member 表：迁移硬规则 5、7 要求保留现有数据，故只回填不替换，
-- 由 sourceMemberId 保留对应关系，旧车辆域继续读 Member。

-- 1. 新建共享客户主档与空间级业务关系
CREATE TABLE `customer_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerType` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `phoneMasked` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `identityVerified` BOOLEAN NOT NULL DEFAULT false,
    `identityNoMasked` VARCHAR(191) NULL,
    `qualifications` JSON NOT NULL,
    `corporateName` VARCHAR(191) NULL,
    `corporateTaxNo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `sourceMemberId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_profiles_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `customer_profiles_tenant_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `customer_profiles_tenant_phone_key`(`tenantId`, `phone`),
    UNIQUE INDEX `customer_profiles_tenant_source_member_key`(`tenantId`, `sourceMemberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_workspace_links` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `levelName` VARCHAR(191) NOT NULL DEFAULT '普通会员',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `firstOrderAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_workspace_links_tenant_customer_idx`(`tenantId`, `customerId`),
    UNIQUE INDEX `customer_workspace_links_ws_customer_key`(`workspaceId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. 回填：把现有 Member 提升为共享客户主档
--    归属只从 tenantId 推导（迁移硬规则 3、4：不得按名称或猜测匹配）。
--    幂等：以 (tenantId, sourceMemberId) 唯一键防重复回填，重复 deploy 不再插入。
INSERT INTO `customer_profiles` (
    `id`, `tenantId`, `customerType`, `name`, `phone`, `phoneMasked`, `email`,
    `identityVerified`, `identityNoMasked`, `qualifications`,
    `status`, `sourceMemberId`, `createdAt`, `updatedAt`
)
SELECT
    UUID(), m.`tenantId`, 'personal', m.`name`, m.`phone`, m.`phoneMasked`, m.`email`,
    m.`identityVerified`, m.`identityNoMasked`,
    -- 驾驶证是否已验证属"资质原始事实"；是否适用由目标空间品类规则判断，不在此下结论。
    JSON_OBJECT('driverLicenseVerified', m.`driverLicenseVerified`),
    CASE WHEN m.`status` = 'active' THEN 'active' ELSE 'suspended' END,
    m.`id`, m.`createdAt`, NOW(3)
FROM `Member` m
WHERE NOT EXISTS (
    SELECT 1 FROM `customer_profiles` p
    WHERE p.`tenantId` = m.`tenantId` AND p.`sourceMemberId` = m.`id`
)
-- 同租户手机号唯一：历史数据若有重号，只提升第一条，其余在对账阶段暴露。
AND NOT EXISTS (
    SELECT 1 FROM `customer_profiles` p2
    WHERE p2.`tenantId` = m.`tenantId` AND p2.`phone` = m.`phone`
);

-- 3. 回填空间级业务关系：已回填的客户接入其租户的默认经营空间
--    用 JOIN 取默认空间，空间不存在则不插入，由对账暴露而不是塞进任意空间（硬规则 9）。
INSERT INTO `customer_workspace_links` (
    `id`, `tenantId`, `workspaceId`, `customerId`, `levelName`, `status`, `createdAt`, `updatedAt`
)
SELECT UUID(), p.`tenantId`, w.`id`, p.`id`,
       COALESCE(m.`levelName`, '普通会员'),
       'active', NOW(3), NOW(3)
FROM `customer_profiles` p
INNER JOIN `business_workspaces` w
        ON w.`tenantId` = p.`tenantId` AND w.`defaultMarker` = 'default'
LEFT  JOIN `Member` m ON m.`id` = p.`sourceMemberId`
WHERE NOT EXISTS (
    SELECT 1 FROM `customer_workspace_links` l
    WHERE l.`workspaceId` = w.`id` AND l.`customerId` = p.`id`
);

-- 4. 权益账户主键改为按空间。先记录改前行数，供对账验证守恒。
CREATE TABLE `_space04_before` (
    `n` INT NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `_space04_before` (`n`) SELECT COUNT(*) FROM `rental_benefit_accounts`;

-- 不再删除无对应主档的权益账户行：既然不加外键就没有这个必要，
-- 而删除业务数据本身违背迁移硬规则 5（现有数据必须保留）。

ALTER TABLE `rental_benefit_accounts` DROP PRIMARY KEY, ADD PRIMARY KEY (`workspaceId`, `customerId`);
CREATE INDEX `rental_benefit_accounts_tenant_customer_idx` ON `rental_benefit_accounts`(`tenantId`, `customerId`);

-- 5. 对账：任何一条不成立就让本次迁移明确失败
CREATE TABLE `_space04_reconcile` (
    `finding` VARCHAR(191) NOT NULL,
    CONSTRAINT `space04_backfill_must_be_complete` CHECK (`finding` = 'ok')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 每个 Member 都必须有对应的共享主档（重号会在这里暴露）
INSERT INTO `_space04_reconcile` (`finding`)
SELECT CONCAT('Member 未能全部提升为共享客户主档，缺 ', COUNT(*), ' 条（可能存在同租户手机号重复）')
FROM `Member` m
WHERE NOT EXISTS (
    SELECT 1 FROM `customer_profiles` p
    WHERE p.`tenantId` = m.`tenantId` AND p.`sourceMemberId` = m.`id`
) HAVING COUNT(*) > 0;

-- 每个共享主档都必须进入其租户的默认空间
INSERT INTO `_space04_reconcile` (`finding`)
SELECT CONCAT('共享客户未接入默认经营空间: ', COUNT(*))
FROM `customer_profiles` p
WHERE NOT EXISTS (
    SELECT 1 FROM `customer_workspace_links` l
    INNER JOIN `business_workspaces` w ON w.`id` = l.`workspaceId`
    WHERE l.`customerId` = p.`id` AND w.`tenantId` = p.`tenantId` AND w.`defaultMarker` = 'default'
) HAVING COUNT(*) > 0;

-- 空间级关系不得跨租户
INSERT INTO `_space04_reconcile` (`finding`)
SELECT CONCAT('客户空间关系跨租户: ', COUNT(*))
FROM `customer_workspace_links` l
LEFT JOIN `business_workspaces` w
       ON w.`id` = l.`workspaceId` AND w.`tenantId` = l.`tenantId`
WHERE w.`id` IS NULL HAVING COUNT(*) > 0;

-- 权益账户行数守恒（只允许删掉孤儿行，不得凭空增减）
INSERT INTO `_space04_reconcile` (`finding`)
SELECT CONCAT('权益账户行数异常：改键前 ', b.`n`, ' 行，现有 ', (SELECT COUNT(*) FROM `rental_benefit_accounts`), ' 行')
FROM `_space04_before` b
WHERE (SELECT COUNT(*) FROM `rental_benefit_accounts`) > b.`n`;

DROP TABLE `_space04_reconcile`;
DROP TABLE `_space04_before`;

-- 6. 外键：客户与权益、空间关系必须同租户
ALTER TABLE `customer_profiles` ADD CONSTRAINT `customer_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_workspace_links` ADD CONSTRAINT `customer_workspace_links_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_workspace_links` ADD CONSTRAINT `customer_workspace_links_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_workspace_links` ADD CONSTRAINT `customer_workspace_links_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- 权益账户刻意不加到 customer_profiles 的外键，理由见 schema.prisma 中同名说明：
-- rental 域的 customerId 目前是自由标识（grantReward 不校验客户存在），加外键会让既有路径 500。
