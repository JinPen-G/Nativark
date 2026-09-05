-- 会员方案是否实际减免、减免多少及分摊到哪些租赁／服务行，都是报价与订单的历史事实。
-- 会员关系快照本身不足以在方案后来调整后还原这次报价，因此报价和订单各固化一份。
-- 历史报价／订单没有此事实，保持 NULL，不回填猜测。
ALTER TABLE `rental_quotes`
  ADD COLUMN `membershipBenefitEvaluations` JSON NULL;

ALTER TABLE `rental_orders`
  ADD COLUMN `membershipBenefitEvaluations` JSON NULL;
