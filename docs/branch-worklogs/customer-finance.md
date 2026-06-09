# customer-finance 分支开发记录

## 本轮范围

- 目标分支：`codex/customer-finance`
- 工作树：`D:\工作文件\RIMORental\.worktrees\customer-finance`
- 业务范围：个人会员、企业客户、客户等级、押金/预授权预留、发票/收据、手工调账、企业月结、财务对账。
- 本轮新增重点：营运端财务结算中心、财务 MySQL 表、财务 API、权限接入。

## 依据

- PRD：
  - `02_PRD与产品文档/PRD与方案/门市租赁/门市租赁端到端业务流程.md`
  - `02_PRD与产品文档/PRD与方案/门市租赁/订单/门市租车订单总索引.md`
  - `02_PRD与产品文档/PRD与方案/门市租赁/订单/费用管理.md`
  - `02_PRD与产品文档/PRD与方案/门市租赁/订单/门市租车订单状态.md`
- 原型：
  - `03_原型与页面/营运端/members.html`
  - `03_原型与页面/营运端/member_detail.html`
  - `03_原型与页面/营运端/member_review.html`
  - `03_原型与页面/营运端/membership_plans.html`
  - `03_原型与页面/营运端/corporates.html`
  - `03_原型与页面/营运端/corporate_detail.html`
  - `03_原型与页面/营运端/order_detail.html`

## 已实现

- `FinanceDocument`：发票/收据表，支持订单、会员、企业、月结账单快照字段。
- `FinanceManualAdjustment`：手工调账表，支持补收、退款、减免和客户自付/企业月结口径。
- `FinancePreAuthorization`：预授权/押金台账表，支持订单、会员、企业快照、冻结/扣款/释放金额、剩余额度、状态、支付渠道、授权码、渠道流水号和过期时间。
- 财务接口：
  - `GET /store-rental/finance/overview`
  - `GET /store-rental/finance/transactions`
  - `GET/POST/PUT /store-rental/finance/pre-authorizations`
  - `GET/POST/PUT /store-rental/finance/documents`
  - `GET/POST /store-rental/finance/manual-adjustments`
  - `POST /store-rental/finance/manual-adjustments/:id/process`
  - `GET /store-rental/finance/reconciliation`
- 调账入账规则：
  - 关联订单时生成订单费用项。
  - 企业月结调账生成 `monthly_bill` 交易，并写入企业月结账单线。
  - 客户自付补收/退款保留待处理费用，后续由订单费用中心或支付接入处理。
- 权限：
  - `store-rental:finance:view`
  - `store-rental:finance:manage`
  - `store-rental:finance:adjust`
  - `store-rental:finance:invoice`
  - `store-rental:finance:reconcile`
- 营运端页面：
  - 新增 `/finance` 财务结算页。
  - 左侧导航新增“财务中心 / 财务结算”。
  - 页面覆盖资金流水、预授权押金、企业月结、发票收据、手工调账、财务对账。

## 2026-06-09 本轮新增

- OR-16 预授权与押金台账第一版：
  - 新增 `FinancePreAuthorization` Prisma schema 与 migration `20260609000200_add_finance_pre_authorizations`。
  - 共享包新增 `FinancePreAuthorizationRow`、`SaveFinancePreAuthorizationRequest`、状态与渠道类型。
  - 后端新增 `/store-rental/finance/pre-authorizations` 列表/新增/更新接口。
  - MySQL 模式下显式台账落 `FinancePreAuthorization`；列表会从订单 `pre_auth_freeze/pre_auth_capture/pre_auth_release` 资金流水派生缺失台账，避免历史订单无台账展示。
  - 财务总览“预授权冻结”改为按台账剩余额度统计，显式台账优先于派生台账。
  - 财务结算页新增“预授权押金” Tab 和登记/编辑弹窗，覆盖订单、客户、状态、渠道、服务商、授权码、渠道流水、冻结/扣款/释放金额、过期时间和处理人。

- OR-17 发票与收据重开链路第一版：
  - 新增 migration `20260609000300_add_finance_document_reissue_links`，扩展 `FinanceDocument` 的 `relatedFeeIds`、原单/替换单据链路、作废原因/处理人、重开时间和审计轨迹字段。
  - 共享 DTO 新增 `FinanceDocumentAuditItem`，`FinanceDocumentRow` 和 `SaveFinanceDocumentRequest` 支持费用级关联、重开来源和作废留痕。
  - 后端内存模式和 MySQL repository 支持重开新单时自动把原单置为 `voided`，并写入 `replacementDocumentNo`、`voidReason`、`voidedBy` 和 `auditTrail`。
  - 财务结算页“发票收据” Tab 增加关联费用展示、原单/替换单链路、最近审计展示和“重开”操作；弹窗支持录入多个费用 ID、作废/重开原因和处理人。

## 客户等级字段

- 当前客户等级方案字段：
  - `code`
  - `name`
  - `tierRank`
  - `status`
  - `upgradeCondition`
  - `benefitSummary`
  - `orderDiscountPercent`
  - `depositDiscountPercent`
  - `freeServiceCount`
- 当前门市租赁口径下，等级主要影响租金折扣、押金折扣和增值服务权益。

## 企业客户与月结规则

- 个人订单和非月结企业身份订单仍走客户自付资金链路。
- 企业月结订单不发起客户支付、客户预授权和客户退款。
- 企业月结金额在还车结算、完成后追缴、手工补录时进入企业月结账单。
- 完成后追加费用按确认挂账时间进入对应月份账单，不回改已关闭账期。

## 通用租赁平台改造点

- 当前 `FinanceDocument`、`FinanceManualAdjustment` 和 `FinancePreAuthorization` 已避免直接绑定车辆字段，保留 `orderId/orderNo/memberId/corporateId` 等通用业务键。
- `FinanceManualAdjustment` 的 `category` 可从车辆租赁的 ETC、停车费、车损，迁移为摄影器材、露营器材等行业的损耗费、清洁费、遗失赔偿。
- `metadata.rentalObjectType` 当前写为 `vehicle`，后续通用化时应调整为可配置租赁物类型，例如 `camera_equipment`、`camping_gear`。
- 企业月结线当前仍展示 `vehicleGroupName/pickupStoreName/returnStoreName`，通用化时建议抽象为 `rentalObjectName/pickupLocationName/returnLocationName`，但本期不改订单和账单旧表字段，避免影响门市租赁 PRD 验收。
- 预授权当前已有显式台账和订单交易派生展示，外部支付仍只预留接入；后续通用化时应把押金规则从车辆规则迁到通用租赁规则域。

## 验证状态

- `npm install` 已在独立 worktree 成功。
- 2026-06-09 已运行：
  - `npm run db:generate`
  - `npm run build -w @rimo/shared`
  - `npm run build -w @rimo/api`
  - `npm run build -w @rimo/admin`
  - `$env:DATABASE_URL='mysql://root:password@localhost:3306/rimo_store_rental'; npx prisma validate --schema apps/api/prisma/schema.prisma`
  - `npm run build`
  - `git diff --check`
- 仍需在最终提交前运行：
  - `npm run db:validate`：本轮执行时被 Windows 沙箱进程权限拦截；按规则提权重试又因工作区审批额度不足被系统拒绝，需在审批恢复后补跑。
