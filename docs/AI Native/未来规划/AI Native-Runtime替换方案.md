# AI Native：Runtime 与 Provider SDK 开源接入方案

文档版本：整理合并版；整理日期：2026-10-16。文件名保持稳定，内容覆盖 Runtime 双向转换与 Provider SDK 独立替换。具体依赖版本须在未来获准实施时另行核验。

> 文档分类：未来规划／设计方案。当前继续自研，不安装或迁移 LangGraph、Provider SDK；任何实际切换需负责人单独授权。
> 本文只维护替换边界、状态/存储映射、实施前置和回退方案，不记录项目百分比、当前 HEAD、派工或历史开发流水。
> 原技术设计保留，整理前原文见[历史快照](../../历史归档/整理前快照-20261016/docs/开发任务/附件/AI原生系统协作切片/20261008-Runtime双向转接与自研保留手册.md)；项目当前状态见[协作接续](<../AI Native-协作接续.md>)。
> 本文是未来需求与技术方案，不替代当前正式需求或开发任务，也不新增本期框架接入任务。这里的目标能力、候选和验收条件不表示代码已实现、依赖已选定或真实环境已验证。

## 1. 用途与授权边界

未来的两条替换路线相互独立：

- **Agent Runtime：** 自研运行层 → LangGraph 等运行层，以及将来退回自研或其他 Runtime。目标是替换编排驱动及必要适配，而不是业务系统。
- **Provider SDK：** 原请求编码/解析 → 经验证的成熟 SDK 适配。仅涉及模型协议边界，不要求同时替换 Runtime、Gateway、出网或预算。

这不是必须接入某一框架的决定，也不承诺在途任务可无损热切换。真实包版本、许可证、Node/模块制式、TypeScript、schema 库和 saver 兼容性在实施前核验，不用历史调研版本充当已锁定版本。

本文件是现行未来接入方案的唯一维护入口；原开源研究归档保留，作为设计参考而非当前施工指令：[Claude 与 Codex 统一方案原文](../../历史归档/整理前快照-20261016/docs/开发任务/附件/AI原生系统文档备份/20261007-开源接入暂缓-943c15ea/开源接入统一方案-20261007-Claude与Codex整合.md)。原文引用的双方研究、历史评分和候选版本只对当时调研有效，不作为现在的完成率、节省比例或依赖锁定结论。

整合分工如下，不保留另一份相互竞争的现行正文：

| 内容 | 在本方案中的位置 |
| --- | --- |
| 自研成果保留、唯一执行权及业务权威 | 第2～5节 |
| Runtime 状态、checkpoint、重入及双向迁移 | 第4～10节 |
| Provider SDK 独立接法、出网与 usage 边界 | 第2节及第13节 |
| 候选选型、许可、兼容与未来收益判断 | 第11节及第14节 |

未来目标是复用适用的通用编排和协议能力，减少重复维护，而不是换掉 Rental OS 的业务、权限、审批和计量体系。不承诺一键切换、零维护成本或未经测量的节省比例。

## 2. 不可替换的业务权威与两条路线

Runtime 或 SDK 都不能替代当前身份/Scope/Guard/ALS、人工批准、Core 事务/幂等、文件/知识 ACL、唯一 Gateway 与预算单账。框架/SDK 专有类型留在适配层，不进入业务工具或公共 DTO。

Provider SDK 路线尤其保持：

- 唯一 invocation/dispatch 与原 request/run/step、配置/价格/用量证据关联，禁止与旧协议双发或双记账。
- 传输、DNS/地址/重定向、凭据、取消及超时由现有受控层掌握；SDK 默认重试和故障转移不能绕过派发所有权。
- 明确请求/错误/流终态/实际 usage 映射；缺 usage 不补零，丢应答/unknown 不换 ID、Provider 或适配器重发。
- 实施时固定依赖/协议版本，先做不产生真实双副作用的差分；保留原适配器源码与回退路径。

## 3. 源码保留规则

### 3.1 将来获准采用时的分工：通用机制与业务控制分离

以下是未来接入的设计原则，不是当前采用决定：获准接入后优先复用框架适用的通用能力，业务控制复用 Rental OS 正式服务。既有自研成果实际保留，不让两个驱动同时推进同一任务。

