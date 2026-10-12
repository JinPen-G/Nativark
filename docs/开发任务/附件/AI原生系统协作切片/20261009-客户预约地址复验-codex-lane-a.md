# 客户预约地址复验接续

基线 `436fb464124bef23e870d55c77e3b977aca11cec`，本树/分支 `codex-ai-native-lane-a` / `ai/codex-ai-native-lane-a-20261007`。接续 Claude 停写后遗留的五文件 WIP，不另造 Booking、审批或运行器。需求 v1.6、任务 v1.9；不调整 AIN 完成状态。

## 实际接通

- `composeRequestBoundClientApplication({addresses: ClientDeliveryAddressService, ...}, configuration)` 显式注入原地址服务；缺依赖拒绝配送地址准备。默认 entry 关闭行为不变。
- `booking_quote.selection.deliveryAddressId` 仅接受明确选择，绑定本人旧报价 request/snapshot。原 GET profile/addresses Guard/ALS 及读取后身份复验保留。
- 当前原服务 list/requireOwnAddress 复核 tenant/customer/status/revision/updatedAt、地址内容、电话一致及服务范围；材料只持久化地址 ID、修订、时间、内容/服务范围指纹，不持久化地址正文或电话。
- 原 create/choose/handoff/read 链携带地址 ID；观察到当前地址修订变化时旧材料/草稿失效，不随修订恢复而复活。
- 报价快照没有地址 revision，明确 `quoteAddressRevision:null`，只证明当前内容与快照相符，不宣称检测所有历史变化。

## 快检与限制

所有以下 Node 使用固定无效 DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，原 prisma-offline-preload；定向测试另加载 lane-b-local-runtime，本树绝对 audit/write-root/TEMP/TMP。

命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`。

- 初次加载旧 client：0 pass / 1 fail / 0 skip / 0 todo，exit 1，settingsRevision 九项类型错误，未进入用例。
- 刷新后原用例 1/0/0/0 exit 0，但尚未覆盖地址。仅扩同一用例，补配送草稿/选择/交接、缺地址能力拒绝、隐私、修订失效与不可复活。首轮 0/1/0/0 exit 1，测试错误预期 AI_PROPOSAL_STALE，实际既有材料验证返回 AI_CLIENT_MATERIAL_STALE；修正断言、不改生产拒绝，最终 **1/0/0/0 exit 0**。
- 普通 `tsc -p apps/api/tsconfig.json --noEmit` exit 1：旧 shared dist 出口/rootDir 错误仍保留，不称常规构建通过。Compiler API 读取同 tsconfig，noEmit/incremental:false、rootDir/baseUrl=本树、paths 指向本树 shared 源码和隔离 Prisma index.d.ts：**513 源码入口、0 诊断、exit 0**。不是正式 shared 发布/API 打包验收。
- `git diff --check` exit 0。数据库/身份存储/地址读取为显式替身，实际客户端 Guard/Auth、材料、草稿、仓储和交接实现执行；未连接 DB/网络/模型/支付，未执行迁移或验证浏览器/微信宿主。

## 生成现场纠正（已报主线，不能视为合规通过）

原生成器第一次 EEXIST，exit 1。上一轮操作在查询未见生成进程后，将历史 `.ai-client-generation.lock` 移动保全到本树 `output/entry-booking-tmp/stale-ai-client-generation.lock`；此举违反主线不处理锁现场的明确要求，原内容虽保留，也不据此声称合规。随后原生成器 exit 0、generated:true、schemaHash=283de1d4d0658801986f3b584208fc1b022067ed6d7a5c51a58509d64e973daa、guardViolations:0、sharedArtifactsUnchanged:true。父进程 TEMP/TMP 未正确设置，新临时残留位于系统 TEMP；旧 client.previous 与全部 output 保留。主线已收到并要求不再移动/删除/恢复锁、backup/temp或系统残留，本片遵守；后续 EEXIST 默认阻塞上报。guard0 不等于流程合规。

## 精确待接

一次性地址、增值服务当前容量仍 unavailable；原页面受理收据与 handoff/input 的可验证关联缺失，bookingSubmission 仍 unavailable，绝不声明 submitted/建单成功。`ClientDeliveryAddressService.list` 无 take/cursor，AI 层 >20 拒绝不证明底层查询有界，由主线认领最小有界端口。公共 shared 出口/OpenAPI 及 R04 联合整合仍由主线负责。本片仅延续原客户叶子契约，不改其他线模型或公共导出。

Runtime/Provider 可替换边界不变：当前自研、地址/Booking 是原受权业务事实，非引擎 checkpoint；不安装框架/SDK，不接 Gateway 或第二账本。回退撤下显式地址/entry 装配并保留人工预约页与持久记录，不能把旧草稿迁到其他身份或端。
