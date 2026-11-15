# 平台 Core 接入当前协作接续

更新时间：2026-11-15。

> 状态：负责人已明确授权本对话全权负责独占工作树及PCH拆分需要的公共文件，原唯一作者窗口阻塞已解除，持续完成PCH-01～12。最新main62ca已纳入；[独立公共宿主阶段](平台Core接入-开发记录.md#core-public-host-packages-20261115)提供公共合同/服务包、只含公共表的schema与构建、实际认证/外观模块及精确Guard，原Rental兼容出口继续消费同一实现。[公共初始化与管理](平台Core接入-开发记录.md#core-public-management-20261115)和[标准Core主接点](平台Core接入-开发记录.md#core-public-assembly-20261115)已接独立AppModule/Guard/同源HTTP，[公共期限和数据计划](平台Core接入-开发记录.md#core-public-data-term-20261115)已提供真实reader/物理检查，[工单独立示范](平台Core接入-开发记录.md#core-tickets-independent-host-20261115)已有标准适配/宿主/严格包门禁与迁移准备，下一入口为固定标准包真实消费、完整公共订阅/设置与后台；完整无Core运行/后台、多Core及Rental全功能验收仍未完成。

开源主体为公共底座，Rental Core 是首个业务 Core 示范。现有 Nativark README/MIT 与品牌原稿已在 main，负责人已另开命名对话继续选择名称；本片沿现有技术包 scope，不因命名讨论改运行标识。品牌固定来源见[许可记录](平台Core接入-开发记录.md#nativark-mit-20261114)与[main合并](平台Core接入-开发记录.md#pch-frozen-main-20261114)。

N/A/B 原稿完整保留在 `8f4c45b3a5f637256afac9363ca13a4cd2232a5c` 及当前资产目录，[N保留记录](平台Core接入-开发记录.md#nativark-logo-n-retained-20261114)与[两版设计记录](平台Core接入-开发记录.md#nativark-logo-core-options-20261114)保留来源及验证。运行Logo的Preview黑白适配归原后台作者，本片不接管品牌设计。

> 正式依据：[需求v1.5](平台Core接入-需求.md)、[开发任务v1.5](平台Core接入-开发任务.md)。原PCH编号、依赖、顺序及G1～G4计分继续使用原表，统一能力查询纳入原01/02/11。各项进度按原门槛核收。

负责人要求接入手册与每片代码同步，实际文件/命令/预期结果/错误处理应能直接交给开发Agent。当前可执行的清单/包检查见[契约包说明](../../../packages/core-contracts/README.md)，完整五步业务接入仍按原任务逐片落地。只做必要测试的规则已补入根[AGENTS](../../../AGENTS.md#修改验证与交付)。

## 1. 当前目标与已明确的边界

建设比脚手架更完整、对开发者和开发AI友好的AI Native SaaS底座，交付真实公共能力、正式合同、样例及可独立接手的资料。无Core可启动、登录和进入公共后台，未获Core授权时提示联系管理员，不开放无Core通用Agent任务。

开发者受控注册Core→SaaS管理员直接授权租户→租户管理员分配成员可用Core→按Core内角色与数据范围使用。同部署/同租户可并存多个Core，新Core不自动分配全员；首期不新增Core申请流程，原订阅申请保留。Core共用租户订阅期限，开通/停用分别控制；停用保留数据、配置、原绑定和收据，重开核当前条件，不重复初始化或重放旧操作。续费不恢复主动停用、成员撤权或账号冻结；客户等其他audience沿原专用授权，必要历史和在途/unknown按原权限收尾。

Core各自定义业务分区，Rental经营空间/品类/地点留在Rental内部；AI工具可选，缺少时普通后台可用，Agent不能查询/操作该Core。多Core导航可切换或分组，权限、状态与缓存须隔离。首期同仓独立模块和受控组合构建，可同进程同库；跨Core互通本期只固定接点，具体场景留未来。

整个管理后台外壳归底座，包括左栏、内容容器、顶部面包屑/页名整行及铃铛/休息/面板收展；无Core只缺业务贡献，公共设置及自身保存可用。Core作者在自己的路由/页面声明操作，框架使用既有主按钮、表单/列表/详情和请求反馈；不要求复制样式或修改底座内部。实现与验收见[页面合同](平台Core接入-开发任务.md#declarative-page-contract)，实际源码边界见[本次澄清](平台Core接入-开发记录.md#core-declarative-pages-20261114)。

拆分按[功能对照与切片门槛](平台Core接入-开发任务.md#compatibility-slices)保护所有已支持功能；旧失败/未验项保留原归属。先做[标准包及本地安装](平台Core接入-开发任务.md#core-package-standard)，再接GitHub Release下载和 `nativark-core` Topic发现。开发者从[五步指南](平台Core接入-开发任务.md#core-quick-start)和[Agent任务模板](平台Core接入-开发任务.md#core-agent-template)开始。AI Native未完成不阻止无关切片，其最小固定接点按[并行边界](平台Core接入-开发任务.md#ai-parallel-boundary)办理。

按[源码整理](平台Core接入-开发任务.md#source-organization)核收整个平台的可读性和简洁实现，API与源码/例子同版本。无Core租户登录和公共设置须真实可用，轻量工单/工作流由Core承载。底座和各Core按[独立更新](平台Core接入-开发任务.md#independent-upgrades)分别升级，保留下游Core、配置、授权与数据；不将源码合并成功当部署升级通过。

开发Agent从[统一能力索引](平台Core接入-开发任务.md#capability-index)按关键词/类别/归属查询，读取准确公共导入、API/页面、源码和接入资料。目录从模块原声明生成，源码/登记/验证状态及动态缺口准确区分；运行工具发现仍经当前身份和原发布授权。

[品类治理](<../../Rental Core/品类治理/品类治理-协作接续.md>)、AI Native、MCP、Harness及Runtime/SDK仍按原专项和作者推进。PCH不重派其任务，不把它们全项完成当作开工前置。

## 2. 写入归属与固定来源

- 当前独占树为C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS，分支codex/platform-core-extraction。负责人明确本树只有本对话，授权全权负责PCH需要的公共身份/Auth/Guard/ALS、shared正式出口、AppModule/OpenAPI、schema/迁移/Seed及后台壳/路由。原文件窗口阻塞已解除，本树由本对话唯一施工；不写main索引或其他树，不覆盖其他树活动WIP。
- 最新main62ca183f10b7c316ab63c28ef6d04ee88d06488b已纳入并上传；固定同步与双方记录保全见[同步阶段](平台Core接入-开发记录.md#core-main-runtime-sync-20261115)。后续从最新已提交main及本树差异核对，再整合固定成果。
- 原简称检查点982043aba913745c6d0e258b2d74ca1efb9a98d4已包含在本树，原省略/null/空字符串、审计和租户投影保留。[原公共基线](平台Core接入-开发记录.md#core-public-window-baseline-20261115)与[后台简称记录](../../管理后台/管理后台-开发记录.md#operator-short-name-foundation-20261114)分别定位既有差异及剩余实页/真库验收。
- 当前Core合同、宿主授权/绑定和工单样例分别在packages/core-contracts、packages/core-host、packages/example-tickets-core；公共平台适配在packages/platform-core-host，原API保留薄转接。公共后台正式出口为packages/platform-admin，原apps/admin/src/core等路径兼容转接同一实现。独立迁移尚未进入实际部署，原主应用/Guard/业务路由仍需消费。
- [公共认证片](平台Core接入-开发记录.md#core-public-auth-extraction-20261115)已将公共声明、账号/会话/原角色映射和签名/刷新抽为单源，原Rental兼容路径及外观旧品牌显式适配保持。其他专项正式需求、原任务及未验事项仍归原册；真实业务环境、安装/迁移、合main或发布不因源码写权自动开放。
- [独立公共包及宿主](../../../apps/platform-api/README.md)消费platform-contracts/platform-server正式出口，原19路径只做窄转接；原组合schema/迁移保持，公共新库基线独立。构建/实际Nest容器与离线平台表行为已核，公共初始化/租户与人员角色管理已接线，真实HTTP/持久化、完整后台与剩余订阅/集成尚未验；Core管理适配已进入独立公共主组合，当前22模型/4份公共SQL含统一期限归公共宿主，物理计划与当前schema生成类型通过；所选Core实际运行/原Rental总装配尚未交付。
- 原接续全文保存在固定d170a5fa8db1cb56d166fb05246790c0ead29539同路径。本册继续承接全部未完项和证据链接，历史前像与品牌原稿在Git，不重复复制。

## 3. 下一入口与待交付

公共前端源码和Core呈现已单源移入 [platform-admin](../../../packages/platform-admin/README.md)，原宿主通过验证后的会话/请求/缓存端口消费。[零Core Web](../../../apps/platform-admin/README.md)与[工单Web](../../../apps/example-tickets-admin/README.md)现消费同一公共应用工厂；后者只增加四页注册表，类型、内存构建、声明路由和权限过滤已核。前后端共用实际标准包核验；构建验证的清单是明确fixture，真实磁盘安装门禁/运行未验。先从[当前证据与缺口](平台Core接入-开发记录.md#core-tickets-admin-host-20261115)接续，将Core管理面板接实际公共租户/成员目录，再继续完整公共服务和Rental包。真实登录/保存、浏览器、干净安装和旧功能全量回归仍未验；下述原任务未完项继续有效。

1. 01已按固定main核对238个模型的所有者分组、259份迁移的混合依赖、全部API模块/公开入口集合及代表性页面/客户端/作业消费者，具体去向和原失败/未验见[归属基线](平台Core接入-开发记录.md#core-ownership-baseline-20261114)。[开发能力查询](../../../packages/core-contracts/README.md#找到平台已有的功能)和[模块导读/直接消费者](平台Core接入-开发记录.md#core-source-reading-20261115)已有实际入口及覆盖状态，源码用途/文档缺口继续按模块整改。完整行为基线、独立schema/迁移账和最终前后运行对照仍按原门槛交付。
2. 02已有清单/版本/对象命名空间、目录检查、OpenAPI贡献、服务端/生命周期与授权变更schema；[升级预检](平台Core接入-开发记录.md#core-update-preflight-20261114)及[未完成迁移观察](平台Core接入-开发记录.md#core-main-runtime-sync-20261115)已有独立版本锁/实际数据观察和单对象候选。[首次绑定及事务](平台Core接入-开发记录.md#core-binding-runtime-20261115)与[原绑定/工单组合](平台Core接入-开发记录.md#core-original-binding-tickets-20261115)已消费原主体、当前Core/成员使用权、订阅及同事务审计，下一步接真实部署/数据观察和主应用消费者，核对Rental旧身份兼容。[工单样例](../../../packages/example-tickets-core/README.md)包含领域/MySQL、独立迁移、8操作Nest与同源OpenAPI/原收据只读、4页面贡献，主Guard/HTTP/后台仍按公共窗口接线。
   [原账/工单物理观察](平台Core接入-开发记录.md#core-mysql-data-observation-20261115)已提供正式mysql-deployment子出口及readTicketsPhysicalData。原迁移checksum/顺序与实际3表关键结构共同由目录/升级预检消费，坏Core证据不关闭无关Core；下一步公共平台数据所有者提供自身完整结构检查及已核定原迁移名称映射，受控主组合消费同一Source。真实数据库/原schema拆分仍未验，不从包清单推导就绪。
   [工单原绑定兼容](平台Core接入-开发记录.md#core-tickets-binding-readability-20261115)已使清单、server和原业务组合共用可读范围，保留原绑定/初始化版；普通准入仍核当前物理库及完整迁移。三包类型及原工厂/ALS/授权/迁移/收据离线链通过，实际升级与真实数据库未验，当前API类型证据见下条。
   [更新范围兼容](平台Core接入-开发记录.md#core-update-scope-compatibility-20261115)已使普通单Core预检拒绝租户/容器转换及容器类型改名，返回scope_changed，避免候选切换后原绑定失效。同范围修复、前进迁移与底座更新保持原规则；改变范围仍须专门迁移，实际更新/部署未验。
3. 公共身份/认证、窄存储端口及无Core API构建已由[公共包阶段](平台Core接入-开发记录.md#core-public-host-packages-20261115)交付。[公共管理片](平台Core接入-开发记录.md#core-public-management-20261115)已有无业务表初始化/租户与人员角色、本人资料及当前身份围栏。公共Core包已抽有限事务/订阅/审计接点并进独立Guard/主模块/同源OpenAPI，原组合保留薄适配。公共期限/物理计划已提供，所选工单标准宿主已有显式组合及严格包核验；下一片从固定标准包进行真实消费并接后台，原Rental总AppModule/Guard与后台另接。原有效会话的wid必须作为签名证据复核，不在公共业务workspace中恢复权限；真实订阅/物理迁移观察不能用清单补成功。精确原候选见[公共候选表](平台Core接入-开发记录.md#core-ownership-baseline-20261114)，[原身份管理](平台Core接入-开发记录.md#core-original-management-20261115)、[部署目录](平台Core接入-开发记录.md#core-deployed-catalogue-20261115)和[管理HTTP/接口资料](平台Core接入-开发记录.md#core-management-http-20261115)供主组合消费。旧API身份与Rental映射继续按自身合同，本树由本对话负责。
   当前服务端公共窗口的精确文件/方法及原反向依赖见[实际主入口核对](平台Core接入-开发记录.md#core-package-cli-public-entry-20261115)。先抽平台公共投影/身份及正式合同并保留Rental兼容，再接原Guard/主装配；Auth/PlatformRepository/Service、shared出口、AppModule/OpenAPI已获负责人本次明确授权，不继续用独占接口数量代替独立宿主。
   [当前基线/窗口核定](平台Core接入-开发记录.md#core-public-window-baseline-20261115)确认原主装配仍未消费Core接点，5处公共差异来自已获准简称检查点，后续须从当前含该成果的基线施工。主树服务端候选暂时无WIP，但它和PM已结束的turn均不是新增写权；本树下一PCH主实现继续独立公共宿主和Core主装配；main后台壳活动WIP继续归其作者。
   [原身份SQL模板](平台Core接入-开发记录.md#core-principal-sql-runtime-20261115)已移除模板所需的顶层生成Client运行依赖，15条实际ALS/SQL新旧等价路径通过；原身份仓储及行业投影仍待上述公共窗口。[当前API类型](平台Core接入-开发记录.md#core-api-types-current-schema-20261115)已使用本树实际离线生成Client声明核978根/2,176源零诊断并清理产物；主Guard接线和真实无Core登录未验，不把类型/模板解耦视为主应用拆分完成。
   [当前事实读取](平台Core接入-开发记录.md#core-management-current-reads-20261115)已提供页面变更所需的授权/成员/绑定修订，主应用组合时将 `reads` 与原服务一起供给Controller，页面先读当前事实再提交。
   [原授权结果核对](平台Core接入-开发记录.md#core-access-panels-receipts-20261115)增加两条只读收据路径，主Guard/OpenAPI应直接消费现行单源声明。租户资料和成员资料可分别挂载admin/core正式出口的CoreTenantGrantPanel/CoreMemberAssignmentPanel，原操作及当前状态分别读取；面板不自造目录或身份。[授权刷新与缓存](平台Core接入-开发记录.md#core-access-refresh-receipt-20261115)已把确认结果与随后读取失败分开，只读恢复不重发；本人变化先取消旧目录请求，撤去目标Core条目并清理其缓存，其他Core缓存保留。类型/实际查询库离线通过，主壳/服务端和实页仍待接线。
   [当前成员Core目录](平台Core接入-开发记录.md#core-session-directory-20261115)另提供已登录operator的一条GET及CoreSessionHttpModule/register(reader)。原Guard需明确登记自助政策、OpenAPI总组合消费createCoreSessionOpenApi，主壳/路由可消费useCoreSession的本人集合/管理候选；Core绑定、范围和就绪另核。
   [真实范围/就绪读取](平台Core接入-开发记录.md#core-scope-readiness-20261115)提供CoreScopeHttpModule/register(reader)及同源只读POST/OpenAPI/useCoreScope；后台先核本人Core/页面权，再读Core范围与实际ready。Core自持事务的调用不跨父事务持锁，返回前复核当前绑定，主Guard/组合仍待公共片。
   [统一应用装配](平台Core接入-开发记录.md#core-application-assembly-20261115)已提供composeOriginalCoreApplication及CoreHostModule/register({imports, inject, useFactory})；主应用须先由唯一原服务模块导出真实数据库/人员/订阅/审计及部署目录，再给单一工厂消费。总模块与原单独模块只选一种装配，避免重复Controller；核心业务HTTP另由所选Core登记。主provider不自动对子模块可见，当前实际Nest离线容器已核该拒绝边界。
   [标准HTTP政策](平台Core接入-开发记录.md#core-http-policy-registration-20261115)由Core实际声明生成并放入部署目录http，工单已有createTicketsHttpContribution。主Guard在原签名/ALS后统一调用应用authorizeHttp，业务/原收据及订阅停新按声明和所属服务复验，未知政策拒绝；不为每个新Core向Guard加业务分支。staff/client仍待自身正式适配，原Rental路径保持原兼容政策。
   [移除预检](平台Core接入-开发记录.md#core-removal-preflight-20261115)提供平台准入/完整依赖Source与Core检查汇合，当前SaaS身份前后核验，十一管理操作新增removal/read。[工单实际依赖](平台Core接入-开发记录.md#core-tickets-removal-data-20261115)已由原工厂消费真实MySQL未关闭/历史/原收据读取，缺结构unknown；平台Source及其他Core检查器仍须各自所有者提供，缺失不允许移除。预检clear不执行停新/排空/删除，实际部署移除及AI/回调/作业/历史依赖仍待05/06接线。
4. 沿原03/04→05/06及07固定上下文→08 Rental适配逐片推进，兼容适配先行；每片整理职责与重复逻辑、补准确源码备注和API说明并验证受影响功能，保留必要校验、事务、历史、缓存和唯一执行者。09按原业务出口与AI固定接点处理可选工具及已有任务恢复。
   07沿已授权本树整理BusinessShell/WorkspaceHeader/PageHeader/按钮正式出口、AppShell/navigation/AppRouter/认证缓存、通知业务来源及休息/右面板公共身份适配的正式消费；用工单路由/主操作验证只改Core和装配。完整外壳、单次表单请求、动态操作清理和默认页面模式沿v1.5核收。
   [独立页面合同](平台Core接入-开发记录.md#core-admin-contract-20261114)已有正式类型/路由注册/目标解析，[React适配](平台Core接入-开发记录.md#core-react-page-adapter-20261114)消费原PageHeading/SaveButton/ConfirmAction，`@rental-os/admin/core`为正式源码包出口；[工单页面和Core请求](平台Core接入-开发记录.md#core-tickets-admin-20261114)已有实际源码消费者。真实注册/授权与主应用路由仍未接，下片消费这些适配，不复制通用壳或改变业务方法。
   [声明路由/导航消费](平台Core接入-开发记录.md#core-declarative-routes-20261115)新增createCoreRouteElements及同源菜单/面包屑生成，主Router展开原Route元素，主壳消费同源名称/链接。工单默认详情读取框架登记参数；配置页声明purpose=configuration，当前获权但未绑定/缺项时可配置。公共总入口仍未改，实际浏览器/Portal/回车及无Core壳待验。
   [首次设置消费](平台Core接入-开发记录.md#core-tickets-first-setup-20261115)新增标准useCoreBinding及工单第四页setup，先读原绑定，当前管理权和成员分配满足后办理，未知只读原操作。双语配置页名称和purpose进入同源能力索引，原Auth/Guard/AppRouter接线仍待公共窗口；当前源码/离线调用不表示实际后台已运行。
   [Core表单提交](平台Core接入-开发记录.md#core-form-submission-20261115)由useCoreForm及工单新建页实际消费，原Form/SaveButton校验后共用submit、反馈及草稿保护，unknown同步拒重发。接入例子在admin/core已有README，实际portal/回车/离页及主壳仍需原浏览器组合验证。
   [工单详情消费](平台Core接入-开发记录.md#core-tickets-detail-actions-20261115)已将分派表单接同一Hook，处理/关闭保留分派草稿、不同动作不合并，unknown只读原键。可信业务结果与随后详情刷新错误分开，读取失败单独提示并可只读恢复；实际React/Portal/浏览器和原宿主装配仍待对应验收。
   [标准列表/工单分页](平台Core接入-开发记录.md#core-list-pagination-20261115)由CoreList消费原Table/分页/QueryState，工单/ticket-pages同范围返回rows/total并提供第8条HTTP政策；旧数组接口保留。主组合仍需登记当前同源贡献，实际数据库CTE/授权、分页渲染及无Core壳待验；最小写法见admin/core已有README。
5. [本地打包/安装准备](平台Core接入-开发记录.md#core-local-package-install-20261114)、[固定Release获取](平台Core接入-开发记录.md#core-github-release-20261114)及[Topic查询](平台Core接入-开发记录.md#core-github-discovery-20261114)已有共用候选链。[固定仓库根清单/多Core索引](平台Core接入-开发记录.md#core-github-repository-20261115)已提供真实读取器和作者指南，下一步接宿主发现/安装管理界面与实际部署，以非租赁持久化业务验证完整安装。10/11由独立开发者或Agent只凭简明指南和业务要求接手，在干净宿主重现安装→授权→业务；12核收全功能前后对照、源码/API可理解性、底座跟随上游与Core单独升级、配置/定制/数据保留、回退/分发失败及原独立审查门槛。真实GitHub测试发行和实际远端安装仍待核验。
   [实际工单打包](平台Core接入-开发记录.md#core-tickets-package-20261115)已用真实编译文件形成30文件标准包并核待部署复用/篡改拒绝；pack:core统一构建与清单/API/手册生成，来源须固定提交且无源码差异。prepare成功仍pending，没有干净宿主业务/真实发行验收；源码说明及Node正式出口可供下一实际安装片消费。
   [固定来源子进程链](平台Core接入-开发记录.md#core-package-cli-public-entry-20261115)实测metadata打包、标准check、prepare/重复prepare退出0，重复覆盖退出1；相对包exports和Git根定位按真实Node行为核对。临时目录全部清理，实际运行安装/数据库/远端Release与独立接手未验。
   [随包指南入口](平台Core接入-开发记录.md#core-package-document-links-20261115)已直接链接包内API/服务端/后台与资料，工单README及指南复用正式源码链接转换。[当前包命令复验](平台Core接入-开发记录.md#core-package-current-cli-20261115)已在固定5de源码实际编译并核30文件包、8操作API、指南/README链接、prepare/重复prepare和check，重复覆盖拒绝；此前该验证的自动审批拒绝历史保留，当前实际包/CLI缺口已补证。临时文件全部删除，状态仍pending，干净宿主运行安装/真实发行/升级与独立接手未验。
6. 不同租户/成员、撤权、停用重开、统一期限、有/无工具、迟到响应与unknown验证组合继续保留；部署移除、停用、订阅到期和成员撤权分别判定。

独立包已有清单/目录静态检查、API组合、服务端/页面合同、独立升级预检、指南生成、本地/固定Release准备及Topic查询，后台有原组件的CorePage适配；尚非完整运行SDK。完整功能/源码基线、API离线资料、真实独立宿主、多Core授权/生命周期与UI/AI接线、工单持久化样例、发现管理界面/实际部署及独立更新、独立接手和兼容回退继续待交付。后续只补必要测试，现有用例/短命令优先，不增加成批测试脚本。

## 4. 验证边界与保留事项

公共宿主阶段临时环境的原生删除被自动审批拒绝，已按统一规则归集到D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/environment，责任清单同任务manifest.json，840文件/91,808,304字节，仍未删除。当前output/.tmp已无本环境；工具允许后本会话优先清理既有残留，不能复制回来或长期保留重复环境。[阶段证据](平台Core接入-开发记录.md#core-public-host-packages-20261115)

本片已有独立合同类型/离线包检查、旧/新指纹22例对照及文件绑定消费者证据，见[开工记录](平台Core接入-开发记录.md#core-contract-first-20261114)。没有安装依赖、启动服务、读取实际环境或执行数据库/模型/供应商验证；完整API/页面构建、持久化/浏览器、独立接手和独立审查仍待相应阶段。合同测试产物集中在本树单一任务目录并由退出清理删除，无后台进程或复制依赖。

API贡献的空/双Core、命名/路径冲突、缺失/外部引用与包读取使用短命令验证，新增类型通过原合同检查；没有新增测试脚本。现有主应用OpenAPI仍未迁移，不能把独立组合器通过当作API整体可运行或接口文档已全部完备。

能力索引、查询分页、SaveButton正式导入、工单4页/8接口、同源清单/OpenAPI及随包指南已有内存编译和离线消费证据，原8组合同通过。[列表阶段](平台Core接入-开发记录.md#core-list-pagination-20261115)记录最近固定源码的索引；直接用途说明、动态元数据和六个未检出应用/客户端的覆盖缺口仍需逐模块处理，不能把索引issues=0当全源码整理完成。复杂动态注册/完整API字段和当前运行工具消费仍未完成，原[首次设置](平台Core接入-开发记录.md#core-tickets-first-setup-20261115)、[范围就绪](平台Core接入-开发记录.md#core-scope-readiness-20261115)和[索引覆盖/部署快照](平台Core接入-开发记录.md#core-index-deployment-snapshot-20261115)保留各自历史验证。

服务端注册的空/双Core、错误贡献、版本与schema拒绝、初始化输入边界已离线核对；授权/绑定MySQL事务源码和原身份适配已提供，实际部署迁移、主Auth/Guard/AppModule仍未接新合同。持续目标已生效，后续仍按原门槛在已授权独占树逐片交付。

原MCP审计的隔离执行/清理曾被自动审批在启动前拒绝，原开工阶段保留拒绝历史。[当前定向复验](平台Core接入-开发记录.md#core-original-mcp-audit-20261115)已执行原3个用例，全部通过、skip/todo为0，原断言未改，离线守卫违规0，临时编译/夹具/缓存全部删除。该证据覆盖原OperationLog及OAuth审计回调的离线行为，真实事务/HTTP、OAuth端到端和完整MCP仍按原专项验收，不能由纯指纹或这三个用例替代。

授权管理片的完整API离线Prisma生成/类型和退出清理曾在启动前被自动审批拒绝，原 [拒绝证据](平台Core接入-开发记录.md#core-access-panels-receipts-20261115) 保留。[当前schema类型核对](平台Core接入-开发记录.md#core-api-types-current-schema-20261115) 已沿原离线守卫/生成及finally清理完成，五包和完整API零诊断，本任务生成产物全部删除。实际主装配、浏览器/数据库、业务权限与全功能仍未验，不由类型通过代替。

工单MySQL文件移动后两个空目录的原生删除曾在启动前被自动审批拒绝。本片恢复原操作后核定独占路径、链接与空目录并删除，原路径及唯一责任清单的任务子目录均已移除。失败历史与恢复证据分别见[工单记录](平台Core接入-开发记录.md#core-tickets-domain-20261114)和[索引阶段收尾](平台Core接入-开发记录.md#core-capability-index-20261114)。

原PCH准备、标准化与品牌固定证据继续见[准备记录](平台Core接入-开发记录.md#pch-preparation-20261112)、[标准化记录](平台Core接入-开发记录.md#core-standardization-20261114)及[main归并复核](平台Core接入-开发记录.md#pch-preparation-main-integration-20261113)。此前总导航三份历史附件及AI接续output缺失仍保留原归属；旧失败/未验项不由本次清单测试关闭。

初版与两轮原文分别见[方案基线](历史归档/方案基线/2026-10-31/README.md)、[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)、[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)。旧记录中的缺失附件、历史临时验证材料去向及未验工程继续由原所有者核明；本片不接管未知产物。保留所有Rental、AI Native、旧方案和测试。