| 能力 | 目标主要承担方 | 现有实现保留/复用方式 |
| --- | --- | --- |
| 图分支、并行汇合、子图、图状态合并 | LangGraph原生机制 | 原受权工具/步骤登记/资源限额接节点；旧串行驱动实际保留，退出该任务的调度权 |
| 持久检查点、图中断与恢复 | LangGraph机制及合规saver | 只补必要MySQL/Prisma存储适配，原业务/批准/费用收据仍为事实权威；不另造检查点算法 |
| 图事件与流式调度 | LangGraph流机制 | 桥接原Gateway和稳定公开事件，不新增模型请求或费用路径 |
| 安全节点重试 | LangGraph节点级策略 | 由原动作幂等/派发证据判断是否允许；未知写入不重发，不能与SDK/旧runner重试叠加 |
| 节点缓存 | LangGraph缓存机制 | 原权限/版本/输入/模型配置参与缓存边界；只缓存适用纯计算/只读结果，不缓存批准许可或绕过当前授权 |
| 状态历史、受控时间旅行与分叉 | LangGraph历史机制 | 用于检查/重新推演；原订单/退款/付款不回滚，不因分叉重放既有副作用，新动作仍需新受权登记 |
| 跨任务Store | LangGraph Store机制及必要后端适配 | 原租户隔离、ACL、人类偏好确认、保留策略继续生效；不得以Store中的值授予业务权限 |
| 身份授权、业务批准、Core事务、幂等与预算单账 | 现有Rental OS服务 | 继续共用现有已开发代码，不迁入图、不重复实现 |

以上是目标采用范围，不是宣称全套已接通。版本/存储/合同不兼容时先明确缺口并做最薄适配；不能无限期以unavailable代替实施，也不能为展示“全用上”绕过业务约束。分阶段验收，但不把只读首片的局部能力当成最终架构上限。

### 3.2 实际保留要求

1. **旧自研驱动与直接测试实际留在源码树中，不以Git历史、压缩包或“以后可恢复”替代。** 不删除旧runner、恢复、输入、协议及业务实现。
2. LangGraph驱动放在独立适配目录；建议`ai-native/runtime-adapters/langgraph/`，这是待认领的目标路径，当前没有在此建空壳。
3. 原自研运行路径不能依赖LangGraph包、checkpoint类型或消息类型，不能被改成只调用LangGraph的空包装。停用LangGraph后，原路径应仍能独立编译与运行其已支持的能力。
4. 共享的是授权、登记、受控动作、结果/资源收据等稳定服务，不共享一个隐藏的“第二编排循环”。如需提取原单步逻辑，保持原顺序和语义，由两个驱动复用；提取前核对并保全固定版本，旧驱动仍须通过其原测试。
5. 不为保留两条路径复制Core算法、批准服务、业务数据库或预算账本。旧源码保留不等于旧worker与新worker对同一任务同时执行。
6. 每次框架接入或退出都记录实际修改路径、固定提交、依赖锁版本与验证；本文中的“建议/待实现”只能在有代码和证据后改成“已实现”。

## 4. 已有服务与待实现驱动的边界

以下路径均相对 `apps/api/src/modules/ai-native/`，仅用于定位未来适配边界。实施时必须重新核对实际签名和受权依赖；本表不登记开发进度，也不宣布通用 Runtime 接口已完成。

| 对接位置 | 需要保留的职责 | 转接要求 |
| --- | --- | --- |
| `runner/ai-task-runner.service.ts` | 自研run/runPrepared/recover、串行runHeld循环、取消与结果处理 | 保留自研驱动；LangGraph不能在每个节点调用完整runner.run，否则仍是嵌套双循环 |
| `runner/ai-task-runner.ports.ts` | lease/step/plan/effect/resource/outcome等端口 | 优先复用实际合同；框架类型只在适配器内部，不能传播进公开DTO或业务工具 |
| `runner/prisma-task-application.ts` | start/resume/reconcile/inspect/readEvents/readInput宿主 | 保留外部任务/输入收据语义；新增内部engine选择，不让客户端传driver/lease/fence |
| `runner/prisma-task-run-evidence.repository.ts` | 不可变plan、artifact、当前权限与lease下的证据 | 现有线性plan与并行限制不能直接当作通用图计划；图版本/节点动作映射必须明确 |
| `runner/order-task-host.composition.ts` / `runner/settings-task-host.composition.ts` | 订单与通知设置的 phase 等待/继续宿主 | 复用各自批准/Core与原 charges，按工具保留证据；不以通用图中断替代业务确认 |
| `task-input/`、`approval-execution/` | 正式人类输入/批准、操作与重准备收据 | interrupt/resume只提供控制流，不替代输入校验、人工决定或批准消费 |
| `ai-task-creation.repository.ts` | 唯一原task/run创建与readCreation | 不因换Runtime创建第二任务体系；创建未知按原key核对 |
| `model-gateway.ports.ts`及原Gateway组合 | 模型协议、受控调用与既有计费链 | 图节点只经唯一Gateway；不得直调供应商或绕过原invocation/单账 |

