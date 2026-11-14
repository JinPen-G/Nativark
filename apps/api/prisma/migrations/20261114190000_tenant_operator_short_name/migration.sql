-- 独立后台简称；不回填旧名称，不改变租户编码、对客品牌或业务历史。
ALTER TABLE `Tenant`
  ADD COLUMN `operatorShortName` VARCHAR(64) NULL
  COMMENT '后台营运商简称，与完整公司名称及对客品牌分开保存';
