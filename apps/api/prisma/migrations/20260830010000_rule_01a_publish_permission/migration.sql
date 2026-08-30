-- RULE-01A：新增 store-rental:rules:publish，并给**已有** rules:manage 的角色补授。
--
-- 为什么必须有这段数据迁移：seed 与角色预设只影响新部署。存量部署里管理员角色是靠
-- rules:manage 发布规则的，分权后发布端点只认 rules:publish——不补授就等于升级当晚
-- 所有管理员突然不能发布规则，而这不是本次变更想要的效果。
--
-- 安全性：只 INSERT，没有 DROP/DELETE/UPDATE，且两处都用 NOT EXISTS 做幂等，
-- 重复执行不会产生重复行。不改任何既有权限，也不移除任何授权。

INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT
  UUID(),
  'store-rental:rules:publish',
  '业务规则发布',
  '发布或安排规则版本生效、作废已发布或待生效版本',
  '门市租赁',
  'ACTION',
  CURRENT_TIMESTAMP(3)
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'store-rental:rules:publish');

-- 逐角色补授。fixedAllPermissions 的角色本来就靠 `*` 放行，这里不需要也不会动它们，
-- 因为它们不通过 RolePermission 表授权。
INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT existing.`roleId`, publishPerm.`id`
FROM `RolePermission` AS existing
JOIN `Permission` AS managePerm
  ON managePerm.`id` = existing.`permissionId` AND managePerm.`code` = 'store-rental:rules:manage'
JOIN `Permission` AS publishPerm
  ON publishPerm.`code` = 'store-rental:rules:publish'
WHERE NOT EXISTS (
  SELECT 1 FROM `RolePermission` AS already
  WHERE already.`roleId` = existing.`roleId` AND already.`permissionId` = publishPerm.`id`
);