目标调用关系：

```text
现有场景/客户端 → 稳定应用合同 → 服务器受控Runtime宿主
  → 任务已固定的单一engine：自研驱动 或 LangGraph驱动
  → 共用的受控单步执行边界
  → 当前授权 / 原登记 / 原资源证据 / 原批准与Core / 唯一Gateway
  → 原结果及公开事件
```

**内部入口按下表实施：** 保持原DTO/返回类型及授权，不另创公开Runtime API；框架调用参数只在适配器内部构造。具体库签名待锁定发布包核准。

### 4.1 未来实施的内部接口表

这张表把“替换运行层”落到现有入口；目前只记录目标适配，不新增空接口。

| 操作 | 现有自研入口 | 未来LangGraph适配入口 | 权威写入/返回约束 |
| --- | --- | --- | --- |
| 首次启动 | `PrismaTaskApplication.start({taskId,runId})` → `AiTaskRunner.run/runPrepared` | `LangGraphRuntimeHost.start`（目标） | 服务器解析当前task/run、claim合法lease；图只能在已持有lease和非空plan后启动 |
| 输入后继续 | `PrismaTaskApplication.resume(value)` → `PrismaTaskInputRepository.submit` → `start` | `LangGraphRuntimeHost.resumeInput`（目标） | 先提交/读原输入receipt，再以原inputRef/inputHash/planHash恢复；重复receipt只读 |
| 确认后继续 | `PrismaTaskApplication.continueConfirmation({taskId,runId,checkpointRef}, signal?)`及原批准/submit组合 | `LangGraphRuntimeHost.resumeConfirmation`（目标） | 原入口读取 phase receipt，要求合法已持有 lease；批准消费仍由业务执行边界复验，interrupt 值不授批准 |
| 澄清后继续 | 原输入收据、合法后继 run 与 prepareHeldRun / 正式报价来源 | `resumeClarification`（目标） | 保留consumed输入收据出处、resourceOriginRunId与父limits；新冻结input/plan/operation，不覆盖旧输入/批准或重置账本 |
| 取消 | `AiTaskApplication`/runner signal、task cancel与lease release | 图运行取消适配（目标） | 只阻止未开始节点并传signal；已提交/unknown事实按原收据保留，不声称远端回滚 |
| 恢复/核对 | `PrismaTaskApplication.reconcile`、`AiTaskRunner.recover`、effects.reconcile/readInterrupted | `LangGraphRuntimeHost.reconcile`（目标） | 只读原action/invocation/business/charge receipt；无证据保持unknown，不新发副作用 |
| 检查/事件/输入读取 | `inspect`、`readEvents`、`readInput` | 稳定应用合同继续复用 | 对外不暴露LangGraph state/thread；按当前读权限和scope返回本系统DTO |

目标Host只接受服务器构造的稳定命令和受权上下文，不接受客户端driver、threadId、lease、fencingToken、policy成功标记或任意图节点名。未来适配器负责把LangGraph的`invoke/stream/interrupt/resume`转换为表中入口，不把框架类型泄漏到shared/OpenAPI/业务工具。

### 4.2 当前入口与未来驱动的唯一组合位置

目标组合顺序如下，先满足现有业务边界，再选择运行器：

```text
request-bound/application
  -> current Auth/Guard/ALS and scope resolver
  -> task/input/proposal/approval authority
  -> engine binding (server-owned)
  -> self-hosted runner OR LangGraphRuntimeHost
  -> common step/effect/resource/result ports
  -> original Gateway / Core / business receipt / public event
```

