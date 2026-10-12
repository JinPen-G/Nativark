# 客户预约人工办理材料消费

唯一树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007。保全已知 CA06 WIP 为 11fd3d16，安全合入固定 b852cb54015a6a5aef44315392ecf5274b33897c，合并点 9ace6eaef69cecfde4b913d5c2ec356f75f7327c。无冲突；固定基线已收录同一 CA06 实现，不重复计工作量。未跟踪 output 全部保留。

## 实际入口与功能

`composeRequestBoundClientApplication(...).readBookingPreparation(request, {handoffRef})` 直接接回现有客户应用，复用原 bookingOperation / 当前客户 Guard、ALS、发布空间、权益与政策复验。请求仅接受 handoffRef，身份和 scope 从服务器解析。新增内部消费方法，不注册新 HTTP 路由，不修改 shared DTO。

原 `composeClientBooking` 将 handoff 和对应 draft/material 从同一次当前受权核验返回：明确人类选择修订、inputFingerprint、quoteId、Core 金额/版本/有效期、各字段来源、目录/资格/可用性指纹。复用原 readHandoffMaterial 验证并冻结返回对象；宿主无需自行拼两次读取。原 readHandoff 合同保持不变。

配置、报价、库存观察、资格、地址或当前身份变化仍拒绝旧材料。名称/模型候选不是选择凭证；返回原 OPEN_BOOKING 受控代码和资源引用，没有任意 URL。无新预约、报价、预占、审批或业务提交。

提交能力明确 `unavailable_original_page_acceptance_receipt_missing`，库存 `not_reserved`，批准 `not_granted`。原 readBookingOperation 按同原键读取的是草稿操作，businessSubmission 仍 not_attested；unknown 不重发、不查最新订单。

## 快检结果

环境固定 DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT 本树，AI_OFFLINE_AUDIT 本树 output/ca-booking-preparation.audit / ca-booking-types.audit；TEMP/TMP 本树 output/entry-booking-tmp。

命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`。

1 pass / 0 fail / 0 skip / 0 todo / 0 cancelled，exit 0。扩充既有单个真实应用组合用例，没有新增测试脚本：正常材料/hand-off对应，明确修订，冻结数组，无凭据/伪造字段拒绝，当前可用性变化失效；既有原键重放和 COMMIT 应答丢失核对仍在同一用例验证。业务数据、持久事务与宿主为离线替身。

API TypeScript Compiler API 读取原 apps/api/tsconfig.json，noEmit、incremental:false、rootDir 本树；paths 指向本树 shared 源码和本树 Prisma 声明：525 roots / 0 diagnostics，exit 0。git diff --check：exit 0。不是部署构建/真实数据库验收。

同步后沿既有隔离脚本执行 `node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs scripts/ai-native-generate-local-prisma.cjs`：exit 0，generated true，guardViolations 0，sharedArtifactsUnchanged true；schemaHash d3ab0bc57f02f4e59d13e8c8f924d3be035f12a9a6acd07d65fefa1bc053b032。只生成本树私有 client，previous/tmp 保留。

## 主线精确依赖与剩余队列

原 ClientApiService.createOrder 使用原 idempotency header，但没有已交付的 handoffRef / bookingDraftId / selectionRevision / inputFingerprint / quoteId / customer / workspace 与该原键的受理关联；亦缺同原键的受权预约受理收据查询。需主线协调 Core/公共合同，并决定提交未知时的可信关联事实。A 不以草稿收据、订单列表最新项或原报价已保存证明 submitted。

已核对普通资料差异服务只准备 name，并经当前会员 reader/authority 复验；敏感字段拒绝，revision 未加载，submissionMaterial 明确 prepared_not_submitted。分区差异只支持已暴露的白名单，独立分区结果，不保存或发布。它们已有可调用入口，未重复包装；真正获准写入仍须主线给正式动作/版本/提案端口。订单解释最少问题、来源重新打开、人工材料也复用既有服务。

当前包可做的材料准备与重读已接通；原预约接受/提交/同键业务回读依赖尚未交付，已报主线。无真实 MySQL/HTTP/渠道/支付/模型/微信宿主/设备/生产验证，不宣称 AIN 整项完成。

Runtime 和 Provider SDK 类型未进入业务材料；以后各自替换编排或 Gateway 适配，保留本应用的身份、原键、材料/业务收据边界。回退可撤去新增内部方法消费，保留原 readBookingHandoff 和原人工页面。
