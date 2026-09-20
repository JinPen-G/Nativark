-- 将历史车辆专用权限平滑迁移到多品类 Rental Core 权限。
-- 先补权限定义，再按旧授权逐角色补授；旧权限行暂留给 /rental-os 历史接口，
-- 但新的通用页面与 /rental/v1 守卫不再消费它们。

INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT UUID(), source.`code`, source.`name`, source.`description`, 'Rental Core', 'ACTION', CURRENT_TIMESTAMP(3)
FROM (
  SELECT 'rental-core:catalog:view' AS `code`, '通用商品目录查看' AS `name`, '查看当前经营空间的商品型号与定价分组' AS `description`
  UNION ALL SELECT 'rental-core:catalog:manage', '通用商品目录管理', '维护当前经营空间的商品型号与定价分组'
  UNION ALL SELECT 'rental-core:asset:view', '通用资产库存查看', '查看当前经营空间的资产与数量库存'
  UNION ALL SELECT 'rental-core:asset:manage', '通用资产库存管理', '维护当前经营空间的资产、库存与状态'
) AS source
WHERE NOT EXISTS (SELECT 1 FROM `Permission` existing WHERE existing.`code` = source.`code`);

INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT DISTINCT legacyGrant.`roleId`, targetPermission.`id`
FROM `RolePermission` legacyGrant
JOIN `Permission` legacyPermission ON legacyPermission.`id` = legacyGrant.`permissionId`
JOIN (
  SELECT 'rental-os:vehicle-group:manage' AS `legacyCode`, 'rental-core:catalog:view' AS `targetCode`
  UNION ALL SELECT 'rental-os:vehicle-group:manage', 'rental-core:catalog:manage'
  UNION ALL SELECT 'rental-os:vehicle:view', 'rental-core:catalog:view'
  UNION ALL SELECT 'rental-os:vehicle:view', 'rental-core:asset:view'
  UNION ALL SELECT 'rental-os:vehicle:view', 'rental-os:order:view'
  UNION ALL SELECT 'rental-os:vehicle:manage', 'rental-core:asset:manage'
  UNION ALL SELECT 'rental-os:vehicle:manage', 'rental-os:order:operate'
  UNION ALL SELECT 'rental-os:vehicle:status-action', 'rental-core:asset:manage'
) mapping ON mapping.`legacyCode` = legacyPermission.`code`
JOIN `Permission` targetPermission ON targetPermission.`code` = mapping.`targetCode`
WHERE NOT EXISTS (
  SELECT 1 FROM `RolePermission` existing
  WHERE existing.`roleId` = legacyGrant.`roleId`
    AND existing.`permissionId` = targetPermission.`id`
);