不得在`model-input`或业务场景内直接import LangGraph；不得在LangGraph节点中调用完整`AiTaskRunner.run`；不得在旧runner中再嵌套一个图循环。未来若需要从`AiTaskRunner.runHeld`提取单步边界，应单独固定提交并让原runner先继续通过原测试，再由两个驱动分别调用该边界。

## 5. 执行权、版本与状态权威

本节为目标约束，绑定模型和切换API尚待实现。

- 在首次执行前，服务器为任务固定engine；run固定driver/graph版本、输入版本和checkpoint格式版本。持久绑定必须覆盖scope/task/run，读回精确核验；请求体、threadId或模型输出不能选择引擎。
- 建议任务级engine保持不变，避免同一任务预算与业务动作在两种引擎间隐式迁移；如实际业务确需跨engine接续，必须单独设计显式迁移记录，而不是改一列engine后重跑。
- LangGraph负责下一节点、分支、图状态与检查点调度。原lease/fence/CAS仍控制业务执行资格；不能保留两个互相独立推进同一run的调度循环。
- 图检查点负责图内部进度；原数据库中的task/step、输入、批准、业务与费用收据继续负责各自事实。公共状态从已核验事实投影，不能直接把图结束投影成“订单成功”。
- 回退只改变新任务采用哪个已就绪引擎；已派发任务仍绑定原engine及版本，直到完成或进入受权人工核对。

| 系统状态/事实 | LangGraph侧处理目标 | 始终保留的约束 |
| --- | --- | --- |
| QUEUED / RUNNING | 首次invoke及图运行 | 先合法claim/准备/登记；检查点不能伪造RUNNING或执行许可 |
| WAITING_INPUT | 持久interrupt，消费正式输入收据后resume | 重复答案收据不再继续；新输入不覆盖旧冻结 intent/plan；图内继续或新 run 的映射须显式设计 |
| WAITING_CONFIRMATION | 持久interrupt，复验真人决定后显式继续 | 普通聊天/resume值不是批准，批准不等于Core提交 |
| WAITING_EXTERNAL / UNKNOWN | 停止新副作用，按原ID只读核对 | 缺收据不当作未执行，不新建action、invocation或另收费重试 |
| CANCEL_REQUESTED / CANCELLED | 停止新节点、传AbortSignal、保留已观测结果 | 不宣称远端回滚，不删除已提交业务或费用事实 |
| SUCCEEDED / PARTIALLY_SUCCEEDED / FAILED | 根据原步骤/业务/资源证据形成终态 | 节点return或图END本身不是业务和费用完成证明 |
| 输入/批准/operation receipt | 图中只存有界引用及版本/hash | 原数据库保留不可变事实，框架状态不签发批准或替代业务收据 |

上述映射不是枚举一一强转。特别是UNKNOWN可以同时存在已观测业务成功与待核对费用，不能被框架一个异常状态覆盖。

## 6. checkpoint存储与重入合同

### 6.1 存储选型与需要落地的结构

优先沿现有MySQL/Prisma；先核准维护中的JS saver是否适配选定发布版，不宣称已有合适候选或必须从零实现。若需要薄适配，只实现其持久化协议，不复制框架调度算法。

正式DDL前须明确以下逻辑对象、字段类型、主键/复合FK、索引、大小上限和保留规则：

- 任务/run的engine与graph/schema版本绑定。
- checkpoint：服务器派生的thread标识、namespace、checkpoint ID、parent ID、typed payload、metadata、channel版本。
- pending writes：框架内部task/write序号的稳定复合键；不得与Rental OS task/action ID混用。
- head：原run/fence/revision条件下的CAS推进；旧holder不能写入可被新holder误采纳的head或pending writes。
- 所有读、列举及删除都走当前scope权限；不只在invoke入口检查一次。不把Bearer、活跃lease、服务实例或任意大段敏感正文序列化进去。

旧研究提到getTuple/list/put/putWrites/deleteThread；**实际方法、参数、分页、序列化及删除协议以锁定发布包为准**。内存saver只用于库级验证，不能冒充跨进程恢复。

### 6.2 副作用与检查点不能原子提交时

必须明确每一步真实提交顺序：当前授权与lease → 原步骤/调用登记和资源预留 → 实际动作 → 原结果/usage/业务收据 → 框架checkpoint → 公共状态投影。

框架和Core/Gateway未必共享事务，因此以原动作标识及收据实现重入核对，不许声称LangGraph自动提供跨系统exactly-once。

