-- Additive permission rollout. Never grant these permissions to tenant roles,
-- including fixedAllPermissions tenant administrators.
INSERT INTO `Permission` (`id`, `code`, `name`, `module`, `kind`)
VALUES
 ('perm_category_governance_view', 'system:rental-category:view', '查看租赁品类', '租赁内核', 'action'),
 ('perm_category_governance_edit', 'system:rental-category:edit', '编辑租赁品类草稿', '租赁内核', 'action'),
 ('perm_category_governance_publish', 'system:rental-category:publish', '发布租赁品类及采用资格', '租赁内核', 'action'),
 ('perm_category_governance_opening', 'system:rental-category:opening', '管理品类新开通范围', '租赁内核', 'action'),
 ('perm_category_governance_audit', 'system:rental-category:audit', '查看品类治理审计', '租赁内核', 'action')
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r
JOIN `Tenant` t ON t.`id` = r.`tenantId`
JOIN `Permission` p ON p.`code` IN (
 'system:rental-category:view', 'system:rental-category:edit',
 'system:rental-category:publish', 'system:rental-category:opening', 'system:rental-category:audit')
WHERE r.`id` = 'role_saas_admin' AND r.`code` = 'SAAS_ADMIN'
AND t.`id` = 'tenant_platform' AND t.`code` = 'platform';
