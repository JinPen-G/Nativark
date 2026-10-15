# CA09 原任务中心的业务上下文只读消费

基线5e4800b9c007a3232a457d17b4dca576260da4d1，A树/ai/codex-ai-native-lane-a-20261007。只改scenes/request-bound-scenes.application.ts及两份原测试；原task repository/event/list、runner/task-input/approval、Gateway/budget、shared/schema/Auth/UI均未修改，历史output和保全引用不动。

## 真实新增入口

`composeRequestBoundOriginalSceneModel(...).readTaskSnapshot(request, originalRef)` 与 `composeRequestBoundSelectedQuoteTask(...).readTaskSnapshot(request, originalRef)`。

只接受现有originalRequestReferenceSchema，当前请求credential由原bindRequests解析，scope/actor由既有Auth/Guard/ALS与原请求仓储复核。服务器根据原inputRef找当前受权taskId，再调用实际AiTaskEventRepository.readSnapshot（同事务task/steps/事件水位）。返回前复读原请求、任务run/revision、身份和contentHash；不接受调用者taskId/runId/lease，不创建任务/run或调模型，不推断审批或执行成功。

返回现有AiTaskSnapshotDraft原值，cursor保持字符串（包括9007199254740993）；不拼新事件、不跳水位。游标仅覆盖原仓储快照事务，不能声称和后来业务收据是原子快照。缺任务、修订不符或撤权拒绝，不补造版本和来源。

## 已有聚合直接复用，不计新增

- `composeAiTaskCenterScene.readScene`及原request-bound应用readTaskScene/readScene已连接原请求/恢复、持久snapshot、待澄清input、选定quote的review/decision/order、模型原result和来源。
- 原订单readResult只读原选择/操作收据，not_observed/unknown保留，任务SUCCEEDED或批准不能被当成Core committed；具体付款/履约不由任务状态推断。
- 原通知settings-business-consumer由prepare/change/proposal/currentdecision/原operation同源复验，task-center settings分支连接当前wait/snapshot/业务收据。缺通用配置执行不能借此授权。
- 没请求的可选业务引用保持not_requested；显式请求的无权reader拒绝整次返回，不偷偷返回旧敏感内容或泄漏数量/存在性。本片不放宽降级/权限政策。
- List沿原逐项read_metadata授权，event/reset沿原持久readPage；业务重连新接点只去snapshot。不另外造通用聚合、会话或任务状态机。

## 快检与未验

复用原两个ts-node transpileOnly:false用例，未新增测试脚本/忽略诊断。DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT=A树绝对路径；TEMP/TMP为本树output；AI_OFFLINE_AUDIT亦本树绝对文件；TS_NODE_CACHE=false、NODE_DISABLE_COMPILE_CACHE=1；双preload为prisma-offline-preload.cjs和lane-b-local-runtime.cjs。

首轮命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='request-bound model runs original scenes|selected quote task HTTP uses normal runner' tests/ai-native-lane-a-original-scene-host.test.cjs tests/ai-native-lane-a-human-quote-selection.test.cjs`；audit=output/ca09-original-snapshot-20261012.audit。pass1/fail1/skip0/todo0/cancelled0，exit1：模型三场景通过；报价新增断言误在Controller对象调用尚未发布的应用方法，TypeError，不能计产品红测。修正为实际requests.readTaskSnapshot，不添加Controller/共享路由。

失败项复验命令仅原quote文件、pattern=`selected quote task HTTP uses normal runner`，audit=output/ca09-selected-snapshot-final-20261012.audit：pass1/fail0/skip0/todo0/cancelled0，exit0，实际约145秒（含类型加载及原四种decision路径），不重复扩回归。复验覆盖待确认原snapshot、拒绝调用者runId、原场景aggregate的not_observed/unknown/committed收据以及只读记录不变；首轮模型用例通过覆盖三场景、9007199254740993游标、伪task字段拒绝、session撤权与lazy不启动。不同阶段结果不相加冒充全量。本片没有放宽断言、生产权限或超时设置。

源码依赖经ts-node实际类型编译，无独立全API noEmit/build，不声称全量类型通过。git diff --check exit0。独立提交只暂存三源码/测试文件及本记录，命令级core.hooksPath使用本树output/ai-native-no-hooks，避免未知hook读取env/启服务，不称常规hook通过。

尚未验真实HTTP/MySQL事务锁、模型/支付、部署/生产；原数据库/transport/账务边界仍离线替身。真实snapshot和授权服务执行不等于真库验收。新的应用snapshot HTTP发布需总线在AI_SCENE_MODEL_HTTP_DRAFT及AI_SELECTED_QUOTE_TASK_HTTP_DRAFT、原controller/OpenAPI/Guard统一冻结，不猜URL。本线已报精确方法/输入/输出。

Runtime可替换性：纯业务消费依赖原请求、持久snapshot/event和明确业务收据，未来Runtime checkpoint不能替代这些事实；替换Runtime后unknown仍只读原操作，旧状态不得跨引擎重新执行。Provider SDK不涉及本片，无新增模型/传输/计量链。仅显式模块装配，不启用生产。