- 动作已提交而checkpoint未确认：重入按原action/invocation/operation查证据，不重发。
- checkpoint引用不存在或不一致：保持unknown/阻塞，不能用重新执行“修复”。
- checkpoint写ACK丢失：查原checkpoint ID/hash；不生成新的动作实例绕过未知。
- 节点重试不生成新业务操作ID；真正的新调用须有新受权输入/登记和原预算准入。模型多轮不能藏在只登记一次的节点里。
- 自动重试、缓存、流式终止行为必须按实际库验证；默认不允许对不可确定业务副作用盲重试。

## 7. 能力对照：保证可替换，不夸称一键等价

| 能力 | 未来对接与回退约束 |
| --- | --- |
| 串行计划与受控步骤 | 两个驱动分别调用同一稳定业务边界，先验证行为等价 |
| 持久恢复、取消、资源上限 | 映射原 receipt/unknown/fence 与累计资源，不只恢复图 JSON |
| 确认等待与批准后阶段 | 保留原 phase、批准消费及累计资源；不能用 interrupt 绕过审批 |
| 澄清与多轮输入 | 明确继续当前图或新 run，保持不可变输入、父预算与动作谱系 |
| 流式与公开任务事件 | 框架事件转换为稳定公开合同，不暴露内部节点或敏感上下文 |
| 分支、并行、子图 | 登记、资源、lease/fence、汇合和原线性计划边界必须适配；退回不支持的驱动时拒绝，不静默改变语义 |
| 节点缓存、历史/分叉 | 当前权限、版本、输入与费用参与边界；不能回滚/重放支付订单实现“时间旅行” |
| 跨任务记忆 | 复用正式偏好确认、知识/文件 ACL 与留存政策；图 Store 不授业务权限 |

逐项记录“自研支持 / LangGraph适配支持 / 已验范围 / 不支持时拒绝”，作为未来替换入口的能力门。不能为了宣布完整使用LangGraph，把所有高风险能力直接公开给客户端。

## 8. 正向转接：自研到LangGraph

获准施工后按以下顺序执行，当前不自动执行：

1. **确认基线与归属。** 获准实施时固定届时实际源码、依赖与在途任务版本，保全 WIP；逐项核验共用业务服务与恢复合同，不照旧快照重复开发，也不追辅助活动 HEAD。
2. **核准真实依赖。** 选定LangGraph.js/core/checkpoint版本，验证许可证、生产Node、CommonJS、TS和Zod兼容；现有根配置为CommonJS、API声明Zod3，不能照抄历史候选版本或升级全仓迁就框架。
3. **落定执行边界与存储合同。** 完成本手册第4～6节的真实接口、数据模型及调用顺序；同一run只能有一个driver，checkpoint格式与业务事实分开。
4. **最小只读纵向。** operator/workspace订单解释→真实原输入→图节点→唯一Gateway→原artifact/单账/事件；不是在旧executor里套一次图就宣称完整迁移。
5. **验证持久恢复与受控中断。** 原动作提交后checkpoint失败不重发；正式输入/批准收据才允许继续。只读通过不意味着通知设置、客户、automation或订单写入已全部接通。
6. **新任务显式采用。** 完成服务器engine绑定后再放行限定场景；旧任务留在旧engine。没有实际在途数据证据，不擅自编写/执行历史数据迁移。
7. **逐步扩展。** 再接澄清、确认写入和必要分支/子图；Provider替换不作前置。每项能力回写第7节和实际接口表。

## 9. 反向转接：停用LangGraph，回到自研或其他Runtime

### 9.1 默认安全路线

1. 在可信服务器入口停止新任务选择LangGraph；**切换配置/接口尚未实现，不能现在给出虚构命令。**
2. 按持久engine绑定列出该引擎的在途任务和版本。此列表必须当前授权，不能靠遍历checkpoint猜任务归属。
3. 已运行任务继续由锁定版本LangGraph完成或只读核对；未知/可能已提交任务不得交给旧runner重新执行。不能先卸载包再处理在途任务。
4. 用第7节能力表确认自研驱动已支持待切场景；不足就实现所缺能力或保持该场景不可用，不能把图分支偷偷改成线性流程。
5. 将新任务绑定到自研engine，保持原外部API、授权、输入/批准/业务收据和单账不变；先一个限定场景验证，再扩大。
6. 通过最小同语义验证后停止LangGraph的新增维护/默认装配。依赖移除、数据清理另行批准，全部旧源码/测试及必要版本记录继续实际保留。

