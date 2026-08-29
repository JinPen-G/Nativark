-- PRICE-03 修正：把「一个空间一条 v1」的扁平回填换成真正的价格时间轴。
--
-- 20260829000200 的回填把一个空间全部启用计划的费率压成**一条** v1，effectiveFrom
-- 取最早的计划生效时刻。于是「2026-01-01 起 100 元、2026-06-01 起 200 元」会得到一条
-- effectiveFrom=2026-01-01、价格=200 的版本——1 至 5 月的租期按未来价格计费。
-- 这是金额正确性缺陷，不是展示问题，因此必须重建，而不是补一条说明。
--
-- 正确口径：**每个价格生效边界各一条版本，版本内容只含该时点已经生效的价格**。
--   边界 = 启用计划的 effectiveFrom ∪ 非空 effectiveTo（到期即价格下线，同样是边界）；
--   同一「商品 × 计价单位」在每个边界取 effectiveFrom 最晚且尚未到期的一条，
--   同刻并列以计划编码兜稳定序——结果不依赖 JSON 数组顺序；
--   草稿与停用计划完全不参与（它们不参与报价）；
--   某边界上全部价格都已到期时留一条空版本，表示「此时无有效价格」，
--   否则报价会退回上一条版本，继续按已经下线的价格计费。
--
-- 只重建「版本事实完全来自 000200 回填」的空间。已经有应用写入版本（发布、调价）的
-- 空间正在用新机制，重排它的序号会让已发出的版本号指向另一份内容，因此跳过。
--
-- 幂等：按 changeReason 标记判重；重复执行时目标空间已有时间轴版本，不再命中。
-- 安全性：DELETE 只删 000200 自己打了标记的回填行，不动任何应用写入的版本；
-- 两张 `_price03_*` 是本迁移自建自删的中间表。

DROP TABLE IF EXISTS `_price03_flat`;
DROP TABLE IF EXISTS `_price03_boundary`;

-- 1) 删除待重建空间的扁平回填行。
--    HAVING 判据：该空间除回填行之外没有任何其他版本行。
DELETE `v` FROM `rental_price_versions` `v`
JOIN (
  SELECT `tenantId`, `workspaceId`
  FROM `rental_price_versions`
  GROUP BY `tenantId`, `workspaceId`
  HAVING SUM(CASE WHEN `changeReason` = 'PRICE-03 存量版本回填' THEN 0 ELSE 1 END) = 0
) `t` ON `t`.`tenantId` = `v`.`tenantId` AND `t`.`workspaceId` = `v`.`workspaceId`
WHERE `v`.`changeReason` = 'PRICE-03 存量版本回填';

-- 2) 摊平启用计划的费率。只取「当前一条版本都没有」的空间：
--    上一步删掉回填行后，待重建空间的版本数为 0；已在用新机制的空间仍有行，天然被排除。
CREATE TABLE `_price03_flat` (
  `tenantId`    VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `planCode`    VARCHAR(191) NOT NULL,
  `fromAt`      DATETIME(3)  NOT NULL,
  `toAt`        DATETIME(3)  NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `unit`        VARCHAR(64)  NOT NULL,
  `rate`        JSON         NOT NULL,
  INDEX `_price03_flat_scope_idx` (`tenantId`, `workspaceId`, `itemGroupId`, `unit`, `fromAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_price03_flat`
  (`tenantId`, `workspaceId`, `planCode`, `fromAt`, `toAt`, `itemGroupId`, `unit`, `rate`)
SELECT
  `p`.`tenantId`, `p`.`workspaceId`, `p`.`code`,
  `p`.`effectiveFrom`,
  COALESCE(`p`.`effectiveTo`, TIMESTAMP '9999-12-31 00:00:00'),
  `jt`.`itemGroupId`, `jt`.`unit`, `jt`.`rate`
FROM `rental_pricing_plans` `p`
JOIN JSON_TABLE(`p`.`rates`, '$[*]' COLUMNS (
  `rate`        JSON         PATH '$',
  `itemGroupId` VARCHAR(191) PATH '$.itemGroupId',
  `unit`        VARCHAR(64)  PATH '$.unit'
)) `jt`
WHERE `p`.`status` = 'enabled'
  AND `jt`.`itemGroupId` IS NOT NULL
  AND `jt`.`unit` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `rental_price_versions` `v`
    WHERE `v`.`tenantId` = `p`.`tenantId` AND `v`.`workspaceId` = `p`.`workspaceId`
  );

-- 3) 价格边界：生效时刻与到期时刻各算一个。UNION 去重。
CREATE TABLE `_price03_boundary` (
  `tenantId`    VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `at`          DATETIME(3)  NOT NULL,
  INDEX `_price03_boundary_scope_idx` (`tenantId`, `workspaceId`, `at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_price03_boundary` (`tenantId`, `workspaceId`, `at`)
SELECT `tenantId`, `workspaceId`, `fromAt` FROM `_price03_flat`
UNION
SELECT `tenantId`, `workspaceId`, `toAt` FROM `_price03_flat`
WHERE `toAt` < TIMESTAMP '9999-12-31 00:00:00';

-- 4) 每个边界一条版本骨架，序号按时间升序（时间轴与序号同向）。
INSERT INTO `rental_price_versions`
  (`id`, `tenantId`, `workspaceId`, `sequence`, `effectiveFrom`, `rates`, `changeReason`, `createdBy`)
SELECT
  UUID(), `b`.`tenantId`, `b`.`workspaceId`,
  ROW_NUMBER() OVER (PARTITION BY `b`.`tenantId`, `b`.`workspaceId` ORDER BY `b`.`at`),
  `b`.`at`, JSON_ARRAY(), 'PRICE-03 存量价格时间轴回填', NULL
FROM `_price03_boundary` `b`;

-- 5) 填入每条版本在其生效时刻的完整有效价格（同键取生效最晚者）。
UPDATE `rental_price_versions` `v`
JOIN (
  SELECT `x`.`tenantId`, `x`.`workspaceId`, `x`.`at`, JSON_ARRAYAGG(`x`.`rate`) AS `rates`
  FROM (
    SELECT
      `b`.`tenantId`, `b`.`workspaceId`, `b`.`at`, `f`.`rate`,
      ROW_NUMBER() OVER (
        PARTITION BY `b`.`tenantId`, `b`.`workspaceId`, `b`.`at`, `f`.`itemGroupId`, `f`.`unit`
        ORDER BY `f`.`fromAt` DESC, `f`.`planCode` ASC
      ) AS `rn`
    FROM `_price03_boundary` `b`
    JOIN `_price03_flat` `f`
      ON `f`.`tenantId` = `b`.`tenantId` AND `f`.`workspaceId` = `b`.`workspaceId`
     AND `f`.`fromAt` <= `b`.`at` AND `f`.`toAt` > `b`.`at`
  ) `x`
  WHERE `x`.`rn` = 1
  GROUP BY `x`.`tenantId`, `x`.`workspaceId`, `x`.`at`
) `a`
  ON `a`.`tenantId` = `v`.`tenantId`
 AND `a`.`workspaceId` = `v`.`workspaceId`
 AND `a`.`at` = `v`.`effectiveFrom`
SET `v`.`rates` = `a`.`rates`
WHERE `v`.`changeReason` = 'PRICE-03 存量价格时间轴回填';

DROP TABLE IF EXISTS `_price03_flat`;
DROP TABLE IF EXISTS `_price03_boundary`;
