-- 租户管理后台品牌扩展：浏览器图标与客户端品牌/Logo 分离保存。
ALTER TABLE `client_channel_profiles`
  ADD COLUMN `faviconUrl` VARCHAR(512) NULL;
