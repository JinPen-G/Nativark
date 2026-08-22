-- SPACE-01：经营空间主档与兼容迁移
--
-- 顺序严格遵循「先新增兼容结构 → 回填 → 对账 → 再收紧约束」：
--   1. 建表与外键（外键先于回填，坏数据在回填时就写不进去）
--   2. 为每个**已有品类档案**的租户回填一个默认经营空间
--   3. 把现有账号连同其既有角色回填为默认空间成员
--   4. 对账；不满足即让迁移明确失败，绝不静默把无法归属的数据塞进任意空间
--
-- 刻意不做的事：
--   - 不给任何既有业务大表加 workspaceId（属 SPACE-03；此处无法回填的 NOT NULL 列一律不加）
--   - 不改 tenant_rental_profiles 的主键（它仍是租户级兼容层，空间化属 SPACE-03）
--   - 不按品类名称或显示名猜测归属，归属只从 tenantId + tenant_rental_profiles 推导
--
-- 可重复部署：默认空间 id 取 CONCAT('ws_', tenantId)（确定且可重算），
-- 两条回填都用 ON DUPLICATE KEY UPDATE 做成幂等，重复 deploy 不产生重复数据。

-- CreateTable
CREATE TABLE `business_workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `status` ENUM('active', 'frozen', 'disabled') NOT NULL DEFAULT 'active',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `defaultMarker` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `business_workspaces_category_idx`(`categoryCode`),
    INDEX `business_workspaces_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `business_workspaces_tenant_code_key`(`tenantId`, `code`),
    UNIQUE INDEX `business_workspaces_tenant_default_key`(`tenantId`, `defaultMarker`),
    UNIQUE INDEX `business_workspaces_tenant_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_members` (
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NULL,
    `dataScope` ENUM('all', 'organization', 'store', 'own') NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `workspace_members_tenant_user_idx`(`tenantId`, `userId`),
    INDEX `workspace_members_role_idx`(`roleId`),
    PRIMARY KEY (`workspaceId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
-- 供成员关系的复合外键引用，使「空间与账号必须同租户」成为库层约束而非应用层约定。
CREATE UNIQUE INDEX `users_tenant_id_key` ON `User`(`tenantId`, `id`);

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- (tenantId, workspaceId) 必须落在同一租户的空间上。
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- (tenantId, userId) 必须落在同一租户的账号上；跨租户成员因此在库层写不进去。
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_userId_fkey` FOREIGN KEY (`tenantId`, `userId`) REFERENCES `User`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: 默认经营空间
--
-- 只为拥有 tenant_rental_profiles 的租户创建：品类是 NOT NULL，而档案是品类归属的
-- 唯一权威来源。平台管理租户（无档案、不经营租赁）因此不会被凭空塞一个品类。
INSERT INTO `business_workspaces`
    (`id`, `tenantId`, `code`, `name`, `categoryCode`, `status`, `isDefault`, `defaultMarker`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('ws_', t.`id`),
    t.`id`,
    'default',
    CONCAT(t.`name`, ' 默认经营空间'),
    p.`categoryCode`,
    'active',
    TRUE,
    'default',
    NOW(3),
    NOW(3)
FROM `Tenant` t
INNER JOIN `tenant_rental_profiles` p ON p.`tenantId` = t.`id`
ON DUPLICATE KEY UPDATE `business_workspaces`.`id` = `business_workspaces`.`id`;

-- Backfill: 现有账号 → 默认空间成员
--
-- roleId 与 dataScope 都留空，表示沿用账号既有的租户级角色与范围，
-- 使升级后权限**完全不变**（需求：现有账号仍可正常使用）。详见下方列注释。
-- 不删除、不重建任何 User 或 UserRole 行。
INSERT INTO `workspace_members`
    (`tenantId`, `workspaceId`, `userId`, `roleId`, `dataScope`, `isActive`, `createdAt`, `updatedAt`)
SELECT
    u.`tenantId`,
    w.`id`,
    u.`id`,
    -- 刻意写 NULL 而不是 u.roleId：本列为空表示「沿用租户级默认角色」（见 schema 注释），
    -- 而账号的权威角色集是 UserRole ∪ {User.roleId}，User.roleId 只是建号时存的第一个角色。
    -- 写 u.roleId 会让 findWorkspaceScopedUser 用这单个角色**整体替换**权限集，
    -- 于是多角色账号升级后权限静默收缩（例如同时是店长和财务复核的人只剩店长）。
    -- 升级的要求是"既有账号仍可正常使用"，因此这里不缩小任何人的授权；
    -- 空间级角色由管理员后续按需显式配置。
    NULL,
    NULL,
    u.`isActive`,
    NOW(3),
    NOW(3)
FROM `User` u
INNER JOIN `business_workspaces` w
    ON w.`tenantId` = u.`tenantId` AND w.`defaultMarker` = 'default'
ON DUPLICATE KEY UPDATE `workspace_members`.`workspaceId` = `workspace_members`.`workspaceId`;

-- Reconcile: 回填必须完整，否则迁移明确失败
--
-- 用带 CHECK 约束的临时表做断言：把每一条不满足项作为一行插入，
-- CHECK 只允许 'ok'，因此任何一条问题都会让本次迁移以可读消息中止。
-- 刻意不用存储过程——Prisma 按分号切分语句，过程体里的分号会被切坏。
DROP TABLE IF EXISTS `_space01_reconcile`;
CREATE TABLE `_space01_reconcile` (
    `finding` VARCHAR(191) NOT NULL,
    CONSTRAINT `space01_backfill_must_be_complete` CHECK (`finding` = 'ok')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 有品类档案的租户必须恰好拿到一个默认空间
INSERT INTO `_space01_reconcile` (`finding`)
SELECT CONCAT('租户缺默认经营空间: ', t.`code`)
FROM `Tenant` t
INNER JOIN `tenant_rental_profiles` p ON p.`tenantId` = t.`id`
LEFT JOIN `business_workspaces` w ON w.`tenantId` = t.`id` AND w.`defaultMarker` = 'default'
WHERE w.`id` IS NULL;

-- 默认空间的品类必须与租户品类档案一致（杜绝回填错位）
INSERT INTO `_space01_reconcile` (`finding`)
SELECT CONCAT('默认空间品类与档案不一致: ', t.`code`)
FROM `Tenant` t
INNER JOIN `tenant_rental_profiles` p ON p.`tenantId` = t.`id`
INNER JOIN `business_workspaces` w ON w.`tenantId` = t.`id` AND w.`defaultMarker` = 'default'
WHERE w.`categoryCode` <> p.`categoryCode`;

-- 拥有默认空间的租户，其所有账号都必须成为该空间成员
INSERT INTO `_space01_reconcile` (`finding`)
SELECT CONCAT('账号未回填默认空间成员: ', u.`account`)
FROM `User` u
INNER JOIN `business_workspaces` w ON w.`tenantId` = u.`tenantId` AND w.`defaultMarker` = 'default'
LEFT JOIN `workspace_members` m ON m.`workspaceId` = w.`id` AND m.`userId` = u.`id`
WHERE m.`userId` IS NULL;

-- 成员关系不得缩小任何账号的授权：roleId 必须为空（= 沿用租户级角色）。
--
-- 这条对账有区分力：如果回填改回写 u.roleId，它会立刻报出行数。
-- 上一版写的是 `WHERE NOT (m.roleId <=> u.roleId)`——拿刚复制过去的列比源列，
-- 永远不可能失败，证明不了任何事。
INSERT INTO `_space01_reconcile` (`finding`)
SELECT CONCAT('成员关系写入了空间级角色，会覆盖账号的租户级角色集: ', COUNT(*), ' 行')
FROM `workspace_members`
WHERE `roleId` IS NOT NULL
HAVING COUNT(*) > 0;

DROP TABLE `_space01_reconcile`;
