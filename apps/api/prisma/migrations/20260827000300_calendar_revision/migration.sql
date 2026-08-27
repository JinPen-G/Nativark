-- 并发编辑保护：年度日历的乐观锁版本号。
--
-- 整年日期存在同一个 JSON 字段（days）里，两个编辑人同时修改不同日期时，
-- 各自都会读到同一份草稿、复制全年、改自己那天、再写回整份 JSON——
-- 后写入者把先写入者的改动整体覆盖，而双方都收到成功。
-- 写入改为以「读到的 revision」为条件（条件更新），不匹配即 409 让前端刷新重试。
--
-- 只新增列、可空性由默认值兜住：存量行 revision 落为 0，与新写入的第一次递增（1）不冲突。

ALTER TABLE `rental_business_calendars`
  ADD COLUMN `revision` INT NOT NULL DEFAULT 0;