### 9.2 不做隐式检查点转换

LangGraph的channel版本/pending writes/内部节点任务不能直接塞入旧runner的plan或手写step状态。若必须迁移在途任务，应另立显式转换工具和映射版本：限定可迁移的安全边界、验证全部原动作/费用收据、CAS锁定唯一所有者、留下迁移记录并保留原checkpoint；不满足条件保持原engine或人工核对。

**“可快速更换”是能按固定边界替换新任务的驱动，不是任意时刻无损热切换所有在途任务。** 目前没有实现跨引擎在途转换工具。

## 10. 最小验收与回退判据

复用原场景/runner测试，不每片新增矩阵或大量脚本。库级、离线组合、跨进程持久化、真实DB/模型/宿主证据分别记录。

集中验证至少覆盖：

- 一个真实只读纵向，原输入/动作/输出引用一致，模型派发及账本各只有原有一条路径。
- 一次持久中断/正式人类输入或决定/继续，重复收据不重跑，凭据与当前权限重新校验。
- 一次动作已提交但checkpoint写未确认的恢复，只读查原收据，无第二次业务调用或扣费。
- 旧holder迟到、取消或撤权时不推进新副作用；公开事件和正文也不泄漏。
- 同一原场景分别绑定两种driver，输入、结果/错误与费用语义可比较；**禁止双驱动并行执行真实副作用作对照。**

发现重复派发/收费、checkpoint越权或fence绕过、旧图版本被热替换、unknown被假成功覆盖，立即停止新任务采用新引擎，保留原事实并核对；不通过删记录/换ID/重跑掩盖。

## 11. 正式实施前仍需细化的设计

统一方案的单驱动、保留Core/审批/单账、Provider独立、失败语义和首片选择已纳入本文；本文仍是准备性设计，不能直接当最终施工任务书。

正式实施前至少补齐：

1. 届时的实际接口、在途任务和共用业务服务基线；明确哪些驱动能力可映射、哪些必须保持原引擎或拒绝迁移。
2. 可替换驱动与原单步边界的具体文件、方法签名、依赖方向和唯一维护者；不能只写“适度提取”。
3. 第5～6节的完整状态/动作身份映射、真实saver合同及Prisma模型/索引/CAS事务设计。
4. 线性不可变plan到图分支/多轮的合法登记方式；当前maxConcurrent=1、budget指纹含run/steps的约束如何兼容，不能只放宽数字。
5. 已核验依赖版本与实际加载证据；历史版本只作候选，不是锁定结论。
6. 每一迁移片的输入/消费者/允许改动文件/完成出口，以及第8～10节的正反向切换和验收入口。

这些补充以实施需要为限，不另写泛化框架调研或用文档数量替代功能。Provider方案保留，但不夹带进本轮LangGraph必做清单。

## 12. 后续更新责任

每次driver接口、checkpoint schema、graph模板、engine绑定或业务状态映射变化，维护者同时更新本手册的真实路径/签名/版本、支持能力和回退限制。正式可执行切换入口完成后，在第8/9节填入经验证的操作步骤及所需权限，不填占位命令冒充已支持。

本文件只维护未来设计、依赖条件和迁移/回退限制，不记录项目进度、派工或提交流水。设计状态不等于实现或验收；上游依赖、saver 合同和真实环境兼容性须在获准实施时验证。项目开发情况集中维护在独立实施记录。

## 13. Provider SDK 独立接入与退出

本节整理原统一方案中比 Runtime 手册更详细的协议接入边界。它与第8～9节的 Runtime 切换互不作为强制前置，不要求同时改造两层。

### 13.1 目标接法与选型

优先评估 SDK 的低层 Provider 协议适配；只有正式功能确有需要时再评估其高层 Agent/生成循环，不因采用 SDK 增加第二个调度器。

目标链路：

```text
现有 Gateway / 单账 / 原派发所有权
  → 原 RoutedModelTransport
  → SDK ModelAdapter（未来适配层）
  → 显式 Provider 实例
  → 受控 fetch 桥
  → 原 ModelEgressTransport
```

