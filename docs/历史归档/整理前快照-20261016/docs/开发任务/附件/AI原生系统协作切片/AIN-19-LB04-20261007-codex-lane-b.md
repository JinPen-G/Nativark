# AIN-19 LB04：候选快照竞态修复与接续点

接续 HEAD 为 27c729a1；分支 ai/codex-ai-native-lane-b-20261007，无 MERGE_HEAD。保留此前 Knowledge module WIP，未附带提交或清理 output。

## 实现与红绿证据

实际 InspectionCandidateService.consume 中 z.unknown 保留调用者对象引用，在模板/身份授权 await 后才复制候选。定向用例在实际 Core 读取替身的受控回调中将 42 改为 99，修复前实际服务返回 99：5 pass / 1 fail / 0 skip / 0 todo，退出码 1。

现改为首次 await 前对所有候选完成共享 schema 验证与深复制，后续授权/evidence 检查只消费分离快照。没有降低验证、扩大权限或新增持久假结果。

命令：node --test tests/ai-native-inspection-assist-template.test.cjs。
DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline。
NODE_OPTIONS 为本树 tests/fixtures/ai-native/prisma-offline-preload.cjs 与 lane-b-local-runtime.cjs 的绝对预加载路径。
AI_OFFLINE_AUDIT 为本树 output/inspection-lb04-audit 绝对路径。
修复后 6 pass / 0 fail / 0 skip / 0 todo，退出码 0。实际 ts-node transpileOnly:false 编译被加载应用和模块；不是全 API tsc。git diff --check 退出码 0。

## 未完成及精确公共接入需求

不把本片修复当作多模态履约链完成。剩余边界延续 LB03：

- schema 中只有正式检查模板/检查事实，没有 AI 检查草稿及操作收据对象。持久保存、revision CAS、并发编辑、未知提交核对、迟到模型保护必须依赖正式模型。需主线提供模型/delegate、作用域与 owner 条件、唯一 operation 键、revision、模板/附件/输入指纹、候选与人工更正记录。未获得 schema/迁移修改授权，不创建影子存储。
- staff-uploads.controller.ts 当前生产 rental_order 及阶段/批次/地点绑定，不生产完整 allocation/asset/templateVersion/attachmentRevision 联合证明。需正式上传/绑定生产者与受权有界 bytes 读取；不能信自由 metadata，不把订单下载权限当识别/草稿写权限。
- InspectionEvidenceAuthority 只有消费者，仍无正式证据适配。当前候选被明确标识 caller_supplied_not_model_execution_proof；识别输入需主线提供媒体与内容指纹、能力、invocation 绑定消费端口，不新增 SDK/第二 Gateway。
- 人工采用/修改/拒绝的持久事实需上述草稿 CAS，不能只生成当前时间/revision 假装已登记。
- 正式提交需原检查应用的受权动作端口与原 action 收据查询；Core createInspection 本身不能替代 Controller 的授权/证据/幂等/事务边界。本线尚未交付最终提交 API。

上述缺口不是 MySQL/模型“未验”而已，属于正式代码/合同依赖尚缺。主线交付或明确扩大公共字段/迁移施工授权前保持 unavailable；不反复追加空包装与同义测试。本轮没有运行真库、真实文件存储、模型、设备或微信宿主。
