-- 基础主数据补充：全部为选填列，纯增量 ADD COLUMN ... NULL。
-- 这些字段只用于运营检索与客户端展示，不参与任何业务判定与规则快照，
-- 存量数据无需回填（缺省即 NULL）。不改动 20260919050000 的经纬度列。

-- 履约地点：行政区划与时区主数据。
ALTER TABLE `rental_fulfillment_locations`
  ADD COLUMN `province` VARCHAR(64) NULL,
  ADD COLUMN `city` VARCHAR(64) NULL,
  ADD COLUMN `district` VARCHAR(64) NULL,
  ADD COLUMN `timezone` VARCHAR(64) NULL;

-- 客户主档：基础画像主数据（性别、生日、来源渠道、常驻城市）。
ALTER TABLE `customer_profiles`
  ADD COLUMN `gender` VARCHAR(16) NULL,
  ADD COLUMN `birthday` DATE NULL,
  ADD COLUMN `sourceChannel` VARCHAR(32) NULL,
  ADD COLUMN `region` VARCHAR(64) NULL;
