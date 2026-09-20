-- 客户端主题色：租户可自定义，未设置则客户端用系统默认蓝。
ALTER TABLE `client_channel_profiles`
  ADD COLUMN `themeColor` VARCHAR(16) NULL;
