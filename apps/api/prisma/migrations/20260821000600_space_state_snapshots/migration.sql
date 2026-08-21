-- SPACE-03：状态快照按经营空间存档
--
-- 原主键是 tenantId，于是同租户只有一份快照：非默认空间根本没有存档，
-- 而 persist 又必须固定写默认空间，否则会互相覆盖（实测过：在第二个空间触发
-- persist 会把该空间的状态写进租户级行、抹掉默认空间的存档）。
-- 主键换成经营空间后，每个空间各有自己的恢复副本，persist 也不必再挑空间。
--
-- 这两张表此前不在第 29 条迁移的范围内（它们是恢复副本、不是经营事实），
-- 因此这里要走完整的「加可空列 → 回填 → 对账 → 换主键 → 加外键」。

-- 1. 新增可空列
ALTER TABLE `rental_core_state_snapshots` ADD COLUMN `workspaceId` VARCHAR(191) NULL;
ALTER TABLE `rental_business_state_snapshots` ADD COLUMN `workspaceId` VARCHAR(191) NULL;

-- 2. 回填到该租户的默认经营空间
--    升级前的快照是单空间时代的产物，其内容本就属于兼容层，只可能属于默认空间。
UPDATE `rental_core_state_snapshots` s
  INNER JOIN `business_workspaces` w ON w.`tenantId` = s.`tenantId` AND w.`defaultMarker` = 'default'
  SET s.`workspaceId` = w.`id` WHERE s.`workspaceId` IS NULL;
UPDATE `rental_business_state_snapshots` s
  INNER JOIN `business_workspaces` w ON w.`tenantId` = s.`tenantId` AND w.`defaultMarker` = 'default'
  SET s.`workspaceId` = w.`id` WHERE s.`workspaceId` IS NULL;

-- 3. 对账：没能归属的快照行会让换主键时报 NOT NULL 错误且信息晦涩，
--    因此在这里先以可读消息中止。手法与前几条迁移一致。
CREATE TABLE `_space03_snapshot_reconcile` (
    `finding` VARCHAR(191) NOT NULL,
    CONSTRAINT `space03_snapshot_backfill_complete` CHECK (`finding` = 'ok')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_space03_snapshot_reconcile` (`finding`)
SELECT CONCAT('rental_core_state_snapshots 有未归属经营空间的行: ', COUNT(*))
FROM `rental_core_state_snapshots` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;

INSERT INTO `_space03_snapshot_reconcile` (`finding`)
SELECT CONCAT('rental_business_state_snapshots 有未归属经营空间的行: ', COUNT(*))
FROM `rental_business_state_snapshots` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;

DROP TABLE `_space03_snapshot_reconcile`;

-- 4. 换主键。先补 tenantId 独立索引：该列上有指向 Tenant 的外键，
--    原先靠主键提供索引，先删主键会让外键失去可用索引。
CREATE INDEX `core_snapshot_tenant_idx` ON `rental_core_state_snapshots`(`tenantId`);
CREATE INDEX `business_snapshot_tenant_idx` ON `rental_business_state_snapshots`(`tenantId`);

ALTER TABLE `rental_core_state_snapshots` MODIFY `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_business_state_snapshots` MODIFY `workspaceId` VARCHAR(191) NOT NULL;

ALTER TABLE `rental_core_state_snapshots` DROP PRIMARY KEY, ADD PRIMARY KEY (`workspaceId`);
ALTER TABLE `rental_business_state_snapshots` DROP PRIMARY KEY, ADD PRIMARY KEY (`workspaceId`);

-- 5. 一个空间至多一份快照，并供一对一反向关系使用
CREATE UNIQUE INDEX `core_snapshot_tenant_ws_key` ON `rental_core_state_snapshots`(`tenantId`, `workspaceId`);
CREATE UNIQUE INDEX `business_snapshot_tenant_ws_key` ON `rental_business_state_snapshots`(`tenantId`, `workspaceId`);

-- 6. 复合外键：快照与空间必须同租户
ALTER TABLE `rental_core_state_snapshots` ADD CONSTRAINT `rental_core_state_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_business_state_snapshots` ADD CONSTRAINT `rental_business_state_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
