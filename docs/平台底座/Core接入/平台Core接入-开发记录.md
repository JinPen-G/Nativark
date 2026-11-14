# 平台 Core 接入开发记录

建立日期：2026-10-31。

> 本册记录阶段成果、缺口和证据。负责人已授权开始拆分，当前为 PCH-01/02 的依赖核定、独立清单合同与兼容抽取阶段；百分比只见[开发任务](平台Core接入-开发任务.md)。最新写入范围和下一入口见[协作接续](平台Core接入-协作接续.md)。

## 1. 依据与来源

- [需求v1.4](平台Core接入-需求.md)、[开发任务v1.4](平台Core接入-开发任务.md)。
- [接口与生命周期设计](平台Core接入-开发任务.md#contract-design)、[接入指南](平台Core接入-开发任务.md#integration-guide)：随本次需求澄清更新，仍为实施准备，非已发布SDK/API。
- 历史版本与原始接入设计见[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)，现行依据使用上述v1.4正文；v1.3前像引用本次固定Git，不另复制。
- 原[AI Native通用SaaS未来方案](../未来规划/平台底座-通用化与开源方案.md)继续保留，承接关系已标注；原文与入口修订前像见[方案基线](历史归档/方案基线/2026-10-31/README.md)。

## 2. 文档定界与接手准备阶段（2026-10-31）

### 2.1 授权与成果

负责人要求先整理两个层级的文档：平台底座可接入CRM/TMS等其他业务Core；Rental Core内部继续通过品类治理适配不同租赁类型。授权范围为文档完善及提前准备接手资料，不包含工程抽离、恢复CAT-GOV施工、连库/启服务、安装、迁移、提交或发布。

本阶段建立独立PCH四册，补充接口/生命周期设计和可操作接手步骤、错误/事务/权限/历史/停用要求；原CAT-GOV四册保留独立身份并完善，原14项、22项验收及原百分比保留，不把PCH计入旧任务。负责人随后明确要求按归属整理目录，调整如下：

| 原位置/内容 | 新位置/归并决定 |
| --- | --- |
| `docs/品类治理/` | 整体移至`docs/Rental Core/品类治理/`；原CLOSE业务闭环任务不与CAT-GOV合并，增加Rental Core目录入口 |
| 本轮新建`docs/平台Core接入/` | 移至`docs/平台底座/Core接入/`，增加平台底座目录入口 |
| 原AI Native目录中的通用SaaS底座方案 | 移至[平台底座未来规划](../未来规划/平台底座-通用化与开源方案.md)并改名；工程需求/接入/验收归并PCH，保留外部宿主及开源产品化前置，初版原文保全 |
| 现行README、总导航及相关专项链接 | 按新位置更新，旧目录不留第二套现行正文；历史快照内部链接保持原字节，由原source路径解释 |

原AI Native Runtime/SDK方案、SaaS订阅和租赁平台总业务需求仍独立，未按名字机械归并。原方案章节→现行归属映射见新未来方案§1。所有业务代码、测试和未知WIP未修改；搬迁的原设计/部署文件及历史快照保持原内容。

工作树：`D:/工作文件/rental-OS/.claude/worktrees/core-platform-docs`；分支：`docs/core-platform-boundaries-20261031`；固定基线：`6820e06e9daef877637bc2de4effba2bfa0713b1`。这里只定位证据，不是reset目标或主线已整合声明。文档树从固定提交建立，未复制主树并行代码WIP。

### 2.2 现有接点及缺口

前置只读核查覆盖当时主工作树；本阶段固定提交建立文档树并定向核对相关接点。下表说明静态依赖，不替代全量审计、实际运行或独立接入验证。

| 场景 | 当前实际入口/消费者 | 可复用与未实现边界 |
| --- | --- | --- |
| 应用装配 | [AppModule](../../../apps/api/src/app.module.ts)注册平台和Rental具体服务 | 有集中装配入口；未形成跨业务Core的独立宿主合同 |
| 租户/空间创建 | [PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)、[PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts)调用租赁注册、品类版本和采用政策 | 有同事务回调；平台生命周期仍绑定Rental模型，不能直接换CRM适配 |
| 身份和权限 | [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)、[ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts)消费租赁品类/能力及业务路径 | 当前授权/隔离需保留；公共上下文与业务策略分派尚需解耦 |
| UI装配 | [navigation](../../../apps/admin/src/app/navigation.tsx)、[AppRouter](../../../apps/admin/src/app/AppRouter.tsx)包含Rental能力类型及逐页静态挂载 | 可复用壳和统一路由描述；没有已交付的跨Core页面模块接口 |
| 租赁扩展 | [capability-hook.runtime](../../../apps/api/src/modules/rental-core/capability-hook.runtime.ts)登记租赁Hook与实现版本 | 是行业内扩展，不是业务Core装配；CAT-GOV继续负责品类定义/采用 |
| AI通用机制与业务适配 | [应用providers](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[runner端口](../../../apps/api/src/modules/ai-native/runner/ai-task-runner.ports.ts)、[预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts) | 已有端口分工；装配依赖租赁服务、预算仍导入Rental指纹工具，runner合同还含Prisma类型；不等于独立可用底座 |
| 数据与共享合同 | [Prisma](../../../apps/api/prisma/schema.prisma)、[shared出口](../../../packages/shared/src/index.ts) | 同库/共包可暂保留；尚无Core数据所有权/公共合同独立构建及非Rental宿主证据 |

### 2.3 未完成交付

- PCH-01/02：全面依赖/所有权清单、真实消费者、正式合同唯一出口、样例边界及存储/事务决策仍待实施阶段核实。
- PCH-03～08：无Rental宿主、授权/生命周期/服务/UI边界和Rental重新接入没有工程交付。
- PCH-09/10：非Rental AI适配、持久化样例及独立接手试验未完成；不继承原AI/MCP成果的完成度。
- PCH-11/12：指南是提前准备版本，尚无实际包/构建/运行组合；合同测试、真实环境、兼容回退和独立审查未完成。

### 2.4 验证边界

本阶段只验证文档链接、格式、任务/验收映射、修订前像与原范围保留。业务源码、迁移及仓库检查器未修改；未运行应用、业务测试、Prisma、数据库、模型、MCP Host或供应商联调。没有独立代码审查，文档一致性检查不能提升PCH或CAT-GOV研发百分比。

| 实际命令/核对 | 退出码/结果 | 证明范围 |
| --- | --- | --- |
| `npm run docs:check` | 1；11份白名单文档，3个旧归档链接缺失 | 固定提交不包含`docs/历史归档/`的原全量快照/整合前文件；未删除引用或造文件变绿 |
| `node output/core-docs-20261031/verify-docs.cjs` | 最终0；27份现行/索引文档、555个链接，0个本次新增问题；53个已有缺失引用单列 | 按修订前文本和固定Git文件清单证明缺失归档/本地日志早已不在此基线；不是全库链接通过 |
| 同一定向核对 | 7份修订前像SHA-256/字节数一致；原14任务正文/依赖/百分比及22验收保留；PCH12项齐全 | 迁移后的原实施设计/部署检查与Git正文仅Windows换行差异；相邻7份专项只改链接目标 |
| `git diff --check` | 0 | 已跟踪文档差异的空白格式；新增文档表列数由定向核对覆盖 |
| `node output/core-docs-20261031/check-moved-references.cjs` | 0；57份现行文档无已搬迁目录的旧引用 | 不扫描历史原文，不检查外网；最初内联命令因shell转义失败，改成本地脚本后通过 |
| 独立文档一致性检查 | 指定6份文档，未发现必须修复的文句冲突 | 只检查两层边界、依赖、设计/实现区分及安全/历史/unknown要求；不是代码审查或运行验收 |

定向检查首轮退出1，列出原附件缺失，并把Git LF与工作区CRLF误判成两份原设计变更；随后仅修正本地核对方式：原附件按修订前同目标且不在固定提交中单列，原设计按规范化换行比较。未改变仓库`validate-docs.cjs`或业务断言，没有通过删除原附件引用掩盖问题。临时整理/验证脚本、保全及报告留在本树`output/core-docs-20261031/`，不作为平台能力产物或提交范围。未运行`test:docs`，因为仓库检查器没有改动。

旧归档和本地验证日志需后续由资料所有者核对是否纳入可携带证据；本次未读取或复制其他工作树的未跟踪成果。

### 2.5 文档提交与主线整合授权

负责人在本阶段整理完成后明确要求：“把这次文档改动提交并合入main，别带上其他改动”。授权仅为本片文档固定提交和本地主线整合，不扩展到代码、测试、迁移、其他WIP、推送或部署。提交前再次核对暂存区、目标文档与main未提交归属；主线的其他修改保持原位，不用stash/reset/clean处理。本片独立文档一致性检查已完成，原`docs:check`缺历史附件边界继续保留，不作为提交后已修复。

提交前发现Git默认换行归一会让快照工作区CRLF与暂存blob的LF不同，两个历史快照目录各增加仅针对原文文件的局部`.gitattributes -text`，重新暂存并按blob核对manifest哈希，保证主线检出后仍可验证原字节。没有修改全仓库换行配置或历史正文。

## 3. 后续记录规则

每个完整阶段记录任务ID、固定源码/合同、真实入口和直接消费者、数据/权限/事务边界、已做/剩余、实际命令与退出码、验证层级和残留。近期保留最近一个月，超期先移入本专项`历史归档/开发过程/YYYY-MM.md`再移出近期区，未解决事项保留摘要；不另建“最新总计划”或逐次修复流水。

<a id="core-contract-first-20261114"></a>

## 底座拆分开工：独立清单合同与兼容指纹抽取（2026-11-14）

### 授权、主线与写入范围

负责人明确“开始拆吧”，并要求持续维护接入手册、使用最新 main、只做必要测试且写入规则。复用 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，从当时实际远端/main `4720db2a8aa1d4c82e3cdabe62ef062dc06c3768` 新建 `codex/platform-core-extraction`。原准备树干净、暂存区为空、无合并/拣选状态，原 `1663171c1` 已在主线，未复制环境或旧工作目录。

负责人提醒后再次 `git fetch origin main` 并核对 `ls-remote`。主线后继 `6ca19ac34a3260405ba24388a4aa2a933450e70b` 只涉及后台语言/主题图标及原记录，执行 `git merge --ff-only` 前进到该版本，17 个本片已有修改/新增文件的 SHA-256 前后相同。源码与 schema 清单按该新基线核定；后续阶段开始前继续读取实际 main，只整合已提交固定增量，保护本片 WIP。

PM 随后明确本片唯一窗口：`packages/core-contracts`、必要根 lock 条目、`common/request-fingerprint.ts`、`operation-log.service.ts`、`integrations/file-content-binding.ts` 及 Rental 幂等仓储的等价兼容再导出。shared 总 index、OpenAPI、AuthGuard、AppModule/AI providers 与 AI 任务目录仍归 AI/PM 既有窗口。AI 不需停工或同步改旧出口；下一片的公共接点先列于原接续，由 PM 主动核定。当前消息未要求回复，没有跨对话通报。

### 01：实际依赖、数据与消费者基线

以新基线 Git 文件集检索源码类文件，得到 9,789 项，其中保留的上游 Harness 为 6,133 项，剩余 3,656 项是自有/引入组件/原型/测试的待归属集合，不能全部当自有代码。API 964、shared 144、后台 665、客户小程序 202、员工小程序 205、客户网站 71、企业门户 44、MCP 59、Harness 插件 12、脚本 46、测试/fixture 793；其他组件、营销站和原型沿原目录保留。此为全文件集合与模块定位，尚非逐文件逻辑、注释和接口全覆盖验收。schema 有 238 个模型、259 份历史 SQL 迁移，未执行或改写。

用 TypeScript AST 读取固定 API/shared 源码的 import 和可静态识别的仓储调用。指向 `rental-core/` 的 import 声明包括组合 AppModule 41、common 2、OpenAPI 1、Auth 8、平台域 16、订阅 1、文件 3、集成 9、客户 API 16、企业 41、AI 474。数量含类型引用，不代表全部都是错误依赖；AppModule 的显式组合、Core 业务适配和公共内部依赖须分别判断。没有依靠该计数删除文件或改业务。

| 实际链路 | 原行为、数据所有者与第一处要拆的连接 | 本片结果及后续验证 |
| --- | --- | --- |
| [启动](../../../apps/api/src/main.ts) → [AppModule](../../../apps/api/src/app.module.ts) → 各服务 | 当前启动执行环境加载与监听，组合直接注册 Rental/AI/企业及公共服务；不适合作为离线导入入口 | 本片不加载启动。03 后续拆受控宿主，保留原组合及单一作业执行者 |
| [Auth](../../../apps/api/src/modules/auth/auth.service.ts) → [平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts) → 会话/ALS | `findUserForLogin` 查询 tenant 时带 rentalProfile；Auth 注入 WorkspaceCapabilityService；可信主体、会话与当前角色来源必须保留 | 登录/租户普通设置仍依赖 Rental。下一片先固定公共身份与 Rental 业务范围适配，不删原 Guard 条件 |
| [平台服务](../../../apps/api/src/modules/platform/platform.service.ts) → `bootstrapTenant/createTenantBusinessWorkspace` | 创建租赁租户/空间使用同事务 Rental 初始化回调；缺回调明确拒绝，提交后才刷新缓存 | 原行为保持。将公共租户初始化与 Rental 绑定分开需独立入口和同事务合同，不能直接把回调改成可选成功 |
| [订阅](../../../apps/api/src/modules/subscription/subscription.service.ts) → 租户统一期限/权益 | Subscription/FeatureGrant/Event 属平台商业事实；品类可用性另引用 Rental category-identity | 保留统一期限、善后及撤权。行业可用性后续经已登记适配供给，不复制收费模型 |
| 平台仓储 → 用户/角色/组织；会员与企业结算 → Rental 事实 | Tenant/User/AuthSession/Role/Permission/OperationLog 等是公共候选；BusinessWorkspace/WorkspaceMember、租赁客户会员/企业资格/授信与订单仍有业务约束 | 核出平台目录还写 RentalOrder、品类采用与会员业务。后续逐所有者分离，不能整目录搬成通用层 |
| [审计](../../../apps/api/src/common/operation-log.service.ts) / [文件绑定](../../../apps/api/src/modules/integrations/file-content-binding.ts) → 请求指纹 | 两者为计算摘要反向 import Rental 幂等仓储，加载了无关 ORM/业务依赖 | 本片改到纯公共函数；原仓储保留相同路径导出，已存指纹不变 |
| [文件 ACL](../../../apps/api/src/modules/files/file-business-access.service.ts) / [支付运行时](../../../apps/api/src/modules/integrations/payment.runtime.service.ts) | 存储运输与业务归属相邻；Rental 金额、原订单/文件授权、回调账由原业务裁定 | 本片仅抽指纹，不改 payment/file-storage 的企业/AI 活动区域。后续逐业务回调与 ACL 接点拆分 |
| [Rental](../../../apps/api/src/modules/rental-core/rental-core.service.ts) / [业务服务](../../../apps/api/src/modules/rental-core/rental-business.service.ts) → 原仓储/快照/作业 | 配置、报价/库存/资金、历史版本与原幂等归 Rental；[到期调度](../../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts)在原事务/锁中执行 | 仅保留幂等函数旧出口；算法、事务和原标识未变。原报价配置混用及 fixture 问题仍在 Rental 原接续 |
| [后台导航](../../../apps/admin/src/app/navigation.tsx) / [路由](../../../apps/admin/src/app/AppRouter.tsx) → [会话](../../../apps/admin/src/features/auth/authStore.ts) / [缓存](../../../apps/admin/src/app/queryClient.ts) | 当前壳识别 Rental 品类/能力，Vite/tsconfig 仍指 shared 源码；会话/租户/空间变化清理并隔离迟到响应 | 本片未改 UI。07 需扩 Core 命名空间并保留旧深链接、主题/语言和未保存保护 |
| [客户 API](../../../apps/api/src/modules/client/client-api.service.ts) / [企业](../../../apps/api/src/modules/enterprise/enterprise-read.controller.ts) → 网站/门户/小程序 | 现有客户端继续通过原 audience、会员/企业授权和受权订单投影使用 Rental；不能改成租户员工授权 | 作为后续兼容消费者，源码基线已定位，本片未做宿主/浏览器复验 |
| [AI 组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts) → 原工具/批准/执行/恢复；MCP/Harness消费 | 现有大量指纹引用仍走旧 Rental 出口；它们包含原任务/账/收据语义 | 本片兼容再导出足以保持引用；AI原15/25继续其窗口，不对其批量改 import 或扩大测试 |
| [shared](../../../packages/shared/src/index.ts) → DTO/[OpenAPI](../../../apps/api/src/contracts/openapi-document.ts)/各端 | shared 同时包含运行时和 Rental/AI 合同，platform.ts 仍引用 Core 类型；不能视为纯平台包 | 新跨业务清单归独立正式包，不复制旧 DTO；新包不反向依赖 shared。原HTTP语义/操作保持 |

上述原功能状态一律区分来源和层级：未运行当前场景记未验，原专项记录中的成功只作固定证据入口；已知失败仍由原专项维护。本片不声称“现有所有功能已验证正常”。后续登录、租户/角色/订阅、Core授权、业务/各端、AI/回调/作业每个受影响切片必须取得前后对照。

最小非租赁样例冻结为简单工单：以租户为范围，不引入经营空间/资金/库存；对象包含标题、说明、创建者、受派成员、`open/in_progress/closed` 状态和修订。基本流程为创建→分派→开始处理→关闭，管理者按角色查看/分派本租户工单，普通成员只读本人创建或获分派对象，正式状态更新需当前授权及修订；同键提交读原收据。样例实际持久化、UI、同租户多 Core 授权与停用恢复待10，当前测试中的 `example-tickets` 仅为清单夹具，不冒充该业务样例。

### 02：已落地的正式契约与兼容抽取

- 新建 [core-contracts](../../../packages/core-contracts/README.md)，正式包名 `@rental-os/core-contracts`，`0.1.0`，唯一字段来源为 [manifest schema](../../../packages/core-contracts/src/manifest.ts)，类型由 Zod 推导。独立包只依赖既有固定 Zod，不引用 shared/Rental/Nest/Prisma；根 lock 只增该 workspace 及其链接，既有依赖记录逐项相同。技术命名沿现有 scope，品牌讨论不触发本片全量改名。
- [版本与组合检查](../../../packages/core-contracts/src/compatibility.ts)区分底座、合同、Core、数据和 Node；首版兼容范围为确定三段数字版本的闭开区间，支持空/单/多 Core 组合，拒绝重复标识、未知必需能力和不兼容版本。Core 单独升级不修改其他版本，实际迁移/部署仍待后续实现。
- 清单包含包内入口、可选后台/AI/OpenAPI/作业/事件、权限资源/动作、自有 tenant/container 范围、来源和迁移摘要。[对象引用](../../../packages/core-contracts/src/reference.ts)用元组表示 Core/租户/容器/对象边界，只作定位，不授予权限或替换历史幂等键。
- [只读目录检查](../../../packages/core-contracts/src/package.ts)及[命令](../../../packages/core-contracts/src/check.ts)检查声明和文件、迁移摘要及指定宿主兼容，输出可读/JSON 与稳定退出码；不加载 Core 代码。下载/安全解压、完整包摘要锁定、实际模块合同/装配、权限/生命周期/事务及 HTTP 贡献尚未交付，不能称可安装业务 SDK。
- [请求指纹](../../../apps/api/src/common/request-fingerprint.ts)从原 Rental 仓储等价移出，函数正文与新基线逐字符（只归一换行）相同；审计和文件绑定改消费公共入口，Rental 原路径再导出。既有 JSON/排序/异常语义全部保留，不借抽离修历史指纹算法。
- [接入说明](../../../packages/core-contracts/README.md)与命令同片交付，明确当前可执行的清单/目录检查、错误定位、版本与源码路线。完整五步手册仍在原任务内维护，后续依据实际可运行宿主/样例生成随包指南；不另建手写第五册，不让 Agent 将待开发步骤当成已可执行命令。
- 根 [AGENTS](../../../AGENTS.md#修改验证与交付)按负责人要求强化“只做必要测试，不编写大量测试脚本”。本片清除自己新写的单独运行器，保留一个合同测试文件及全部有效断言；该检查没有已有入口可替代。原业务测试不新增/扩写；指纹对照通过 stdin 短命令完成。

### 实际验证、缺口与交付边界

| 验证 | 实际结果 | 证明范围 |
| --- | --- | --- |
| `node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs` | 8组通过，退出0 | 使用本树实际 TS 编译产物，类型/反向行业依赖、版本/范围/对象隔离、目录/链接/摘要和CLI；没有租户/持久化/业务成功假设 |
| `node --no-compilation-cache -` 指纹前后对照 | 退出0，22个输入/异常对照与原函数正文相同，文件绑定实际消费者结果相同 | 新旧摘要字节、边界输入、异常类型与原出口；未执行资金或任务 |
| `node --no-compilation-cache -` 公共指纹类型检查 | 退出0 | 新公共文件完整类型；不等同全API/客户端组合构建 |
| `node --no-compilation-cache -` 原仓储出口导入 | 退出0，新旧出口为同一个函数，未加载Prisma | 通过既有ts-node只读编译、不启用测试装饰器元数据；验证原导入路径兼容，不等同Nest生产装配 |
| lock JSON逐项对照 | 退出0，只增两个workspace记录 | 既有依赖/锁定未改变；本片未安装依赖 |
| Git状态与更新 | 远端main核定为`6ca19ac34`，本树从4720快进且WIP哈希保持 | 只更改独占分支；main索引和其他树未写 |
| `node --no-compilation-cache -` 文档定向核对 | 退出0，4份改动文档191本地链接/26锚点无新增问题；任务正文与进度原文未变 | 复用原检查器API，稀疏树外目标以同一固定Git树只读核定；不改检查规则 |
| 原 `validate-docs.cjs` 白名单逻辑，固定Git补足稀疏目标 | 11份可读，3个既有历史附件缺失 | 缺失仍为总导航第54行原三附件；未删引用、伪造历史或称全库文档通过 |
| 原 `mcp-original-audit.test.cjs` 的隔离执行/退出清理 | 执行前被自动审批拒绝，返回 `blocked by policy`，无进程退出码 | 命令未启动，`output/.tmp/pch-fingerprint`不存在；本片原MCP审计回归未验，没有换壳/绕过拒绝 |

测试只读使用主树已有且与锁文件匹配的 TypeScript 5.9.3、Zod 3.25.76、@types/node 22.20.1，经本轮命令的 `NODE_PATH` 定位，无跨树 junction 或复制 node_modules，产品/测试代码不硬编码其他树路径。正式声明仍使用 npm workspace 和锁文件。全部测试编译与夹具集中在本树 `output/.tmp/core-contracts`，测试 `after` 清理并确认移除；stdin核对不落脚本。不读取 `.env`、不连接数据库/供应商/模型、不启动服务，没有新后台进程。

本片是01/02的首个独立实现阶段。完整数据所有者/迁移链、所有消费者逐项核验和业务基线尚未完成，02的运行模块/当前授权/生命周期/受限事务及真实双Core消费者也未齐；因此不凭新增文件或8组测试提高原任务百分比，仍由原门槛核收。完整API构建、真实持久化/浏览器、独立接手、迁移/恢复和独立审查未实施。后续公共窗口与具体下游入口见现行接续。

阶段代码、根规则与接入说明固定于 `a8da7ae1e47b289e9b8cc72f607b74e14cbdf4b6`，包含19份明确归属文件；`git push -u origin codex/platform-core-extraction` 成功，随后 `git ls-remote --heads origin codex/platform-core-extraction` 回读为同一SHA。提交时主线基线为`6ca19ac34`，本树工作区/索引干净。没有合入main或通知其他对话；当前记录/接续的固定证据补记另随文档提交上传。

<a id="core-admin-contract-20261114"></a>

## Core页面单源声明合同（2026-11-14）

本地打包/待部署准备固定于 `25c713a5b8a5d217bb0a6213c4f5978163d6a5d3` 并已推送回读。本片沿v1.4最少声明要求，在独占[admin合同](../../../packages/core-contracts/src/admin.ts)增加路由/名称/菜单/父级/权限的唯一schema和类型，以及组件引用、页面操作类型、注册与本地路径解析。操作分为navigate/open/command/save，真实处理方法和Form仍由Core代码提供；没有通用表达式执行器或第二套按钮实现。

`registerCoreAdminPages`在清单后台贡献存在且Core/版本相符时注册，检查本Core页面ID/同形路径/权限目录、父级缺失与循环；跨Core同名页面使用各自命名空间。组件引用不调用，错误不返回部分表。`resolveCorePageLocation`只解析已登记目标和完整参数，并编码对象ID，未知/额外参数、路径控制值明确拒绝。注册表不授予权限；原路由/Guard/页面生命周期仍须按07接线。

原单一合同入口含新增完整类型，8组通过/退出0；stdin核对空/双Core、同源名称/菜单、编码参数、未知目标、重复/同形/循环、未知权限及外部/重复参数路径拒绝（退出0），组件调用计数为0。现有测试文件未扩写，临时编译目录由原after清理。模块说明含最小真实schema例子、四类操作语义和当前未接线声明；React自动呈现/主按钮/表单/默认页面及真实租户权限尚未完成，不能将合同通过计为07宿主验收。

<a id="core-tickets-domain-20261114"></a>

## 非租赁工单领域与 MySQL 适配（2026-11-14）

前片React适配已中文提交并上传 `595edf963e992530b19a8a56f49c80cc14757844`，GitHub真实远端回读一致、起点干净，main仍为已包含的 `275064d40`。沿原PCH独占模块/非冲突源授权新增 [example-tickets-core](../../../packages/example-tickets-core/README.md) 和根lock必要workspace条目；没有改公共Auth/Guard/AppModule/schema/迁移链或活动后台壳，原PCH任务身份/百分比不按代码数量变更。

这是原已冻结的非租赁工单样例实现，不再只是包格式夹具。[领域合同](../../../packages/example-tickets-core/src/contracts.ts)/[服务](../../../packages/example-tickets-core/src/service.ts)提供创建、分派、开始处理、关闭、读取及原操作回执。租户为唯一业务范围、普通成员只读创建/受派对象，管理者仍须具体业务权限；状态只open/in_progress/closed，更新核修订。同键同输入复核当前授权/可见范围后读原结果，同键变化拒绝；原收据不被当前状态替换。

[MySQL适配](../../../packages/example-tickets-core/src/mysql.ts)提供实际参数化SQL和Prisma兼容窄事务入口，[独立迁移](../../../packages/example-tickets-core/migrations/001-tickets.sql)只归该Core，不进入原公共组合迁移链。执行器先由真实宿主authority锁人员/授权及受派者，再取本租户Core写锁，业务/原回执/原平台审计同一事务；异常抛出回滚。领域出口不泄漏Prisma，私有mysql仅用已有驱动Runtime/SQL模板、不依赖生成的Rental模型。首次类型检查暴露主依赖目录未生成Prisma组合client，因而收窄为实际用到的驱动接口，不生成/复制另树Client或补假模型。

[服务端贡献](../../../packages/example-tickets-core/src/server.ts)消费正式CorePrincipal/Binding，拒绝错误Core/租户/容器，读取当前绑定数据版本；[清单生成](../../../packages/example-tickets-core/src/manifest.ts)注入真实固定来源、声明权限和不可变迁移摘要，独立实现/数据常量分别维护。没有业务初始化、AI或伪HTTP/页面贡献。没有移除检查器时不能据此移除历史执行者。包说明随片记录实际方法/权限/锁顺序/迁移/构建和待接线范围。

必要验证为6根新源码完整类型0诊断、反向行业/宿主导入0；stdin运行真实领域、MySQL适配与标准注册器，离线事务/权限替身覆盖完整创建→分派→处理→关闭、原收据、状态/修订/成员/租户/audience拒绝、撤权先于业务查询、审计失败回滚、参数化SQL及迁移摘要，退出0。替身不证明真实DB锁/原授权或持久化恢复，也不证明HTTP/UI已接通；真实宿主authority、迁移应用、Controller/页面、双Core组合及独立接手继续待交付。没有新增测试脚本、安装依赖、启动服务或连接业务库。

3份文档306条链接定向核对新错误0；root lock原所有条目逐项保持，只增本Core workspace和链接两项，包依赖一致；需求/任务原文未变，`git -c core.whitespace=cr-at-eol diff --check`退出0。构建产物未复制或落地，无新增测试/诊断文件。

临时残留：新增MySQL文件最初放在独占API适配目录，随后用apply_patch移入本Core，留下两个空目录。安全核定后原生PowerShell删除命令在执行前被自动审批拒绝（`blocked by policy`），没有退出码；未换工具/壳或移动以绕过。零文件/零字节的两目录仍在原位，唯一责任清单为主树 `output/.cleanup-pending/pch-preparation/tickets-core-empty-dirs/manifest.json`，记录原路径、归属和恢复条件，未提交Git。其余本任务验证临时目录仍已删除，不能把本片空目录说成已清理。

<a id="core-react-page-adapter-20261114"></a>

## Core 页面声明复用原 React 组件（2026-11-14）

Topic片已提交上传 `0ea168622c90301a4e431220acc68ead74d037c2`，真实远端回读一致。复核PM原当前派工的“PCH独占清单、模块合同及非冲突源继续”，本片仅新增[CorePage适配](../../../apps/admin/src/core/CorePage.tsx)/[正式出口](../../../apps/admin/src/core/index.ts)/[源码说明](../../../apps/admin/src/core/README.md)，以及未有活动WIP的admin包配置和根lock单一依赖项；原AppShell/BusinessShell/PageHeader/顶栏/样式正由main后台作者修改，均只读，不覆盖。shared总index、Auth/Guard/原AppModule及AI目录没有扩大修改。

CorePage消费原 `@rental-os/core-contracts` 的页面和动作类型，标题从当前注册项取得；按钮按navigate/open/command/save选择原Button、ActionButton、ConfirmAction和SaveButton，经原PageHeading/WorkspaceHeader呈现。没有新样式、vendor修改、UI框架或页面JSON解释器。动态权限由宿主当前回调供给，执行前重验、无权正文不挂载；路由对象/身份代次变化释放旧页，确认等待/离页回调不持有旧授权，最多一个主操作、操作ID唯一。真正授权/缓存失效仍由后端和原宿主负责，不能使用恒真回调装配生产。

表单保留真实Form、validateFields及mutateAsync，原SaveButton继续同步防重复、关联原Form与保存快照；非保存动作不假显示保存成功。普通错误走原反馈，字段错误留原Form，确认走原原位状态；业务拒绝/unknown由各Core类型化API抛错与原收据处理，不猜测任意响应或自动重发。接入指南给出路由单源、打开编辑器和保存的短例子，未实现的业务方法明确标注。

admin增加对本仓合同包的正式依赖，predev/prebuild/prelint先构建本树合同产物，不增加Vite深层源码别名；安装依赖、应用启动和本树dist构建本片未执行。最终完整类型使用TypeScript CompilerHost只读依赖映射，648根/3989源、0诊断；首轮验证映射重复识别React产生21条ref类型错误，统一只读真实路径后通过，未改产品类型约束或原组件。AntD6.6 Form/Button API与Form例子已查，新组件lint0问题，原263 vendor哈希异常0。

stdin核对实际CorePage JSX的四类组件选择、受控导航、打开不提交、确认同一Promise、当前撤权、原Form/值传递、离页拒绝、无权页和单主按钮，退出0。另直接核对原SaveButton/ActionButton的校验顺序、真实Promise、防重复、原form ID/native submit防双发及失败不记保存，退出0。这些使用hook/宿主facade，是离线行为证据，未证明真实React挂载、portal/回车、浏览器样式或服务端授权。没有新增测试脚本或临时文件，原已清理目录保持不存在。

4份文档的326个本地链接/44个锚点定向通过，admin包与root lock依赖一致，原需求/任务正文未改；`git -c core.whitespace=cr-at-eol diff --check`退出0。最终反馈回调补齐后，完整648根类型复验仍0诊断，新组件AntD lint仍零问题。

**剩余接线：** 原AppRouter/导航须在公共窗口供给真实Core注册/授权/成员分配、lifetimeKey、可访问目标和缓存代次，再以轻量工单真实业务页核对原壳。当前新增适配尚未有已装配路由消费者，仍不能称无Core/多Core后台完成或独立前端包已发布；列表/详情模式继续复用原组件，后续按实际重复需求补最短接入面。PCH-07原前置/完整门槛保留，本片不以类型通过计整项完成。

<a id="core-github-discovery-20261114"></a>

## Topic 发现与离线查询状态（2026-11-14）

固定Release片已提交并上传 `96ce79dac0211bec335e46ea0d9f0ba223e82dda`，实际远端回读一致、工作树干净、main `275064d40`仍已包含。继续原包独占窗口，为后续PCH-07发现面提供[Topic查询](../../../packages/core-contracts/src/github-discovery.ts)；[只读传输](../../../packages/core-contracts/src/github-http.ts)从原Release实现移出后两者共用，没有第二套下载或本机凭据通道。

查询仅在公开未归档仓库的 `nativark-core` Topic中按名称/简介检索，拒绝原始查询表达式；每页20、上限1000符合GitHub官方[仓库搜索](https://docs.github.com/en/rest/search/search#search-repositories)。返回查询时间、来源/许可、下一页和不完整标记，候选明确为unreviewed/unchecked，不从标签推断Core身份或可安装性。单实例保存最近50页、5分钟缓存，并发同查询复用读取；手动刷新可跳过缓存。失败返回unavailable和准确原因，若有旧页只附stale原时间，不伪造成功空列表、不影响已安装组合；调用者不能通过修改返回对象污染缓存。

原GitHub命令新增discover，实际实现/命令/缓存生命周期及展示要求同步[接入说明](../../../packages/core-contracts/README.md#发现公开-core-仓库)。原单一合同入口8组/完整类型通过；stdin核固定Topic/分页、上限/查询拒绝、fresh/cache/stale/离线/限流/格式错误、并发去重/返回隔离和原Release解析均退出0。全部HTTP为离线响应，不把搜索逻辑验证当作真实GitHub结果或后台界面通过；没有新增测试脚本、依赖、网络业务访问或后台进程，原测试临时目录已删除。

CLI失败JSON/退出1、缓存容量淘汰和时钟回拨刷新另以stdin核对，退出0。3份文档324条链接定向核对新错误0，需求/任务原文不变；原白名单仍仅总导航3个既有历史缺失，`git -c core.whitespace=cr-at-eol diff --check`退出0。

独占范围的目录发现和固定包准备继续分开。仓库根清单/同仓索引到发行的核对、安装状态/授权/版本管理界面及真实部署仍待宿主公共窗口；不得用本片替代完整PCH-03/07/10/12。再次尝试只读浏览器仍在初始化返回kernel assets路径缺失，未获得实页；营运商简称实际宽度仍由原后台记录承接，不以离线字宽代替。

<a id="core-github-release-20261114"></a>

## 固定 GitHub Release 与本地准备共链（2026-11-14）

阶段基线为已上传并回读的 `2cf775ce9664c7666666d32622c311466bb9777d`，当日再次读取实际远端main仍为 `275064d40a3977542a530158974070e8b6c337ca`，本树已包含该提交。修改仅限独占 `packages/core-contracts` 和原PCH记录/接续；无合并、拣选或他人WIP，完整宿主/后台公共窗口继续沿原候选表。

[GitHub入口](../../../packages/core-contracts/src/github.ts)与[命令](../../../packages/core-contracts/src/github-release.ts)为公开仓库提供显式inspect/prepare。Tag固定为 `v<版本>`，同仓多Core为 `<Core ID>/v<版本>`；资产固定 `<Core ID>-<版本>.tgz`。inspect解析真正的Tag引用和附注对象，锁定仓库、提交、Core/实现版本、Release/资产ID、字节数与GitHub SHA-256；不将活动分支target_commitish当提交，不读本机环境/凭据。

prepare在下载前后复核固定资料，限制时间、字节数和GitHub HTTPS下载跳转，然后复用原[安装准备](../../../packages/core-contracts/src/install.ts)。新增可选预期来源输入在任何候选写入前核对清单ID/版本/仓库/提交；未传时旧本地入口语义不变。重复仍核原字节、被用户修改仍拒绝，结果仅deployment=pending。网络、限流、Tag移动、替换资产、未知摘要、错误来源和包检查失败均不改变活动组合；响应体/签名URL不写错误日志。

必要验证和边界：

- 原单一合同测试退出0，8组通过；包含全部新增源码类型及反向依赖检查，没有新增或扩写测试脚本。
- stdin离线HTTP响应＋实际文件准备退出0，覆盖轻量/附注Tag、同仓Tag、200/302下载、重复、移动Tag/替换资产/来源不符、无摘要、限流/离线、非GitHub/非HTTPS跳转、用户修改拒绝；没有对外下载Core。夹具入口抛错，用于确认检查/准备没有加载包代码，不是非租赁业务实现。
- 读取中断、取消已失败的响应、过大JSON和CLI实际schema/分支/纯JSON/退出码用stdin定向复验，退出0；取消错误不覆盖原HTTP/网络诊断。CLI文件读取facade只证明参数和调用映射，不能代替真实GitHub发行运行。
- 查阅GitHub官方[Release](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)、[资产](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)、[引用](https://docs.github.com/en/rest/git/refs#get-a-reference)及[附注Tag](https://docs.github.com/en/rest/git/tags#get-a-tag)。Tavily搜索/提取均因额度返回432，改为直接读取官方公开文档；refs首次连接EOF后重试200。这是文档研究，不是标准Core发行下载验收。
- `output/.tmp/core-contracts` 与 `output/.tmp/core-github-release` 均经finally清理并核实不存在，无新服务、依赖副本、数据库/模型或发布操作。
- 定向5份文档核对388个本地链接、71个锚点、47个表格，新错误0；需求/任务原文及12行原任务不变。原白名单的3个总导航历史附件缺失仍在，未以删引用或改检查器处理。`git -c core.whitespace=cr-at-eol diff --check`退出0。

[接入说明](../../../packages/core-contracts/README.md#从-github-固定发行准备)同片加入作者包名/Tag/发布步骤及部署者两条命令、来源锁、结果和错误处理。Topic搜索/缓存/界面、受控组合构建、真实部署注册、非租赁持久化和独立安装/更新验收仍待交付；没有用下载或格式夹具关闭PCH-03/10/12。原PCH完整G1接点/消费者尚未齐，本片不以源码或用例数量计分。

<a id="core-local-package-install-20261114"></a>

## Core 本地打包与安装准备（2026-11-14）

沿原独占合同包完成PCH-03可独立的文件准备切片。此前新增营运商简称最小窗口的检查点已固定于 `982043aba913745c6d0e258b2d74ca1efb9a98d4` 并推送/回读一致，其类型/数据/源码证据与剩余实测宽度只见[后台原记录](../../管理后台/管理后台-开发记录.md#operator-short-name-foundation-20261114)，不挪作PCH研发完成。

[包检查](../../../packages/core-contracts/src/package.ts)将目录读取和内存文件快照接到同一清单/文件/迁移/OpenAPI检查，保留原入口/错误/CLI语义。新打包只读取清单明确声明的入口、资源、迁移及文档；额外源码/构建材料须显式声明，禁止读取实际环境/Git元数据/依赖目录。[安装准备](../../../packages/core-contracts/src/install.ts)与[打包命令](../../../packages/core-contracts/src/pack.ts)/[准备命令](../../../packages/core-contracts/src/prepare-install.ts)使用原USTAR+gzip格式和整包摘要；不下载安装依赖、不执行Core源码或修改活动组合。

安装先完成摘要/格式/兼容/包内容检查，再在部署者指定的既有独占根创建暂存，完整写入后发布以Core/版本/完整摘要确定的候选目录。成功只为prepared/deployment=pending；重复请求逐文件对照原字节后返回already_prepared，原目录被修改、缺件或带链接时拒绝覆盖。失败经finally核定路径后清理本次暂存，当前运行目录、授权/绑定、数据库和其他候选保持。精确的单文件输出采用wx，失败删除自己刚创建的半包，已有输出文件从不覆盖。

必要验证复用原单一合同测试（8组与新增完整类型通过，退出0）；stdin在 `output/.tmp/core-package-install` 编译并创建最小格式fixture，实际运行目录打包、待部署写入、重复导入、已有用户改动保留、坏摘要/缺兼容/未声明文件拒绝，以及pack/prepare两条CLI（退出0）。包内服务代码为抛错哨兵，验证未被执行。其余未声明文件未被纳入，原包重复输出被拒绝且字节保持。该临时目录含源码产物/包/解包文件，finally已全部删除并核实；没有新增测试脚本或后台进程。

当前属于本地可复现文件准备；宿主装配、注册/租户授权/成员分配、Core持久化业务、远端Release/Topic、实际升级/迁移、独立接手仍未验。接入说明同片给出路径、命令、输入、JSON状态、退出码和下一步，不把准备成功显示为业务已启用；PCH原门槛不凭文件操作通过提高。

<a id="core-declarative-pages-20261114"></a>

## 完整后台外壳与声明式业务页面澄清（2026-11-14）

负责人在持续拆分过程中明确：左侧菜单区域、右侧内容面包屑整行、铃铛/休息/收展都属于底座，无业务Core时保留；Core只提供业务菜单、正文和业务主按钮。随后要求开发者在对应路由页面声明主操作，即使用已设计好的按钮与交互，并将减少重复工作的原则推广到其他常见页面能力。以上为本次修订依据，无需重问已确认产品意图。

需求/任务升为v1.4，新增需求1.9、扩充原R07/R11/A07/A11，以及原02/07/11、任务[页面声明合同](平台Core接入-开发任务.md#declarative-page-contract)、五步入口和Agent模板；原12项任务行、编号、依赖、顺序和百分比不变。要求覆盖单源路由/菜单/面包屑/标题、页面主次动作、原保存/确认语义、标准列表/详情/表单、请求/错误/权限状态与可选通知文件接点；特殊业务可提供正文，仍复用公共壳。公共设置自身的保存仍可用，“无业务主按钮”不删除公共设置操作。无Core保留辅助面板收展及未开通信息，不开放通用业务Agent。

只读追踪固定main源码：[BusinessShell](../../../apps/admin/src/components/BusinessShell.tsx)拥有侧栏/页头/内容/动作插槽，[AppShell](../../../apps/admin/src/components/AppShell.tsx)传入实际面包屑与休息/铃铛/右面板；[PageHeader](../../../apps/admin/src/components/PageHeader.tsx)→[WorkspaceHeader](../../../apps/admin/src/components/workspace/WorkspaceHeader.tsx)已将页面标题/操作送入顶部，[ActionButton/SaveButton](../../../apps/admin/src/components/ui/ActionButton.tsx)有原异步状态、表单校验与回车关联。继续封装这些真实入口，不复制按钮或另建框架。当前PageHeader仍导入固定导航/认证，通知Provider直接读取Rental待办与AI演示，Copilot可用性依workspace，故尚无跨Core独立页面SDK；前端源码本片只读。

待07的具体文件补充到原公共候选：BusinessShell/WorkspaceHeader/PageHeader及按钮的正式出口、AppShell中的注册组合、navigation/AppRouter与认证缓存、NotificationProvider业务来源和RestProvider公共身份边界、CopilotLayout外壳/业务内容分离。原后台作者的主题/布局/表单/动效源保留，由PM协调唯一改动窗口；不向其他对话主动发消息，也不通过新页面旁路宣称完成。

修订前两册及接续原文保存于 `d01561912cc6644776cbceea4971508eeb4c99ba`。该提交已合入最新main `ee281955161ffcf9b9d166be45972d48fbe0191f` 的两份服务恢复记录，合入前后本片五个包/指南WIP的SHA-256全部相同，随后普通推送并回读远端为d01561912。原main运行/数据库待迁移问题沿管理后台原记录保留；本片没有代执行真实迁移。

本阶段5份现行文档/模块说明定向检查371个本地/外链声明、66个本地锚点和45张表，新增问题0；外链仅核语法，未访问网络。原12项任务行逐字对照相同，依赖/百分比不变；`git diff --check`退出0。没有页面运行、独立接手或真实授权验证，不以文档确认记07完成。

<a id="core-guide-archive-20261114"></a>

## 随包指南生成与标准归档原语（2026-11-14）

上一阶段独立升级预检固定于 `6ba45c0bb59c454bf261a757912344dfbc4626f3`，已推并核定实际远端。本片[指南生成](../../../packages/core-contracts/src/guide.ts)从原任务快速入口与Agent模板取文、补Core实际入口和固定版本链接；[命令](../../../packages/core-contracts/src/generate-guide.ts)使用本地指定提交的任务原文，将生成内容输出到stdout，不覆盖已有Core文档。缺锚点拒绝，不手写第二份长期指南；正式宿主未接线仍明确标记，不把五步设计称现成SDK。

[归档原语](../../../packages/core-contracts/src/archive.ts)采用USTAR+gzip、固定顺序/权限/时间，整个包SHA-256固定。通过Node专用`@rental-os/core-contracts/archive`出口使用；只支持普通文件、UTF-8及有界包大小，不收PAX/软硬链接/目录记录、重复/越界路径、实际环境配置或node_modules。先校验整包摘要和解压上限，解析只返回内存文件；不写解包目录、不下载、不安装或执行Core。实际打包目录入口及待安装区写入继续后续交付。未增加压缩依赖或安装包，使用Node原生gzip。

原单一合同入口包含新增源码完整类型，8组通过/退出0。stdin核对相同输入包字节一致、UTF-8/空文件往返、错误摘要/越界/链接/大小写/父子路径冲突/截断拒绝，以及固定任务原文生成指南、元数据转义、缺锚点拒绝和固定链接（退出0）。未新增测试脚本或落地压缩包；本树合同临时目录已删除。此为归档原语/资料生成证据，完整安装、干净宿主及独立接手未验。

<a id="core-update-preflight-20261114"></a>

## 底座与单 Core 独立升级预检（2026-11-14）

归属基线及公共候选已固定于 `b8ffed04f3baec2d7592631765ca3d5e037fa97d`，普通推送及真实远端回读一致。本片继续独占合同包，落实PCH-02/03的独立版本锁定和候选预检，不接管当前Auth/Guard/AppModule等公共窗口。

[升级合同](../../../packages/core-contracts/src/update.ts)提供底座发行、Core包固定资料、部署锁、单对象更新请求及实际数据观察schema。提交/摘要/来源/data定义复用[唯一清单](../../../packages/core-contracts/src/manifest.ts)，迁移schema从原清单抽出复用，保持原字段与错误定位。锁记录不接受用户配置/Key/授权，不设隐式更新全部模块；同版本来源/摘要/元数据变化、来源替换、降版和重复Core明确拒绝。

`planCoreUpdate`复制当前锁，只替换所选底座或一个Core；检查全组合所需合同/运行/能力、实际数据版本和已应用迁移摘要。已发布迁移必须是新链不变的前缀。新迁移只在实际状态等于当前完整基线、数据版本前进时列为migration_required；其他Core待迁移、历史矛盾/缺失或缺观察时拒绝。已应用新链且数据目标一致可继续准备程序候选；不重做迁移。owner显式区分platform与core:id，Core恰好名为platform也不混用。

[只读命令](../../../packages/core-contracts/src/plan-update.ts)接三份JSON并输出人读/机器读结果，退出0/1/2区分预检通过、业务兼容拒绝与用法/输入读取错误。没有下载、解压、加载Core、读取业务环境、写锁/配置、应用迁移或切换运行；`candidate`与`migration_required`均不表示升级已执行。真实数据观察生产者、安装准备、用户文件冲突、历史执行者及迁移/回退仍待03/06/12接线。

实际验证：首次原合同入口类型检查发现`checkCoreCombination`返回对象误作迭代器（TS2488），before hook失败、业务8组未执行；改为迭代issues后复验8组通过/退出0，最终一次包含全部新源码类型。stdin短命令核对底座/单Core分别更新、其他模块与原输入不变、版本/来源/重复发行/缺数据拒绝、前进迁移、已应用读回、错误摘要/版本及platform同名隔离（退出0）；CLI用真实schema/计划器与内存只读文件facade核对三输入、纯JSON、0/1/2退出（退出0），这不是外部文件安装或真实迁移证明。未新增/扩写测试脚本，无临时独立运行器。

[接入说明](../../../packages/core-contracts/README.md)同片给出可执行预检命令、输入唯一来源、结果/错误处理及下一执行边界。原任务仍需真实生产者、独立宿主、授权/生命周期、完整消费者及独立升级结果，不因纯预检跨档；持续目标继续推进。

<a id="core-ownership-baseline-20261114"></a>

## 原组合的数据归属与下一公共片（2026-11-14）

服务端合同固定于 `953fccad0ad538d0dc27aad8df717ba52297baa7`，普通推送成功并由`ls-remote`回读一致。本阶段继续以已包含的main `6ca19ac34a3260405ba24388a4aa2a933450e70b`为原行为基线，源代码读取来自本树已核定文件及该固定Git对象，不读取其他研发活动WIP。以下为待实现连接的范围冻结；每片的实际运行结果仍须另取，不能将静态归属盘点当作全功能通过。

### 数据所有者及独立构建的最小范围

核读[Prisma模型](../../../apps/api/prisma/schema.prisma)、原仓储调用、原生SQL和实际服务。当前238个模型分为公共候选29、AI86、Rental及客户端110、企业Rental扩展12、营销申请1；这是所有模型的排查分组，部分通用运输和业务政策共处的表须继续拆字段/适配，不能按前缀自动搬表。AST扫描找到了12个企业模型没有delegate调用，随后确认企业大量使用原生SQL；这不是未使用代码或可删表证据。

| 数据集合与唯一所有者 | 生产者、直接消费者及拆分方式 |
| --- | --- |
| 平台身份：Tenant、OrganizationUnit、User、AuthSession、AuthLoginFailure、Role、Permission、UserRole、RolePermission | [平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts)与[Auth](../../../apps/api/src/modules/auth/auth.service.ts)拥有登录/角色/会话写入；Guard、AI可信主体及所有业务调用方消费。公共查询只投影账户/租户/角色；当前Tenant/User/Organization反向Rental关系、会话currentWorkspaceId等由组合schema/适配维护。不能复制另一套用户或令牌服务来做无Core登录 |
| 公共设置：UserAppearancePreference、TenantAppearanceProfile、SystemParameterSet、FilterPreset | [账号外观](../../../apps/api/src/modules/client/account-appearance.service.ts)、[租户外观](../../../apps/api/src/modules/client/tenant-appearance-profile.service.ts)及平台仓储。外观虽在client目录仍属公共面；租户外观首次保存会读旧ClientChannelProfile补旧值，需将此历史读取交Rental兼容适配；不能在无Core宿主上查询不存在的渠道表。参数/筛选模板保留原用户与租户范围，业务参数由所属Core管理 |
| 平台订阅：TenantSubscription、TenantSubscriptionSegment、SubscriptionFeatureCatalog、TenantFeatureGrant、SubscriptionRequest、SubscriptionEvent、SubscriptionStandardPrice | [SubscriptionService](../../../apps/api/src/modules/subscription/subscription.service.ts)唯一计算统一期限及办理事实；Core消费当前期限/权益，品类身份由Rental适配供给。新Core授权不改这些期限或恢复主动撤权 |
| 公共运输与审计：OperationLog、FileAsset、FileUploadSession、NotificationTemplate、NotificationSendLog、ExternalAdapterLog、TenantIntegrationConfig、AsyncJob、DocumentPrintJob | [审计](../../../apps/api/src/common/operation-log.service.ts)、[集成目录](../../../apps/api/src/modules/integrations)、[文件ACL](../../../apps/api/src/modules/files/file-business-access.service.ts)、jobs/notifications原入口。存储/发送/排队机制公共；businessType、模板内容、上传场景及业务文件ACL仍归Core，需登记处理器。FileAsset等字段含workspace/业务关联，不能仅搬类就视为无Rental依赖。原收据与任务引用、延迟回调执行者保持 |
| Rental配置与经营范围：全部Rental模型、BusinessWorkspace、WorkspaceMember、TenantRentalProfile、WorkspaceCapabilityInstance/AuditEntry、CapabilityHookAuditEntry、OfficialCalendarSource/Version | 原[Rental服务](../../../apps/api/src/modules/rental-core/rental-core.service.ts)、[能力服务](../../../apps/api/src/modules/rental-core/workspace-capability.service.ts)及品类解析/治理所有。经营空间单品类、成员角色覆盖/地点过滤保留，包装成Core范围适配；工单不继承这组表。日历来源及原历史快照继续按Rental原所有者维护 |
| Rental客户/企业事实：Customer开头全部模型、企业12模型 | 平台目录内[会员](../../../apps/api/src/modules/platform/membership.service.ts)、[客户仓储](../../../apps/api/src/modules/platform/shared-customer.repository.ts)、[企业结算](../../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)及[企业扩展](../../../apps/api/src/modules/enterprise)真实读写；保持租户级会员与企业关系、空间级订单/资金范围的区别。其他Core不得因同名customer复用其表；当前企业审批/收据端口仍归ECP/Core原作者 |
| Rental客户端渠道：ClientChannelProfile/Workspace、WebsiteChannelProfile/Asset、MiniProgramChannel、ClientWechatIdentity、ClientRegistrationChallenge、ClientAuthSession、ClientApiRateBucket、ClientOrderDeliverySnapshot及CustomerDeliveryAddress | [client目录](../../../apps/api/src/modules/client)维护现有客户身份、发布空间、网站/小程序和本人订单链。渠道配置有租赁发布空间及默认空间，保留在Rental接入；WebsiteAsset存在公共品牌使用候选，提取其字节运输需沿当前上传/公开读取契约核查，不能让公共Logo强依赖Rental表 |
| Rental设备及支付事实：TBoxDevice、PaymentWebhookEvent、PaymentReconciliationBatch/Line及Rental支付/资金模型 | 设备/支付运输可通过窄端口复用，当前命令与资金引用属于Rental；回调须定位原订单/支付操作，不能由请求自报coreId路由。支付/退款/对账unknown保留原审计和恢复，不能换Core重复执行 |
| AI：Ai开头86模型 | 原[AI组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)与领域仓储/原生SQL所有；通用任务、Gateway/预算与行业动作适配逐片分离。当前表广泛包含workspace/原业务引用，不能先重命名或重建；无AI宿主不依赖其模型/初始化。有AI时保留历史任务、工具/批准版本、账及原收据 |
| 营销：DemoRequest | [演示申请模块](../../../apps/api/src/modules/demo-requests)及营销网站所有；属于可选营销能力，无Core公共登录不以申请模块为必需依赖 |

259份现有迁移中，多份同一SQL同时涉及公共表、Rental外键/业务表或AI关系；例如[初始迁移](../../../apps/api/prisma/migrations/20260608000100_init_store_rental_schema/migration.sql)与[Rental初版](../../../apps/api/prisma/migrations/20260813000100_add_rental_core_v1/migration.sql)。对旧表的创建/移除和重命名保持历史原文，不能按文件名前缀裁剪后在已有库重放。索引型SQL也须登记归属，已补核[AI检查索引](../../../apps/api/prisma/migrations/20261007211000_ai_inspection_submission_index/migration.sql)与[资产锁查询索引](../../../apps/api/prisma/migrations/20261101010000_asset_hold_current_read_indexes/migration.sql)。

实施方向为分别生成公共及所选Core的受限数据适配/构建，再由同进程组合明确持有实际事务。公共schema不声明未选Core的导航关系；旧组合保留原表名/ID/FK和历史迁移链。新空库的公共基线与既有组合的增量演进是两条明确入口，不能以旧完整链先建全部Rental表再隐藏来证明无Core。实际schema拆分/组合生成、迁移账归属和真库演练待06/12固定窗口，当前未产生或执行SQL。

### 原功能与所有直接消费面的去向

| 基线功能、角色与实际入口 | 固定合同/数据及必要验证入口 | 当前证据与下一切片 |
| --- | --- | --- |
| SaaS/租户登录、退出、本人安全、当前会话：[Auth](../../../apps/api/src/modules/auth/auth.controller.ts)与[Guard](../../../apps/api/src/common/api-auth.guard.ts) | 原AuthUser/LoginResponse、用户/角色/AuthSession；[登录锁定](../../../tests/auth-login-lockout.test.cjs)、[租户权限](../../../tests/tenant-admin-privilege-write.test.cjs)、[租户成员政策](../../../tests/tenant-membership-policy.test.cjs) | 当前未运行这些整链；04拆基础身份/业务范围，保留签名、audience、撤权、空间修订及原可信票据 |
| SaaS租户管理、租户账号/角色/组织和公共参数：[平台Controller](../../../apps/api/src/modules/platform/platform.controller.ts) | 原TenantSummary/SystemUser/Role、参数和操作日志；[租户访问原子性](../../../tests/tenant-access-atomic.test.cjs)、[公共SaaS](../../../tests/saas-foundation.test.cjs) | 当前listTenants带Rental订单/空间统计，bootstrap要求品类并写门店角色。03/04新公共创建入口只建原平台事实；旧租赁bootstrap继续原同事务编排，不能把回调改为可选成功 |
| 租户与账号外观/语言、公共后台框架：[租户外观](../../../apps/api/src/modules/client/tenant-appearance-profile.controller.ts)、[会话状态](../../../apps/admin/src/features/auth/authStore.ts) | 原appearance合同/乐观锁、公共外观表；[外观检查](../../../tests/admin-appearance-settings.test.cjs)、[品牌检查](../../../tests/admin-branding.test.cjs) | main语言/主题已集成固定原作者成果，当前不重复宣称实页验收。07保留React/UIArc、声音、主题/语言，拆旧渠道补值与新Core可见性 |
| 订阅/续费申请/期限/额外权益：[订阅目录](../../../apps/api/src/modules/subscription) | [共享订阅合同](../../../packages/shared/src/subscription.ts)与统一期限表；[订阅服务](../../../tests/saas-subscription-service.test.cjs)、[日历](../../../tests/saas-subscription-calendar.test.cjs) | 原SubscriptionService读取品类身份；06经登记适配消费，期限/未知历史政策保持，不新增收费模型 |
| Rental配置/品类/商品/资产/报价/订单/履约/检查/资金：[原业务](../../../apps/api/src/modules/rental-core/rental-business.service.ts) | 原core运行时、不可变版本/快照与仓储；[Core](../../../tests/rental-core-v01.test.cjs)、[业务](../../../tests/rental-business-v1.test.cjs)、[定价](../../../tests/rental-pricing-strategy.test.cjs)、原各业务专用用例 | 08按受影响功能取前后对照；原接续明确库存/恢复fixture、续租脚本历史改写及真库缺口，保留归属。当前新合同未触及业务算法，不能关闭这些问题 |
| 租赁企业后台、本人客户网站/小程序、员工端：[企业](../../../apps/api/src/modules/enterprise)、[Client API](../../../apps/api/src/modules/client/client-api.service.ts) | 原企业grant/审批/财务投影、客户/员工audience；[企业政策](../../../tests/enterprise-policy.test.cjs)、[企业消费](../../../tests/enterprise-consumers.test.cjs)、[客户渠道](../../../tests/client-channel.test.cjs)、[员工小程序](../../../tests/staff-miniprogram-static.test.cjs) | ECP原固定接线证据可追溯；真实历史空间/账单/保证金及小程序基线类型失败仍未验/未解。本片不把普通客户改成租户员工权限 |
| AI任务/工具、MCP/Harness：[AI组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[MCP包](../../../packages/mcp-server)、[Harness插件](../../../clients/harness-plugin/README.md) | 原工具目录/批准/任务/账/收据；[原审计](../../../tests/mcp-original-audit.test.cjs)、原AI定向入口 | 09只改已固定Core接点；AI15/25活动成果由原作者完成。本片原MCP运行回归曾被自动审批拒绝，仍未验；现有AI默认关闭不能替代正向验收 |
| 文件/通知/支付回调/作业/打印：[集成目录](../../../apps/api/src/modules/integrations)、[ACL](../../../apps/api/src/modules/files/file-business-access.service.ts)、[到期作业](../../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts) | 原上传/运输/支付引用、租户/空间权限和幂等；[文件生命周期](../../../tests/file-storage-lifecycle.test.cjs)、[支付回调](../../../tests/payment-callback-integrity.test.cjs)、[通知租约](../../../tests/rental-notification-lease.test.cjs)、[作业调度](../../../tests/rental-due-job-scheduler.test.cjs) | 原运输与业务解释混合；06/08登记原执行者，保留迟到/重复/unknown，不因停用统一丢弃原收尾 |
| 页面、API、shared、构建/离线资料：[原OpenAPI](../../../apps/api/src/contracts/openapi-document.ts)、[后台路由](../../../apps/admin/src/app/AppRouter.tsx)、[shared](../../../packages/shared/src/index.ts) | 原API/DTO/权限静态脚本、各包tsconfig和构建。后台shared源码别名及查询epoch见[queryClient](../../../apps/admin/src/app/queryClient.ts) | 现有API语义/operationId/schema/深链接保留；新Core贡献走独立合同。07增加Core/容器缓存隔离；03组合构建不能继续通过shared总出口把Rental带入无Core宿主 |

全Git源码集合还包括`packages/ui-arc/ui-motiq/ui-tablecn/web-client`、营销站及克隆参考工程、保留Harness上游、测试/fixture和脚本。按已有来源/许可识别vendor/原型/生成物，保留唯一原稿；不能把源码扩展名总数当自有文件数，也不按“无delegate引用”删SQL消费者。实际逐模块注释/死分支/错误处理整改随所属切片进行，本表是覆盖清单，不是整库代码质量已经验收。

### 可交接的公共文件最小候选

以下候选基于本节main和服务端合同固定提交，供PM为具体片指定唯一作者；在取得窗口前不写公共入口。每片先保持Rental旧消费者，然后接新Core，合并时仍取最新main并核增量。

| 顺序 | 精确文件/方法 | 所需改动与退出条件 |
| --- | --- | --- |
| 1 | `platform.repository.ts` 的 `listTenants/findTenantByCode/findUserForLogin/toTenantSummary`；对应PlatformService薄转发 | 基础租户与用户投影不查询rentalProfile/业务计数；Rental提供已注册可选投影。既有租赁响应字段和值保持，无Core返回真实公共身份而非虚构品类 |
| 2 | `platform.repository.ts` 的 `bootstrapTenant` / `platform.service.ts` 同方法及原DTO/Controller局部 | 独立公共创建入口复用原密码、用户/组织/角色/参数/审计；旧带品类bootstrap保留完整同事务Rental初始化。公共创建不种门店/业务模板；当前旧模板回执还描述演示车辆/订单，须与实际写入核同再整理，不能复制进公共入口 |
| 3 | `auth.service.ts` 的 `resolveAccessContext/issueSession/buildLoginResponse/getSessionContext/getCategoryContext`，`api-auth.guard.ts` 对应范围/策略；原ALS最小附加Core范围 | 拆公共认证和每Core范围提供者，保留原签名/租户/成员/撤权/并发时点；采用独立合同的CorePrincipal/Scope/Binding，客户端自报coreId不授权。原workspace兼容字段和可信票据留Rental映射；新Core不继承默认经营空间 |
| 4 | 原schema/迁移与原人员角色服务局部 | 新增部署/Core授权/成员分配/绑定/原操作记录，使用复合唯一键及当前修订；授权不扩成全员。初始化先锁当前授权，再锁绑定/原操作，写Core与审计，同事务提交后才发布缓存；完整Prisma只留私有组合适配 |
| 5 | `app.module.ts` 最小受控装配；独立平台/选中Core数据及包配置 | 消费`registerCoreServers`和显式模块引用，只有通过兼容/数据检查才允许新准入；空组合不加载Rental/AI代码/作业/表。原组合保持唯一执行者；只建另一个能登录的旁路服务不能代替原公共代码抽离 |
| 6 | `openapi-document.ts`、shared正式出口及后台Auth/路由/导航局部 | 原接口身份归属先分组，再消费新`composeCoreOpenApi`；旧Rental例外逐项固定。公共后台消费真实授权/成员分配/就绪，不把前端可见性当鉴权；旧缓存epoch与未保存保护保留 |

现有技术指南§4.1/4.2将经营workspace/品类/capability写为所有经营API前提，§4.3只指shared总出口；与已批准PCH多行业合同存在适用范围差异。Rental原边界继续有效，新增Core采用自己的范围与独立正式合同。待相关实现片同步公共指南时明确将旧条款限定到Rental，不暗中按新源码改锁定规范。

本阶段AST/SQL短命令退出0，覆盖模型和原API Controller/方法及跨模块调用定位；AST不覆盖动态SQL/字符串拼接/运行分支，已用实际企业SQL和索引SQL补核其局限。没有新增测试脚本、完整环境副本、SQL执行、业务网络或后台进程。本片仍需在实际公共窗口内取行为基线、完成迁移/构建决策及真实消费者验证；原任务不按盘点数量跨档。

<a id="core-server-contract-20261114"></a>

## Core 服务端注册与生命周期合同（2026-11-14）

负责人要求设定持续目标并完成原 PCH-01～12 拆分。目标已建立，工程继续同一独占树和 `codex/platform-core-extraction`，本片基线为已推送 `8d0abba954a31f8aee36cdcd97eb710466e783dc`；当日 `git fetch origin main` 与 `git ls-remote --heads origin main codex/platform-core-extraction` 核定 main 仍为 `6ca19ac34a3260405ba24388a4aa2a933450e70b`，本树已包含该版本，工作区/索引起点干净且无合并/拣选状态。目标不扩大既有公共文件写入窗口或真实环境权限。

[生命周期合同](../../../packages/core-contracts/src/lifecycle.ts)将平台持有的租户Core授权、成员分配、业务绑定和原操作引用分别定义为唯一schema/推导类型。保存记录修订从1开始，变更请求0表示不存在；成员分配请求不接受租户字段，管理范围由原认证确定。Core就绪明确为ready、configuration_required（非空缺项）或unavailable，授权/注册不替代就绪；无Core独立期限、收费或自动恢复成员权限字段。初始化、持久化、当前撤权与同事务审计尚待真实宿主供给，schema不是认证凭证。

[服务端合同](../../../packages/core-contracts/src/server.ts)定义受控组合传入的真实服务实例和最小范围/生命周期接点。`registerCoreServers`核对唯一ID、宿主兼容、清单/实现版本及必需函数；空组合合法，错误不返回部分注册表，注册过程中不执行Core函数、不加载路径、不授予使用权。业务命令和HTTP/AI/作业仍经所属Core原正式入口，不引入万能`execute(action, JSON)`。

`defineCoreInitializer`将Core自己的schema解析集中在初始化输入边界，下游取得已验证类型。可选初始化只表示Core是否需要初始领域事实，宿主仍须真实写入绑定与审计。`CoreTransaction`仅为受限、回调内句柄合同；后续适配须在运行时核对所属Core/当前事务与有效期，不把类型标记或完整Prisma client当安全隔离。缺少`assessRemoval`时不能批准代码移除；unknown/在途/回调/作业/历史依赖均显式表达，重新开通不重放原操作。

实际复核原[Auth/可信主体](../../../apps/api/src/modules/auth/auth.service.ts)、[请求身份](../../../apps/api/src/common/request-identity.ts)、[平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts)及[订阅](../../../apps/api/src/modules/subscription/subscription.service.ts)：登录仍加载Rental档案，Auth仍注入空间能力，初始化仍在原事务内调用Rental，期限仍由原SubscriptionService计算。新合同没有替换这些生产路径。后续候选须保留原Auth/Guard/ALS、原租户和角色映射，并将Rental范围/品类逻辑收在适配器中；不能用当前schema通过称无Core已可登录。

必要验证使用原单一合同入口（8组、退出0，含新增源码类型与反向依赖检查），以及一次stdin运行时核对（退出0）：空/双Core、同ID、身份/实现版本冲突、缺必需函数/错误可选贡献、不执行生命周期函数；授权禁额外到期日、持久修订不能为0、成员请求禁自报租户；缺项非空；初始化错误输入不进领域回调且每次只解析一次。此为离线合同证据，不是真实授权、初始化事务或服务器组合验收。未新增测试脚本，原单一入口退出时清理本树临时产物；stdin不落文件。

[模块接入说明](../../../packages/core-contracts/README.md)与源码同片维护函数、职责、调用顺序和未接线范围。完整数据/消费者基线及真实双Core消费者尚未齐，02的身份/公共服务/事件与正式运行接点继续待交付，原任务门槛本片不跨档。公共文件候选与待授权接线见现行接续；首段原MCP审计的自动审批拒绝继续保留，未以本片合同核对替代该回归。

本片3份文档定向本地链接检查退出0，原需求/任务正文对照未变，原白名单仍只有总导航第54行3个历史附件缺失。首次临时核对因全库`ls-tree`输出超过Node默认缓冲而退出1，未改源码；只调整stdin读取缓冲后复核退出0，没有新增脚本或落地清单。`git diff --check`退出0，`output/.tmp/core-contracts`确认已删除，无新服务或其他一次性产物。

<a id="core-openapi-contract-20261114"></a>

## Core API 文档贡献与独立组合（2026-11-14）

继续同一 PCH-02 独占包窗口，基线为已推送的 `bb850efcd5b614efe2379137ecd0ae4791e08231`；实际远端 main 仍为 `6ca19ac34`。本片不修改原 `openapi-document.ts`、Guard、AppModule 或 AI 工作目录，先交付可供宿主消费的独立接口文档接点。

[OpenAPI 合同](../../../packages/core-contracts/src/openapi.ts)导出 `CoreOpenApiContributionSchema`、`checkCoreOpenApi`、`composeCoreOpenApi`。Core 声明包内 JSON，使用 OpenAPI 3.0 的 paths 和 schemas；新路径为 `/api/cores/<id>/...`，operationId/schema 采用 `<id>.` 命名空间。每项操作要求用途、响应和显式security；其余字段按标准文档语义保留。这里只验证归属、最小文档约束与组合冲突，不自建一套完整OpenAPI验证器，也不替代Controller/DTO验证。

组合器创建原平台文档的副本，按所选Core组合；重复Core、同形路径（包含只改参数名）、operationId/schema冲突、缺失或隐式跨Core schema引用均返回具体问题，失败不发布部分文档。引用只在本Core或平台公共schema解析，不自动请求外部URL。例子/default/enum中的业务值以及名为`$ref`的业务属性不会被误当作外部文档引用。

[目录检查](../../../packages/core-contracts/src/package.ts)已实际消费该合同：若清单声明OpenAPI，则只读取JSON并校验，不执行Core入口。迁移/OpenAPI单文件读取上限为32MiB，其他业务入口只查文件元信息。原Rental路径可以由受控宿主提供精确METHOD/path白名单，Core本身不能新增豁免；原operationId/schema兼容映射、主应用JSON入口和离线导出仍待正式迁移片核定，不宣称现有API已解耦。

[接入说明](../../../packages/core-contracts/README.md)同片加入“给Core附上API说明”，解释文件、命名、鉴权声明、引用、组合器与失败结果。当前完整业务手册仍从原任务五步入口展开，运行SDK/授权/样例未实现的步骤继续明确标注。

必要验证只复用原单一合同测试及stdin短命令：`node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs`（退出0、8组，包含新增文件完整类型与独立导入）；`node --no-compilation-cache -`内存核对空/双Core、冲突、宿主旧路由白名单、跨Core/外部引用和原文不变（退出0）；另以文件读取facade确认包检查实际读取API JSON、拒绝损坏/错误归属且不读取服务器代码（退出0）；修正文档例子引用后短命令复验业务`$ref`与真实嵌套引用（退出0）。本片没有新增或扩写测试脚本、依赖安装、网络/业务调用或后台进程；已有合同测试临时目录清理确认不存在。

这些结果为合同/类型/离线组合证据。真实平台生产者、Rental与非租赁API完整迁移、当前权限和公开文档覆盖待公共窗口；02尚未完成全部必需合同，原任务百分比本片不变。首段原MCP审计被自动审批拒绝的未验项继续保留，不用本片API检查关闭。


## 四册归并（2026-10-31）

接口与生命周期设计、接入指南归入开发任务的[实施设计](平台Core接入-开发任务.md#contract-design)与[接入步骤](平台Core接入-开发任务.md#integration-guide)，协作接续只维护当前入口。原文及修改前像见[归档清单](历史归档/四册整理/2026-10-31/manifest.json)。PCH-11的可操作资料和独立接手门槛不变；本次没有交付SDK/样例，不提高12项百分比。

<a id="pch-frozen-main-20261114"></a>
## 最新底座文档与保留品牌资产的固定合并（2026-11-14）

负责人要求合入所有冻结树，并同步昨晚已确认的项目名与README。固定来源为 `1663171c1b505cbb824d4895d0b74678443d8daa`，含原Nativark/MIT、N方案和Core两方案22份保留资产以及v1.3标准化六文档。README、LICENSE与许可元数据已经等同main，合并保留现有版本；PCH尚未启动工程，原任务不因文档/素材合并加分。两个记录/接续冲突按职责归并：保留main全部集成证据，补来源三段原文，接续使用已批准v1.3现场。

负责人当前暂选Preview同款黑白图形作为运行默认标志，后台作者单独适配；本片只保留N/A/B唯一原稿，不将任何候选直接换成应用默认。尚未确认的新名称讨论不替换本片已冻结Nativark名称。原技术包/API/数据标识与业务功能保持，未执行部署/迁移。

最终合并使用本片固定Git第二父提交，原开发树及AI活动WIP不写入；验证为六份文档链接/原内容与22资产字节核对，后续最终main按负责人安排交QA一次review。

<a id="nativark-logo-n-retained-20261114"></a>

## Nativark 静态标志 N 方案保留（2026-11-14）

负责人要求参考其 Preview 标志制作静态 SVG，提供黑白和彩色版本。实际参考页面为 `http://127.0.0.1:5264/index.html`，标题为“Preview · Logo 动效”；本阶段读取层叠圆角卡片、粗轮廓及蓝色渐变的视觉特征，手工绘制三块错位圆角模块、前景 N 字母和承载托座。N 是助手自行取 Nativark 首字母加入的品牌识别。

负责人随后指出底座承载的对象应是 Core，并要求“先保留现在的这个”。本阶段完整保留当前 N 方案，作为后续可对照的初版原稿；负责人尚未确认最终标志。承载对象表达 Core 的反馈留作后续设计依据。

唯一资产集合位于本任务树 `assets/01_Logo/`，包含[彩色 SVG](../../../assets/01_Logo/nativark-logo-color.svg)、[黑色 SVG](../../../assets/01_Logo/nativark-logo-black.svg)、[白色 SVG](../../../assets/01_Logo/nativark-logo-white.svg)、[彩色 PNG](../../../assets/01_Logo/nativark-logo-color.png)、[黑色 PNG](../../../assets/01_Logo/nativark-logo-black.png)、[白色 PNG](../../../assets/01_Logo/nativark-logo-white.png)及[三色对比图](../../../assets/01_Logo/nativark-logo-preview.png)。三份 SVG 均为 512×512 透明背景静态矢量，PNG 为对应透明导出，对比图为 960×320。原七份文件完整保留，未另建重复副本。

| SVG 原稿 | 字节数 | SHA-256 |
| --- | --- | --- |
| `nativark-logo-color.svg` | 2133 | `142ca0c20889c29b2cd423b824701dd6a6217d3ff88485293dd4a39d6054feae` |
| `nativark-logo-black.svg` | 2737 | `ce4bdcd113a81ace09d7acc5c1ff7178be0afe4db495aafbf3de74af7d07ce20` |
| `nativark-logo-white.svg` | 2737 | `dc227261b7c9a0ac488225cd8b6c24f16d6681f6b7d584948c6f1634e27746c9` |

复用宿主已有 sharp 导出 PNG，并实际查看三色对比图。`node --no-compilation-cache -` 经 stdin 核对 SVG 静态内容、尺寸、内部引用及 PNG 像素，退出 0；PNG 与对应 SVG 内存渲染相同，四角透明，黑白版轮廓一致。PowerShell 使用禁用外部解析器的 `System.Xml.XmlDocument` 读取三份 SVG，退出 0。参考页临时标签已关闭，原减少动态效果设置已恢复；本任务未新增临时目录、诊断脚本或后台进程。

本阶段复用 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，任务分支 `codex/nativark-logo`，固定父版本为已上传的 README/MIT 提交 `d4ea8aa340a77e996bb5c54f76e2f98b9fdedb43`。实际远端核对确认父版本在 `codex/nativark-mit`，logo 分支开工时尚无远端提交，暂存区干净且无合并/拣选现场。七份资产原被既有 `.gitignore` 的本地设计原稿规则忽略，作为明确要求的交付物精确强制暂存，忽略规则不变。

交付范围为七份资产及原开发记录、接续。`node --no-compilation-cache -` 定向文档检查退出 0，核对两份文档的 92 个本地链接、15 个锚点引用和 10 个表格，原开发记录全文及接续的产品边界、原下一入口保留，正式需求/任务和 README/MIT 文件无新增差异；稀疏检出外的链接目标依据固定父版本 Git 树核验。`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出 0。固定提交以包含本节的 Git 对象定位，按持续授权普通推送 `codex/nativark-logo` 后回读实际远端，在本对话登记 SHA。品牌资产不计 PCH 工程进度。

<a id="nativark-logo-core-options-20261114"></a>

## Nativark 承载 Core 的两版静态标志（2026-11-14）

负责人明确要求“保留所有成果，再给我设计两版给我选择”。本阶段在同一品牌设计工作树和 `codex/nativark-logo` 分支继续，以已上传的 N 方案固定提交 `633fdf889fe2db46bf99b15d4bf2da53b851a7d6` 为父版本。开工核对确认本地与实际远端任务分支一致，工作区/暂存区干净且无合并/拣选现场。已有 README/MIT、N 方案七份文件及原记录保留在 Git 原位置；两版以新文件名增加。

两版都将被承载对象画为业务 Core，以独立中心核识别每个模块，沿用实际 Preview 参考页的圆角、粗轮廓和蓝色渐变。A“模块托座”使用三个错位圆角模块和正面托座，保留卡片层叠感；B“Core 平台”使用三个等距立方 Core 和一块厚实公共平台，形成不同的立体轮廓。均为本阶段手工绘制的纯静态矢量，待负责人选择。

| 方案 | 彩色 SVG | 黑色 SVG | 白色 SVG | 对照预览 |
| --- | --- | --- | --- | --- |
| A · 模块托座 | [彩色](../../../assets/01_Logo/nativark-core-dock-color.svg) | [黑色](../../../assets/01_Logo/nativark-core-dock-black.svg) | [白色](../../../assets/01_Logo/nativark-core-dock-white.svg) | [黑／彩／白](../../../assets/01_Logo/nativark-core-dock-preview.png) |
| B · Core 平台 | [彩色](../../../assets/01_Logo/nativark-core-isometric-color.svg) | [黑色](../../../assets/01_Logo/nativark-core-isometric-black.svg) | [白色](../../../assets/01_Logo/nativark-core-isometric-white.svg) | [黑／彩／白](../../../assets/01_Logo/nativark-core-isometric-preview.png) |

每版附有三份对应的透明 PNG。六份 SVG 与六份 PNG 为 512×512，两张对照图为 960×320。尺寸、设计来源、N 方案原始哈希及本阶段十四份导出的字节数/SHA-256统一见[资产清单](../../../assets/01_Logo/nativark-logo-options.json)，该 JSON 是实际资产清单，不新增专项第五册或重复原稿。旧七份成果均与固定父版本 Git blob 逐字节相等。

复用宿主已有 sharp 渲染，不安装项目依赖。实际查看两张对照图后，`node --no-compilation-cache -` 经 stdin 核对六份 SVG 的尺寸、唯一 ID、内部引用、无脚本/动画/外部资源及清单哈希，退出 0；对应 PNG 与 SVG 内存渲染逐像素相等、四角透明、黑白版轮廓一致。PowerShell 以禁用外部解析器的 `System.Xml.XmlDocument` 解析六份 SVG，退出 0。生成中定位到 A 彩色 SVG 的内部 ID 重复，修为独立平台 ID 后定向验证通过，视觉像素未变。

继续使用同一个 Creative Production board `890e57af-654c-44e6-8a39-09d14e2d53f6`，保留原三项并追加六个新预览；六项 complete 回执均对应原 board 和预定 item，revision 12～17，未另建看板。全部导出位于唯一 `assets/01_Logo/`，过程脚本经 stdin 执行，本阶段未创建临时目录、下载/安装依赖或后台进程。

交付范围为十五份新增资产（六份 SVG、六份 PNG、两张预览、一份清单）及原开发记录、接续。`node --no-compilation-cache -` 定向文档检查退出 0，核对两份文档的 103 个本地链接、17 个锚点引用及 11 个表格，原开发记录全文和接续中的产品边界、PCH 下一入口完整保留；稀疏树外目标按固定父版本 Git 树核验。差异格式检查 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出 0。精确暂存明确交付文件，不改忽略规则。原需求/任务、工程进度及其他作者文件不变；最终标志待负责人选择。暂存后核对资产字节及清单哈希，按持续授权普通推送当前任务分支后回读真实远端，固定 SHA 留在本对话。

<a id="core-standardization-20261114"></a>

## Core 标准化、兼容拆分与简明接入资料（2026-11-14）

### 本轮需求与处理决定

负责人准备拆分 Core 与底座，要求保住现在所有功能、同时标准化 Core 接入并留下简单的说明，能把说明交给开发 Agent 快速做出 Core；随后补充 GitHub 标签发现/下载安装、全平台源码梳理和文件备注、避免无依据防御与简洁高效实现、完整API说明、无Core可保存公共设置、轻量工单/工作流Core，以及底座跟随上游和Core独立更新，并询问AI Native未完成的影响。本轮按原“先分析并完善文档”继续准备，已将这些要求纳入未来实施范围；本轮尚未启动源码修改。

| 事项 | 本次落位 |
| --- | --- |
| 现有功能继续正常 | R09/A09、任务01/08/12与4.1；建立有实际结果的全功能清单，按切片核对原正常、既有失败和未验项 |
| 推荐的拆分方式 | 同仓分模块，先正式合同和兼容适配、再逐段替换连接；每段保持原业务，事务/数据/权限和唯一执行者持续可核对 |
| AI Native尚未完成 | R08、任务4.2/09；不等AI全专项完成，已支持功能保兼容，未完功能留原任务，只等待实际需要的固定接点 |
| Core标准化 | R02、任务02/03/5.8；清单、正式出口、最少必需贡献和可选扩展、版本/来源与统一校验相互一致 |
| 简单的Agent接入说明 | R10/R11、任务10/11和五步快速入口/Agent模板；实际命令与最小样例随实现补齐，由独立接手者验证 |
| GitHub发现与安装 | R11/R12/A12及03/07/10～12；Topic用于发现，固定Release包用于安装，下载/部署/注册/租户授权分别记事实 |
| 全平台可理解性 | R01/R11、任务01/11/4.3；全量自有代码盘点、模块/关键文件职责及复杂逻辑说明，第三方/生成物/历史归属明确 |
| 简洁高效实现 | R09、任务4.3；处理重复/无效包装、吞错和无依据兜底，保留边界校验、授权/幂等/并发/事务与恢复保障，优化用实际证据证明 |
| API资料 | R11、任务02/11/4.4；平台/Core可组合OpenAPI、同版本离线文档、schema/例子与源码/消费者一致性，HTTP与模块SDK分别说明 |
| 无Core基本功能与轻量Core | R01/R10及1.8、任务01/03/07/10；租户登录和公共设置真实保存/隔离，最小非租赁样例优先简单工单，通用流程引擎不内置 |
| 底座上游更新与Core单独更新 | R02/R12、任务02/03/06/10～12及5.9；版本分离、兼容预检、用户Core/配置/数据保留、迁移与恢复，分别验证底座升级和单Core升级 |
| 范围变化 | 根据本轮补充将轻量发现/分发/受控安装及独立更新纳入首期，明确全平台代码/API可理解性；付费交易、热加载、远程服务化不随之引入 |

需求/任务升至v1.3，沿原PCH-01～12细化交付，原12行任务表、编号/依赖/顺序、G1～G4评分和现有百分比保持。平台索引增加快速入口；未来方案v1.5校正已转入PCH的分发、代码/API资料和独立更新范围及已确认Nativark/MIT依据。源码文件职责、复杂边界说明和API例子随实现同片更新，指南从任务内设章节及正式合同生成随包文件，不新增第五册。原R01～R12/A01～A12身份保留，验收按负责人本轮扩展补充。

### 外部参考的核实

实际使用 Tavily 检索与读取负责人给出的[Magpie首页](https://usemagpie.ai/zh/)、官方[插件开发文档](https://usemagpie.ai/docs/plugins)及[社区插件样例](https://github.com/magpie-community/plugins)。官方文档有最小示例、模块/Hook说明、测试、发布与上架规则；其GitHub发现使用仓库Topic `magpie-plugin`，归入未审核来源，根package.json与可加载入口有明确要求。Topic不是版本Tag，也不等于直接批准执行。

Nativark借鉴清晰入口、按需参考、最小样例和机器检查的开发体验；选择 `nativark-core` Topic作为本项目发现约定，Release/版本Tag/提交与摘要锁定安装包。这是本轮提出的Nativark设计，并非Magpie当前实现的照抄；不会采用其模型供应商插件/中间件的运行与错误放行规则来替代服务端Core授权。先做本地标准包、再接Release下载、最后接发现界面。未下载安装或运行Magpie，未改变本项目Topic或创建公开发行。

### 固定来源与现有工程证据

主树当次固定HEAD/实际远端main为 `de9458d0470ee5deace40b7211d0c7ec3f868e00`，仅只读核对；六项既有WIP归其他作者，main索引未改。原文档工作树 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS` 的 `codex/nativark-logo` 在 `8f4c45b3a5f637256afac9363ca13a4cd2232a5c` 与实际远端一致且干净；从该固定父版本新建 `codex/core-standardization`，复用既有稀疏树，不复制主树/依赖。

开始修订前，需求、任务、平台索引及未来方案与固定main正文一致；本树保留完整品牌阶段原记录，main另有PM的README/MIT归并记录。因此本轮不整取main或其他活动HEAD。该归并原文直接见[固定main中的许可归并](https://github.com/JinPen-G/Nativark/blob/de9458d0470ee5deace40b7211d0c7ec3f868e00/docs/%E5%B9%B3%E5%8F%B0%E5%BA%95%E5%BA%A7/Core%E6%8E%A5%E5%85%A5/%E5%B9%B3%E5%8F%B0Core%E6%8E%A5%E5%85%A5-%E5%BC%80%E5%8F%91%E8%AE%B0%E5%BD%95.md#nativark-mit-main-integration-20261114)，不复制历史原文。PM后续仅集成本轮六份文档增量，按职责合并记录与接续，不把旧品牌分支整片覆盖main。

| 固定源码接点 | 本轮观察 |
| --- | --- |
| [AppModule](../../../apps/api/src/app.module.ts)、[PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)、[PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts) | 宿主仍组合Rental服务；租户/空间初始化在原事务中调用initializeTenant/registerWorkspace，仓储引用品类政策；先抽合同与有限事务接点 |
| [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)、[ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts) | 当前仍引用WorkspaceCapabilityService；需移出Rental策略并保留原授权、撤权及audience |
| [navigation](../../../apps/admin/src/app/navigation.tsx)、[AppRouter](../../../apps/admin/src/app/AppRouter.tsx)、[Vite](../../../apps/admin/vite.config.ts) | 导航含RentalCategoryCode，路由lazy加载具体租赁页；Vite仍穿透shared源码，页面贡献与正式产物边界需一起实现 |
| [AI应用组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[runner端口](../../../apps/api/src/modules/ai-native/runner/ai-task-runner.ports.ts)、[预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts) | 应用组合使用Rental业务服务，runner公共结果仍含Prisma类型，预算指纹引用Rental文件；不能只挪目录声称AI已解耦 |
| [shared出口](../../../packages/shared/src/index.ts)、[AI应用组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[查询缓存](../../../apps/admin/src/app/queryClient.ts) | 当前源码已有公共入口职责和缓存隔离原因等说明，说明规则仍有实际使用；本轮只抽样，不声称全平台注释已规范 |
| [OpenAPI组合](../../../apps/api/src/contracts/openapi-document.ts)、[文档Controller](../../../apps/api/src/modules/openapi/openapi.controller.ts)、[API启动](../../../apps/api/src/main.ts) | 当前通过/api/openapi.json输出组合合同，入口仍引用Rental和AI等具体schema；需拆为平台/Core贡献并保持原HTTP兼容 |
| [技术开发指南](../../公共技术资料/开发指南/项目-开发指南.md) | 现有2.5及源码说明规则要求模块路线、关键文件职责和复杂逻辑原因；本轮补充全量梳理/简洁实现/API同步的PCH验收，不擅改锁定通用规范 |
| [现有脚本](../../../package.json)及[文档检查器](../../../scripts/validate-docs.cjs) | 根构建仍串联shared/MCP/API/admin；定向业务命令中有构建与环境依赖。本轮只运行文档静态核对，不运行这些业务命令 |

以上为固定Git对象的定向观察，不是全仓消费者盘点或实际运行验收。PCH-01仍须在工程开工时用当前获准基线补全并验证功能清单，02仍须冻结真实字段、包路径/格式、命令及兼容合同；标准包、安装器、发现页面和SDK尚未实现。

### 验证与待交付边界

本轮只改PCH四册、平台索引及未来方案共六份Markdown。`node --no-compilation-cache -` 经stdin复用现有检查器并定向核对，退出0：六份文档的239个本地链接、64个锚点引用、37个表格通过；原12行任务表、全部任务详情、G1～G4计分及R01～R12/A01～A12身份保留，原R03～R07正文未改，历史阶段正文除现行版本导航外完整保留。稀疏树未展开的链接目标按固定父版本Git树及blob核验。

两轮12份原文快照的字节数/SHA-256与manifest一致，22份品牌成果与父版本逐字节相等。11份白名单文档按同一固定基线比对，前后均为5处既有缺链：总导航的3份历史附件和AI Native接续的2份output证据，无新增错误；这不是全库文档检查通过，也未修改检查器或删除缺失引用。`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出0。未运行包含构建/环境依赖的业务命令。

验证脚本全部经stdin执行；本树没有本轮新增的临时目录、依赖、生成物或后台进程，`output`与`node_modules`均不存在。历史文档与品牌交付物有明确保留用途，继续原位保存，不复制到其他目录。提交前只暂存上述六份文档，并核对暂存差异与原任务/历史保全边界。

工程仍缺完整功能/源码基线、逐模块整理和源码说明核收、版本化API贡献与离线产物、标准源码合同、独立宿主/多Core授权、持久化样例与第三方安装、底座/Core独立更新、AI适配、独立Agent接手及迁移/回退验证。本轮没有依赖安装、应用/数据库/模型/供应商运行、代码抽离或独立工程审查，不调整PCH研发百分比。提交与普通推送按根持续授权办理，任务分支 `codex/core-standardization`，上传后回读GitHub并在本对话登记固定SHA；不主动跨对话发送报告。

<a id="pch-preparation-main-integration-20261113"></a>

## PCH 准备文档的 main 归并与独立复核（2026-11-13）

PM 在主线 `1e010786a99cf180bce79cb797e48cdf14fc44fe` 之后收回已推送的固定文档 `557a4d07d950f812efded6e690513f5a19b8dce8`。两份记录/接续的主线前像与来源父版本逐 blob 相同；来源记录本身保存 CRLF，工作副本与源对象归一换行后正文相同，本文仍由 Git 固定来源保全原字节。保留原准备阶段及历史证据，不覆盖需求/任务、平台索引与未来方案。原十二项任务仍为 0%，全面清单、正式源码合同及公共窗口尚待原实施授权，不把文档归并计为工程完成。

QA 主审和独立一致性复核确认 77 处文档链接、10 处锚点及 12 份历史前像字节/SHA-256 匹配；需求、任务、索引及未来方案与 main 同 blob。文档最终验证 `node --no-compilation-cache -` 退出 0，stdin SHA-256 `5e77dbf360403f74fb112da6a14ee2ddcb9f7fe3df0af8192efbd114ede1e0a3`（包含另列 OPS 文档检查）。本次归并后的新增链接和差异格式定向核对，无新增链接错误。

本片只改现有[开发记录](平台Core接入-开发记录.md)与[协作接续](平台Core接入-协作接续.md)。没有安装依赖、启应用、读实际环境、连接数据库/供应商或执行迁移/部署，源码装配、独立构建、真实持久化、浏览器和工程验收仍未实施。六项其他作者 WIP 保持，无新增临时目录或进程。实际提交以包含本段的 Git 对象为准，普通推送后回读 GitHub。

<a id="scope-clarification-20261109"></a>

## 需求澄清与实施文档完善（2026-11-09）

### 范围与决定

负责人要求复核原拆分规划，并先后允许两轮、每轮最多五个问题确认边界。第一轮在`D:/工作文件/rental-OS`的main核对，HEAD为`44129cd00`；未进入源码实施。管理后台源码及其他专项已有WIP保留，六份平台底座文档初次开工时无未提交差异，暂存区为空且无合并/拣选现场。第二轮补充前重查HEAD为`ba107abe8b4a42bdc44efe2caaddfa44c651a8a9`，六份文档含本会话第一轮未提交成果，其他并行修改保持原位；暂存区及合并/拣选现场仍为空。以上均为定位证据，不授权接管其他写入。

| 已明确的事项 | 本次落位 |
| --- | --- |
| 产品定位为比脚手架更完整、AI开发友好的AI原生SaaS底座 | 需求§1.1及R11；开发任务01/02/11与接入指南。实际公共能力、正式合同、样例和独立接手一起验收 |
| 无Core时只需平台正常启动、登录、进入公共后台并提示联系管理员授权 | 需求R01/R07/A01；不把早期讨论中的“无Core通用问答、内容整理与任务产品”纳入交付，以负责人后续明确纠正为准 |
| 新Core与旧Core可并存，注册后由SaaS管理员授权租户 | 需求R02～R04及A02～A04；任务03～05/07/10。首期扩为同部署、同租户多Core，注册、授权、就绪和用户权限分开 |
| 各Core独立定义业务分区 | 需求R03/R05与接口上下文；Rental经营空间/品类/地点保留在Rental内，不强制CRM等沿用 |
| AI工具可选，不提供不阻止普通后台使用 | 需求R08/A08；任务09/10及指南步骤七。Agent不得绕过缺失工具查询/操作该Core |
| 跨Core数据互通留后续具体场景 | 需求§1.5及[未来方案](../未来规划/平台底座-通用化与开源方案.md#cross-core-collaboration)。首期只固定命名空间、引用、受控调用及事件接点 |
| 仓库组织由负责人交给工程判断 | 采用首期同仓独立模块、独立构建及正式出口，边界稳定后按独立维护/发行需要拆仓；同仓不免除反向依赖检查，不捆绑拆库/拆服务 |
| 首期沿用租户统一期限，Core分别开通/停用 | 需求R04/A04及任务05；采用讨论中的简化建议，并核对原SaaS需求§4已有统一期限。Core不另设有效期，续费不恢复主动停用或成员撤权，不改原收费规则 |
| 多Core的入口形式均可，由实现阶段选择 | 需求R07/A07及任务07；切换或业务分组均可，当前Core清晰、权限/状态/缓存隔离，不锁定唯一UI形式 |
| 租户联系管理员，首期由SaaS管理员直接办理Core开通 | 需求§1.4/R04及任务05/07；不新增Core申请流，不取消原订阅升级/续费申请 |
| Core停用后保留业务数据 | 需求R04/A04及生命周期设计；保留配置与原绑定，重新授权按当前条件恢复，必要历史/在途善后仍受控，不重放旧操作 |
| 租户管理员可给成员分配不同Core | 需求R03/R07/R08及任务04/07/09；成员范围只能来自租户获权集合，普通后台与Agent一致复验，Core内部角色和数据权限继续独立生效 |

本次更新PCH四册、平台底座索引和未来方案共六份现行文档。第一轮需求/任务为v1.1、未来方案为v1.3，第二轮补充后分别为v1.2和v1.4；保留原PCH编号、依赖、顺序、门槛计分及百分比，不改变其他专项任务身份。验收覆盖无Core、单Core、同租户双Core、不同租户/成员授权、单Core停用重开、统一期限及有/无AI工具组合；没有登记研发完成。

### 现有证据与剩余工作

- 根[package.json](../../../package.json)使用npm workspaces，主要构建串联shared/API/admin；[admin Vite配置](../../../apps/admin/vite.config.ts)及类型配置仍直接引用shared源码。当前工程适合先建立同仓模块和产物边界，不能把现有workspace列表当作独立Core已交付。
- [平台空间创建](../../../apps/api/src/modules/platform/platform.service.ts)仍在事务回调中调用Rental注册与品类能力初始化；Auth/Guard和后台导航仍含Rental专属依赖。[AI预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts)仍引用Rental请求指纹工具，runner端口仍有Prisma类型。本次仅静态复核，未修改或运行这些链路。
- PCH-01/02仍须完成全面消费者/数据归属盘点，确定实际包出口、构建、注册/授权存储与事务合同；03～12的独立宿主、多Core准入、UI/AI适配、样例、独立接手、迁移和回退仍待实施。旧记录中的原未完项继续保留。
- 修订前六份完整原文及SHA-256/字节数存于[保全清单](历史归档/需求澄清/2026-11-09/manifest.json)，原链接按source路径解释；局部`.gitattributes -text`用于保留历史字节。本次未覆盖旧档案，也未复制其他工作树产物。
- 第二轮补充前再次保存六份工作区原文至[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)，其中包括第一轮未提交成果，不能按manifest中的Git基线宣称已提交。已复核原[SaaS订阅需求§4](../../SaaS订阅/SaaS订阅-需求.md#4-订阅有效期与使用状态)的统一期限、到期善后和冻结独立性；成员Core分配限定租户成员，不改变客户及企业客户的专用授权。

### 第一轮验证

| 实际命令/核对 | 退出码/结果 | 证明范围 |
| --- | --- | --- |
| 修改前`npm run docs:check` | 1；11份白名单文档，3个既有历史附件链接缺失 | 缺失位于总导航第54行，分别为10月16日快照索引及两份旧租赁平台文档；保留原引用 |
| 六份修订前像复制与SHA-256核对 | 0；6/6字节一致 | 仅证明原文保全，不证明任何工程能力 |
| `node -`（stdin定向检查，复用`scripts/validate-docs.cjs`） | 0；六份现行/六份前像及归档README，215个本地链接、31个锚点引用、34个表格检查，0个问题；6/6前像哈希一致 | 计数包含基线比较；PCH的12项编号、原依赖/顺序、百分比和需求/验收映射保持，12条需求/验收身份齐全；不验证业务实现 |
| 修订后`npm run docs:check` | 1；仍为修改前同样的3个历史附件缺失，无新增错误 | 只覆盖原11份白名单，不能代替本片定向检查；未删除历史引用或改校验器变绿 |
| `git diff --check -- docs/平台底座` | 0 | 本片已跟踪文档差异的空白格式；Git的LF/CRLF提示不表示修改了历史字节 |

业务源码、脚本和其他专项正式文档未修改；校验器没有变更，不运行`test:docs`。未运行构建、应用、Prisma、数据库、浏览器、模型或供应商验证。未作独立审查；文档一致性不能替代研发、业务验收或发布。

### 第二轮补充验证

补充前重读项目入口、规则、四册和校验器，并核对原订阅正式规则及当前授权/Core静态依赖。

- `node -`保全第二轮补充前六份工作区原文并核对SHA-256，退出0，6/6字节一致；未覆盖第一轮前像。
- `node -`定向检查，复用`scripts/validate-docs.cjs`的链接解析和校验，退出0：六份现行文档、两份归档索引及12份前像，共339个本地链接、50个锚点引用、53个表格，无发现问题；12/12前像哈希和字节数一致。PCH的12项任务编号、顺序、依赖、百分比及需求/验收映射与两轮前像一致，12条需求/验收身份保留。
- 补充前后`npm run docs:check`均退出1，仍为总导航第54行同样的三个历史附件缺失，无新增错误；未改总导航、历史引用或校验器。此命令只覆盖原11份白名单。
- `git diff --check -- docs/平台底座`退出0；只证明本片已跟踪差异的空白格式，新增归档索引另经定向链接检查。

本阶段仅修改六份现行Markdown及新增历史保全。原任务仍为0%，业务源码、迁移和其他专项资料未改；没有构建、数据库、浏览器、模型、外部服务或独立审查证据，未提交或发布。

<a id="pch-preparation-20261112"></a>

## 恢复核对与 PCH-01/02 实施准备（2026-11-12～13）

### 授权、固定基线与已有文档收口

负责人要求恢复开工，PM指定本会话继续原PCH需求澄清与实施准备，写入仍限文档阶段。本次核定原两轮决定、PCH-01/02所需最小范围及公共文件依赖；代码抽离、依赖安装、应用/数据库/供应商验证和main整合均未执行。源码阶段及公共文件唯一作者由PM另行明确。

只读基线为 `2a5c56471abb5714f80715e2cfa0aa236f003f51`，开工时main及GitHub实际main均为此提交，暂存区为空，无合并/拣选现场；主树他人WIP保留。两轮六份现行文档及12份原文前像已由 `d1ae52df6d8207e913d6e49fde1dd28c7c962bc3` 收入Git且为本基线祖先，不能继续把11月9日“未提交”当作当前状态。后续 `eae7bb1c143607211c1569447ff2d110a6d56144` 在记录开头恢复了两行旧版本标签；本次改为指向历史前像，现行正式依据仍为需求/任务v1.2。历史阶段原记录不改写。

本次旧接续直接以固定基线中的Git原文保全，不新增历史副本。原PCH编号、顺序、依赖、门槛、需求/验收映射及百分比保持；本片准备不计PCH-01/02研发完成。两轮产品决定已与[澄清记录](#scope-clarification-20261109)、需求v1.2及任务v1.2逐项核对，无需重新询问产品问题：无Core公共后台、多Core、注册→租户授权→成员分配、统一期限、停用保留及按当前条件恢复、可选AI、自有业务分区和未来跨Core边界均保留。

### 固定源码入口与待冻结边界

下表来自上述固定提交的定向静态核对，是PCH-01/02的起查清单，不是全面消费者清单或已实现合同。

| 范围 | 真实入口和直接消费者 | 首个应固定的内容 |
| --- | --- | --- |
| 构建与宿主 | [根脚本](../../../package.json)、[API包](../../../apps/api/package.json)、[AppModule](../../../apps/api/src/app.module.ts)、[启动入口](../../../apps/api/src/main.ts) | 当前主构建为shared→MCP server→API→admin；AppModule集中装配具体Rental服务。将显式组合与公共内部依赖区分，公共启动不加载未选Core；环境读取/启动副作用保持原边界 |
| 登录、权限与上下文 | [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)→[ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts)→[RequestIdentity/ALS](../../../apps/api/src/common/request-identity.ts) | Auth/Guard仍消费WorkspaceCapabilityService；身份含可信workspace/dataScope/locationScope。先列全部当前消费者及audience，再确定Core范围解析接点；不把currentWorkspace改名成currentCore或移除现有校验 |
| 租户/业务初始化 | [PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)→[PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts)→Rental初始化 | bootstrapTenant事务回调调用initializeTenant，createTenantBusinessWorkspace调用registerWorkspace及必选能力初始化；仓储也直接引用Rental品类采用政策。授权、成员分配、业务绑定/就绪、原操作和审计分别建模，保留事务/锁顺序及提交后缓存发布 |
| 期限与权益 | [SubscriptionService](../../../apps/api/src/modules/subscription/subscription.service.ts)、[期限规则](../../../apps/api/src/modules/subscription/subscription-term.ts)、[shared订阅合同](../../../packages/shared/src/subscription.ts)→Guard及授权入口 | 租户统一期限和原收费规则复用；当前服务还引用Rental品类身份，需区分通用期限机制和行业权益。续费不恢复主动停用或成员撤权 |
| 数据与迁移 | [schema](../../../apps/api/prisma/schema.prisma)、[迁移目录](../../../apps/api/prisma/migrations)、[Seed](../../../apps/api/prisma/seed.ts) | Tenant/User/AuthSession/Role为公共身份候选；BusinessWorkspace/WorkspaceMember含Rental品类与空间关系，不能作为通用Core授权表直接复用。逐表确认读写所有者、复合键、存量映射和迁移顺序；公共初始化与Rental Seed分别负责 |
| 共享正式出口 | [shared出口](../../../packages/shared/src/index.ts)、[包出口配置](../../../packages/shared/package.json)→API DTO/[OpenAPI](../../../apps/api/src/contracts/openapi-document.ts)及各端 | shared同时导出类型和运行时代码；API消费产物，后台[Vite](../../../apps/admin/vite.config.ts)仍别名到源码。冻结合同版本、命名空间、错误语义和兼容出口，列出DTO/schema/OpenAPI/客户端对应关系 |
| 后台壳与缓存 | [navigation](../../../apps/admin/src/app/navigation.tsx)、[AppRouter](../../../apps/admin/src/app/AppRouter.tsx)、[authStore](../../../apps/admin/src/features/auth/authStore.ts)→[queryClient](../../../apps/admin/src/app/queryClient.ts) | 当前导航/页面含Rental，缓存按会话/租户/空间清除并中止旧请求；Core准入变化须复用这些防迟到机制并补业务命名空间。界面可切换或分组，直接URL/API仍服务端鉴权 |
| AI适配 | [应用providers](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts)、[runner端口](../../../apps/api/src/modules/ai-native/runner/ai-task-runner.ports.ts) | 组合引用Rental执行者，预算指纹依赖Rental文件，runner边界有Prisma类型。由AI原作者提供固定适配子交付；无Core不开放通用Agent，缺AI工具仅阻止对应Core的Agent访问 |
| Rental兼容 | [品类解析](../../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)、[空间能力](../../../apps/api/src/modules/rental-core/workspace-capability.service.ts)、[Hook运行时](../../../apps/api/src/modules/rental-core/capability-hook.runtime.ts)及原订单/库存/资金链 | CAT-GOV仍是Rental内部扩展；初始化、品类采用、报价→下单→履约→结算及原收据按已支持场景保留。原未完项仍归原专项，不用假授权或全部unavailable证明兼容 |

数据归属还须沿真实读写补齐：租赁会员、企业租赁资格/授信、订单、库存及资金事实留原领域；文件/通知/审计的基础机制可以共用，但业务ACL、投影与事件事实仍由所属Core裁定。AI预算账与任务资源账也不混用。不能因文件位于platform或使用相同客户ID而成为跨Core公共数据。

### 最小工作树与公共文件安排

- 文档准备使用独占任务树及 `codex/pch-preparation` 分支；仅改本册和接续，需求、任务、平台索引及未来方案保持原文。树路径、检出范围及验证见本阶段交付项。源码只读取固定提交，不复制其他研发树的WIP、依赖、生成物或环境文件。
- PCH-01/02源码阶段建议只设一个PCH作者工作树，按PM指定固定基线扩展；无需先拆出多个子树。01可直接按Git对象逐项盘点。02涉及真实合同编译时再准备根package/lock/tsconfig、shared、MCP server、API公共模块及其完整导入闭包、admin壳/配置/UIArc、对应现有验证与fixture；当前单体装配下不能只拷两个入口文件就声称可构建。安装与运行按后续实际授权办理。
- PCH新增合同模块/适配文件可以独占，但具体路径与导出须在02冻结。现有公共文件只按PM安排的唯一作者窗口修改；文档中的候选路径不是写入授权。

| 公共窗口 | 最小交付与先后 | 归属安排 |
| --- | --- | --- |
| shared总出口/包配置、DTO/OpenAPI | 01消费者清单→02版本化合同及生产者/消费者映射；随后03/04使用 | PM指定一名集成作者；企业/Core/AI已获准的领域合同片段仍归原作者，不整取活动HEAD |
| AuthService、ApiAuthGuard、RequestIdentity及身份合同 | 02明确最小身份/范围解析及授权事实→04真实接线；原audience/撤权/ALS不放宽 | 先由PM核定共同身份文件窗口；AI和企业既有鉴权片段仅接收固定成果 |
| PlatformService/Repository、订阅、schema/迁移/Seed | 01数据所有者和提交点→02授权/绑定/事务设计→04/05/06；原人员/商业锁早于品类/空间锁 | 平台事务、迁移各指定唯一作者，Rental初始化与品类政策由原Core作者负责，避免在Core回调逆序取得人员/商业锁 |
| AppModule、根构建/锁文件、配置入口 | 02明确组合和出口→03真实宿主；保留OP配置以及企业/AI已登记项 | PM安排唯一装配作者，配置改动与OP固定交接 |
| navigation/AppRouter、authStore/queryClient及后台公共壳 | 02页面/上下文合同→03/04固定接点、05固定生命周期→07 | 与现有UI作者协调具体窗口；Rental页面不由PCH文档作者接管，写前读取admin规则与界面规范 |
| AI应用组合、预算和runner接点 | 02/04/06与08的正式出口固定后→09 | AI-RD负责内部实现和助手分工；本会话只向PM交所需合同，不直接派AI助手 |

### 原任务顺序与验证组合

1. **PCH-01先形成可冻结清单：** 标注每项import/注入、数据读写、事件/作业/回调、UI/API/各端消费者与作者；区分公共宿主、Rental适配和合理组合。补完现有代表链及原未完项，确认无Core、Rental单Core、非租赁单Core、双Core的组合边界。
2. **PCH-02消费01固定清单：** 确定同仓模块/正式出口、Core标识与版本、注册/租户授权/成员分配/绑定/就绪独立事实、资源范围、错误和冲突、初始化事务/锁、审计/原操作及迁移兼容。选择有限事务接点，不向公共合同暴露全库Prisma Client或框架类型；Rental与非租赁消费者必须能消费同一合同。
3. **后续仍沿原依赖：** 03/04基于02固定子交付，05/06固定初始化与授权事务，07消费真实上下文；08保留Rental，09按原前置接可选AI，10/11验证样例与独立接手，12收口兼容/回退/审查。无需等待CAT-GOV或AI全专项100%，也不能绕过实际所需子交付。

最小非租赁样例建议为“项目事项登记”：独立项目分区与记录持久化，覆盖创建→读取→状态变更→进程重启后读取，成员可访问不同项目；无需资金、库存或外部供应商。这是01待冻结的实现候选，不新增完整项目管理产品，不提前记样例完成；AI可选验证仍按09/10另行满足。

| 验证组合 | 必须观察的行为 |
| --- | --- |
| 无Core／已装配但租户未获权 | 独立构建/启动/登录与公共后台可用，提示联系管理员；不加载未选Core迁移/Seed/作业，不开放通用Agent |
| Rental单Core／非租赁单Core | 自身业务分区、正式入口和真实持久化可用；Rental存量授权、业务事实与原收据等价 |
| 双Core及另一租户仅单Core | 同宿主同租户并存、同ID不串数据；不同租户/成员只见获权集合，新Core不默认分配全员 |
| 成员撤权／旧修订／迟到响应 | 页面、直接URL/API与Agent都复验；旧会话/缓存/请求不能继续泄露或新办业务 |
| 单Core停用→重开／统一期限到期→续费 | 数据/配置/绑定和原收据保留，其他Core可用；重开核当前条件，不初始化或重放旧操作，续费不解除主动停用/成员撤权 |
| 有／无AI工具 | 普通业务均按权限可用；Agent只调用明确发布且当前获权工具，部分工具不扩大为全Core操作 |
| 在途、unknown及回退 | 按原身份/操作/收据受控收尾；停用、超时、重开均不证明可以换键重做；迁移/兼容和旧程序回退另取真实证据 |

已有验证可从[租户权限测试](../../../tests/tenant-access-atomic.test.cjs)、[空间范围](../../../tests/rental-workspace-scope.test.cjs)、[订阅服务](../../../tests/saas-subscription-service.test.cjs)、[品类/订阅身份](../../../tests/category-subscription-identity.test.cjs)及原Core/AI定向入口选取。逐个先读脚本：其中tenant-access-atomic会读取环境配置并要求DATABASE_URL，不能按名字当离线测试。现有脚本并未覆盖尚不存在的PCH宿主/授权合同，本轮未运行业务测试。

### 交付、验证与剩余项

PCH-01全面清单/样例冻结及PCH-02正式源码合同尚未交付；公共文件作者窗口和源码固定基线仍待PM安排，独立接手者、真实运行/持久化、浏览器、模型、迁移回退及独立审查仍未完成。本片只完成启动前的定向核对和顺序准备；原工程缺口继续保留。

文档树为 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，分支 `codex/pch-preparation`，仅稀疏检出 `docs`、`scripts` 及根级受版本控制文件。跨日后已于2026-11-13重新核对本树HEAD、工作区/暂存区及GitHub实际main，仍为上述固定基线；该任务分支此前无远端提交。没有复制依赖、构建产物、环境文件或整套主树。

| 实际命令/核对 | 结果 | 证明范围 |
| --- | --- | --- |
| `git ls-remote --heads origin main codex/pch-preparation`、`git merge-base --is-ancestor d1ae52df6d8207e913d6e49fde1dd28c7c962bc3 2a5c56471abb5714f80715e2cfa0aa236f003f51` | 退出0；主线固定基线与既有文档祖先核实 | 文档已进入Git/远端历史；本次不替他人推主线 |
| `node -`原文及固定差异核对 | 12/12前像字节数/SHA-256一致；五份现行正文与d1ae版本一致，记录的旧标签回入已明确 | 最初六份blob直接相等检查退出1，定位为记录变化及换行差异，未据此误报六份字节一致 |
| `npm run docs:check`（主树只读运行） | 退出1；11份白名单文档，仍为总导航第54行三个历史附件缺失 | 未修改检查器、引用或历史附件，不代表全库文档通过 |
| `node -`定向文档检查 | 退出0；六份现行、两份归档索引及12份前像，共372个本地链接、51个锚点引用、57个表格，无问题；12项任务身份/进度及四份未改文档一致 | 复用现有校验器；稀疏树未检出的链接目标依据固定Git树存在性及blob核验，非当前文件/运行验收。原阶段记录正文完整保留 |
| `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check -- docs/平台底座` | 退出0；按现有CRLF检查空白，未修改仓库配置 | 默认 `git diff --check` 曾将记录新增行的CRLF报作尾空白；保留原换行方式，仍检查行尾空格、空文件尾与tab前空格 |

本片仅两份Markdown变化；记录/接续按原四册维护，没有新增第五册、测试脚本、临时验证目录、后台进程或历史重复副本。文档任务树作为后续交付入口保留；验证脚本均经stdin运行。应用创建工具的完成状态未返回，挂接重试报“Cannot verify that this ownerless worktree belongs to this task”；已另以Git核对本次新建路径、固定HEAD、干净索引且无创建/合并/拣选锁，再在此树显式操作。应用挂接仍待确认，不影响通过独立Git分支交付；不要重复创建工作树。

提交只包含本片两份文档，普通推送目标为上述任务分支，固定提交和远端回读结果通过本阶段PM单点交付登记。main合入由PM安排，本片不合main。没有代码、运行、真库、模型、供应商、迁移回退、独立接手或独立审查证据。

<a id="nativark-mit-main-integration-20261114"></a>

## Nativark README 与许可固定成果归并 main（2026-11-14）

负责人已在底座对话确认 Nativark 开源品牌、底座主体及 MIT，PM本次按巡检/阶段收回授权整合已推 `d4ea8aa340a77e996bb5c54f76e2f98b9fdedb43`。固定来源仅六文件；main取标准LICENSE、底座视角README、根package.json和package-lock.json的license元数据，并归并下述原阶段记录及当前接续。依赖、脚本、工作区、原业务和租户后台品牌不改；标志仍待负责人在A/B中选择，原稿保留任务分支，不在本片替换应用Logo。

集成起点main `43d2f88c58a87a49d07bd347e18e44d32adbd1f8`。四份文件blob与固定来源一致；package前后JSON只新增license，README本地链接、原技术入口锚点及既有白名单差异检查核定。原PCH-01/02及后续工程仍未实施，不把许可/文档记为Core拆分完成。测试/服务/业务HTTP/DB/模型/迁移/部署均未运行，无新增临时文件或进程，中文提交普通推送并回读GitHub，保留全部main并行WIP。

<a id="nativark-mit-20261114"></a>

## Nativark 底座 README 与 MIT 许可（2026-11-14）

负责人确认开源品牌为 Nativark，并明确要求为仓库加入 MIT 许可证。GitHub 公开仓库接口已确认名称为 `JinPen-G/Nativark`、默认分支为 `main`。本轮复用原文档工作树，按已核实的固定主线 `9fb20dd236143f9b4c502bf7651b94ecc6bced8f` 建立 `codex/nativark-mit`，开工时该提交与实际远端 main 相同，工作区与暂存区干净，无合并或拣选现场。

根目录新增标准 [MIT 许可证](../../../LICENSE)，版权署名采用 `Copyright (c) 2026 Nativark contributors`。根 README 的许可段指向该许可证，根 package.json 和 package-lock.json 的根包元数据同步 `license=MIT`。第三方组件、素材与上游源码仍按各自版权及许可声明使用，具体来源沿根 README 的第三方内容入口查阅。

负责人进一步明确开源主体为底座，Rental Core 将作为第一个业务 Core 示范开源。本阶段据此重写根 README，介绍 Nativark 公共能力、目标架构、Core 注册与授权、可选 AI 工具、示范业务、开发目录、当前组合运行步骤和贡献入口。独立宿主及多 Core 接入的目标放在设计语境中，当前命令对应现有组合工程。原技术资料使用的项目组成、环境要求、配置、验证等章节锚点继续可定位。

改写前根 README 在固定主线 `9fb20dd236143f9b4c502bf7651b94ecc6bced8f` 中保全。本轮只补 MIT 段的中间稿也保存为 Git blob `1ebc5137612438606813eab415856c4a0413fc6d`。本阶段修改集中在根 LICENSE、README、package.json、package-lock.json 及本专项记录、接续。

最终使用 `node --no-compilation-cache -` 经 stdin 复用现有文档检查器，退出 0。三份改动文档的 160 个本地链接、28 个锚点引用和 18 个表格核对通过，原 README 的项目组成、环境要求、配置、验证、贡献和许可章节入口保留。稀疏检出中未展开的目标以固定基线 Git 树与 blob 核验。11 份白名单文档仍有五处基线缺链，分别为总导航的三份历史附件和 AI Native 接续的两份 output 证据，本次新增错误为 0。

MIT 正文与已有标准文本比对通过，版权署名为本阶段选定的 `Nativark contributors`。根 package.json 和 package-lock.json 仅新增根包许可字段，依赖配置一致。原阶段记录、正式需求和任务正文逐项比对保留，第三方许可及来源入口可定位。差异格式检查采用 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check`，按原换行方式核对新增文本。

本阶段只交付文档、许可证和包许可元数据。验证脚本通过 stdin 执行，本任务没有创建临时目录或后台进程。提交范围为本阶段六份文件，固定提交由包含本节的 Git 提交定位，普通推送目标为 `codex/nativark-mit`，上传后以实际远端分支回读核定并在本对话保留结果。主线归并按现有负责人流程办理。
