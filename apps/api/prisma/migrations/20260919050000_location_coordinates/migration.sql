-- 门店坐标：客户端按位置排序与地图导航使用；可空，未录入则客户端不显示距离。
ALTER TABLE `rental_fulfillment_locations`
  ADD COLUMN `latitude` DECIMAL(10, 7) NULL,
  ADD COLUMN `longitude` DECIMAL(10, 7) NULL;
