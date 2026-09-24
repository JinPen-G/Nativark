-- 租户级管理后台圆角配置：仅保存受服务层 8-20px 校验的基础控件圆角。
ALTER TABLE `client_channel_profiles`
  ADD COLUMN `adminCornerRadius` TINYINT UNSIGNED NULL;
