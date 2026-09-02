-- 车辆样本曾把“标准轿车 / 城市 SUV”这类商业车组名称写进产品型号主档。
-- 只纠正明确的 demo 经营空间与固定样本行；历史订单和不可变价格版本不改写。
UPDATE `rental_item_groups`
SET
  `code` = 'VEH-ROEWE-D7',
  `name` = '荣威 D7 标准版',
  `attributes` = JSON_SET(
    `attributes`,
    '$.modelYear', 2026,
    '$.seats', 5,
    '$.transmission', '自动'
  ),
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` = 'ws_tenant_001_vehicle_veh-sedan'
  AND `tenantId` = 'tenant_001'
  AND `workspaceId` = 'ws_tenant_001_vehicle'
  AND `code` = 'VEH-SEDAN'
  AND `name` = '标准轿车';

UPDATE `rental_item_groups`
SET
  `code` = 'VEH-LYNK-08',
  `name` = '领克 08 Pro',
  `attributes` = JSON_SET(
    `attributes`,
    '$.modelYear', 2026,
    '$.seats', 5,
    '$.transmission', '自动'
  ),
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` = 'ws_tenant_001_vehicle_veh-suv'
  AND `tenantId` = 'tenant_001'
  AND `workspaceId` = 'ws_tenant_001_vehicle'
  AND `code` = 'VEH-SUV'
  AND `name` = '城市 SUV';

UPDATE `rental_pricing_groups`
SET
  `code` = 'COMFORT-SEDAN',
  `name` = '标准轿车组',
  `version` = `version` + 1,
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` = 'ws_tenant_001_vehicle_veh-sedan'
  AND `tenantId` = 'tenant_001'
  AND `workspaceId` = 'ws_tenant_001_vehicle'
  AND `code` = 'VEH-SEDAN'
  AND `name` = '标准轿车';

UPDATE `rental_pricing_groups`
SET
  `code` = 'CITY-SUV',
  `name` = '城市 SUV 组',
  `version` = `version` + 1,
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` = 'ws_tenant_001_vehicle_veh-suv'
  AND `tenantId` = 'tenant_001'
  AND `workspaceId` = 'ws_tenant_001_vehicle'
  AND `code` = 'VEH-SUV'
  AND `name` = '城市 SUV';

-- 车辆实体新增了颜色和首次登记日期两个可选动态字段；样本只补展示数据，
-- 车牌和 VIN 等既有唯一事实保持不变。
UPDATE `rental_assets`
SET
  `attributes` = JSON_SET(
    `attributes`,
    '$.color', IF(MOD(CAST(RIGHT(`assetNo`, 1) AS UNSIGNED), 2) = 1, '白色', '黑色'),
    '$.firstRegistrationDate', '2026-01-15'
  ),
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `tenantId` = 'tenant_001'
  AND `workspaceId` = 'ws_tenant_001_vehicle'
  AND `itemGroupId` IN ('ws_tenant_001_vehicle_veh-sedan', 'ws_tenant_001_vehicle_veh-suv');