以上是目标适配关系，不表示 SDK 桥或该组合已实现。凭据、BaseURL、模型、配置修订和能力都来自现有可信配置；SDK 不得隐式读取环境密钥、选择云代理或从模型内容解析连接目标。

ModelEgressTransport 不是 fetch 签名，不能用类型强转假装兼容。未来桥接须按锁定 SDK 的真实调用协议处理 Request / Response / ReadableStream、必要响应元数据、背压、AbortSignal、iterator return 和总 deadline，不为适配开放任意出网能力。

### 13.2 传输、派发与计量合同

- 保留原 DNS/地址审查、固定连接 IP/TLS、URL/method/header 白名单、重定向政策、响应字节限制和取消边界。不得回退 global fetch，或隐式执行媒体下载、遥测与其他外部请求。
- 一次合法派发只能产生其允许的实际请求；高层自动重试、故障转移和自动工具调用须关闭或由原边界明确受控。低层 API 也要核对真实请求次数，不能只检查高层重试参数。
- 保留 invocation、dispatch、reservation 与 request/run/step、actor、scope、配置和价格/usage 证据的关联；SDK 自有请求或 tool-call ID 不能冒充供应商返回的可信关联。
- token/call/money 分离，缺失或不完整 usage 保持 unknown/reconcile；SDK 补零、估算值或派生统计不能直接作为实际结算证据。
- 明确 provider 错误、流中 error、缺 finish、截断、取消及敏感内容回显的映射。收到文字不等于流完整、业务成功或可以结清预算。
- 派发前失败仅按原证据决定是否释放；派发后不明保留原操作核对，不换 SDK、Provider 或 ID 重发。

### 13.3 独立实施与回退门

1. 获准后锁定候选与依赖，完成第14节兼容核验；不因此改公共 DTO 或同时迁移 Runtime。
2. 对原 ModelAdapter 合同实现最薄桥接，保留现有出网、凭据、能力、取消和单账；不另建 Provider 派发许可或钱包。
3. 复用原契约入口做有界离线组合，检查编码/解析、流终态、请求次数、取消、usage 与关键拒绝路径。替身通过不等于真实供应商通过。
4. 取得外联及环境授权后，再在限定场景核验真实协议兼容性；同一调用禁止新旧适配器真实双发作对照。正式开放另行验收。
5. 回退时先停止新调用选择新适配器；已派发或 unknown 调用按原绑定完成或核对。保留原适配器、版本与收据，不能用旧适配器重发原未知调用。依赖移除和数据清理需另行批准。

## 14. 候选复核与未来实施范围

LangGraph.js 是 Runtime 的优先研究候选，不是已批准依赖。Provider SDK 的候选与 Runtime 分开选择；历史研究出现过的包名和版本仅作为查证线索，本次文档整理未安装、联网核验发布包或验证许可证及加载行为。

正式采用前逐项确认：

- 实际发布包、公开导出、维护状态、安全风险、许可证/NOTICE 与使用或局部复用时的保留义务。
- 生产 Node、CommonJS/ESM、TypeScript、schema 库及传递依赖的实际兼容。优先局部适配或适当版本，不整仓转 ESM 或升级基础设施迁就示例。
- JS checkpoint saver 与锁定 Runtime 的序列化、pending writes、分页、并发、删除和恢复合同。优先现有 MySQL/Prisma；仅在无合适维护实现且确有需求时补薄适配，不因研究有限就宣称没有开源实现。
- 框架/SDK 默认重试、缓存、追踪、云代理、自动工具/媒体处理与出网行为。以实际版本验证，不能依赖未经核实的默认值。
- 首个迁移切片的完整输入、真实消费者、当前权限、提交点、原收据、计量和回退出口。建议仍从当前合法 operator/workspace 的只读订单解释开始，不报价、建单或处分资金，不默认开放其他 audience。

未来功能可分片验收，但持久恢复、授权和副作用未知语义不是上线后再补的欠项。Runtime 与 SDK 均不得引入第二任务/审批/知识权威或账本，也不为“采用开源”顺带增加托管平台、队列、向量库或其他基础设施；确有正式需求时另行说明与授权。

当前开发只保持真实需要的稳定服务边界和必要说明，不建空适配层、不提前复制框架 API、不为未来迁移暂停原核心功能。接口或耦合实质变化时更新本文相应设计；功能进展和关键提交仍只进入现有协作接续/开发记录，不恢复逐片迁移论文或历史派工模板。
