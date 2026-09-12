-- PRICE-03：补回迁移执行后才懒落库的价格计划。
--
-- 20260829000200 只能看到当时已经存在的 rental_pricing_plans；演示租户和新空间的
-- 默认价格是在应用首次访问时才写入，因此可能出现「有计划、无空间整体价格版本」。
-- 报价端必须继续对无版本 fail-closed，这里只补一条真正的不可变 v1。
--
-- 只处理没有任何空间版本的经营空间；同一商品 × 计价单位按最早生效时刻的计划取值，
-- 同刻按计划编码稳定排序，保证结果唯一且不把未来计划提前写进当前版本。
INSERT INTO `rental_price_versions`
  (`id`, `tenantId`, `workspaceId`, `sequence`, `effectiveFrom`, `rates`, `changeReason`, `createdBy`)
SELECT
  UUID(),
  d.`tenantId`,
  d.`workspaceId`,
  1,
  MIN(d.`planEffectiveFrom`),
  JSON_ARRAYAGG(d.`rate`),
  'PRICE-03 缺失初始版本回填',
  NULL
FROM (
  SELECT
    f.*,
    ROW_NUMBER() OVER (
      PARTITION BY f.`tenantId`, f.`workspaceId`, f.`itemGroupId`, f.`unit`
      ORDER BY f.`planEffectiveFrom` ASC, f.`planCode` DESC
    ) AS `rn`
  FROM (
    SELECT
      p.`tenantId`,
      p.`workspaceId`,
      p.`effectiveFrom` AS `planEffectiveFrom`,
      p.`code` AS `planCode`,
      jt.`rate`,
      jt.`itemGroupId`,
      jt.`unit`,
      MIN(p.`effectiveFrom`) OVER (PARTITION BY p.`tenantId`, p.`workspaceId`) AS `spaceFrom`
    FROM `rental_pricing_plans` p
    JOIN JSON_TABLE(p.`rates`, '$[*]' COLUMNS (
      `rate` JSON PATH '$',
      `itemGroupId` VARCHAR(191) PATH '$.itemGroupId',
      `unit` VARCHAR(64) PATH '$.unit'
    )) jt
    WHERE p.`status` = 'enabled'
      AND NOT EXISTS (
        SELECT 1
        FROM `rental_price_versions` v
        WHERE v.`tenantId` = p.`tenantId`
          AND v.`workspaceId` = p.`workspaceId`
      )
  ) f
) d
WHERE d.`planEffectiveFrom` = d.`spaceFrom`
  AND d.`rn` = 1
GROUP BY d.`tenantId`, d.`workspaceId`;
