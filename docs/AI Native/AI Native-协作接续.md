# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-16。最近功能提交：`64df1cbd`（前置操作耗尽总时限后不再启动动作）、`1a9bef1a`（原执行授权绑定与当前读取复验分离）。过期结果、混合调用、原账、计价及审批收敛见开发记录。开工以实际 Git 状态为准，不将提交号作为回退目标。
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

1. **持久计价的真实生产者与标准应用装配。** 任务Gateway/模型宿主/原请求已支持服务端选择`pricing: { kind: 'recorded', priceVersion }`；旧calls兼容，不混用或回退。计价工厂的原价格、发布收据及输入上界读取现独立于生产器；`AiBudgetManagementModule.registerHttpPricingHistory`可显式装配`POST /api/ai-native/budget-settings/pricing/{price|publication|input-bound}`，只读当前受权的原依据、默认关闭，不注册AppModule，不开放发布/准入。下一步仍需合法的真实费率/可信token上界生产者、已发布能力及标准应用执行依赖；没有生产器仍拒绝新发布，不把历史证据、接口或离线合成费率当成真实依赖验真。
2. **中断与结果收敛。** 原请求/模型订单、选报价、审批及能力验证已接有界等待和原runner恢复，领取丢应答不凭重读授执行权，证据发布超时仍unknown。步骤登记/资源占用耗尽总时限后，执行前不再强行给1毫秒启动动作；缺原终态收据则沿既有unknown核对、占用保留，不猜退款或失败。持久流程和输入登记按`maxSteps`约束全部步骤，`maxCalls`由原资源门按Gateway调用原子占用；旧无资源门宿主保留保守限制。原请求→模型→受权订单事实→回答已离线验证steps=3/calls=2，事实变化后旧回答stale、不再派发。已存计划/指纹/累计额度不改，多轮不得重置。下一步仍核对完整可信执行装配及各中断窗口，不把定向组合当运行器、真实财务预算或供应商整项验收。
3. **原账恢复与宿主。** 场景善后仍由默认关闭的`AiOriginalScenesModule.registerHttpAccounting`提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。能力验证另在既有`TextCapabilityProbeModule.registerHttp`下接通`POST /api/ai-native/text-capability/accounting/{read|release-unsent|reconcile}`，只收requestKey，由原材料定位唯一task/run/call及价格版本；当前管理权限、任务读取政策和单账证据复验，不要求原探测配置/计划继续开放，不授新探测或派发权。响应复用公开用量投影，不含凭据、dispatch token或内部association。两入口均未注册AppModule、默认关闭；部署还需授权构建同版shared及可信宿主。剩余是token/money、未派发释放成功、提交应答丢失等场景组合证据，以及员工/客户正式运输入口；没有可靠usage仍unknown，不能自动重发/退额。
4. **剩余原任务。** 原模型结果的执行时身份现对照同scope/owner/版本的持久原请求，不要求今天仍有原执行权限；当前读取权限、来源事实/知识ACL及等待后身份仍独立复验，原绑定变化拒绝。开业/报价复查不再调用新任务材料生产器；输入过期、场景/模型停用后仍可核对，开业来源只重开原选定分区，请求撤销或登录失效仍拒绝，不授新执行。AIN-06/07各中断/确认/接管窗口，知识/媒体的真实ACL与保留删除传播，以及完整可信宿主仍按原任务承接。AIN-25～28真实环境、供应商、宿主与独立验收尚未完成，不能混称为仅剩部署。

当前主线功能片验证结束，无本轮启动的服务、Worker、Cron或真实模型调用。Codex已按最新授权恢复主线核心施工；未启动任何辅助对话或重复心跳。

## 验证与交接边界

- 最近API源码类型检查：658 roots、0诊断，退出0。总时限耗尽的实际Auth/runner/Prisma资源组合1/1，零工具执行、占用UNKNOWN且未退回；既有正常QUEUED启动1/1，均0 fail/skip/todo、退出0。首轮实际发生一次超期执行，且后续任务终态提交应答不明，修复后返回unknown而无新动作。此前原结果撤执行保读取1/1、过期场景2/2等分别留记录，不相加称全量通过，无新增测试文件。此前选报价HTTP原样旧夹具仍失败，不宣称原样或真实HTTP通过。diff退出0；DB/Core存储和工具为替身，模型组合的路由、准入、财务生命周期及传输也为替身，不是实际BudgetService或真库验收。各新HTTP仍默认关闭、未注册AppModule。
- 数据库事务、路由及模型传输为离线替身；真实MySQL锁/并发、供应商、浏览器/微信、真实支付/存储均未验。全局契约静态门此前失败，本轮未重跑或修复，不写成通过。
- 不新增测试脚本；复用已有入口、一次性命令及必要类型检查，不删断言或扩大审查。开发记录按完整功能收口简短更新，百分比未跨原门槛不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
