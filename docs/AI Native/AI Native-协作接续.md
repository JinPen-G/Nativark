# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-16。最近功能提交：`fb4b032d`（任务应用等待）、`f8659157`（设置恢复/租约清理）；原账HTTP：`4b3ee36f`。开工以实际 Git 状态为准，不将提交号作为回退目标。
> **负责人已恢复主线单线开发。** 仅在下述主线树施工，暂不向 A/B 派工、不恢复其他辅助线；未来抽离、Runtime/SDK接入仍未启动。目标模式和心跳未由本轮另外启用。

## 权威依据

- 产品范围、任务依赖与阶段放行：[正式需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。新补的目标驱动和场景闭环原则适用，不改原28项及 ENTRY 的分母或既有百分比。
- 已做/剩余、固定功能提交及验证边界只维护在[开发记录](<AI Native-开发记录.md>)。
- 未来设计分别查[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<未来规划/AI Native-通用SaaS底座方案.md>)；均不授权当前拆库、拆服务、开源或另造通用平台。
- 原总册、旧派工和历史接任提示词已归档，只供追溯，不能覆盖负责人本轮单线授权。

## 工作树与写入归属

唯一写入树：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`。
分支：`ai/ai-native-contracts-s01-20261002`。公共 Gateway/预算、运行器及审批接点由本轮主线单一认领，不与其他线双写。

四条辅助树仍保留在同级目录：`codex-ai-native-lane-a`、`codex-ai-native-lane-b`、`claude-ai-native-lane-a`、`claude-ai-native-lane-b`。各树及本地 main 上次统一同步点为 `46cbaf0f`；本轮未更新这些树，不宣称其与新主线同步，也不追活动 HEAD。

开工核对 branch、HEAD、status、index、MERGE_HEAD、CHERRY_PICK_HEAD、未提交归属及写入者。本轮继承的五份需求/任务/未来方案/导航改动均为本对话已获授权成果，已单独提交；无须重新制作。未跟踪 output、保全副本、旧patch、私有Prisma client及锁继续保留，不清理或附带提交。

## 当前核心接点及下一步

主线继续原 AIN-03/04/05/06/07/11 依赖，不以界面或空包装代替核心：

1. **持久计价的真实生产者与标准应用装配。** `task-model-gateway.composition.ts` 的 `composePersistedTaskGateway`、`composePersistedTaskModelHost` 及原请求场景组合已可由服务端显式选择 `pricing: { kind: 'recorded', priceVersion }`；旧 calls 入口保留兼容，不混用、不回退。下一步仍需合法的真实费率/可信token上界生产者、已发布能力和标准应用执行依赖；本次未注册生产模型驱动，不把有记录/接口当成依赖验真。
2. **中断与结果收敛。** 设置原任务恢复/确认/取消与共用`PrismaTaskApplication`的授权、仓储和输入等待已有有限边界；提交应答不明保留unknown，已委派运行器的租约不由宿主猜测释放。已确认且未委派的租约按原fence/CAS清理，清理超时不再迟到发释放；接管后的旧清理拒绝不覆盖原失败。批准→原Core提交→终态收据观察只执行一次，澄清已保存但应答迟到不自动继续。下一步核对`authorized-persistent-task-input.composition.ts`的`takeoverAndRecover`及其他接管/终态窗口；未覆盖的路径不视作已完成。真实计价/能力依赖仍见第1项。
3. **原账恢复与宿主。** 原请求→原任务→原调用的善后已接到shared、OpenAPI和默认关闭的`AiOriginalScenesModule.registerHttpAccounting`；显式启用后提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。响应复用已校验的公开用量投影，不含凭据引用、dispatch token或内部association；当前Guard/Auth/ALS和原账证据仍复验。未注册AppModule，不是生产开放；标准应用部署还须按授权构建同版shared并选择可信宿主。剩余是token/money、未派发释放、提交应答丢失等场景组合证据，以及员工/客户各自正式运输入口；不能凭善后授新执行权。
4. **剩余原任务。** AIN-06/07各中断/确认/接管窗口，知识/媒体的真实ACL与保留删除传播，以及完整可信宿主仍按原任务承接。AIN-25～28的真实环境、供应商、宿主与独立验收尚未完成，不能混称为仅剩部署。

当前主线功能片验证结束，无本轮启动的服务、Worker、Cron或模型调用。后续仍由本线继续核心接点；没有新增 A/B 活动任务。

## 验证与交接边界

- 最近API源码类型检查：658 roots、0诊断。设置恢复一次性冒烟8/8、应用中断读取1/1及原收据冒烟3/3；已有设置定向4/4。应用定向首轮5/7，两处清理失败旧错误码预期校正并补原租约断言后，仅重跑失败2/2；运行器接管首轮1失败已修，单项复验通过。命令/首轮失败见开发记录，不相加当全量回归。原账HTTP仍默认关闭、未注册AppModule。
- 数据库事务、路由及模型传输为离线替身；真实MySQL锁/并发、供应商、浏览器/微信、真实支付/存储均未验。全局契约静态门此前失败，本轮未重跑或修复，不写成通过。
- 不新增测试脚本；复用已有入口、一次性命令及必要类型检查，不删断言或扩大审查。开发记录按完整功能收口简短更新，百分比未跨原门槛不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
