ALTER TABLE `rental_order_extensions` ADD COLUMN `executionBasis` JSON NULL COMMENT '本次续租的品类政策与计价实现版本依据；NULL 表示历史无证据';
