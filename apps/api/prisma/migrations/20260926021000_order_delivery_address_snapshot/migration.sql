-- 配送/上门类（deliveryDestination=customer_address 的品类）订单的收货地址快照。
-- 可空、无默认：存量订单缺省 NULL（＝旧行为，无地址），读取侧据此回落。
-- 快照含明文电话，仅运营视图使用；下发客户端前置空并只给脱敏号。
ALTER TABLE `rental_orders`
  ADD COLUMN `deliveryAddressSnapshot` JSON NULL
  COMMENT '配送/上门类订单收货地址快照（含明文电话）；自取、车辆据点类为空';
