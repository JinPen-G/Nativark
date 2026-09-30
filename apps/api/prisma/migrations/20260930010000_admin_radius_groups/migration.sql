-- 后台圆角拆分为三组独立配置：容器（卡片/弹窗/抽屉/表格）、按钮（分段/页签/选中菜单）、输入（录入控件）。
-- 均可空；留空时前端回退旧的统一字段 adminCornerRadius，观感不变。SMALLINT 以容纳极致圆角离散档 999。
ALTER TABLE `client_channel_profiles`
  ADD COLUMN `adminContainerRadius` SMALLINT UNSIGNED NULL,
  ADD COLUMN `adminButtonRadius` SMALLINT UNSIGNED NULL,
  ADD COLUMN `adminInputRadius` SMALLINT UNSIGNED NULL;
