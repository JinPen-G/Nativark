-- 统一经营空间的默认展示名称；不修改空间编码、品类编码或任何业务快照。
UPDATE `business_workspaces`
SET `name` = CASE
  WHEN `name` = '摄影设备经营空间' THEN '摄影设备租赁'
  WHEN `name` = '露营装备经营空间' THEN '露营装备租赁'
  WHEN `name` = '车辆载具经营空间' THEN '车辆载具租赁'
  WHEN `name` = '工程设备经营空间' THEN '工程设备租赁'
  WHEN `name` LIKE '%默认经营空间' AND `categoryCode` = 'camera' THEN '摄影设备租赁'
  WHEN `name` LIKE '%默认经营空间' AND `categoryCode` = 'camping' THEN '露营装备租赁'
  WHEN `name` LIKE '%默认经营空间' AND `categoryCode` = 'vehicle' THEN '车辆载具租赁'
  WHEN `name` LIKE '%默认经营空间' AND `categoryCode` = 'construction' THEN '工程设备租赁'
  ELSE `name`
END
WHERE `name` IN ('摄影设备经营空间', '露营装备经营空间', '车辆载具经营空间', '工程设备经营空间')
   OR `name` LIKE '%默认经营空间';
