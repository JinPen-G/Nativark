# Codex B：员工人工检查草稿消费（2026-10-10）

## 实际入口与功能

基于固定主线 `b852cb54` 及本线 `e94307b9`，不修改主线正在实现的 `inspection-recognition-task.application.ts`。

`StaffInspectionRequestFactory.open(request).drafts.readReview({orderId, allocationId, stage, templateId, draftId})` 通过原 Guard、当前请求会话、原冻结模板及 Prisma 草稿仓储读取人类审阅材料：

- 按字段对应当前人工值/决定、候选历史、所选候选来源、缺项和待核实标记；零与空值不混淆。
- 模板读取等待后再读取草稿，revision/状态/候选变化拒绝混合观察。资源或模板改变保留明确标记的历史人工值，不给历史字段拼新模板标签，不当作新资产事实。
- 不输出可直接执行的提交材料；已提交引导读原检查，`submission_unknown` 引导原提交核对。仍由已有 edit、prepare、submit/reconcile 走正式原检查接口与同一份 idempotency receipt；不写完成状态、责任、费用或资金。
- 新能力直接在已有 drafts 服务及 opt-in 模块内可调用，没有新增孤立类或 HTTP/页面注册。

修复 `open().recognitionTaskHost` 允许独立 credentials 的身份接线问题：现在强制使用本请求同一份私有 credentials，与附件/草稿读取同源。close 后保存的 credential source 也拒绝读取；不意味着远端任务已取消。

最小接入顺序：open → templates.read → drafts.create/readReview → 人类明确 drafts.edit → 原 operationId 的 drafts.reconcileOperation（不明时）→ submission.prepare/submit 或 reconcile → finally close。识别候选仅经现有 recognitionResults 读取/保存，不自动采用。主线负责正式识别 task 创建与 Gateway/model 装配。

## 定向快检

固定无效 DATABASE_URL、绝对本树 AI_OFFLINE_AUDIT/TEMP，预加载 `prisma-offline-preload.cjs` 与 `lane-b-local-runtime.cjs`。

`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-inspection-persistent-application.test.cjs tests/ai-native-inspection-media-submission.test.cjs`：20 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，退出码 0。

仅扩展两份已有测试，没有新测试脚本。覆盖真实 Guard/模板/附件流/草稿仓储、候选采用与拒绝、人工修改竞态、原操作查询、资源变化、请求关闭；沿用真实原检查适配器的同键竞争、已提交应答丢失、回写失败与无原收据 unknown 用例。

凭据传递用例仅在 runner 组合边界捕获参数；上游 Guard、模板、文件 bytes 与冻结输入为实际实现，不能称该用例证明完整 staff 模型执行。原有 image runner 组合用例仍独立驱动实际执行器，传输、数据库与财务预留为离线替身。

准备阶段失败保留：首次字段标签期望与合成模板不一致（7/1）；尝试将 operator 模型 harness 当 staff 会话被真实 Guard 拒绝（18/1，改为独立真实 staff 附件链的组合边界检查，不放宽 Guard）；close 为同步拒绝，最初误用异步断言（19/1，改正确同步断言）。最终上述两文件 20/0，不删除原失败语义或 skip/todo。

API 原严格选项 source-mapped noEmit：入口 `inspection-assist.composition.ts`，1075 文件、0 诊断、退出码 0；映射与本树私有 Prisma 沿用前片，未改 tsconfig/shared 生成物。`git diff --check` 退出码 0。

## 未验与公共接入边界

没有连接真实 DB/文件存储/模型，没有运行迁移或设备/生产验收；实际服务器会话、成员权限、订单/资源/模板、正式文件业务绑定、受控 bytes 及原检查 controller/receipts 必须由宿主提供。依赖缺失仍拒绝，不用候选当模型已验结果，不把客户端参数当授权。

当前 per-allocation 人工 review 不授予 order-wide 提交能力，复用既有 `manual_review_only`。持久草稿成功不等于检查提交或履约完成。本片不调整 AIN 完成率。
