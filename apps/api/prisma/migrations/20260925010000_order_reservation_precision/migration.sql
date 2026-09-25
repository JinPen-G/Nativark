ALTER TABLE `rental_order_lines`
  ADD COLUMN `reservationPrecision` VARCHAR(20) NOT NULL DEFAULT 'group'
  COMMENT '预约精度：group 按分组，exact_model 指定准确型号';
