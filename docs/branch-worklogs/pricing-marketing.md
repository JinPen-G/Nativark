# pricing-marketing 分支工作日志

## 本轮范围

- 严格按门市租赁 PRD 处理规则、定价、行销方案和报价快照。
- 不开发分时租赁，仅保留页面 Tab 位置。
- 用户 H5、企业端仍只预留接口；本轮落点为营运端和后端 API。
- 外部支付、节假日日历、优惠券、积分等先预留字段或提示，不做真实外部接入。

## 已完成切片

1. 标准价版本
   - `PricingPlanDetail` 增加 `currentVersionId`、历史版本、定时调价计划。
   - 动态调价页保存门市标准价后生成新 `PRICE-STORE-*` 版本。
   - 标准价按 PRD 作为车组统一日租金，不再用标准价自身拆平日/假日；平假日差异交给行销方案。

2. 行销方案
   - 新增 `MarketingPlanSummary/Detail`、规则行、历史版本、保存请求类型。
   - 后端新增门市行销方案列表、详情、新增、编辑接口。
   - 营运端新增 `MarketingView.vue`，按原型实现方案列表、行销日历、配置抽屉、历史版本弹窗；分时 Tab 仅占位。

3. 报价计算链路
   - 计算顺序：车组标准日租金 -> 增值服务 -> 门店/还车调整 -> 单一行销方案 -> 押金/预授权。
   - 个人/企业按 `customerType` 匹配不同可用行销方案。
   - 未指定行销方案时，后端按优先级降序、同优先级按优惠金额降序自动选择一个方案。
   - 明确传入不可用方案时，不自动换成其他方案，按标准价报价并返回告警。
   - 企业身份订单保留“不支持优惠券和积分”的提示。

4. 订单快照
   - 报价结果新增 `priceVersionId`、`marketingPlanVersionId`、`baseDailyAmount`、行销核验字段、分段解释和费用解释。
   - 创建订单时把行销方案版本、折扣、分段和解释写入 `marketingSnapshot`；历史订单不回查当前行销主数据。
   - 订单成功弹窗展示价格版本、行销版本、规则版本。
   - 新建订单页费用明细已展示 `explanationLines` 和 `billingSegments`，支持验证标准价、门店/还车调整、行销命中、每日平假日分段和优惠金额。

5. MySQL schema
   - 新增 `PriceAdjustmentSchedule`、`MarketingPlan`、`MarketingPlanVersion`、`MarketingRuleLine`、`PricingQuoteSnapshot`。
   - 现有 `StoreRentalOrder.marketingSnapshot` 已接入创建订单链路。

## 规则优先级

- 标准价版本：只作为新建订单和后续商业重定价事件的价格来源。
- 行销方案互斥：订单最终只能使用一个行销方案。
- 默认命中：未手动选择时，先按方案优先级，优先级相同再按优惠金额最大。
- 手动选择：如果手动选择 `none`，明确不使用方案；如果选择的方案不可用，不自动替换其他方案。
- 平假日：周五、周六、周日按假日段处理；后续法定节假日需要接系统通用参数日历。

## 快照字段

- `pricingVersion` / `priceVersionId`：下单时命中的标准价版本。
- `baseDailyAmount`：车组标准日租金。
- `marketingPlanId` / `marketingPlanVersionId` / `marketingPlanName`：命中的行销方案版本。
- `manualVerification` / `qualificationName` / `requiredDocText`：到店核验提示。
- `billingSegments`：按天拆分的平日/假日优惠解释。
- `explanationLines`：报价解释链路。

## 通用租赁平台改造提示

- 车辆维度替换点：
  - `vehicleGroupCode` 改为 `assetGroupCode` 或 `rentalItemGroupCode`。
  - `VehicleGroup` 价格行改成通用资产品类/规格组价格行。
  - 行销方案 `vehicleGroupCodes` 改成 `assetGroupCodes`。
  - 报价快照保留“主数据 ID + 展示快照”结构，不依赖当前资产名称。
- 可复用逻辑：
  - 标准价版本、行销方案版本、报价解释、订单快照链路可直接复用。
  - 到店核验可复用为“履约时人工资格核验”。
- 需要重做逻辑：
  - 库存占用算法需要从车辆时间窗改成对应资产/设备的库存模型。
  - 押金规则需要从车组押金改成品类押金或单品押金。
  - 平假日规则可保留，但按摄影器材/露营设备等业务可能需要改成“旺季/档期/节日”维度。

## 验证记录

- `npm run build -w @rimo/shared`：通过。
- `npx prisma validate --schema apps/api/prisma/schema.prisma`：通过，使用本地占位 `DATABASE_URL`。
- `npx prisma generate --schema apps/api/prisma/schema.prisma`：通过。
- `npm run build -w @rimo/api`：通过。
- `npm run build -w @rimo/admin`：通过。

## 2026-06-09 追加

- 沿用既有 `codex/pricing-marketing` 分支，没有新建分支。
- 已先将分支快进到 `origin/codex/integration/store-rental-mvp@508ebdd`，确保基于最新集成成果继续开发。
- 本轮补 `PR-05 报价快照解释` 的营运端展示：新建订单页费用明细增加报价命中说明、规则链金额和每日计费分段。
- 未完成：订单详情页仍需按 `order_detail.html` 展示下单时的完整报价快照；报价解释后续要继续支持系统参数里的法定节假日日历。

## 2026-06-09 追加二

- 主线程接管 `codex/pricing-marketing` 分支继续推进，没有新建分支。
- 对照 `动态调价策略（牌价&费率）.md`、`行销方案管理.md` 和 `pricing.html`，本轮补 `PR-03/PR-05` 的营运端验证入口：在动态调价策略页新增“门市调价试算”面板。
- 试算面板复用真实 `POST /store-rental/pricing/quote` 接口，不做静态假数据；支持选择车组、取还门市、取还时间、客户类型和结算方式。
- 试算结果展示报价号、计费天数、租金、优惠、押金/预授权、应付/入账金额、命中的 `priceVersionId`、`marketingPlanVersionId`、规则版本、费用项、报价解释链和日历分段。
- 该入口用于验证调价计划或手动改价后“只影响新订单、历史订单读取快照”的规则；真正的定时作业自动执行计划仍需后续接入后台 runner。
- 验证：`npm run build -w @rimo/shared`、`npm run db:generate`、`npm run build -w @rimo/api`、`npm run build -w @rimo/admin`、`git diff --check` 已通过；首次 API 构建因本 worktree Prisma Client 过旧失败，执行 `db:generate` 后通过。
