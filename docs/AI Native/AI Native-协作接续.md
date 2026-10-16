# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-16。最近功能提交：`0614cc2b`（持久任务Gateway的显式受控协议生产者）。固定证据见开发记录，开工以实际Git现场为准，不将SHA作为回退目标。
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

1. **持久计价与标准执行装配。** 原任务Gateway支持服务端选择recorded或calls，未配置不回退。`composePersistedTaskGateway`及原场景/员工持久模型宿主现可由服务器显式指定`gateway.nativeProtocol:'openai_chat_completions'`，复用原有界/出网校验传输和受控订单工具协议；与adapters互斥，二者皆缺仍拒绝，不因省字段启用。配置、Vault、当前身份、能力收据和单账门仍逐调用复核；本地协议缺功能时先拒绝，不能以远端能力证据顶替。本原生选项不附带任意structured output schema，须另供正式适配器。默认审计接原OperationLog，绑定当前主体/原task/run/step/call、预留和dispatch关联，只留必要ID/hash，不存正文、密钥或原dispatch token。客户`createCallGateway/createPersistedCallGateway`及`composeAuthorizedPersistedTextProbeWorkflow`也复用该审计生产者，缺日志仓储仍拒绝。审计COMMIT应答不明不重写、不据此派发，不代表标准应用执行放行。计价历史及发布收据仍可独立于生产器读取；显式`registerHttpPricingHistory`默认关闭。下一步仍需真实费率/可信token上界生产者、已发布能力及标准完整执行依赖；原生协议支持或calls调用计数不等于真实供应商/成本已验真。
2. **中断与结果收敛。** 原请求/模型订单、选报价、审批及能力验证已接有界等待和原runner恢复，领取丢应答不凭重读授执行权，证据发布超时仍unknown。原请求→模型→受权订单事实→回答现有正式输入证据来源，不再强制宿主补一个not_required替身：复核原计划、输入、完成步骤、用量/财务关联和固定工具候选，回答还复核订单快照。历史回答现按不可变原请求的执行时授权指纹核对证据，并复验当前结果读权限与事实；原输入过期/停新执行不单独阻断已完成回答观察，原记录撤销、串绑定或当前撤权仍拒绝，不授继续派发权。入口沿`composeRequestBoundPersistedOriginalSceneModel`的服务端`orderReadChain:{enabled:true,answerRoundTrip:true}`，可省inputSource，仍未注册生产执行。未知/串绑定/事实变化拒绝推进；该封闭链不承担自由澄清，报价多轮仍走原澄清源。已存计划/指纹/累计额度不改，maxSteps与原calls门分别限制，超时不补1毫秒强行启动。下一步仍核对完整可信执行装配及各中断窗口，不把定向组合当运行器、真实财务预算或供应商整项验收。
3. **原账恢复与宿主。** 场景善后仍由默认关闭的`AiOriginalScenesModule.registerHttpAccounting`提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。能力验证另在既有`TextCapabilityProbeModule.registerHttp`下接通`POST /api/ai-native/text-capability/accounting/{read|release-unsent|reconcile}`，只收requestKey，由原材料定位唯一task/run/call及价格版本；当前管理权限、任务读取政策和单账证据复验，不要求原探测配置/计划继续开放，不授新探测或派发权。预算层现保留真实商业权益布尔值：明确撤回新用量权益后，仍可凭当前独立动作授权处理绑定原预留的read/settle/release/unknown/reconcile；reserve/dispatch和设置不放行。权益目录/版本缺失、主体撤权及证据不明仍拒绝，不能据此释放已派发调用。响应复用公开用量投影，不含凭据、dispatch token或内部association。两入口均未注册AppModule、默认关闭；部署还需授权构建同版shared及可信宿主。剩余是token/money、未派发释放成功、提交应答丢失等场景组合证据，以及员工/客户正式运输入口；没有可靠usage仍unknown，不能自动重发/退额。
4. **标准观察与剩余原任务。** 标准`AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER`已接`POST /api/ai-native/scene-requests/model/{scene|input|result|source}`：聚合原任务/快照与指定模型结果，读取当前澄清或明确null；源自原计划/步骤/结果、当前业务候选与权限，变化后拒绝旧问题。问题来源复用原执行宿主逻辑，但观察不构造Gateway、不授lease/提交/继续执行权，也不把旧问题标签直接当当前可用。原知识政策/版本与人类确认仍复验，缺依赖不丢来源露文本。新增scene/input读取使用原有限等待；只读仓储不发FOR UPDATE语句，执行及取消事务锁保持原样。标准政策仍仅原订单解释；报价正向澄清由显式服务端组合消费，不默认开放报价模型执行。下一步仍是完整可信执行宿主、AIN-06/07其余中断窗口、真实文件ACL/保留删除传播；真实费率/计数生产者未交付，不将这些代码缺口混称为仅剩部署。

当前主线功能片验证结束，无本轮启动的服务、Worker、Cron或真实模型调用。Codex已按最新授权恢复主线核心施工；未启动任何辅助对话或重复心跳。

## 验证与交接边界

- 最近API源码类型检查659 roots/0诊断、diff均退出0。订单3步/2模型调用一次性组合1/1：实际Auth/Guard、runner、BudgetService/Prisma仓储、准入/单赢家dispatch及审计，两份原预留/两次settle/六个层级allocation，一份原run和任务累计预算；Core返回、DB、路由/传输为替身，尚非真实供应商闭环。原生协议显式装配/缺配置拒绝/互斥与未知协议/本地能力缺失定向1/1，均0 fail/skip/todo、退出0；不触发DNS/HTTP/凭据读取。两处消费者类型诊断已修，未放宽检查。无新增测试脚本。前片权益撤回组合1/1及既有权益边界4/4见记录；客户完整旧夹具Booking预算断言、旧选报价HTTP夹具和全局静态门失败未重跑或掩盖。
- 数据库事务、路由及模型传输为离线替身；真实MySQL锁/并发、供应商、浏览器/微信、真实支付/存储均未验。全局契约静态门此前失败，本轮未重跑或修复，不写成通过。
- 不新增测试脚本；复用已有入口、一次性命令及必要类型检查，不删断言或扩大审查。开发记录按完整功能收口简短更新，百分比未跨原门槛不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
