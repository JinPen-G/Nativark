-- No historical backfill: current templates cannot prove historical inspection requirements.
ALTER TABLE `rental_quotes` ADD COLUMN `inspectionTemplateSnapshots` JSON NULL COMMENT '报价时完整取还检查模板快照；NULL 表示历史无证据';
ALTER TABLE `rental_orders` ADD COLUMN `inspectionTemplateSnapshots` JSON NULL COMMENT '原样继承报价的完整取还检查模板快照；NULL 表示历史无证据';
