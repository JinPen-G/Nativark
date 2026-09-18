-- 空间证件类型独立授权：新增 rental-os:qualification-type:manage，并给**已有** rental-os:member:manage 的角色补授。
--
-- 背景：此前「空间证件类型」页与租户级会员页共用 member:manage，一个码在两种范围下检查，
-- 角色配置者无法判断授权到底开哪些页。现在守卫对 /membership/qualification-types 的写入
-- 只认新码；管理端靠 legacyPermissions 兜底让存量角色仍能进入页面，但不补授保存会 403。
--
-- 与 20260830010000_rule_01a_publish_permission 同一模式：只 INSERT，两处 NOT EXISTS 幂等，
-- 不改任何既有权限，不移除任何授权。fixedAllPermissions 的角色靠 `*` 放行，不经 RolePermission。

INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT
  UUID(),
  'rental-os:qualification-type:manage',
  '空间证件类型管理',
  '维护当前经营空间的资质证件类型',
  '租赁业务',
  'ACTION',
  CURRENT_TIMESTAMP(3)
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'rental-os:qualification-type:manage');

INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT existing.`roleId`, qualPerm.`id`
FROM `RolePermission` AS existing
JOIN `Permission` AS managePerm
  ON managePerm.`id` = existing.`permissionId` AND managePerm.`code` = 'rental-os:member:manage'
JOIN `Permission` AS qualPerm
  ON qualPerm.`code` = 'rental-os:qualification-type:manage'
WHERE NOT EXISTS (
  SELECT 1 FROM `RolePermission` AS already
  WHERE already.`roleId` = existing.`roleId` AND already.`permissionId` = qualPerm.`id`
);
