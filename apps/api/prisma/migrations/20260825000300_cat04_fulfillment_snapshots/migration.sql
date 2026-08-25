ALTER TABLE `rental_orders`
    ADD COLUMN `fulfillmentLocationSnapshot` JSON NULL,
    ADD COLUMN `returnLocationSnapshot` JSON NULL;

-- 历史订单只能以升级时仍可读取到的地点与主体主档生成兼容快照；名称字段继续
-- 保留原下单时值，避免地点改名后用当前名称覆盖历史。新订单由应用写入完整快照。
UPDATE `rental_orders` orders
JOIN `rental_fulfillment_locations` location ON location.`id` = orders.`fulfillmentLocationId`
LEFT JOIN `rental_fulfillment_operators` operator ON operator.`id` = location.`operatorId`
SET orders.`fulfillmentLocationSnapshot` = JSON_OBJECT(
  'id', location.`id`,
  'code', location.`code`,
  'name', orders.`fulfillmentLocationName`,
  'type', location.`type`,
  'capabilities', location.`capabilities`,
  'address', location.`address`,
  'contactName', location.`contactName`,
  'contactPhone', location.`contactPhone`,
  'businessHours', location.`businessHours`,
  'operator', JSON_OBJECT(
    'id', COALESCE(operator.`id`, ''),
    'code', COALESCE(operator.`code`, ''),
    'name', COALESCE(operator.`name`, location.`operatorName`, ''),
    'type', COALESCE(operator.`type`, location.`operatorType`, 'self_operated'),
    'settlementMode', operator.`settlementMode`
  )
)
WHERE orders.`fulfillmentLocationSnapshot` IS NULL;

UPDATE `rental_orders` orders
LEFT JOIN `rental_fulfillment_locations` return_location ON return_location.`id` = orders.`returnLocationId`
JOIN `rental_fulfillment_locations` fulfillment_location ON fulfillment_location.`id` = orders.`fulfillmentLocationId`
LEFT JOIN `rental_fulfillment_operators` return_operator ON return_operator.`id` = COALESCE(return_location.`operatorId`, fulfillment_location.`operatorId`)
SET orders.`returnLocationSnapshot` = JSON_OBJECT(
  'id', COALESCE(return_location.`id`, fulfillment_location.`id`),
  'code', COALESCE(return_location.`code`, fulfillment_location.`code`),
  'name', COALESCE(orders.`returnLocationName`, orders.`fulfillmentLocationName`),
  'type', COALESCE(return_location.`type`, fulfillment_location.`type`),
  'capabilities', COALESCE(return_location.`capabilities`, fulfillment_location.`capabilities`),
  'address', COALESCE(return_location.`address`, fulfillment_location.`address`),
  'contactName', COALESCE(return_location.`contactName`, fulfillment_location.`contactName`),
  'contactPhone', COALESCE(return_location.`contactPhone`, fulfillment_location.`contactPhone`),
  'businessHours', COALESCE(return_location.`businessHours`, fulfillment_location.`businessHours`),
  'operator', JSON_OBJECT(
    'id', COALESCE(return_operator.`id`, ''),
    'code', COALESCE(return_operator.`code`, ''),
    'name', COALESCE(return_operator.`name`, return_location.`operatorName`, fulfillment_location.`operatorName`, ''),
    'type', COALESCE(return_operator.`type`, return_location.`operatorType`, fulfillment_location.`operatorType`, 'self_operated'),
    'settlementMode', return_operator.`settlementMode`
  )
)
WHERE orders.`returnLocationSnapshot` IS NULL;
