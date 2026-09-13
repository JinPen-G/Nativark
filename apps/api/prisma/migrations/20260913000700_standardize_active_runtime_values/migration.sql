-- 统一当前运行数据中的旧平台命名。
-- OperationLog 是不可篡改的审计历史，不在此迁移中改写；这里只处理仍会被运行时读取的权限与有效系统配置。

UPDATE `Permission`
SET `module` = '租赁业务'
WHERE `module` = '门市租赁';

UPDATE `Role`
SET `buttonPermissions` = CAST(
  REPLACE(CAST(`buttonPermissions` AS CHAR), 'store-rental:', 'rental-os:')
  AS JSON
)
WHERE `buttonPermissions` IS NOT NULL
  AND (
    CAST(`buttonPermissions` AS CHAR) LIKE '%store-rental:%'
    OR CAST(`buttonPermissions` AS CHAR) LIKE '%store_rental%'
  );

UPDATE `SystemParameterSet`
SET `content` = CAST(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(CAST(`content` AS CHAR), 'store-rental', 'rental-os'),
        'store_rental',
        'rental_os'
      ),
      'Store Rental Platform',
      'Rental OS'
    ),
    '门市租赁',
    '租赁业务'
  )
  AS JSON
)
WHERE `status` = 'effective'
  AND (
    CAST(`content` AS CHAR) LIKE '%store-rental%'
    OR CAST(`content` AS CHAR) LIKE '%store_rental%'
    OR CAST(`content` AS CHAR) LIKE '%Store Rental Platform%'
    OR CAST(`content` AS CHAR) LIKE '%门市租赁%'
  );
