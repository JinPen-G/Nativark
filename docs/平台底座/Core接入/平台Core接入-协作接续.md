# 平台 Core 接入当前协作接续

更新时间：2026-11-15。

> 状态：负责人已授权开工并设定持续完成 PCH-01～12 的目标，01/02已跨原G1，证据与缺口见[门槛复核](平台Core接入-开发记录.md#pch-first-gate-20261115)。最新main62ca已纳入并上传，Core管理HTTP和同源API资料固定于 `3e8843239ca243bdf8eed87fac1309c63fea2a73`。当前[统一查询](平台Core接入-开发记录.md#core-capability-index-20261114)、授权/绑定和[工单原宿主组合](平台Core接入-开发记录.md#core-original-binding-tickets-20261115)已有实际源码，真实部署及原AppModule/Guard/UI仍按公共窗口接线。

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

- 当前独占树为 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，分支 `codex/platform-core-extraction`，最新main `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 已纳入并上传。固定合并与双方记录保全见[同步阶段](平台Core接入-开发记录.md#core-main-runtime-sync-20261115)，本树共享源码变化后按本树版本准备运行产物，后续每阶段核最新main及WIP再整合。
- 本次固定main修复8文件包含4产品文件和4原记录，源码逐项核同。迁移部分失败/恢复物理状态、CHECK witness及bigint修订读取证据沿[主线运行恢复](../../管理后台/管理后台-开发记录.md#main-database-runtime-upgrade-20261114)引用，升级观察增加未完成迁移拒绝及原恢复资料接点。
- 本片经PM明确的唯一源文件窗口为 `packages/core-contracts`、必要root lock、`common/request-fingerprint.ts`、`operation-log.service.ts`、`integrations/file-content-binding.ts` 与 `rental-idempotency.repository.ts` 的等价指纹再导出。根规则和本册/记录随负责人要求维护，正式需求/任务身份与门槛保持。
- 原派工同时允许PCH非冲突源继续；已新增 `apps/admin/src/core` 的独占React适配及必要admin依赖/构建前置，原壳/页头/按钮仅消费，不修改main后台作者的顶栏/样式WIP。真实路由/授权/缓存消费仍等待下一公共片，不据此扩大共享窗口。
- 轻量非租赁实现独占 `packages/example-tickets-core`，独立迁移只在该包内声明，没有加入公共原schema/迁移链；真实宿主authority与主应用装配仍须原公共窗口。
- 平台Core管理应用层独占 `packages/core-host`，输入/输出复用原core-contracts；独立MySQL表和迁移源码尚未接原schema/部署链，真实原身份/部署管理生产者不在本包伪造。
- 原Core管理适配独占 `apps/api/src/modules/core-host`，复用原ALS、PlatformRepository账号/角色映射及已获窗口的OperationLog同事务方法；API必要包依赖与构建前置已加入。实际AppModule/Guard/平台公共生产者仍按下条窗口办理。
- PM新增UX-TENANT-NAME-01最小窗口，限原platform合同、Tenant/增量迁移、原platform DTO/服务/仓储/Auth租户投影、OpenAPI四个Tenant schema及TenantManagementPage/原请求类型/NativeWorkspaceSwitcher/NativeContextSwitcher简称字段闭包。源码检查点和剩余实际宽度/真库验收唯一见[原后台记录](../../管理后台/管理后台-开发记录.md#operator-short-name-foundation-20261114)，不计PCH新任务，不扩为平台抽离公共窗口。
- shared总index、OpenAPI、AuthGuard、AppModule/AI providers及AI任务目录属于AI/PM既有窗口；未调整其源码，AI可继续使用原Rental指纹出口。平台服务/仓储、schema与后台壳的后续修改先取得对应固定窗口，本片不覆盖他人WIP或接管其专项。
- 已有品牌/文档固定来源和两轮12份前像均在Git。覆盖前接续原文保存在上述main基线同路径，未解决事项在本册及原记录继续有入口，不重复复制历史。

## 3. 下一入口与待交付

1. 01已按固定main核对238个模型的所有者分组、259份迁移的混合依赖、全部API模块/公开入口集合及代表性页面/客户端/作业消费者，具体去向和原失败/未验见[归属基线](平台Core接入-开发记录.md#core-ownership-baseline-20261114)。[开发能力查询](../../../packages/core-contracts/README.md#找到平台已有的功能)和[模块导读/直接消费者](平台Core接入-开发记录.md#core-source-reading-20261115)已有实际入口及覆盖状态，源码用途/文档缺口继续按模块整改。完整行为基线、独立schema/迁移账和最终前后运行对照仍按原门槛交付。
2. 02已有清单/版本/对象命名空间、目录检查、OpenAPI贡献、服务端/生命周期与授权变更schema；[升级预检](平台Core接入-开发记录.md#core-update-preflight-20261114)及[未完成迁移观察](平台Core接入-开发记录.md#core-main-runtime-sync-20261115)已有独立版本锁/实际数据观察和单对象候选。[首次绑定及事务](平台Core接入-开发记录.md#core-binding-runtime-20261115)与[原绑定/工单组合](平台Core接入-开发记录.md#core-original-binding-tickets-20261115)已消费原主体、当前Core/成员使用权、订阅及同事务审计，下一步接真实部署/数据观察和主应用消费者，核对Rental旧身份兼容。[工单样例](../../../packages/example-tickets-core/README.md)包含领域/MySQL、独立迁移、7操作Nest与同源OpenAPI/原收据只读、3页面贡献，主Guard/HTTP/后台仍按公共窗口接线。
3. 下一公共片的最小候选依次为平台基础投影→独立公共租户创建→Auth/Guard/ALS范围提供者→授权/绑定存储与受限事务→AppModule组合→API/后台消费。精确文件/方法、固定基线、原消费者与退出条件见[公共候选表](平台Core接入-开发记录.md#core-ownership-baseline-20261114)。[原身份管理](平台Core接入-开发记录.md#core-original-management-20261115)、[部署目录](平台Core接入-开发记录.md#core-deployed-catalogue-20261115)和[管理HTTP/接口资料](平台Core接入-开发记录.md#core-management-http-20261115)已有实际消费者。下一步原Guard消费 `coreManagementHttpPolicy`、AppModule登记 `CoreManagementHttpModule`、原OpenAPI组合消费同源生成器，以及真实数据观察/后台；旧API身份与Rental映射继续按自身合同。公共片由PM核定唯一作者，具体消费者入口已可定位。
4. 沿原03/04→05/06及07固定上下文→08 Rental适配逐片推进，兼容适配先行；每片整理职责与重复逻辑、补准确源码备注和API说明并验证受影响功能，保留必要校验、事务、历史、缓存和唯一执行者。09按原业务出口与AI固定接点处理可选工具及已有任务恢复。
   07须取得BusinessShell/WorkspaceHeader/PageHeader/按钮正式出口、AppShell/navigation/AppRouter/认证缓存、通知业务来源及休息/右面板公共身份适配的最小窗口；用工单路由/主操作验证只改Core和装配，现有后台源码本片只读。完整外壳、单次表单请求、动态操作清理和默认页面模式沿v1.5核收。
   [独立页面合同](平台Core接入-开发记录.md#core-admin-contract-20261114)已有正式类型/路由注册/目标解析，[React适配](平台Core接入-开发记录.md#core-react-page-adapter-20261114)消费原PageHeading/SaveButton/ConfirmAction，`@rental-os/admin/core`为正式源码包出口；[工单页面和Core请求](平台Core接入-开发记录.md#core-tickets-admin-20261114)已有实际源码消费者。真实注册/授权与主应用路由仍未接，下片消费这些适配，不复制通用壳或改变业务方法。
5. [本地打包/安装准备](平台Core接入-开发记录.md#core-local-package-install-20261114)、[固定Release获取](平台Core接入-开发记录.md#core-github-release-20261114)及[Topic查询](平台Core接入-开发记录.md#core-github-discovery-20261114)已有共用候选链。[固定仓库根清单/多Core索引](平台Core接入-开发记录.md#core-github-repository-20261115)已提供真实读取器和作者指南，下一步接宿主发现/安装管理界面与实际部署，以非租赁持久化业务验证完整安装。10/11由独立开发者或Agent只凭简明指南和业务要求接手，在干净宿主重现安装→授权→业务；12核收全功能前后对照、源码/API可理解性、底座跟随上游与Core单独升级、配置/定制/数据保留、回退/分发失败及原独立审查门槛。真实GitHub测试发行和实际远端安装仍待核验。
6. 不同租户/成员、撤权、停用重开、统一期限、有/无工具、迟到响应与unknown验证组合继续保留；部署移除、停用、订阅到期和成员撤权分别判定。

独立包已有清单/目录静态检查、API组合、服务端/页面合同、独立升级预检、指南生成、本地/固定Release准备及Topic查询，后台有原组件的CorePage适配；尚非完整运行SDK。完整功能/源码基线、API离线资料、真实独立宿主、多Core授权/生命周期与UI/AI接线、工单持久化样例、发现管理界面/实际部署及独立更新、独立接手和兼容回退继续待交付。后续只补必要测试，现有用例/短命令优先，不增加成批测试脚本。

## 4. 验证边界与保留事项

本片已有独立合同类型/离线包检查、旧/新指纹22例对照及文件绑定消费者证据，见[开工记录](平台Core接入-开发记录.md#core-contract-first-20261114)。没有安装依赖、启动服务、读取实际环境或执行数据库/模型/供应商验证；完整API/页面构建、持久化/浏览器、独立接手和独立审查仍待相应阶段。合同测试产物集中在本树单一任务目录并由退出清理删除，无后台进程或复制依赖。

API贡献的空/双Core、命名/路径冲突、缺失/外部引用与包读取使用短命令验证，新增类型通过原合同检查；没有新增测试脚本。现有主应用OpenAPI仍未迁移，不能把独立组合器通过当作API整体可运行或接口文档已全部完备。

能力目录4,385条唯一条目、查询分页、SaveButton正式导入、工单3页/7接口、同源清单/OpenAPI目录及随包指南生成经实际内存编译验证，原8组合同通过。当前尚有3,547条缺少直接JSDoc用途及5条动态元数据标记，未检出客户端/复杂动态注册/完整API字段和当前运行工具消费继续列为缺口。依据详见[索引阶段](平台Core接入-开发记录.md#core-capability-index-20261114)。

服务端注册的空/双Core、错误贡献、版本与schema拒绝、初始化输入边界已离线核对；没有真实授权持久化或事务适配，原Auth/Guard/AppModule未接新合同。持续目标已生效，后续仍按原门槛逐片交付，必要公共文件窗口由PM协调。

原MCP审计的额外隔离执行/清理命令被自动审批在启动前拒绝，返回`blocked by policy`，对应目录未创建；该项保持未验，没有替换脚本或换壳绕过。已完成的纯指纹对照和旧路径导入不能替代原MCP整体审计回归。

工单MySQL文件移动后两个空目录的原生删除曾在启动前被自动审批拒绝。本片恢复原操作后核定独占路径、链接与空目录并删除，原路径及唯一责任清单的任务子目录均已移除。失败历史与恢复证据分别见[工单记录](平台Core接入-开发记录.md#core-tickets-domain-20261114)和[索引阶段收尾](平台Core接入-开发记录.md#core-capability-index-20261114)。

原PCH准备、标准化与品牌固定证据继续见[准备记录](平台Core接入-开发记录.md#pch-preparation-20261112)、[标准化记录](平台Core接入-开发记录.md#core-standardization-20261114)及[main归并复核](平台Core接入-开发记录.md#pch-preparation-main-integration-20261113)。此前总导航三份历史附件及AI接续output缺失仍保留原归属；旧失败/未验项不由本次清单测试关闭。

初版与两轮原文分别见[方案基线](历史归档/方案基线/2026-10-31/README.md)、[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)、[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)。旧记录中的缺失附件、历史临时验证材料去向及未验工程继续由原所有者核明；本片不接管未知产物。保留所有Rental、AI Native、旧方案和测试。
