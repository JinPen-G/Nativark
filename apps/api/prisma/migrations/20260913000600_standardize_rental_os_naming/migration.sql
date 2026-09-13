-- 统一 Rental OS 当前运行时命名。
-- 历史迁移文件保持不可变；本迁移只转换仍在运行数据中的旧命名。

-- 先使用临时前缀，避免 Permission.code 唯一键在新旧权限同时存在时冲突。
UPDATE `Permission`
SET `code` = CONCAT('rental-os-rename:', SUBSTRING(`code`, CHAR_LENGTH('store-rental:') + 1))
WHERE `code` LIKE 'store-rental:%';

UPDATE `Permission`
SET `code` = CONCAT('rental-os:', SUBSTRING(`code`, CHAR_LENGTH('rental-os-rename:') + 1))
WHERE `code` LIKE 'rental-os-rename:%';

UPDATE `FilterPreset`
SET `scopeKey` = REPLACE(`scopeKey`, 'store-rental.', 'rental-os.')
WHERE `scopeKey` LIKE 'store-rental.%';

UPDATE `FileAsset`
SET `businessModule` = 'rental-os'
WHERE `businessModule` = 'store-rental';

UPDATE `FileAsset`
SET `businessType` = 'rental_order'
WHERE `businessType` = 'store_rental_order';

UPDATE `NotificationSendLog`
SET `businessType` = 'rental_order'
WHERE `businessType` = 'store_rental_order';

UPDATE `ExternalAdapterLog`
SET `businessType` = 'rental_order'
WHERE `businessType` = 'store_rental_order';

UPDATE `AsyncJob`
SET `businessType` = 'rental_order'
WHERE `businessType` = 'store_rental_order';

UPDATE `DocumentPrintJob`
SET `businessType` = 'rental_order'
WHERE `businessType` = 'store_rental_order';
