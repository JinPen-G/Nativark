# Rental 支付对账

本模块提供对账批次列表、批次明细、CSV 导入和差异处理。两个页面入口消费相同正文，页头与返回操作通过 Core 声明接入原后台外壳，表格、筛选、详情布局、上传和保存反馈复用公共组件。[页面贡献](index.tsx) · [页面声明](pages.ts) · [页面正文](PaymentReconciliationPage.tsx)

## 页面接入

1. 使用已验证的 Rental 会话、实时会话读取器、查询范围和 `AdminRuntime` 创建上下文。请求前后核对同一账号、租户、经营空间、会话代次和财务权限，查询取消信号交给原传输。[上下文工厂](page-context.tsx) · [四请求客户端](client.ts)
2. 将上下文钩子传给 `createRentalPaymentReconciliationAdminContribution`，与其他 Rental 页面合入同一贡献。列表与详情声明共用 `finance:reconcile`，旧宿主沿用 `rental-os:finance:reconcile`。[贡献工厂](index.tsx) · [准入与父级](pages.ts)
3. 将 `rentalPaymentReconciliationMessages` 并入宿主同一语言目录。批次标题、原处理原因、币种和差异代码继续从服务端返回值展示。[语言资源](messages.ts)

列表与详情分别登记 `/payment-reconciliation` 和 `/payment-reconciliation/:batchId`。旧宿主保留 `/rental/payment-reconciliation` 及原批次深链接，将已匹配的 `batchId` 传入 `CorePageHost.params`。页面跳转经 `CorePageLocation` 定位受权登记目标，详情继承列表菜单和面包屑父级。[位置映射](pages.ts) · [旧宿主上下文](../../../../apps/admin/src/features/settings/legacy-payment-reconciliation-context.tsx) · [旧页面入口](../../../../apps/admin/src/features/settings/PaymentReconciliationPage.tsx)

## 请求与业务依据

| 客户端方法 | 原 HTTP | 职责 |
| --- | --- | --- |
| `paymentStatementBatches` | `GET /rental/v1/payment-reconciliation/statements` | 读取当前经营空间的批次，默认 `limit=50` |
| `paymentStatementBatch` | `GET /rental/v1/payment-reconciliation/statements/:batchId` | 读取指定批次及明细 |
| `importPaymentStatement` | `POST /rental/v1/payment-reconciliation/statements` | 以原 `provider`、`file` 两个 FormData 字段导入 CSV |
| `reviewPaymentStatementLine` | `POST /rental/v1/payment-reconciliation/statements/:batchId/lines/:lineId/review` | 保存 `acknowledge` 或 `query_provider` 及原处理原因 |

Controller 从原身份和经营空间权威取得租户与空间，交给同源对账应用执行。金额、币种、匹配与差异事实沿原服务读取，支付、退款、资金和供应商 unknown 沿原业务依据处理。[请求实现](client.ts) · [HTTP 入口](../../src/http-payment-reconciliation.controller.ts) · [对账应用](../../src/mysql-payment-reconciliation-file.ts) · [请求与返回契约](../../src/payment-contracts.ts)

## 表单与异步行为

CSV 选择保持原单文件、非空、扩展名及 10MB 上限。开始导入时固定文件和支付平台，整个请求期间保留当前选择并限制关闭与重复提交，失败保留文件和原错误展示，当前范围内成功后打开返回的批次。[导入与文件状态](PaymentReconciliationPage.tsx) · [原样式](PaymentReconciliation.module.css)

差异处理原因沿原 Form 校验，必填、排除纯空白、最多 500 字符。保存按钮与原生回车共用现有编辑驱动的校验和真实提交 Promise。每次打开固定当前批次、明细、处理方式及编辑代次，提交期间保留该对象，关闭重开、批次切换或权限变化后的旧校验和响应按原对象边界退出。[差异表单](PaymentReconciliationPage.tsx) · [既有编辑驱动](../orders/useOrderEditor.ts)

## 验证入口

既有文件对账用例覆盖原导入、匹配、差异处理和支付事实边界。页面请求载荷、深链接、会话与范围变化、失败文件保留及异步表单提交按直接消费者定向核对，类型、离线行为与真实宿主证据分别记录。[文件对账用例](../../../../tests/payment-reconciliation-file.test.cjs) · [原支付对账用例](../../../../tests/payment-reconciliation.test.cjs) · [页面实现](PaymentReconciliationPage.tsx)
