-- 统一内置演示履约地点的当前展示名称。
-- 只处理稳定的系统演示记录，不改写租户自行维护的地点名称。
UPDATE `OrganizationUnit`
SET `name` = CASE `id`
  WHEN 'org_store_mongkok' THEN '旺角服务点'
  WHEN 'org_store_central' THEN '中环服务点'
  WHEN 'org_store_airport' THEN '机场服务点'
  WHEN 'org_store_nanshan' THEN '南山服务点'
  ELSE `name`
END
WHERE `id` IN (
  'org_store_mongkok',
  'org_store_central',
  'org_store_airport',
  'org_store_nanshan'
);
