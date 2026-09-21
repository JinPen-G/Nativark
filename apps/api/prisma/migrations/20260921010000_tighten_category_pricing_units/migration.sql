-- 收紧首批四品类的基础计价单位。历史报价、订单与价格版本保存的是自己的快照，
-- 本迁移只更新品类定义；存量经营设置由 API 读取时按当前定义过滤，运营再次保存后落库。
UPDATE `rental_category_definitions`
SET
  `businessModel` = JSON_SET(
    `businessModel`,
    '$.pricingUnits', JSON_ARRAY('hour', 'day_24h', 'calendar_day', 'week'),
    '$.supportsUsagePricing', JSON_EXTRACT('false', '$')
  ),
  `version` = '0.4.0',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'camera';

UPDATE `rental_category_definitions`
SET
  `businessModel` = JSON_SET(
    `businessModel`,
    '$.pricingUnits', JSON_ARRAY('calendar_day', 'night', 'week')
  ),
  `version` = '0.4.0',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'camping';

UPDATE `rental_category_definitions`
SET
  `businessModel` = JSON_SET(
    `businessModel`,
    '$.pricingUnits', JSON_ARRAY('hour', 'day_24h', 'calendar_day', 'week', 'month', 'usage')
  ),
  `version` = '0.5.0',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'vehicle';

UPDATE `rental_category_definitions`
SET
  `businessModel` = JSON_SET(
    `businessModel`,
    '$.pricingUnits', JSON_ARRAY('hour', 'shift', 'calendar_day', 'week', 'month', 'usage')
  ),
  `version` = '0.4.0',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'construction';
