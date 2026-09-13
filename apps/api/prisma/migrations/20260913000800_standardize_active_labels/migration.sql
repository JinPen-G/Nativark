-- 收口当前有效配置中的历史业务标签；审计日志与已退役实体仍保持原始事实。

UPDATE `Role`
SET `description` = REPLACE(`description`, '维护门市租赁价格、规则和增值服务配置。', '维护租赁业务价格、规则和增值服务配置。')
WHERE `description` LIKE '%门市租赁%';

UPDATE `SystemParameterSet`
SET `content` = CAST(
  REPLACE(
    REPLACE(
      REPLACE(CAST(`content` AS CHAR), '门市订单主状态', '租赁订单主状态'),
      '按门市租车订单状态 PRD 维护主状态展示文案。',
      '按租赁订单状态规则维护主状态展示文案。'
    ),
    '门市订单号',
    '租赁订单号'
  )
  AS JSON
)
WHERE `status` = 'effective'
  AND (
    CAST(`content` AS CHAR) LIKE '%门市订单主状态%'
    OR CAST(`content` AS CHAR) LIKE '%按门市租车订单状态 PRD 维护主状态展示文案。%'
    OR CAST(`content` AS CHAR) LIKE '%门市订单号%'
  );
