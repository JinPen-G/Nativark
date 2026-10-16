# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-16。最近功能提交：`b713f9ef`（接管与历史收据）、`fb4b032d`（任务应用等待）、`f8659157`（设置恢复/租约清理）。开工以实际 Git 状态为准，不将提交号作为回退目标。
> **负责人要求收口，交由 Claude 使用既有 Codex A/B 两树双线接续。** 本轮 Codex 已停止新功能开发；Claude 两线开工前确认身份、文件认领及本次同步结果。主线保留整合职责，不同时双写公共文件；原 Claude A/B 两树同步后暂不启用。未来抽离、Runtime/SDK接入仍未启动。

## 权威依据

- 产品范围、任务依赖与阶段放行：[正式需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。新补的目标驱动和场景闭环原则适用，不改原28项及 ENTRY 的分母或既有百分比。
- 已做/剩余、固定功能提交及验证边界只维护在[开发记录](<AI Native-开发记录.md>)。
- 未来设计分别查[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<未来规划/AI Native-通用SaaS底座方案.md>)；均不授权当前拆库、拆服务、开源或另造通用平台。
- 原总册、旧派工和历史接任提示词已归档，只供追溯，不能覆盖负责人本轮单线授权。

## 工作树与写入归属

唯一写入树：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`。
分支：`ai/ai-native-contracts-s01-20261002`。本轮源码已收口提交，不留待另一作者猜测归属的WIP。后续双线建议：Codex A树认领运行器/任务输入/审批恢复；Codex B树认领Gateway/财务预算与计价装配。修改公共shared、schema、Guard、场景组合前明确唯一作者和消费者，不能两线各自补同一接口。

四条辅助树仍保留在同级目录：`codex-ai-native-lane-a`、`codex-ai-native-lane-b`、`claude-ai-native-lane-a`、`claude-ai-native-lane-b`。负责人已确认四线及心跳停写；同步前四树均为`46cbaf0f`、工作区干净且无独有提交，本轮将四树快进到本次主线交接提交。开工以`git rev-parse HEAD`及`git rev-list --left-right --count 主线分支...HEAD`核实，同步不改各树原分支、不复制私有生成物。本地main仍为`46cbaf0f`，本次没有合main或推送授权。

开工核对 branch、HEAD、status、index、MERGE_HEAD、CHERRY_PICK_HEAD、未提交归属及写入者。本轮继承的五份需求/任务/未来方案/导航改动均为本对话已获授权成果，已单独提交；无须重新制作。未跟踪 output、保全副本、旧patch、私有Prisma client及锁继续保留，不清理或附带提交。

## 当前核心接点及下一步

主线继续原 AIN-03/04/05/06/07/11 依赖，不以界面或空包装代替核心：

1. **持久计价的真实生产者与标准应用装配。** `task-model-gateway.composition.ts` 的 `composePersistedTaskGateway`、`composePersistedTaskModelHost` 及原请求场景组合已可由服务端显式选择 `pricing: { kind: 'recorded', priceVersion }`；旧 calls 入口保留兼容，不混用、不回退。下一步仍需合法的真实费率/可信token上界生产者、已发布能力和标准应用执行依赖；本次未注册生产模型驱动，不把有记录/接口当成依赖验真。
2. **中断与结果收敛（A线）。** 设置原任务与共用应用的有限等待、安全清理已接通；`takeoverAndRecover`现有有限接管等待、超期前写入检查和已确认但中断的CAS清理，丢提交应答只查原收据，不重读成执行许可。历史接管收据改用当前`read_step_terminal`，关闭新接管不阻断本人原记录观察，撤权仍拒绝。A线继续原请求场景中的recover/takeover外层授权、计划与原材料读取，以及确认/Core提交后的原收据收敛；不重复本片底层修复，不新建状态机或重派unknown。各场景完整中断窗口和真实多进程仍未验。
3. **原账恢复与宿主。** 原请求→原任务→原调用的善后已接到shared、OpenAPI和默认关闭的`AiOriginalScenesModule.registerHttpAccounting`；显式启用后提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。响应复用已校验的公开用量投影，不含凭据引用、dispatch token或内部association；当前Guard/Auth/ALS和原账证据仍复验。未注册AppModule，不是生产开放；标准应用部署还须按授权构建同版shared并选择可信宿主。剩余是token/money、未派发释放、提交应答丢失等场景组合证据，以及员工/客户各自正式运输入口；不能凭善后授新执行权。
4. **剩余原任务。** AIN-06/07各中断/确认/接管窗口，知识/媒体的真实ACL与保留删除传播，以及完整可信宿主仍按原任务承接。AIN-25～28的真实环境、供应商、宿主与独立验收尚未完成，不能混称为仅剩部署。

当前主线功能片验证结束，无本轮启动的服务、Worker、Cron或模型调用。Codex不再继续施工或另行派工；Claude可据负责人交接在既有Codex A/B树接续上述核心分工，不能假定两个对话已自动收到任务。

## 验证与交接边界

- 最近API源码类型检查：658 roots、0诊断，退出0。接管既有组合6/6与一次性边界冒烟4/4、diff退出0；涵盖丢COMMIT应答、超时后迟到、当前历史读权限和撤权，数据库仍为事务替身。此前设置/应用证据分开见开发记录，不相加当全量回归。原账HTTP仍默认关闭、未注册AppModule。
- 数据库事务、路由及模型传输为离线替身；真实MySQL锁/并发、供应商、浏览器/微信、真实支付/存储均未验。全局契约静态门此前失败，本轮未重跑或修复，不写成通过。
- 不新增测试脚本；复用已有入口、一次性命令及必要类型检查，不删断言或扩大审查。开发记录按完整功能收口简短更新，百分比未跨原门槛不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
