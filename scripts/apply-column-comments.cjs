/**
 * 为当前数据库字段补充 Navicat 可见的备注。
 *
 * 安全边界：
 * - 默认只处理字段备注为空的业务表，跳过 _prisma_migrations；
 * - --repair-fallbacks 只修复本脚本生成的“字段：原字段名”兜底备注，不覆盖人工备注；
 * - 字段定义直接取 SHOW CREATE TABLE 的原文，只在末尾追加 COMMENT；
 * - 不凭脚本里的类型信息重建字段，避免误改类型、默认值、可空性或索引；
 * - 可重复执行，已有备注不会被覆盖。
 *
 * 用法：
 *   node scripts/apply-column-comments.cjs --dry-run
 *   node scripts/apply-column-comments.cjs
 *   node scripts/apply-column-comments.cjs --repair-fallbacks --dry-run
 *   node scripts/apply-column-comments.cjs --repair-fallbacks
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
  source: "来源",
  sourceId: "来源 ID",
  sourceName: "来源名称",
  businessId: "业务对象 ID",
  businessType: "业务对象类型",
  parentId: "上级记录 ID",
  fileAssetId: "文件资产 ID",
  rentalOrderId: "租赁订单 ID",
  subjectId: "业务主体 ID",
  entityId: "业务实体 ID",
  eventId: "外部事件 ID",
  batchId: "批次 ID",
  externalId: "外部记录 ID",
  localRecordId: "本地记录 ID",
  reviewId: "审核记录 ID",
  templateId: "模板 ID",
  registrationId: "注册记录 ID",
  registeredCustomerId: "注册生成的会员 ID",
  currentRevisionId: "当前资质修订 ID",
  boundVehicleId: "绑定车辆资产 ID",
  requestJson: "请求内容 JSON",
  responseJson: "响应内容 JSON",
  errorMessage: "错误信息",
  result: "处理结果",
  detail: "详细内容",
  details: "详细内容",
  filters: "筛选条件 JSON",
  changes: "变更明细 JSON",
  diff: "差异明细 JSON",
  before: "变更前内容 JSON",
  after: "变更后内容 JSON",
  days: "日历日期与时段 JSON",
  rates: "价格结果 JSON",
  telemetry: "设备遥测数据 JSON",
  feeBases: "能力费用依据 JSON",
  blockReasons: "阻断原因 JSON",
  notices: "提示信息 JSON",
  linkedTasks: "关联任务 JSON",
  resultVersionId: "执行结果价格版本 ID",
  sourceVersionId: "来源版本 ID",
  restoredFromVersionId: "恢复来源版本 ID",
  restoredFromVersion: "恢复来源版本号",
  fixedAllPermissions: "是否固定拥有全部权限",
  needsTenantOnboarding: "是否需要租户初始化",
  supportsIButton: "是否支持 iButton",
  stackableWithDiscountPlans: "是否可与优惠方案叠加",
  appVisible: "是否对客户端可见",
  failed: "是否失败",
  optional: "是否可选",
  defaultMarker: "默认标记",
  totalQuota: "总发放额度",
  claimedQuantity: "已领取数量",
  availableQuantity: "可用数量",
  redeemedQuantity: "已核销数量",
  totalBudget: "总预算金额",
  lockedBudget: "已锁定预算金额",
  redeemedBudget: "已核销预算金额",
  reservedAfter: "预留后余额",
  receivableAfter: "应收后余额",
  quantityDelta: "数量变更量",
  amountDelta: "金额变更量",
  balanceAfter: "变更后余额",
  sizeBytes: "文件大小（字节）",
  fileExt: "文件扩展名",
  mimeType: "文件 MIME 类型",
  storageKey: "对象存储键",
  publicUrl: "公开访问地址",
  checksum: "文件校验值",
  uploadScene: "上传场景",
  provider: "服务提供方",
  operation: "操作名称",
  businessModule: "业务模块",
  documentNo: "文档编号",
  documentType: "文档类型",
  templateCode: "模板编码",
  attempt: "当前尝试次数",
  maxAttempts: "最大尝试次数",
  scheduledAt: "计划执行时间",
  finishedAt: "完成时间",
  sentAt: "发送时间",
  nextAttemptAt: "下次尝试时间",
  lastAttemptAt: "最近尝试时间",
  lastLoginAt: "最近登录时间",
  passwordChangedAt: "密码变更时间",
  warrantyExpireAt: "保修到期时间",
  powerOnAt: "上电时间",
  lastHeartbeatAt: "最近心跳时间",
  refreshTokenHash: "刷新令牌哈希，不存储明文令牌",
  verificationTokenHash: "验证码令牌哈希，不存储明文令牌",
  currentWorkspaceId: "当前经营空间 ID",
  revokeReason: "撤销原因",
  releaseReason: "释放原因",
  failureReason: "失败原因",
  voidReason: "作废原因",
  closeReason: "关闭原因",
  terminatedReason: "终止原因",
  reviewReason: "审核原因",
  differenceDetail: "差异详情",
  differenceCodes: "差异代码列表 JSON",
  applicableItemGroupIds: "适用商品/资产型号 ID 列表 JSON",
  applicablePricingGroupIds: "适用定价分组 ID 列表 JSON",
  benefitReferenceIds: "权益引用 ID 列表 JSON",
  registrationResult: "注册结果 JSON",
  reviewStatus: "审核状态",
  statementStatus: "对账单状态",
  normalizedStatus: "标准化状态",
  localStatus: "本地状态",
  externalStatus: "外部状态",
  entryType: "流水类型",
  entryKind: "流水类别",
  operationType: "操作类型",
  action: "操作动作",
  point: "Hook 执行节点",
  decision: "Hook 决策结果",
  implementationVersion: "能力实现版本",
  subjectType: "业务主体类型",
  scopeKey: "限流范围键",
  bucketStart: "限流时间桶开始时间",
  identifierHash: "身份标识哈希",
  maskedDestination: "脱敏发送目标",
  deliveryMode: "发送方式",
  requestKey: "请求幂等键",
  idempotencyKey: "幂等键",
  idempotencyHash: "幂等键哈希",
  consumedAt: "消费时间",
  revokedAt: "撤销时间",
  lastUsedAt: "最近使用时间",
  issuedAt: "签发时间",
  importedAt: "导入时间",
  supersededAt: "被替代时间",
  voidedAt: "作废时间",
  voidedBy: "作废人",
  closedAt: "关闭时间",
  exitedAt: "退出时间",
  restrictedAt: "风险限制时间",
  suspendedAt: "暂停时间",
  registeredAt: "注册时间",
  occurredAt: "发生时间",
  appliedAt: "应用时间",
  reversedAt: "冲正时间",
  importedBy: "导入人",
  reviewedBy: "审核人",
  approvedBy: "审批人",
  requestedBy: "申请人",
  appliedBy: "执行人",
  disabledBy: "停用人",
  disabledAt: "停用时间",
  cleanupAttempts: "清理尝试次数",
  lastCleanupAt: "最近清理时间",
  cleanupError: "清理错误信息",
  reasonCode: "原因代码",
  failureCode: "失败代码",
  externalTransactionId: "外部交易 ID",
  paymentIntentId: "支付意图 ID",
  merchantOrderNo: "商户订单号",
  merchantRefundNo: "商户退款单号",
  externalRefundId: "外部退款 ID",
  fileRef: "文件引用",
  evidenceRef: "证明材料引用",
  referenceNoMasked: "脱敏证件/资质编号",
  agentIdNoMasked: "脱敏经办人证件号",
  agentPhoneMasked: "脱敏经办人手机号",
  contactPhoneMasked: "脱敏联系人手机号",
  unifiedSocialCreditCodeMasked: "脱敏统一社会信用代码",
  bankAccountMasked: "脱敏银行账号",
  recipientEncrypted: "加密接收地址",
  recipientFingerprint: "接收地址指纹",
  recipient: "接收地址",
  targetMasked: "脱敏发送目标",
  trigger: "触发事件",
  eventCode: "事件编码",
  channel: "通知渠道",
  channels: "通知渠道列表 JSON",
  variableSchema: "模板变量定义 JSON",
  variables: "模板变量 JSON",
  renderedTitle: "渲染后标题",
  renderedBody: "渲染后正文",
  providerMessageId: "服务商消息 ID",
  retryCount: "重试次数",
  nextRetryAt: "下次重试时间",
  totalRows: "总行数",
  matchedRows: "已匹配行数",
  differenceRows: "差异行数",
  acknowledgedRows: "已确认行数",
  rowNumber: "行号",
  kind: "记录类型",
  year: "年度",
  date: "日期",
  region: "地区",
  coverageLimit: "保障额度",
  deductible: "免赔额",
  requiresCapacity: "是否需要容量控制",
  applicableFulfillmentModes: "适用履约方式列表 JSON",
  applicableLocationIds: "适用履约地点 ID 列表 JSON",
  insuranceProviderStatus: "保险服务商状态",
  insuranceProviderName: "保险服务商名称",
  parentLocationId: "上级履约地点 ID",
  operatorId: "履约操作员 ID",
  assigneeId: "工单处理人 ID",
  assigneeName: "工单处理人名称快照",
  workNo: "工单编号",
  inspectionId: "检查记录 ID",
  dispositionId: "处置记录 ID",
  returnBatchKey: "归还批次键",
  dedupeKey: "去重键",
  bufferUntil: "缓冲结束时间",
  blockReason: "阻断原因",
  restoredQuantity: "已恢复数量",
  restoredAt: "恢复时间",
  restoredBy: "恢复人",
  onHandQuantity: "在库数量",
  maintenanceQuantity: "维护中数量",
  onHandBefore: "变更前在库数量",
  onHandAfter: "变更后在库数量",
  batchNo: "批次编号",
  sourceDocumentNo: "来源单据编号",
  operationId: "操作记录 ID",
  requestFingerprint: "请求指纹",
  sourceVersion: "来源版本号"
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

// 仅用于当前无法从字段名安全推导的业务专用字段；按表声明，避免同名字段在不同业务中的含义混淆。
const tableFieldLabels = {
  AsyncJob: {
    result: "任务执行结果 JSON"
  },
  DocumentPrintJob: {
    result: "文档打印结果 JSON"
  },
  OperationLog: {
    detail: "操作详情 JSON"
  },
  SystemParameterSet: {
    versionNo: "版本号",
    content: "参数内容 JSON"
  },
  customer_authorized_agents: {
    authorityScope: "授权范围 JSON",
    agentName: "经办人姓名",
    agentPhone: "经办人手机号",
    validFrom: "授权有效开始时间",
    validTo: "授权有效结束时间"
  },
  customer_membership_plan_versions: {
    eligibility: "会员资格条件 JSON",
    benefits: "会员权益 JSON",
    disableReason: "版本停用原因"
  },
  customer_qualification_revisions: {
    applicableScope: "资质适用范围 JSON"
  },
  rental_business_state_snapshots: {
    state: "业务状态快照 JSON"
  },
  rental_core_state_snapshots: {
    state: "核心状态快照 JSON"
  },

  rental_order_idempotency_records: {
    response: "幂等响应 JSON"
  },
  workspace_capability_audits: {
    configSnapshot: "能力配置快照 JSON"
  },
  FileAsset: {
    uploadedBy: "上传人 ID"
  },
  FilterPreset: {
    isSystem: "是否为系统预设"
  },
  Role: {
    enabledBusinessScopes: "启用的业务范围 JSON",
    buttonPermissions: "按钮权限 JSON"
  },
  client_registration_challenges: {
    codeHash: "验证码哈希",
    method: "注册验证方式",
    attempts: "已尝试次数"
  },
  customer_contacts: {
    relation: "联系人关系",
    linkedCustomerId: "关联会员主档 ID",
    isPrimary: "是否为主联系人"
  },
  customer_corporate_contracts: {
    contractNo: "企业合同编号"
  },
  customer_corporate_credit_ledger: {
    receivableDelta: "应收变更金额"
  },
  customer_corporate_credits: {
    settlementTermDays: "结算账期天数"
  },
  customer_corporate_memberships: {
    department: "企业成员所属部门",
    employeeNo: "员工编号"
  },
  customer_corporate_profiles: {
    legalRepName: "法定代表人姓名",
    legalRepPhoneMasked: "脱敏法定代表人手机号",
    unifiedSocialCreditCode: "统一社会信用代码"
  },
  customer_membership_qualification_types: {
    requiredForBooking: "是否为预约必需资质"
  },
  customer_merge_mappings: {
    approver: "合并审批人",
    fieldDiff: "字段差异 JSON",
    membershipSnapshot: "会员关系快照 JSON",
    mergedAt: "合并时间"
  },
  customer_risk_records: {
    riskType: "风险类型"
  },
  customer_sensitive_access_audits: {
    field: "被访问的敏感字段",
    revealed: "是否揭示了敏感内容"
  },
  customer_status_history: {
    approver: "审批人"
  },
  rental_asset_status_history: {
    assetNo: "资产编号"
  },
  payment_reconciliation_batches: {
    fileSha256: "对账文件 SHA-256 校验值"
  },
  payment_webhook_events: {
    payloadHash: "支付回调载荷哈希"
  },
  rental_attribute_unique_values: {
    fieldCode: "属性字段编码"
  },
  rental_benefit_accounts: {
    pointsBalance: "积分余额",
    marketingBalance: "营销余额",
    availableRewardCouponCount: "可用奖励券数量"
  },
  rental_bundle_components: {
    bundleItemGroupId: "套装商品型号 ID",
    componentItemGroupId: "组成商品型号 ID",
    substitutionGroup: "替代组"
  },
  rental_business_calendars: {
    overrideAudits: "日期覆盖审计记录 JSON",
    importPreservedOverrides: "导入时保留的日期覆盖 JSON"
  },
  rental_category_definitions: {
    supportedInventoryModes: "支持的库存模式 JSON",
    terminology: "品类术语配置 JSON",
    attributeSchema: "品类属性定义 JSON",
    businessModel: "业务模型 JSON"
  },
  rental_coupon_templates: {
    minimumSpend: "最低消费金额",
    perCustomerUseLimit: "每位会员使用上限",
    appliesTo: "适用费用范围"
  },
  rental_customer_coupons: {
    templateName: "优惠券模板名称快照",
    templateVersion: "优惠券模板版本快照",
    minimumSpend: "最低消费金额快照",
    grantReason: "发放原因",
    appliesTo: "适用费用范围快照"
  },
  rental_discount_plans: {
    priority: "优惠方案优先级",
    stackableWithCoupon: "是否可与优惠券叠加",
    appliesTo: "适用费用范围",
    thresholdAmount: "满额减免门槛金额"
  },
  rental_fulfillment_locations: {
    capabilities: "履约地点能力 JSON",
    businessHours: "履约地点营业时段 JSON"
  },
  rental_funding_events: {
    instrument: "资金工具",
    paymentMethod: "收款方式"
  },
  rental_inspection_records: {
    stage: "检查阶段",
    templateVersion: "检查模板版本快照",
    results: "检查结果 JSON",
    exceptions: "检查异常 JSON",
    attachments: "检查附件 JSON"
  },
  rental_inspection_templates: {
    stage: "检查阶段",
    fields: "检查字段定义 JSON"
  },
  rental_notification_logs: {
    templateVersion: "通知模板版本快照",
    attempts: "发送尝试次数",
    businessObjectId: "业务对象 ID",
    businessObjectType: "业务对象类型"
  },
  rental_notification_templates: {
    body: "通知模板正文",
    providerTemplateCode: "服务商模板编码"
  },
  rental_order_changes: {
    request: "变更请求 JSON",
    beforeSnapshot: "变更前快照 JSON",
    afterSnapshot: "变更后快照 JSON",
    additionalAmount: "变更追加金额",
    requestedAt: "申请时间"
  },
  rental_order_document_snapshots: {
    snapshotAt: "文档快照生成时间"
  },
  rental_order_extensions: {
    rateSnapshot: "取价结果快照 JSON",
    ruleSnapshot: "计费规则快照 JSON",
    calendarSnapshot: "营业日历快照 JSON",
    pricingSnapshot: "定价快照 JSON",
    originalEndAt: "原计划归还时间",
    billableUnits: "计费单位数量",
    memo: "续租备注",
    paidAt: "支付时间",
    serviceSnapshots: "增值服务快照 JSON"
  },
  rental_order_lines: {
    inventoryMode: "明细库存模式",
    pricingGroupMemberItemGroupIds: "定价分组成员商品型号 ID 列表 JSON"
  },
  rental_orders: {
    fulfillmentLocationSnapshot: "履约地点快照 JSON",
    returnLocationSnapshot: "归还地点快照 JSON",
    capabilitySnapshot: "能力快照 JSON",
    adjustmentAmount: "订单调整金额",
    cancellationReason: "订单取消原因",
    legacyDepositUnverified: "是否为历史未核验押金订单",
    legacyDepositUnverifiedAmount: "历史未核验押金金额",
    capabilityDecisions: "品类能力决策 JSON",
    capabilityExceptions: "品类能力例外 JSON",
    agentId: "经办人会员 ID",
    contractSubjectCustomerId: "合同主体会员 ID",
    payerSubjectCustomerId: "付款主体会员 ID",
    userSubjectCustomerId: "使用人会员 ID",
    membershipBenefitEvaluations: "会员权益评估 JSON",
    feeReviews: "费用复核记录 JSON",
    pickupOverdueAt: "领取逾期时间",
    noShowNoticeAt: "未到店通知时间",
    quoteNo: "报价编号",
    noShowAt: "未到店时间",
    noShowReason: "未到店原因",
    userSubjectCustomerId: "使用人会员 ID"
  },
  rental_payment_intents: {
    instrument: "支付工具",
    method: "支付方式",
    checkoutUrl: "支付收银台地址",
    paidAt: "支付完成时间"
  },
  rental_payment_refunds: {
    method: "退款方式",
    acceptedAt: "退款受理时间",
    succeededAt: "退款成功时间",
    fundedAt: "退款到账时间"
  },
  rental_price_adjustment_plans: {
    cancelReason: "调价计划取消原因",
    confirmedBy: "调价计划确认人",
    confirmedAt: "调价计划确认时间"
  },
  rental_pricing_group_members: {
    sortOrder: "归组排序号"
  },
  rental_pricing_plans: {
    fulfillmentFees: "履约费用 JSON"
  },
  rental_quotes: {
    appliedDiscountPlanIds: "已应用优惠方案 ID 列表 JSON",
    consumedOrderId: "已消费报价的订单 ID",
    receivableAmount: "应收金额",
    calendarWarnings: "营业日历提示 JSON",
    legacyDepositUnverified: "是否为历史未核验押金报价",
    legacyDepositUnverifiedAmount: "历史未核验押金金额",
    capabilityDecisions: "品类能力决策 JSON",
    ruleSnapshot: "计费规则快照 JSON",
    calendarSnapshot: "营业日历快照 JSON",
    capabilitySnapshot: "能力快照 JSON",
    serviceSnapshots: "增值服务快照 JSON",
    pricingContext: "取价上下文 JSON",
    membershipBenefitEvaluations: "会员权益评估 JSON"
  },
  rental_referrals: {
    inviteeCustomerId: "被邀请会员 ID",
    referrerCustomerId: "推荐人会员 ID"
  },
  rental_reward_ledger_entries: {
    rewardType: "奖励类型",
    triggerType: "触发类型",
    relatedCustomerId: "关联会员 ID"
  },
  rental_service_reservations: {
    confirmedAt: "服务预占确认时间"
  },
  rental_stock_dispositions: {
    receivedAt: "库存接收时间"
  },
  rental_value_added_service_versions: {
    snapshot: "增值服务版本快照 JSON",
    termsVersion: "服务条款版本号"
  },
  rental_work_orders: {
    attachments: "工单附件 JSON"
  },
  tenant_integration_configs: {
    credentialsEncrypted: "加密第三方凭据",
    secretFields: "敏感凭据字段名列表 JSON",
    lastTestStatus: "最近测试状态",
    lastTestMode: "最近测试模式",
    lastTestAt: "最近测试时间",
    lastTestError: "最近测试错误信息"
  },
  tenant_rental_profiles: {
    capabilities: "租赁能力配置 JSON",
    terminology: "租赁术语配置 JSON",
    initializedAt: "初始化时间"
  },
  workspace_capability_instances: {
    pausedAt: "能力暂停时间"
  }
};

// 首次生成时已经写入数据库的少量错误翻译。仅当现值精确匹配这些旧值时才允许修正，
// 不会把后续人工维护的备注当成自动生成内容覆盖。
const knownIncorrectComments = {
  "AsyncJob.result": ["处理结果"],
  "DocumentPrintJob.result": ["处理结果"],
  "OperationLog.detail": ["详细内容"],
  "SystemParameterSet.content": ["内容"],
  "customer_authorized_agents.authorityScope": ["授权范围"],
  "customer_authorized_agents.validFrom": ["有效开始"],
  "customer_authorized_agents.validTo": ["有效结束"],
  "client_registration_challenges.codeHash": ["编码哈希"],
  "payment_webhook_events.payloadHash": ["数据载荷 JSON哈希"],
  "rental_order_document_snapshots.snapshotAt": ["业务快照 JSON时间"],
  "customer_membership_plan_versions.eligibility": ["资格条件"],
  "customer_membership_plan_versions.benefits": ["权益"],
  "customer_qualification_revisions.applicableScope": ["适用范围"],
  "rental_business_state_snapshots.state": ["状态"],
  "rental_core_state_snapshots.state": ["状态"],
  "rental_category_definitions.businessModel": ["业务型号"],
  "rental_order_changes.request": ["请求"],
  "rental_order_changes.beforeSnapshot": ["前快照"],
  "rental_order_changes.afterSnapshot": ["后快照"],
  "rental_order_idempotency_records.response": ["响应"],
  "rental_order_extensions.rateSnapshot": ["比例快照"],
  "rental_order_extensions.ruleSnapshot": ["规则快照"],
  "rental_order_extensions.calendarSnapshot": ["日历快照"],
  "rental_order_extensions.pricingSnapshot": ["定价快照"],
  "rental_order_lines.pricingGroupMemberItemGroupIds": ["定价分组会员商品分组 ID 列表"],
  "rental_orders.fulfillmentLocationSnapshot": ["履约地点快照"],
  "rental_orders.returnLocationSnapshot": ["归还地点快照"],
  "rental_orders.capabilitySnapshot": ["能力快照"],
  "rental_quotes.ruleSnapshot": ["规则快照"],
  "rental_quotes.calendarSnapshot": ["日历快照"],
  "rental_quotes.capabilitySnapshot": ["能力快照"],
  "rental_value_added_service_versions.snapshot": ["业务快照 JSON"],
  "workspace_capability_audits.configSnapshot": ["配置快照"],
  "SystemParameterSet.versionNo": ["版本无"],
  "customer_corporate_memberships.employeeNo": ["员工无"],
  "rental_asset_status_history.assetNo": ["资产无"],
  "rental_orders.quoteNo": ["报价无"],
  "rental_orders.noShowAt": ["无显示时间"],
  "rental_orders.noShowReason": ["无显示原因"],
  "customer_corporate_profiles.unifiedSocialCreditCode": ["统一社会授信编码"],
  "rental_orders.userSubjectCustomerId": ["用户主体客户 ID"]
};

const tokenLabels = {
  async: "异步",
  job: "任务",
  document: "文档",
  external: "外部",
  local: "本地",
  rental: "租赁",
  json: "JSON",
  csv: "CSV",
  cid: "CID",
  sim: "SIM",
  mime: "MIME",
  sha: "SHA",
  tbox: "TBox",
  i: "I",
  button: "Button",
  html: "HTML",
  api: "API",
  uuid: "UUID",
  ip: "IP",
  ref: "引用",
  quota: "额度",
  per: "每",
  bucket: "时间桶",
  parent: "上级",
  idempotency: "幂等",
  retry: "重试",
  business: "业务",
  module: "模块",
  provider: "服务商",
  operation: "操作",
  request: "请求",
  response: "响应",
  error: "错误",
  message: "信息",
  attempt: "尝试",
  max: "最大",
  scheduled: "计划",
  finished: "完成",
  sent: "发送",
  signed: "签署",
  issued: "签发",
  submitted: "提交",
  reviewed: "审核",
  raised: "提出",
  closed: "关闭",
  exited: "退出",
  restricted: "风险限制",
  suspended: "暂停",
  registration: "注册",
  registered: "注册",
  event: "事件",
  processed: "处理",
  occurred: "发生",
  imported: "导入",
  warranty: "保修",
  expire: "到期",
  expired: "过期",
  power: "电源",
  heartbeat: "心跳",
  bound: "绑定",
  subject: "主体",
  review: "审核",
  batch: "批次",
  entity: "实体",
  claimed: "领取",
  redeemed: "核销",
  available: "可用",
  remaining: "剩余",
  total: "总",
  budget: "预算",
  locked: "锁定",
  unlocked: "解锁",
  revoked: "撤销",
  voided: "作废",
  terminated: "终止",
  failure: "失败",
  difference: "差异",
  normalized: "标准化",
  statement: "对账单",
  merchant: "商户",
  transaction: "交易",
  intent: "意图",
  internal: "内部",
  account: "账户",
  credit: "授信",
  settlement: "结算",
  billing: "账单",
  cycle: "周期",
  term: "期限",
  ledger: "流水",
  entry: "记录",
  balance: "余额",
  approved: "审批",
  marker: "标记",
  ext: "扩展名",
  storage: "存储",
  public: "公开",
  scene: "场景",
  telemetry: "遥测",
  firmware: "固件",
  app: "应用",
  model: "型号",
  vehicle: "车辆",
  plate: "车牌",
  serial: "序列",
  address: "地址",
  contact: "联系人",
  destination: "目标地址",
  target: "目标",
  scope: "范围",
  applicable: "适用",
  coverage: "保障",
  deductible: "免赔额",
  insured: "被保险",
  insurance: "保险",
  capacity: "容量",
  window: "时段",
  assignee: "处理人",
  disposition: "处置",
  inspection: "检查",
  work: "工单",
  return: "归还",
  restore: "恢复",
  buffer: "缓冲",
  hand: "在库",
  maintenance: "维护",
  before: "前",
  after: "后",
  delta: "变更量",
  fingerprint: "指纹",
  rows: "行数",
  row: "行号",
  region: "地区",
  industry: "行业",
  scale: "规模",
  legal: "法定",
  representative: "代表人",
  unified: "统一",
  social: "社会",
  tax: "税务",
  bank: "银行",
  invoice: "开票",
  receive: "接收",
  authority: "授权",
  valid: "有效",
  evidence: "证明材料",
  reference: "引用",
  first: "首次",
  personal: "个人",
  member: "会员",
  level: "等级",
  rank: "排序",
  recommended: "推荐",
  eligibility: "资格条件",
  benefits: "权益",
  assignment: "分配",
  granted: "授予",
  disabled: "停用",
  tenant: "租户",
  workspace: "经营空间",
  user: "用户",
  role: "角色",
  permission: "权限",
  organization: "组织",
  customer: "客户",
  corporate: "企业",
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
  version: "版本",
  snapshot: "快照",
  audit: "审计",
  history: "历史",
  revision: "修订",
  file: "文件",
  upload: "上传",
  webhook: "回调",
  notification: "通知",
  amount: "金额",
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
  no: "编号",
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
  if (column.endsWith("Ids")) {
    const base = column.slice(0, -3);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase} ID 列表` : undefined;
  }
  if (column.endsWith("Id")) {
    const base = column.slice(0, -2);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase} ID` : undefined;
  }
  if (column.endsWith("At")) {
    const base = column.slice(0, -2);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}时间` : undefined;
  }
  if (column.endsWith("Amount")) {
    const base = column.slice(0, -6);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}金额` : undefined;
  }
  if (column.endsWith("Price")) {
    const base = column.slice(0, -5);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}价格` : undefined;
  }
  if (column.endsWith("Rate")) {
    const base = column.slice(0, -4);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}比例` : undefined;
  }
  if (column.endsWith("Quantity")) {
    const base = column.slice(0, -8);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}数量` : undefined;
  }
  if (column.endsWith("Count")) {
    const base = column.slice(0, -5);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}数量` : undefined;
  }
  if (column.endsWith("No")) {
    const base = column.slice(0, -2);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}编号` : undefined;
  }
  if (column.endsWith("Hash")) {
    const base = column.slice(0, -4);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}哈希` : undefined;
  }
  if (column.endsWith("Json")) {
    const base = column.slice(0, -4);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase} JSON` : undefined;
  }
  if (column.endsWith("Url")) {
    const base = column.slice(0, -3);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}地址` : undefined;
  }
  if (column.endsWith("Ref")) {
    const base = column.slice(0, -3);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}引用` : undefined;
  }
  if (column.endsWith("Key")) {
    const base = column.slice(0, -3);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}键` : undefined;
  }
  if (column.endsWith("Bytes")) {
    const base = column.slice(0, -5);
    const translatedBase = translatedFieldName(base);
    return translatedBase ? `${translatedBase}字节数` : undefined;
  }
  for (const prefix of ["is", "has", "can", "should", "supports", "requires", "needs", "must", "allow"]) {
    if (column.startsWith(prefix) && column.length > prefix.length) {
      const base = column.slice(prefix.length);
      const normalizedBase = base.slice(0, 1).toLowerCase() + base.slice(1);
      const translatedBase = translatedFieldName(normalizedBase);
      return translatedBase ? `是否${translatedBase}` : undefined;
    }
  }
  const words = splitWords(column);
  if (!words.length || words.some((word) => !tokenLabels[word])) return undefined;
  const translated = words.map((word) => tokenLabels[word] ?? word);
  return translated.join("");
}

function commentFor(tableName, tableComment, columnName) {
  const override = tableFieldLabels[tableName]?.[columnName] || tableLabels[tableName]?.[columnName];
  if (override) return override;
  const translated = translatedFieldName(columnName);
  if (translated) return translated;
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
  const repairFallbacks = process.argv.includes("--repair-fallbacks");
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
        const existingComment = String(column.columnComment ?? "").trim();
        const isGeneratedFallback = existingComment.includes("字段：");
        const key = `${tableName}.${String(column.columnName)}`;
        const isKnownIncorrect = knownIncorrectComments[key]?.includes(existingComment) ?? false;
        if (existingComment && !(repairFallbacks && (isGeneratedFallback || isKnownIncorrect))) {
          skipped += 1;
          continue;
        }
        const columnName = String(column.columnName);
        const definition = definitions.get(columnName);
        if (!definition) throw new Error(`无法从 SHOW CREATE TABLE 读取 ${tableName}.${columnName} 的定义`);
        const comment = commentFor(tableName, String(table.tableComment ?? ""), columnName);
        if (comment === existingComment) {
          skipped += 1;
          continue;
        }
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
