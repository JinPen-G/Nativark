# order-fulfillment 分支开发日志

## 本轮范围

- 目标：补齐门市租赁订单履约闭环的辅助记录底座，让订单动作不只改变状态，还能沉淀合同/单据、通知、备注跟进、操作锁和幂等记录。
- 依据：`订单取车.md`、`订单还车.md`、`订单详情.md`、`新建订单.md` 以及营运端 `order_detail.html`、`store_orders.html`、`new_order.html` 原型。
- 不做：工作台、分时租赁、H5/企业端真实页面、真实支付/短信/合同平台调用。

## 已完成

- Prisma/MySQL 增加订单履约辅助表：
  - `OrderContractDocument`
  - `OrderNotificationRecord`
  - `OrderRemarkRecord`
  - `OrderOperationLock`
  - `OrderIdempotencyRecord`
- 共享类型增加：
  - 合同/单据记录
  - 客户通知记录
  - 订单备注/跟进记录
  - 操作锁记录
  - 幂等记录
- 后端接口增加：
  - `GET /store-rental/orders/:id/fulfillment`
  - `POST /store-rental/orders/:id/contracts`
  - `POST /store-rental/orders/:id/notifications`
  - `POST /store-rental/orders/:id/remarks`
  - `POST /store-rental/orders/:id/operation-locks`
- 订单状态机动作补充自动留痕：
  - `start-pickup` 记录取车操作锁。
  - `pickup-inspection` 记录租赁合约、取车交接单、取车完成通知，并释放取车操作锁。
  - `return-inspection` 记录还车交接单，并记录还车操作锁释放。
  - `confirm-settlement` 记录还车结算单和还车完成/待补缴通知。
  - `cancel`、`mark-no-show`、`reject-order`、`close-order` 记录订单终止通知。
- 订单动作支持 `idempotencyKey`：
  - 重复提交同一订单、同一动作、同一 key 时，返回上次成功结果。
  - 幂等结果写入 MySQL，内存模式也可用。
- 订单详情页增加：
  - 合同与单据记录卡片。
  - 通知与备注跟进卡片。
  - 操作锁/幂等记录卡片。
  - 合同、通知、备注新增弹窗。

## 当前状态机边界

- 主状态流转仍沿用现有 `runOrderAction` / `runMysqlOrderAction`：
  - `pending_payment -> reserved`
  - `reserved/pickup_overdue -> inspecting`
  - `inspecting -> renting`
  - `renting/renewing/overdue/accident_processing -> settlement_pending`
  - `settlement_pending/payment_due/refund_pending -> completed/payment_due/refund_pending`
  - 终止动作进入 `cancelled/no_show/rejected/closed`
- 本轮没有重写费用计算、改派、续租、事故逻辑，只为动作结果补充可追溯记录。

## 接口依赖

- 定价分支需要继续保证订单创建时写入 `pricingSnapshot`、`marketingSnapshot`、`termsSnapshot`，本分支的单据 snapshot 会读取订单当前快照摘要。
- 车辆/调度分支需要继续保证 `plateNo`、`dispatchStatus`、车辆营运状态真实更新，取车/还车交接单会读取这些字段。
- 客户/财务分支需要继续补齐会员证件、企业月结、资金状态、发票/追缴；通知记录目前只做内部留痕，不调用真实短信或 App。

## 通用租赁平台改造点

- 可复用：合同/通知/备注/操作锁/幂等记录模型可直接用于摄影器材、露营装备等租赁品类。
- 需要改造：
  - `vehicleGroupName`、`plateNo`、取还车字段后续应抽象为 `assetGroupName`、`assetNo`、取还资产点位。
  - 取车/还车交接单中的里程、油量/电量、车损字段需要改成品类化检查项。
  - 合同标题和通知文案需要按品类配置，不应写死“车辆/取车/还车”。
  - 车辆营运状态联动应抽象成资产状态机。

## 未完成

- 取车向导仍是当前详情页快速动作口径，未完全复刻原型中的分步表单。
- 合同/通知为 MVP 留痕，未接真实合同平台、短信、Email、App 推送。
- 操作锁释放回退到 `reserved/pickup_overdue/no_show` 的完整规则还需继续实现。
- 还车结算快照已通过单据 snapshot 记录摘要，完整事件级快照链仍需继续补强。
## 第二轮：取还车向导、操作锁释放与事件级快照

本轮目标分支：`codex/order-fulfillment`。

开发依据：
- PRD：`门市租赁/订单/订单取车.md`
- PRD：`门市租赁/订单/订单还车.md`
- PRD：`门市租赁/订单/订单详情.md`
- PRD：`门市租赁/订单/费用管理.md`
- 原型：`03_原型与页面/营运端/order_detail.html`

新增内容：
- 订单详情页新增取车分步向导：身份与优惠资格核验、押金尾款、合约验车发车。
- 订单详情页新增还车分步向导：验车录入、费用结算、还车完成。
- 后端增强 `pickup-inspection`、`return-inspection`、`confirm-settlement` 的服务端校验和完整 payload 留痕。
- 新增 `release-operation-lock` 动作，支持释放取车操作锁、作废草稿，并按当前时间重新判定 `reserved`、`pickup_overdue` 或 `no_show`。
- 新增 `OrderEventSnapshot` MySQL 表，记录取车资格、取车资金、取车交付、还车验车、还车结算、结算确认和操作锁释放事件级快照。
- 订单详情页右侧新增事件级快照链展示，后续财务、报表、通用租赁改造可以直接读取。

