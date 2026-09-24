-- 恢复租户后台圆角字段的原存储范围；部署前已确认没有超过 20 的配置值。
ALTER TABLE `client_channel_profiles`
  MODIFY COLUMN `adminCornerRadius` TINYINT UNSIGNED NULL;
