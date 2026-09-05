-- 补 `settling`（待结算）到订单状态枚举。
--
-- 为什么是必须的：共享契约 `RentalCoreOrderStatus` 一直有 `Settling = "settling"`，
-- 而这个库枚举没有对应成员。归还路径 `finishReturn` 把订单推进到 settling，
-- 事实仓储再 `upper()` 成 `SETTLING` 交给 Prisma，成员不存在 → 写库失败。
-- 结清（requireSettling）与关闭都要求 status 必须是 settling，因此
-- 「归还 → 待结算 → 结清 → 完成」整条链在真库上都走不通。
-- 内存实现不校验枚举，所以四十多个专项测试全绿，这个缺口一直没被发现。
--
-- 位置放在 return_inspection 之后、completed 之前，与业务流程和共享契约顺序一致。
--
-- 无损性：新定义包含全部旧值，MySQL 的 MODIFY 会按字符串值重新匹配，
-- 已有行不受影响；DEFAULT 保持 'reserved' 不变。
ALTER TABLE `rental_orders`
  MODIFY `status` ENUM(
    'draft',
    'reserved',
    'ready_for_pickup',
    'renting',
    'return_inspection',
    'settling',
    'completed',
    'cancelled'
  ) NOT NULL DEFAULT 'reserved';
