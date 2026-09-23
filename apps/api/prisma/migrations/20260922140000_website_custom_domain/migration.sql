-- WEBSITE-CHANNEL-02：租户自定义官网域名 → 按 Host 反查租户。
--
-- 一套前端 + 一个后端端口服务多个租户。除子域名（a.rentalos.com）外，还要支持客户自带域名
-- （www.brand.com）：客户把域名 CNAME 到我方边缘，边缘按 SNI 发证并回源；后端据 Host 头
-- 反查这里绑定的 customDomain → 定位租户。全局唯一，避免一个域名指向两个租户。

ALTER TABLE `website_channel_profiles`
  ADD COLUMN `customDomain` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `website_channel_profiles_domain_key` (`customDomain`);