通用租赁平台改造点：
- `OrderEventSnapshot.eventType` 目前按汽车租赁履约事件命名，迁移到摄影器材、露营器材时建议抽象为 `pickup_verification`、`pickup_deposit`、`asset_handover`、`return_inspection`、`settlement_confirmation`。
- 取还车向导中的“里程、油量/电量、车牌、驾照”属于汽车租赁字段，通用物品租赁可改为“资产编号、配件清单、外观等级、押金担保、归还数量/套件完整性”。
- 合同/通知仍为预留接入，本轮只保存日志和展示效果；后续替换为真实电子签、短信、App 推送时优先替换服务层 provider，不改订单状态机。

未完成项：
- 图片上传仍以数量和说明模拟，尚未接入真实附件中心。
- 外部支付、预授权、电子签、通知平台仍按 MVP 预留，不调用外部平台。
- 还车费用当前支持超时、损伤、清洁和减免切片；完整超里程、油电补差、异地还车差额仍需继续扩展规则计算。

## 第三轮：OR-15 合同与单据 MVP

本轮目标分支：`codex/order-fulfillment`。

开发依据：
- PRD：`门市租赁/订单/新建订单.md`
- PRD：`门市租赁/订单/订单取车.md`
- PRD：`门市租赁/订单/订单还车.md`
- PRD：`门市租赁/订单/费用管理.md`
- 原型：`03_原型与页面/营运端/official_vehicle_contracts.html`
- 原型：`03_原型与页面/营运端/order_detail.html`

新增内容：
- 新增营运端 `OfficialVehicleContractsView.vue` 和 `/contracts` 路由/菜单，按原型复刻统计、筛选、模板卡片、列表、新建和详情抽屉。
- 合同中心读取真实订单和 `OrderContractDocument` 记录，支持按订单生成租赁合约、取车交接单、还车交接单和还车结算单。
- 订单详情合同区补打印、下载和 mock 签署入口，与合同中心共用后端接口。
- 共享类型新增合同中心、合同模板、打印结果和 mock 签署结果 DTO；合同记录扩展模板码、打印状态、打印次数、下载地址和外部签署状态。
- 后端新增 `GET /store-rental/contracts`、`GET /store-rental/contracts/templates`、`POST /store-rental/contracts/:id/print-mock`、`POST /store-rental/contracts/:id/sign-mock`。
- MySQL 模式复用 `OrderContractDocument`，扩展字段写入 `payload` JSON；内存模式复用 `orderContracts` map。
- 打印、PDF、电子签真实 provider 保持预留，本轮自动跳过外部调用，并写入 `externalProvider=reserved`、`externalSignStatus=skipped`。

验证：
- `npm run build -w @store-rental/shared`
- `npm run build -w @store-rental/api`
- `npm run build -w @store-rental/admin`
- `$env:DATABASE_URL='mysql://root:password@localhost:3306/store_rental'; npm run db:validate`
- `npm run build`

未完成项：
- 租户可编辑合同模板尚未开发，当前模板为后端固定清单。
- 真实 PDF 生成、附件中心、打印服务和电子签 provider 尚未接入，本轮按要求 mock 跳过。
- 发票/收据、预授权凭证和合同审计报表仍需后续接入。

## 第四轮：OR-19 订单备注与跟进第一版

本轮目标分支：`codex/order-fulfillment`。

开发依据：
- PRD：`门市租赁/订单/订单详情.md`
- PRD：`门市租赁/订单/门市租车订单列表.md`
- 原型：`03_原型与页面/营运端/order_detail.html`
- 原型：`03_原型与页面/营运端/store_orders.html`

新增内容：
- 扩展共享 `StoreRentalOrderRemarkRecord`，补内部备注、客户备注、回访记录、履约跟进分类。
- 扩展 `OrderRemarkRecord` MySQL 表，新增提醒时间、责任人、关闭时间、关闭人和关闭说明字段，并新增查询索引。
- 后端新增 `PATCH /store-rental/orders/:id/remarks/:remarkId/close`，支持关闭待跟进记录；内存与 MySQL 模式保持一致。
- 订单详情“通知与跟进”区域展示全部备注/跟进记录，包含状态、责任人、记录人、跟进时间、提醒时间、关闭信息和关闭按钮。
- 备注弹窗支持内部备注、客户备注、回访记录、履约跟进、责任人、跟进时间和提醒时间，终态订单仍可新增备注但不改变订单主状态。

通用租赁平台改造点：
- `OrderRemarkRecord` 可抽象为订单级 `OrderFollowupRecord`，适用于摄影器材、露营装备等租赁品类。
- `category` 应保留为稳定 code；页面文案可按品类调整，不能把汽车租赁专有字段固化进备注主表。
- `reminderAt` 当前只落库和展示，后续接通知中心或定时任务时再触发站内信、短信或待办。

未完成项：
- 尚未开发独立跟进列表和跨订单待办视图。
- 提醒时间尚未接 `PF-12` 通知中心或 `PF-16` 定时作业。
- 跟进记录暂未接数据权限过滤、批量关闭和统计报表。
