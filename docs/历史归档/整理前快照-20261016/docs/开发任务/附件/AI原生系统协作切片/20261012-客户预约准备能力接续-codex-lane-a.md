# CA08 / AIN-21、AIN-22 客户预约准备能力接续

基线与归属：A树 `ai/codex-ai-native-lane-a-20261007`，HEAD `a63954aa48edde098a54188cf78474467f810782`。无 MERGE_HEAD；继承报价、shared、脚本与测试 WIP、未跟踪 output 全部保留。本轮不提交、不复制主线 WIP。

## 实际改动

- `scenes/client-request.application.ts`：`readBookingPreparation` 复用已存在的 Draft/hand-off 受权读取，按同一 Client 实例及 prepareOrderSubmission/readOrderSubmission/createOrder 三个真实端口呈现原预约办理能力。未装配保持 unavailable；只读准备不接受请求、不建单、不审批、不预占。`capabilities.bookingSubmission` 使用相同严格依赖判断，不因对象同实例但缺方法误报可用。
- `tests/ai-native-lane-a-original-scene-host.test.cjs`：只在继承测试的客户场景中增加本轮断言，未覆盖旧报价修改。正常完整端口与不完整端口分别验证；保持 not_submitted、not_granted、not_reserved、零订单写入和不可变输出。
- 未增加 HTTP/shared DTO、持久会话、worker、模型执行或第二条 booking 链。已有 accept/submit/readSubmission 及原操作键 Core 收据直接复用，未改写。

## 实际验证

环境：两次测试及源码检查均预加载 `prisma-offline-preload.cjs` 和 `lane-b-local-runtime.cjs`；DATABASE_URL 固定 `mysql://offline:offline@127.0.0.1:1/rental_os_offline`；AI_OFFLINE_WRITE_ROOT 为 A 树绝对路径；TEMP/TMP/AI_OFFLINE_AUDIT 在 A 树 `output/ca08-preparation-20261012`。

命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates through actual client Guard/Auth' tests/ai-native-lane-a-original-scene-host.test.cjs`。

- 正常严格加载：退出 1，pass 0 / fail 1 / skip 0 / todo 0；测试未执行，被继承 `quote-preview.service.ts:116,128` 的 TS2554 阻塞。
- 仅运行时证据：同命令显式设置 `TS_NODE_IGNORE_DIAGNOSTICS=2554`，退出 0，pass 1 / fail 0 / skip 0 / todo 0。只暂时不阻断已报告的 TS2554，不修改源码、测试加载器或类型门槛；不能作为类型通过或绿基线。涵盖既有客户 Guard/ALS、Draft 选择/交接、当前身份复核、原 booking 接受、同键丢应答收据恢复等实际逻辑，数据库/Core写边界仍为离线替身。
- TypeScript Compiler API：读取现有 API tsconfig（仅 JSON，不读取环境文件），以 noEmit/incremental:false、rootDir=A树、shared 源码及本树 Prisma 路径检查 548 个 API 根文件。退出 1，diagnostics 2，均为上述 quote-preview 的 execute 调用四参数/签名最多三参数；本轮新增文件无诊断。不称 `tsc` 或构建通过。

## 精确未接通项与主线交接

1. 客户材料 prepare 目前是显式 application 服务入口；现有 client-entry controller/shared HTTP 草案没有对应材料准备与 readBookingPreparation 路由。本线不猜协议、不另造公共 DTO；未来宿主材料生产接线由主线统一确认。
2. 两端现有 booking-host.factory 仅提供 readBookingHandoff；消费组件已有可选 acceptBookingSubmission/submitAcceptedBooking/readBookingSubmission，原 API 包装已存在，但 factory 尚未注入。UI 宿主不在本轮写入范围，已报主线，不复制一套宿主。
3. 报价 TS2554 冻结给主线处理：execute 调用增加 expectedAddressFingerprint，而继承方法签名未同步。不得以本轮忽略诊断的运行时结果宣称已修复。
4. submission 可用仅指已装配原业务端口，不是接受回执、业务成功或永久授权。原步骤仍须当前 Guard/对象版本复验和用户显式动作；unknown 只读原键，不创建第二单。

未运行真实 HTTP、MySQL锁/迁移、模型、支付、微信宿主/设备、浏览器及生产。作者离线行为不是 AIN 整项验收。旧报价 WIP/历史资源保持原样；本轮只留下可复核增量。

## 同包接续：原收据读取与政策隔离

主线要求继续原来源/原收据当前受权读取。原来源 `readSource` 已复用 Guard、发布 scope、原材料内容 hash、当前事实与读后复核，未复制 reader。原收据本轮接续：

- `loadAcceptance` 使用既有 AiClientTaskAuthority 的 `read` 动作而非创建政策；授权等待后重读同 scope 同 acceptanceRef 记录，变化返回 conflict。
- `readSubmission` 先快照原接受材料和真实业务收据，再复核同一原接受记录与当前读取政策指纹。撤权/政策变化拒绝返回；不重新消费报价、不创建第二单、不改付款/履约状态。
- 新提交前仍走既有 booking handoff 当前创建政策及原业务 Guard；重复提交/未知仅观察原键收据。新增 read 授权不是业务批准。

证据纠正：初次撤权探针误改了小程序政策（数组第0项），目标调用是 web（第1项），导致三次运行时探针 Missing expected rejection（每次0 pass/1 fail/退出1）。这些不能算有效产品红测，已向主线纠正。最终探针改为目标 web 读取政策，并使用既有真实 Client/Core receipt reader、仅替换原持久化查找边界，不扩展测试脚本。

后续增量的必要源码检查以 client-request.application.ts 为单一根入口，使用上述相同 noEmit/source paths 配置：退出1，仍为继承的2项 quote-preview TS2554，不称全局类型通过。diff check 退出0。

最终运行时复验：同一上述 test 命令，AI_OFFLINE_AUDIT 为 `output/ca08-preparation-20261012/receipt-web-policy-green.audit`，仍显式 TS_NODE_IGNORE_DIAGNOSTICS=2554；退出0，pass1/fail0/skip0/todo0。目标 web 权限在原业务收据读取期间撤销，返回拒绝且原写入数不变；测试 finally 恢复政策和查找替身。此为运行时证据，不覆盖冻结报价类型错误。未新增测试脚本、提交或生产启用。
