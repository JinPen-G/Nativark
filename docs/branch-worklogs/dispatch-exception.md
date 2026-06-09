# codex/dispatch-exception 调度与异常开发记录

## 本轮范围

- 分支：`codex/dispatch-exception`
- 日期：2026-06-08
- 依据：
  - `门市租赁调度边界与履约规则.md`
  - `智能调度派车规则.md`
  - `订单/订单改派.md`
  - `订单/事故出险处理.md`
  - 原型：`03_原型与页面/营运端/dispatch.html`、`order_detail.html`、`vehicles.html`

## 已实现切片

1. 车辆不可交付处理接口
   - 新增 `POST /api/store-rental/dispatch/vehicle-unavailable`
   - 入参支持 `orderId`、`vehicleId`、`plateNo`、不可交付原因、目标车辆营运状态、是否自动改派、备注和操作人。
   - 车辆状态可落为 `controlled`、`maintenance`、`disabled`；`disabled` 在 MySQL 下同步将车辆 `enabled=false`。

2. 后续订单释放与自动改派
   - 扫描同车辆后续未开始履约订单：`reserved`、`pickup_overdue`。
   - 对 `pending`、`pre_assigned`、`locked`：
     - 先使用同门市、同车组、无冲突候选池尝试自动改派。
     - 自动改派成功写入新车辆和调度事件。
     - 自动改派失败释放原车辆占用，订单进入 `dispatch_manual_required`。
   - 对 `manual_reassigned`、`upgraded`：
     - 不自动覆盖人工结果。
     - 写入“人工结果已失效 / 车辆不可交付”风险标记和调度事件，进入人工确认范围。

3. 事故登记联动
   - MySQL 分支下，订单事故登记且未结案时，复用车辆不可交付处理。
   - 事故车辆进入 `controlled`，并触发后续订单自动改派或人工队列。

4. AI 调度分析预留
   - 新增 `POST /api/store-rental/dispatch/ai-analysis`
   - 当前 MVP 不调用外部模型，只生成调度分析数据包摘要、风险行、推荐行，并写入 `DispatchEvent.payload`。
   - 记录 `promptVersion=rimo-store-dispatch-agent-v1`、`packetVersion=dispatch-packet-v1`、系统提示词、候选池和推荐摘要。

5. 营运端调度页面
   - 订单调度抽屉新增“车辆不可交付”入口。
   - 车辆排程抽屉新增“车辆不可交付处理”入口。
   - 新增车辆不可交付处理弹窗，支持原因、目标状态、自动改派开关、备注和处理结果明细。
   - AI 分析弹窗从静态展示改为调用后端预留接口，展示请求包摘要、风险诊断和推荐明细。

## 关键业务规则

- 本期不支持跨车行调度、跨车行转单、跨车行还车。
- 自动改派仍使用现有候选池：同门市、同车组、启用、非管控/维修/禁用、服务类型匹配、据点服务能力匹配、时间窗无冲突。
- 人工改派和免费升等属于人工结果保护，批量优化和车辆不可用自动处理不得直接覆盖。
- 车辆不可交付不会自动取消订单，失败后只进入人工调度队列。
- AI 只输出建议和日志，不直接写订单、车辆或排程；后续真实接入仍必须走 JSON Schema 校验、候选池约束和人工确认。

## 后续真实 AI 接入改造点

1. 在平台系统规则中读取租户 AI 模型配置、API Key、模型名称、超时和开关。
2. 在 `analyzeDispatchWithAi` 中将当前 `requestSummary/riskRows/recommendations` 扩展为完整调度数据包。
3. 外部模型返回必须先做 JSON Schema 校验，再校验推荐车辆是否来自系统候选池。
4. AI 推荐应用不得绕过 `applyDispatchOptimization` 或人工改派接口。
5. `DispatchEvent.payload` 保留请求摘要、提示词版本、模型返回摘要和校验结果；敏感信息不得入库。

## 待继续

- 异常关闭单独页面/列表还未拆出，当前仍通过订单详情终止/关闭动作处理。
- 调度告警关闭 `alert_closed` 事件已有类型但还没有单独关闭接口。
- 前端需要继续按 `dispatch.html` 原型微调视觉密度和字段顺序。
- 非 MySQL 内存数据源事故登记只更新车辆状态，没有自动调用异步后续订单处理；正式开发以 MySQL 为准。

## 2026-06-09 继续推进

### 已实现切片

1. OR-18 操作锁与幂等
   - 新增共享 DTO：`StoreRentalOrderOperationRecord`。
   - 新增 MySQL 表：`OrderOperationRecord`，并补 migration `20260609000100_add_order_operation_notification_records`。
   - 订单关键动作统一生成稳定请求摘要；同一订单、同一动作、同一幂等键或请求摘要命中已完成记录时，直接返回已保存结果。
   - `pickup-inspection`、`reject-order` 校验未过期取车操作锁；非持锁人默认不能提交，需显式 `overrideOperationLock=true`。
   - 内存数据源保留最近操作记录；MySQL 数据源通过 repository raw SQL 落库。

2. OR-22 客户通知留痕
   - 新增共享 DTO：`StoreRentalOrderNotificationRecord`。
   - 新增 MySQL 表：`OrderNotificationRecord`，记录事件、模板、渠道、目标号码快照、发送状态、关联动作和发送时间。
   - 支付、开始取车、取车完成、续租、改派、改还车、还车验车、结算、事故、取消、爽约、拒绝履约、关闭订单会生成 mock 短信通知留痕。
   - 通知记录会同步写入订单时间线，现有订单详情页可直接看到“客户通知：xxx（sms mock sent）”。
   - 新增查询接口：`GET /store-rental/orders/:id/operation-records`、`GET /store-rental/orders/:id/notifications`。

3. DP-04 调度任务池关闭
   - 新增共享 DTO：`StoreRentalDispatchCloseTaskRequest`、`StoreRentalDispatchTaskActionResult`。
   - 新增接口：`POST /store-rental/dispatch/tasks/close`。
   - 关闭任务写入 `alert_closed` 调度事件，payload 保存 `taskKey=orderId:taskType`。
   - 任务池实时派生时读取最近关闭事件并过滤对应任务。
   - 调度页任务卡片新增“关闭任务”入口，关闭说明必填。

### 验证

- `npm run build -w @rimo/shared`
- `npm run build -w @rimo/api`
- `npm run build -w @rimo/admin`
- `DATABASE_URL=... npx prisma validate --schema apps/api/prisma/schema.prisma`

### 待继续

- 通知中心还没有模板配置、失败重试、真实 provider 和发送回执。
- 下单通知、费用中心/资金流水接口幂等、支付/通知入站回调幂等还未覆盖。
- 调度任务池仍需补认领、处理中状态、关闭原因筛选和报表。
