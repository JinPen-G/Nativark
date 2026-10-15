# 员工原收据只读消费（Codex B，2026-10-10）

前置 `47dcdfec`，固定公共依赖仍 `b852cb54`。CB08/CB09 原失败事件→独立政策→影子/人工任务→原键人类操作收据已经实现并装配，见 `20261008-CB08-CB09-事件人类办理消费-codex-lane-b.md`；本片不重复事件、主体、任务或去重机制。

## 可调用链

`StaffInspectionRequestFactory.open(request).readCurrentReview(targetAndDraft, includeReceipt=false)`：

- 默认只读取上一片真实 `drafts.readReview`，原收据状态明确 not_requested，不创建执行入口。
- 显式 includeReceipt=true 使用新的 `submission.readReceipt` → 原 `OriginalInspectionApplication.reconcile` → 原受权 idempotency repository 查询。不同于原 submission.reconcile，此链不调用 finish、不写草稿链接、不产生新操作、不提交检查。
- 原收据查询保留已有 submit 动作/原 POST Guard 所需权限；没有正式较窄收据读取政策前不扩大到普通元数据 read。明确请求收据而无权限时整次拒绝，不把它伪装成正常纯草稿响应。
- 原 actionId/requestHash、目标、模板版本仍从持久草稿办理材料取得；不接受 caller 自报收据键/hash。返回后复验草稿 revision/状态与当前员工会话，期间变化拒绝混用。
- not_prepared、unavailable、not_observed 和 submitted 分开；缺收据不证明原业务未执行，retryable=false，不自动重发。manual_review_only 没有 order-wide 原提交能力。
- open 的私有 credentials、close 生命周期复用已有请求工厂。无 Controller/AppModule/worker 注册。

## 一次定向冒烟

沿用本树无效 DATABASE_URL、绝对 audit/temp 与离线 preload。

`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='employee review' tests/ai-native-inspection-media-submission.test.cjs`：1 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，退出码 0（筛选单项，不报整个文件全量通过）。实际请求工厂、Guard、草稿/原检查适配与原收据仓储，DB/原业务控制器为受控替身。

覆盖原提交成功且应答丢失后的读取、零新增业务调用/零草稿与operation写入、只读权限默认读取与显式收据拒绝、请求关闭，以及原收据缺失仍保持未知且不回写。

API 原严格选项 source-mapped noEmit：`inspection-assist.composition.ts` 根入口，1075 文件、0 诊断、退出码 0；未改 tsconfig/shared 生成物。diff --check 退出码 0。没有新测试脚本，不扩全仓回归。

## 待公共装配与未验

主线负责已认领识别 task 创建/服务/API，不修改其在途文件。实际会话、文件/模板资源、原检查 controller/receipt ports 需合法注入。本片不增加执行权限。更窄的只读员工原收据政策若需要，必须由主线明确，不自行定义权限码或解释 ACL。

未连接 DB/模型/文件存储/HTTP，未验 MySQL 锁/生产/微信设备。纯查询链不等于独立审查或 AIN 整项验收；多实例传播、正式后台主体和生产调度仍由原公共依赖提供。Runtime 与 Provider 替换独立，本片不安装框架、不换原操作键或模型引擎。
