-- 重新放开租户后台圆角字段的存储范围，支持「极致圆角」离散档 999px（TINYINT 上限 255 存不下）。
ALTER TABLE `client_channel_profiles`
  MODIFY COLUMN `adminCornerRadius` SMALLINT UNSIGNED NULL;
