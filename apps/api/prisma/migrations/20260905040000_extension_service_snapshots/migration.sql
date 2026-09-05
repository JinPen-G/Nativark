-- 续租新增的增值服务快照（Codex review #7）。
--
-- 续租此前只把服务费算进 serviceAmount 与费用明细，解析出来的快照直接丢弃，于是这些
-- 服务既不占服务容量也不进订单的 serviceSnapshots：容量可被超卖，归还结算看不到它们。
-- 申请与生效之间可能隔着客户补款，因此快照必须落库，生效时才能据此确认容量。
--
-- 可空且不回填：存量续租记录没有这份快照，读取侧按 undefined 处理，行为与本列不存在时一致。
ALTER TABLE `rental_order_extensions` ADD COLUMN `serviceSnapshots` JSON NULL;
