# CA04 原澄清报价→明确选择消费

只在 A 树施工。继承 628e8ac9 后合入固定 f8013d3a417d1e6f161209710e34b10c14913e24；不追主线活动 HEAD，不修改公共 runner/审批/选择仓储/Core/Gateway。新增源码仅 request-bound-scenes.application.ts 与 original-scenes.module.ts，tests/fixtures 不变。

## 实际方法与绑定

`composeRequestBoundClarifiedQuoteSelection(dependencies, options, business).select(request, selectionCommand, clarificationCommand)` 接两个已有命令形状：AiQuoteSelectionCreateDraft 与原 `{original, submission}` 澄清收据引用；不是新公共 DTO，也没有新 HTTP 路由。

`registerHttpQuoteFlow` 导出本地注入 token `AI_CLARIFIED_QUOTE_SELECTION_REQUESTS`，其 factory 构建此真实消费者。方法先严格解析/深拷贝已有选择命令、澄清引用及请求 Authorization；从实际持久模型请求根只读 `readClarifiedQuoteReceipt`，必须 observed + quoted + quote 存在；随后核对 originalInputRef、taskId、合法后继 runId 与真实原操作 quoteId，再调用原 PrismaQuoteSelectionRepository.select。

原仓储继续核查当前 Guard、Quote 与人类输入、期限/版本、后继 ancestry、CAS，并拒绝已有 plan/input 的 run。不能复用冻结模型 run，不能把模型填 ID 当人类选择，不运行后继、不审批、不建单；unknown/不存在的原报价拒绝且不创建第二份。

主线公共仓储原操作 request hash 修复由固定 f801 同步保留。正式 RentalBusinessFactRepository 三方法存在，本线不重造或写 Core。

## 快检与证据边界

- 本树原 offline preload/local-runtime，固定无效 DATABASE_URL、绝对 write-root/audit/TEMP/TMP。
- Compiler API 内联 noEmit 根 original-scenes.module.ts：首轮1诊断（可选 quote 未显式核验），加 quote 存在性拒绝后 **0 diagnostics / exit 0**。
- 直接内联既有实际 scene/module/provider + select：初轮命令误用 Core 报价行作为建单行，严格既有 schema 返回 INVALID_INPUT；按照原 AiQuoteSelectedOrderDraft 投影后复验 **exit 0**。不同 original 引用在写 selection 前 ACCESS_DENIED，selection/approval 无新增、模型发送0。原报价缺底层旧夹具方法仍 unavailable/unknown，原查收据仍拒绝，不伪称报价正向。
- `git diff --check`通过；没有新增/修改测试脚本或 fixtures，内联断言不按测试总数算专项进度。

尚未验证此方法 observed 原报价→真实 selection 正向，以及审批消费/Core 建单/提交应答不明全链。离线缺原操作完整数据库模拟，不用预填 artifact 冒充正式生产者；生产仓储代码已存在，不能报告成生产接口缺失。服务器可直接注入新 token；若需公开这个绑定更强的操作，必须由主线核验现有公共 Controller/契约如何承载，当前不私造地址。

## 接续

继续正式后继输入与原审批/建单收据的实际断点，再做通知设置原消费者与客户独立 Booking 链；已有三步订单解释直接复用。a8069a3f 音频无依赖，当前不为此同步或新增支持。原可替换 Runtime/Provider 边界不变：本方法只消费既有 Gateway/runner，SDK类型不出适配层。
