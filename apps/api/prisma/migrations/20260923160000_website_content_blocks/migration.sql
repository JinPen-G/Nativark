-- WEBSITE-CHANNEL-05：官网首页内容块（卖点 / 租赁流程 / 用户评价）改为租户可编辑。
--
-- 三块此前是前端写死文案；改为存租户配置，缺省仍回落前端通用文案（评价缺省隐藏）。

ALTER TABLE `website_channel_profiles`
  ADD COLUMN `advantagesJson` JSON NULL,
  ADD COLUMN `stepsJson` JSON NULL,
  ADD COLUMN `testimonialsJson` JSON NULL;
