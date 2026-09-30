-- Tenant adoption is distinct from platform publishing and limited price editing.
INSERT INTO `Permission` (`id`, `code`, `name`, `module`, `kind`)
VALUES ('perm_category_adoption_manage', 'rental-os:category:adopt', '经营空间品类版本采用', '租赁业务', 'action')
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r
JOIN `Permission` p ON p.`code` = 'rental-os:category:adopt'
WHERE r.`code` = 'TENANT_ADMIN' AND r.`fixedAllPermissions` = 1;
