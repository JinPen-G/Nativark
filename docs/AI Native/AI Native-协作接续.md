# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-16。最近功能提交：`cd99b42f`（原场景取消/澄清）、`3793d8d8`（原场景恢复领取）；此前接管：`b713f9ef`。开工以实际 Git 状态为准，不将提交号作为回退目标。
> **负责人确认Claude未施工，已要求Codex直接接回主线。** 当前继续主线单线实现，不启动A/B或其他辅助线。此前Claude双线交接未执行，不作为活动派工。未来抽离、Runtime/SDK接入仍未启动。

## 权威依据

- 产品范围、任务依赖与阶段放行：[正式需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。新补的目标驱动和场景闭环原则适用，不改原28项及 ENTRY 的分母或既有百分比。
- 已做/剩余、固定功能提交及验证边界只维护在[开发记录](<AI Native-开发记录.md>)。
- 未来设计分别查[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<未来规划/AI Native-通用SaaS底座方案.md>)；均不授权当前拆库、拆服务、开源或另造通用平台。
- 原总册、旧派工和历史接任提示词已归档，只供追溯，不能覆盖负责人本轮单线授权。

## 工作树与写入归属

唯一写入树：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`。
分支：`ai/ai-native-contracts-s01-20261002`。主线认领公共Gateway/预算、运行器及审批接点；本轮不向辅助树写入或派工，不与其他线双写公共文件。

四条辅助树仍保留在同级目录：`codex-ai-native-lane-a`、`codex-ai-native-lane-b`、`claude-ai-native-lane-a`、`claude-ai-native-lane-b`。上次交接已实际同步四树到`71dbdd65`，当时均干净且与主线差异0/0；本轮主线已有新提交，辅助树未再同步，不宣称它们仍与最新主线一致。不复制私有生成物。本地main仍为`46cbaf0f`，本次没有合main或推送授权。

开工核对 branch、HEAD、status、index、MERGE_HEAD、CHERRY_PICK_HEAD、未提交归属及写入者。本轮继承的五份需求/任务/未来方案/导航改动均为本对话已获授权成果，已单独提交；无须重新制作。未跟踪 output、保全副本、旧patch、私有Prisma client及锁继续保留，不清理或附带提交。

## 当前核心接点及下一步

主线继续原 AIN-03/04/05/06/07/11 依赖，不以界面或空包装代替核心：

1. **持久计价的真实生产者与标准应用装配。** `task-model-gateway.composition.ts` 的 `composePersistedTaskGateway`、`composePersistedTaskModelHost` 及原请求场景组合已可由服务端显式选择 `pricing: { kind: 'recorded', priceVersion }`；旧 calls 入口保留兼容，不混用、不回退。下一步仍需合法的真实费率/可信token上界生产者、已发布能力和标准应用执行依赖；本次未注册生产模型驱动，不把有记录/接口当成依赖验真。
2. **中断与结果收敛。** 原请求场景、模型宿主及模型→订单事实组合的恢复领取已复用原`runner.run({recovery:true})`，保留原快照修订/fence/CAS，领取超时或丢应答不凭重读获得执行权；恢复不调用prepare、不生成新输入/调用或重置资源。场景外层recover/takeover及订单组合装配读取有界；通用原场景start/resume/requestCancel/reconcile现已接同一等待边界，取消请求和取消收敛写入的应答不明仍unknown，不作为缺输入等待证据吞掉。后续优先核对`original-model-order-scene.composition.ts`自身的取消/收据分支，以及获准报价建单的批准/Core提交剩余窗口；不能把通用原场景此片当成所有业务动作恢复完成。真实计价/能力依赖仍见第1项。
3. **原账恢复与宿主。** 原请求→原任务→原调用的善后已接到shared、OpenAPI和默认关闭的`AiOriginalScenesModule.registerHttpAccounting`；显式启用后提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。响应复用已校验的公开用量投影，不含凭据引用、dispatch token或内部association；当前Guard/Auth/ALS和原账证据仍复验。未注册AppModule，不是生产开放；标准应用部署还须按授权构建同版shared并选择可信宿主。剩余是token/money、未派发释放、提交应答丢失等场景组合证据，以及员工/客户各自正式运输入口；不能凭善后授新执行权。
4. **剩余原任务。** AIN-06/07各中断/确认/接管窗口，知识/媒体的真实ACL与保留删除传播，以及完整可信宿主仍按原任务承接。AIN-25～28的真实环境、供应商、宿主与独立验收尚未完成，不能混称为仅剩部署。

当前主线功能片验证结束，无本轮启动的服务、Worker、Cron或真实模型调用。Codex已按最新授权恢复主线核心施工；未启动任何辅助对话或重复心跳。

## 验证与交接边界

- 最近API源码类型检查：658 roots、0诊断，退出0。取消片复用既有原场景unknown/取消用例及已中断启动冒烟2/2，受控时钟的取消提交应答超时1条通过；恢复片原场景6/6、模型→订单事实原unknown恢复1条及相关既有用例分开见开发记录，diff退出0。不相加当全量回归；数据库/传输/初始财务生命周期均有替身边界。原账HTTP仍默认关闭、未注册AppModule。
- 数据库事务、路由及模型传输为离线替身；真实MySQL锁/并发、供应商、浏览器/微信、真实支付/存储均未验。全局契约静态门此前失败，本轮未重跑或修复，不写成通过。
- 不新增测试脚本；复用已有入口、一次性命令及必要类型检查，不删断言或扩大审查。开发记录按完整功能收口简短更新，百分比未跨原门槛不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
