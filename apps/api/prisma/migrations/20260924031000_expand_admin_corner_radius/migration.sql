-- 允许租户把基础控件圆角设为 CSS 常用胶囊值 999px。
ALTER TABLE `client_channel_profiles`
  MODIFY COLUMN `adminCornerRadius` SMALLINT UNSIGNED NULL;
