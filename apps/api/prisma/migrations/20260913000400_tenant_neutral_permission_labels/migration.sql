-- ACCESS-ACCEPT-01：权限目录属于多品类租赁平台，不应再显示旧门市租赁术语。
UPDATE `Permission`
SET `module` = '租赁业务'
WHERE `code` LIKE 'store-rental:%';

UPDATE `Permission`
SET
  `name` = CASE `code`
    WHEN 'store-rental:order:pickup' THEN '按钮-领取交付'
    WHEN 'store-rental:order:return' THEN '按钮-归还验收'
    WHEN 'store-rental:order:extend' THEN '按钮-延长租期'
    WHEN 'store-rental:station:view' THEN '履约地点查看'
    WHEN 'store-rental:station:manage' THEN '履约地点管理'
    WHEN 'store-rental:vehicle-group:manage' THEN '品类型号与分组管理'
    WHEN 'store-rental:vehicle:view' THEN '品类资产查看'
    WHEN 'store-rental:vehicle:manage' THEN '品类资产管理'
    WHEN 'store-rental:vehicle:status-action' THEN '按钮-品类资产状态动作'
    ELSE `name`
  END,
  `description` = CASE `code`
    WHEN 'store-rental:order:view' THEN '查看租赁订单列表和详情'
    WHEN 'store-rental:order:operate' THEN '新建租赁订单、领取检查和归还检查'
    WHEN 'store-rental:order:create' THEN '显示并执行新建租赁订单入口'
    WHEN 'store-rental:order:pickup' THEN '执行领取交付和确认开始履约'
    WHEN 'store-rental:order:return' THEN '执行归还验收和提交结算'
    WHEN 'store-rental:order:extend' THEN '执行延长租期和逾期补办续租'
    WHEN 'store-rental:vehicle:status-action' THEN '启停、维保、异常和状态处置'
    ELSE `description`
  END
WHERE `code` LIKE 'store-rental:%';
