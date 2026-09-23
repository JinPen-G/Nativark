-- WEBSITE-CHANNEL-03：官网品类入口图（租户自定义）。
--
-- 官网首页的品类入口图/场景图此前由该品类首个商品图自动派生，租户无法自定义。
-- 新增 categoryImagesJson 存 [{ code, imageUrl }]，code 为经营空间/服务编码；
-- 官网优先用它，缺省再回落到商品图。Hero 大图仍复用既有 heroImageUrl，无需改列。

ALTER TABLE `website_channel_profiles`
  ADD COLUMN `categoryImagesJson` JSON NULL;
