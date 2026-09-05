-- 独立改配权限仅登记，不向普通运营角色自动增权；由租户管理员按空间配置。
INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT UUID(), 'store-rental:order:reassign', '资源解锁与改配', '解锁、释放及更换锁定资源，必须填写原因', '门市租赁', 'ACTION', CURRENT_TIMESTAMP(3)
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'store-rental:order:reassign');
