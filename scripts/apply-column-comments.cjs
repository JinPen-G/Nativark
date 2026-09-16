/**
 * 为当前数据库字段补充 Navicat 可见的备注。
 *
 * 安全边界：
 * - 只处理字段备注为空的业务表，跳过 _prisma_migrations；
 * - 字段定义直接取 SHOW CREATE TABLE 的原文，只在末尾追加 COMMENT；
 * - 不凭脚本里的类型信息重建字段，避免误改类型、默认值、可空性或索引；
 * - 可重复执行，已有备注不会被覆盖。
 *
 * 用法：
 *   node scripts/apply-column-comments.cjs --dry-run
 *   node scripts/apply-column-comments.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function loadRootEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadRootEnv();

const commonLabels = {
  id: "记录主键 ID",
  tenantId: "所属租户 ID",
  workspaceId: "所属经营空间 ID",
  userId: "用户 ID",
  roleId: "角色 ID",
  organizationId: "组织单元 ID",
  customerId: "客户 ID",
  itemGroupId: "商品/资产型号 ID",
  pricingGroupId: "定价分组 ID",
  orderId: "订单 ID",
  orderLineId: "订单明细 ID",
  quoteId: "报价 ID",
  locationId: "履约地点 ID",
  assetId: "资产 ID",
  serviceId: "增值服务 ID",
  planId: "方案 ID",
  versionId: "版本 ID",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  deletedAt: "删除时间",
  publishedAt: "发布时间",
  effectiveFrom: "生效开始时间",
  effectiveTo: "生效结束时间",
  startAt: "开始时间",
  endAt: "结束时间",
  expiresAt: "过期时间",
  completedAt: "完成时间",
  cancelledAt: "取消时间",
  status: "状态",
  statusReason: "状态变更原因",
  statusChangedAt: "状态变更时间",
  statusChangedBy: "状态变更人",
  code: "编码",
  name: "名称",
  displayName: "显示名称",
  description: "说明",
  reason: "原因",
  changeReason: "变更原因",
  note: "备注",
  notes: "备注",
  amount: "金额",
  totalAmount: "总金额",
  payableAmount: "应付金额",
  finalPayableAmount: "最终应付金额",
  discountAmount: "优惠金额",
  couponAmount: "优惠券金额",
  depositAmount: "押金金额",
  preAuthAmount: "预授权金额",
  quantity: "数量",
  releasedQuantity: "已释放数量",
  unit: "计量单位",
  price: "价格",
  unitPrice: "单价",
  rate: "比例",
  taxRate: "税率",
  taxAmount: "税额",
  currency: "币种",
  version: "版本号",
  sequence: "顺序号",
  isActive: "是否启用",
  isDefault: "是否默认",
  enabled: "是否启用",
  passwordHash: "密码哈希，不存储明文密码",
  passwordUpdatedAt: "密码更新时间",
  loginPhone: "登录手机号，敏感字段",
  loginPhoneMasked: "脱敏登录手机号",
  phone: "手机号",
  phoneMasked: "脱敏手机号",
  email: "电子邮箱",
  metadata: "扩展元数据 JSON",
  attributes: "扩展属性 JSON",
  settings: "配置 JSON",
  config: "配置 JSON",
  snapshot: "业务快照 JSON",
  payload: "请求或事件载荷 JSON",
  createdBy: "创建人",
  updatedBy: "更新人",
  operator: "操作人",
  operatorId: "操作人 ID",
  source: "来源",
  sourceId: "来源 ID",
  sourceName: "来源名称"
};

const tableLabels = {
  Tenant: {
    id: "租户主键 ID",
    code: "租户编码",
    name: "租户名称",
    status: "租户状态"
  },
  User: {
    id: "运营账户主键 ID",
    tenantId: "所属租户 ID",
    account: "登录账号",
    displayName: "账户显示名称",
    phone: "账户手机号",
    isPlatformAdmin: "是否为租户平台管理员",
    isSaasAdmin: "是否为 SaaS 平台管理员",
    isActive: "账户是否启用",
    mustChangePassword: "是否必须修改密码",
    tokenVersion: "会话令牌版本"
  },
  business_workspaces: {
    id: "经营空间主键 ID",
    tenantId: "所属租户 ID",
    code: "经营空间编码",
    name: "经营空间名称",
    categoryCode: "经营品类编码",
    status: "经营空间状态",
    isDefault: "是否为默认空间",
    runMode: "运行模式"
  },
  workspace_members: {
    userId: "用户 ID",
    workspaceId: "经营空间 ID",
    roleId: "空间内角色 ID",
    dataScope: "空间内数据范围"
  },
  customer_profiles: {
    id: "会员主档主键 ID",
    tenantId: "所属租户 ID",
    customerType: "会员类型，个人或企业",
    name: "会员名称",
    identityNoMasked: "脱敏证件号码",
    identityVerified: "证件是否已核验",
    qualifications: "会员资质事实 JSON",
    status: "会员主档状态",
    sourceMemberId: "旧会员主档映射 ID",
    mergedIntoCustomerId: "合并目标会员 ID"
  },
  customer_accounts: {
    id: "会员账号主键 ID",
    customerId: "会员主档 ID",
    loginPhone: "会员登录手机号，敏感字段",
    loginPhoneMasked: "脱敏登录手机号",
    status: "会员账号状态",
    lastReason: "最近一次状态变更原因",
    lastOperator: "最近一次操作人",
    mustChangePassword: "是否必须修改密码"
  },
  customer_corporate_profiles: {
    customerId: "企业会员主档 ID",
    corporateName: "企业名称",
    corporateTaxNo: "企业税号或统一社会信用代码"
  },
  customer_corporate_memberships: {
    corporateCustomerId: "企业会员 ID",
    personalCustomerId: "个人会员 ID",
    role: "企业成员角色",
    status: "企业成员关系状态"
  },
  rental_category_definitions: {
    code: "品类编码",
    name: "品类名称",
    defaultCapabilities: "品类默认能力编码 JSON"
  },
  tenant_rental_profiles: {
    tenantId: "所属租户 ID",
    categoryCode: "租户默认租赁品类",
    settings: "租户租赁配置 JSON"
  },
  rental_item_groups: {
    id: "商品/资产型号主键 ID",
    tenantId: "所属租户 ID",
    workspaceId: "所属经营空间 ID",
    categoryCode: "品类编码",
    code: "商品/资产型号编码",
    name: "商品/资产型号名称",
    inventoryMode: "库存模式",
    unit: "计量单位",
    attributes: "型号扩展属性 JSON",
    status: "型号状态"
  },
  rental_assets: {
    id: "资产实例主键 ID",
    itemGroupId: "所属商品/资产型号 ID",
    assetNo: "资产编号",
    serialNo: "序列号或车架号",
    locationId: "当前履约地点 ID",
    workspaceId: "所属经营空间 ID",
    status: "资产状态",
    attributes: "资产扩展属性 JSON"
  },
  rental_pricing_groups: {
    id: "定价分组主键 ID",
    workspaceId: "所属经营空间 ID",
    categoryCode: "品类编码",
    code: "定价分组编码",
    name: "定价分组名称",
    defaultPricingUnit: "默认计价单位",
    status: "定价分组状态"
  },
  rental_pricing_group_members: {
    pricingGroupId: "定价分组 ID",
    itemGroupId: "商品/资产型号 ID",
    effectiveFrom: "归组生效时间",
    effectiveTo: "归组结束时间"
  },
  rental_price_versions: {
    id: "整体价格版本主键 ID",
    workspaceId: "所属经营空间 ID",
    sequence: "空间价格版本序号",
    effectiveFrom: "价格版本生效时间",
    rates: "全空间价格结果 JSON",
    changeReason: "调价原因",
    createdBy: "创建人"
  },
  rental_price_adjustment_plans: {
    id: "调价计划主键 ID",
    workspaceId: "所属经营空间 ID",
    planId: "基础定价计划 ID",
    status: "调价计划状态",
    changes: "价格变更明细 JSON",
    scheduledAt: "计划生效时间",
    resultVersionId: "执行后价格版本 ID",
    baseVersionId: "调价基于的价格版本 ID",
    finalRates: "执行后的价格结果 JSON",
    failureReason: "执行失败原因"
  },
  rental_orders: {
    id: "租赁订单主键 ID",
    orderNo: "订单编号",
    categoryCode: "租赁品类编码",
    status: "订单状态",
    customerType: "预约主体类型",
    customerId: "预约主体会员 ID",
    customerName: "预约主体名称快照",
    contactPhone: "订单联系手机号",
    fulfillmentLocationId: "领取地点 ID",
    returnLocationId: "归还地点 ID",
    startAt: "租赁开始时间",
    endAt: "计划归还时间",
    effectiveEndAt: "实际计费结束时间",
    rentalAmount: "租赁金额",
    serviceAmount: "增值服务金额",
    fulfillmentAmount: "履约费用",
    discountAmount: "优惠方案金额",
    couponAmount: "优惠券金额",
    depositAmount: "押金金额",
    preAuthAmount: "预授权金额",
    payableAmount: "优惠后应付金额",
    finalPayableAmount: "最终应付金额",
    quoteId: "来源报价 ID",
    priceVersionId: "价格版本 ID",
    pricingPlanVersion: "定价计划版本快照",
    ruleSnapshot: "计费规则快照 JSON",
    calendarSnapshot: "营业日历快照 JSON",
    membershipSnapshot: "会员权益快照 JSON",
    subjectSnapshot: "预约主体快照 JSON",
    chargeLines: "订单费用明细 JSON",
    serviceSnapshots: "增值服务快照 JSON",
    assignment: "商品分配结果 JSON"
  },
  rental_order_lines: {
    id: "订单明细主键 ID",
    orderId: "订单 ID",
    itemGroupId: "商品/资产型号 ID",
    pricingGroupId: "定价分组 ID",
    quantity: "预约数量",
    cancelledQuantity: "已取消数量",
    unitPrice: "计价单位单价",
    amount: "明细金额",
    itemGroupName: "商品/资产型号名称快照",
    pricingGroupName: "定价分组名称快照"
  },
  rental_quotes: {
    id: "报价主键 ID",
    quoteNo: "报价编号",
    request: "报价请求快照 JSON",
    chargeLines: "报价费用明细 JSON",
    rentalAmount: "租赁金额",
    discountAmount: "优惠方案金额",
    couponAmount: "优惠券金额",
    serviceAmount: "增值服务金额",
    depositAmount: "押金金额",
    preAuthAmount: "预授权金额",
    payableAmount: "应付金额",
    priceVersionId: "命中的价格版本 ID",
    rateSnapshot: "取价结果快照 JSON",
    discountEvaluations: "优惠方案评估快照 JSON",
    couponEvaluation: "优惠券评估快照 JSON",
    membershipSnapshot: "会员权益快照 JSON",
    expiresAt: "报价过期时间"
  },
  rental_reservations: {
    id: "库存预占主键 ID",
    orderId: "订单 ID",
    orderLineId: "订单明细 ID",
    itemGroupId: "商品/资产型号 ID",
    locationId: "库存地点 ID",
    quantity: "预占数量",
    releasedQuantity: "已释放数量",
    startAt: "预占开始时间",
    endAt: "预占结束时间",
    status: "预占状态",
    expiresAt: "预占过期时间"
  },
  rental_allocations: {
    id: "商品分配主键 ID",
    orderId: "订单 ID",
    orderLineId: "订单明细 ID",
    assetId: "分配资产 ID",
    assetNo: "分配资产编号快照",
    itemGroupId: "商品/资产型号 ID",
    quantity: "分配数量",
    status: "分配状态"
  },
  rental_business_calendars: {
    id: "营业日历主键 ID",
    workspaceId: "所属经营空间 ID",
    year: "营业年度",
    status: "日历版本状态",
    days: "年度营业日与时段 JSON",
    sourceVersionId: "官方来源版本 ID",
    sourceVersion: "来源版本号",
    publishedAt: "发布时间",
    changeReason: "日历变更原因",
    publishDiff: "发布差异 JSON"
  },
  rental_discount_plans: {
    id: "优惠方案主键 ID",
    workspaceId: "所属经营空间 ID",
    code: "优惠方案编码",
    name: "优惠方案名称",
    discountType: "优惠类型",
    discountValue: "优惠值",
    minimumSpend: "最低消费金额",
    maximumDiscount: "优惠金额上限",
    customerScope: "适用会员范围",
    applicableItemGroupIds: "适用商品型号 ID 列表 JSON",
    applicablePricingGroupIds: "适用定价分组 ID 列表 JSON",
    applicableDayTypes: "适用日期类型 JSON",
    exclusiveGroup: "互斥组",
    stackableWithOtherPlans: "是否可与其他优惠方案叠加"
  },
  rental_value_added_services: {
    id: "增值服务主键 ID",
    workspaceId: "所属经营空间 ID",
    code: "增值服务编码",
    name: "增值服务名称",
    serviceType: "服务类型",
    billingUnit: "计费单位",
    price: "服务单价",
    minimumQuantity: "最小数量",
    maximumQuantity: "最大数量",
    termsVersion: "服务条款版本",
    terms: "服务条款正文",
    status: "服务状态",
    selectionMode: "选择方式",
    mandatoryRule: "条件强制规则 JSON"
  }
};

const tokenLabels = {
  tenant: "租户",
  workspace: "经营空间",
  user: "用户",
  role: "角色",
  permission: "权限",
  organization: "组织",
  customer: "客户",
  member: "会员",
  corporate: "企业",
  personal: "个人",
  employee: "员工",
  item: "商品",
  group: "分组",
  asset: "资产",
  category: "品类",
  pricing: "定价",
  price: "价格",
  plan: "方案",
  quote: "报价",
  order: "订单",
  line: "明细",
  reservation: "预占",
  allocation: "分配",
  location: "地点",
  fulfillment: "履约",
  service: "服务",
  payment: "支付",
  refund: "退款",
  deposit: "押金",
  pre: "预",
  auth: "授权",
  coupon: "优惠券",
  discount: "优惠",
  benefit: "权益",
  calendar: "日历",
  rule: "规则",
  capability: "能力",
  qualification: "资质",
  status: "状态",
  reason: "原因",
  source: "来源",
  target: "目标",
  version: "版本",
  snapshot: "快照",
  audit: "审计",
  history: "历史",
  revision: "修订",
  file: "文件",
  upload: "上传",
  webhook: "回调",
  notification: "通知",
  location: "地点",
  amount: "金额",
  price: "价格",
  quantity: "数量",
  count: "数量",
  rate: "比例",
  type: "类型",
  mode: "方式",
  state: "状态",
  code: "编码",
  name: "名称",
  title: "标题",
  description: "说明",
  note: "备注",
  reason: "原因",
  phone: "手机号",
  email: "邮箱",
  password: "密码",
  token: "令牌",
  hash: "哈希",
  key: "键",
  url: "地址",
  data: "数据",
  value: "值",
  content: "内容",
  settings: "配置",
  config: "配置",
  metadata: "元数据",
  attributes: "属性",
  default: "默认",
  active: "启用",
  created: "创建",
  updated: "更新",
  published: "发布",
  started: "开始",
  ended: "结束",
  start: "开始",
  end: "结束",
  effective: "生效",
  expires: "过期",
  cancelled: "取消",
  completed: "完成",
  current: "当前",
  previous: "上一版本",
  next: "下一版本",
  old: "原",
  new: "新",
  legacy: "历史兼容",
  no: "无",
  show: "显示",
  display: "显示",
  publish: "发布",
  change: "变更",
  operator: "操作人",
  by: "人",
  at: "时间",
  from: "开始",
  to: "结束",
  limit: "上限",
  minimum: "最小",
  maximum: "最大",
  required: "必填",
  verified: "核验",
  locked: "锁定",
  released: "释放",
  reserved: "预留",
  used: "已用"
};

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/gu, "``")}\``;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function splitWords(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function translatedFieldName(column) {
  if (commonLabels[column]) return commonLabels[column];
  if (column.endsWith("Id")) {
    const base = column.slice(0, -2);
    return `${translatedFieldName(base)} ID`;
  }
  if (column.endsWith("At")) {
    const base = column.slice(0, -2);
    return `${translatedFieldName(base)}时间`;
  }
  if (column.endsWith("Amount")) {
    const base = column.slice(0, -6);
    return `${translatedFieldName(base)}金额`;
  }
  if (column.endsWith("Count")) {
    const base = column.slice(0, -5);
    return `${translatedFieldName(base)}数量`;
  }
  if (column.startsWith("is") && column.length > 2) {
    return `是否${translatedFieldName(column.slice(2, 3).toLowerCase() + column.slice(3))}`;
  }
  const words = splitWords(column);
  const translated = words.map((word) => tokenLabels[word] ?? word);
  return translated.join("");
}

function commentFor(tableName, tableComment, columnName) {
  const override = tableLabels[tableName]?.[columnName];
  if (override) return override;
  const translated = translatedFieldName(columnName);
  if (translated && !translated.split("").some((char) => /[A-Za-z]/u.test(char))) return translated;
  return `${tableComment || "业务表"}字段：${columnName}`;
}

function parseColumnDefinitions(createSql) {
  const definitions = new Map();
  for (const line of createSql.split(/\r?\n/u)) {
    const match = line.match(/^\s+`([^`]+)`\s+(.+)$/u);
    if (!match) continue;
    definitions.set(match[1], match[2].replace(/,\s*$/u, ""));
  }
  return definitions;
}

function createTableSql(row) {
  return row["Create Table"] || row["CREATE TABLE"] || Object.values(row)[1];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  let changed = 0;
  let skipped = 0;
  try {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT TABLE_NAME AS tableName, TABLE_COMMENT AS tableComment
      FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME <> '_prisma_migrations'
      ORDER BY TABLE_NAME
    `);

    for (const table of tables) {
      const tableName = String(table.tableName);
      const columns = await prisma.$queryRawUnsafe(`
        SELECT COLUMN_NAME AS columnName, COLUMN_COMMENT AS columnComment
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${quoteLiteral(tableName)}
        ORDER BY ORDINAL_POSITION
      `);
      const createRows = await prisma.$queryRawUnsafe(`SHOW CREATE TABLE ${quoteIdentifier(tableName)}`);
      const definitions = parseColumnDefinitions(createTableSql(createRows[0]));

      for (const column of columns) {
        if (String(column.columnComment ?? "").trim()) {
          skipped += 1;
          continue;
        }
        const columnName = String(column.columnName);
        const definition = definitions.get(columnName);
        if (!definition) throw new Error(`无法从 SHOW CREATE TABLE 读取 ${tableName}.${columnName} 的定义`);
        const comment = commentFor(tableName, String(table.tableComment ?? ""), columnName);
        const statement = `ALTER TABLE ${quoteIdentifier(tableName)} MODIFY COLUMN ${quoteIdentifier(columnName)} ${definition} COMMENT ${quoteLiteral(comment)}`;
        if (!dryRun) await prisma.$executeRawUnsafe(statement);
        changed += 1;
      }
    }
    console.log(`${dryRun ? "将处理" : "已处理"} ${changed} 个字段备注，跳过 ${skipped} 个已有备注字段。`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
