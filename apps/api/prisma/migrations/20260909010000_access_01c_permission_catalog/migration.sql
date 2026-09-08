-- ACCESS-01C：把会员/企业六项操作权限补进已有 Permission 事实表。
--
-- 20260901000100_member_unified_module 曾经为当时已有库做过同样的补录，但并非所有
-- 环境都从那条迁移完整落过，且 seed.ts 的权限目录长期缺六项，导致新初始化环境和
-- 角色管理的可配置目录不一致。这里用 INSERT ... SELECT + NOT EXISTS 做安全增量：
-- 只补缺的 Permission 定义，不删权限、不改角色、不重置账号；重复执行不产生重复行。
-- 普通角色不在这条迁移里自动扩权，角色是否授予仍由租户管理员在角色页明确勾选。
INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT UUID(), wanted.`code`, wanted.`name`, wanted.`description`, wanted.`module`, 'ACTION', CURRENT_TIMESTAMP(3)
FROM (
  SELECT 'store-rental:member:account-manage' AS `code`, '会员账号与密码管理' AS `name`, '开通账号、设置临时密码和管理账号状态' AS `description`, '会员管理' AS `module`
  UNION ALL SELECT 'store-rental:member:review', '会员注册审核', '处理个人会员注册审核，不含证件审核', '会员管理'
  UNION ALL SELECT 'store-rental:member:qualification-review', '会员证件审核', '处理身份证件和品类资质审核', '会员管理'
  UNION ALL SELECT 'store-rental:member:plan:manage', '会员方案编辑', '编辑个人和企业会员方案草稿、授予方案', '会员管理'
  UNION ALL SELECT 'store-rental:member:plan:publish', '会员方案发布', '发布会员方案版本', '会员管理'
  UNION ALL SELECT 'store-rental:corporate:employee-manage', '企业员工管理', '维护企业管理员和员工关系', '企业会员'
) AS wanted
WHERE NOT EXISTS (
  SELECT 1 FROM `Permission` AS existing WHERE existing.`code` = wanted.`code`
);
