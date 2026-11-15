# 平台 Core 接入开发记录

建立日期：2026-10-31。

> 本册记录阶段成果、缺口和证据。负责人已授权开始拆分，当前为 PCH-01/02 的依赖核定、独立清单合同与兼容抽取阶段；百分比只见[开发任务](平台Core接入-开发任务.md)。最新写入范围和下一入口见[协作接续](平台Core接入-协作接续.md)。

## 1. 依据与来源

- [需求v1.5](平台Core接入-需求.md)、[开发任务v1.5](平台Core接入-开发任务.md)。
- [接口与生命周期设计](平台Core接入-开发任务.md#contract-design)、[接入指南](平台Core接入-开发任务.md#integration-guide)：随本次需求澄清更新，仍为实施准备，非已发布SDK/API。
- 历史版本与原始接入设计见[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)，现行依据使用上述v1.5正文。各次修订前像沿对应阶段固定Git引用。
- 原[AI Native通用SaaS未来方案](../未来规划/平台底座-通用化与开源方案.md)继续保留，承接关系已标注；原文与入口修订前像见[方案基线](历史归档/方案基线/2026-10-31/README.md)。

<a id="core-rental-pricing-equipment-20261115"></a>

## Rental 计价与器材运行时单源迁移（2026-11-15）

父版本 `91b5e1f3baafece4acc1611ad999d465de655b35` 已普通推送并真实远端回读。[原计价策略](../../../packages/rental-core/src/pricing.ts)和[原器材富化](../../../packages/rental-core/src/equipment.ts)实际移入Rental包，旧API路径仅转接正式 `/pricing`、`/equipment`。只把原shared和营业日依赖改为本包相对单源；没有重算金额、调整单位/时区/历史版本、改品类行为或加入新的缺数据兜底。

两服务端子出口使用可选 `@nestjs/common` peer保留原BadRequest/Conflict错误类型；根合同和营业日出口不加载Nest。源码构建需该peer，宿主兼容版本与lock已登记，包不增加Prisma/平台业务服务依赖。器材投影保留执行版本声明字段、原属性副本与缺商品明确拒绝。

按真实tsconfig和正式已生成声明顺序，在内存构建platform-contracts/rental-core/shared，分别4根/198源/8输出、7根/551源/14输出及122根/338源/244输出，均0诊断。随后将原计价策略及器材测试原文作用于本版实际编译JS，全部原断言通过：单位/日界/非法输入/阶梯/封顶、缺商品拒绝、属性副本、资产覆盖与标识保留。测试原ts-node注册代码保持，目标模块由内存本版产物提供；不是磁盘包安装、真实HTTP/DB或完整租赁业务验收。原67项根运行时导出及旧shared同一对象对照仍通过。

当前238模型schema官方内存声明支持的全原API类型988根/2256源0诊断；两份运行时源码除导入/职责头外对照父版一致，lock一致。15份文档954个本地链接/213个锚点及原需求/任务未改检查退出0，`git diff --check`退出0。无新测试脚本、依赖安装、临时目录或后台服务。完整Rental数据/持久服务/页面/作业/AI/授权装配和公共能力仍未完，原任务未跨档；后续继续真实服务适配与原权限/事务兼容，原失败、真实验收和统一待清理项保持开放。

<a id="core-rental-domain-package-20261115"></a>

## Rental 领域合同与营业日实际迁入独立包（2026-11-15）

父版本 `aa1c370b03ce40f9b6e0801c3b3fe7ad17e1091f` 已普通推送并真实远端回读，main仍为62ca。[Rental独立包](../../../packages/rental-core/README.md)实际承接原shared领域合同、品类标识与API营业日源码，旧路径保留窄正式转接，不复制维护第二份实现。公共底座不依赖本包；新包只依赖正式公共合同，没有shared、Nest、Prisma或AI依赖。shared/API登记真实依赖、构建顺序和锁文件，使用新包JS/声明。

原合同有两处内联类型引用企业预约依据，最初只查顶层import遗漏，类型检查直接拒绝。按实际闭包将原告知确认/预约冻结类型及审批模式单源移入新包，企业政策再引用/导出；没有把整套企业工作流拉入租赁根出口，也没有复制结构或变更字段语义。营业日的时区、日界、营业时段及历史说明原文保留，只改类型导入；品类格式不作为注册/采用依据。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 实际tsconfig与正式产物依赖的内存构建 | platform-contracts 4根/198源/8输出、rental-core 5根/202源/10输出、shared 122根/338源/244输出，均0诊断。按真实rootDir和声明依赖顺序构建，所有产物仅在内存，无shim、安装或生成物写入 |
| 新包实际JS与父版原合同编译字节执行对照 | 67项运行时导出的键、常量值及函数一致；旧shared/core出口引用与新包严格同一对象，不只是结构类似 |
| TS5.9.3全原后台/API消费者 | 原后台642根/4215源0诊断；当前238模型schema用锁定Prisma5.22 WASM及官方generator在内存生成声明，原API988根/2254源0诊断，无实际Client/环境/数据库连接 |
| 原计价策略、检查资源、用量纠正入口 | 均退出0，保留原断言。计价覆盖单位/边界/非法输入/阶梯价/封顶与计算说明，实际消费新营业日；两份检查静态用例只改合同源码定位，不等同业务运行 |

计价首次执行被仓库既有受控 `packages/shared/src/core.js` 优先遮住当前TS源码，导致品类pattern未取到；没有改断言、预载成功常量或删除历史文件，将原ts-node源码测试明确 `preferTsExts: true` 后通过。同名JS/映射在父版Git可定位，完整源码/构建产物所有权清理仍需PCH-01最终对照，不把这些历史文件假称本轮新增垃圾。另三份原企业用例的源码加载器只登记新单源路径，未更改测试、断言、权限或离线围栏；未执行这些需要各自原离线环境的整套用例。

类型验证第一次展开shared composite工程源码时产生验证配置/rootDir诊断，修正内存检查配置后通过；正式包真实配置另由上表独立验证，没有放宽产品配置。三份迁移源码除声明的导入外逐文对照一致，六份既有测试2792处测试/断言调用原文保留，锁文件一致。15份定向文档948个本地链接/212个锚点及原需求/任务未改核对通过，退出0；`git diff --check`退出0。所有新增验证经stdin/内存执行，没有新建测试脚本、临时环境或后台进程。

完整Rental服务/Controller、schema/迁移/Seed、页面/客户端、作业/AI及标准Core清单/授权适配尚未迁完，本包目前不是可完整安装的Rental交付。下一入口继续其运行时和持久化/权限兼容，同时补完整公共能力；原任务计分未跨档，真实环境与原独立验收仍开放。

<a id="core-public-self-security-20261115"></a>

## 公共本人安全入口与强制改密共用（2026-11-15）

父版本 `9821c1bbce696801b6ce5b3f6272ae84e1073ff7` 已普通推送并真实远端回读。公共[应用](../../../packages/platform-admin/src/application.tsx)增加无需Core或管理角色的本人安全路由，仍由受保护布局校验会话；[原改密表单](../../../packages/platform-admin/src/session-pages.tsx)增加嵌入形式，强制首次改密保留原完整面板和验证规则。两者共用原 `session.changePassword`，不新增密码保存或认证执行者。

按钮/回车保留同一Promise，HTTP只发当前/新密码，不发送确认字段；密码草稿和提交中复用原离开保护，成功清空表单，失败保留输入。会话撤销/轮换、当前身份和缓存代次沿原认证客户端处理，不写密码缓存或存储。

必要验证使用TS5.9.3 compiler API/noEmit：公共包235根/2495源、零Core Web5根/2496源及工单Web3根/2500源均0诊断。实际改密组件配明确Hook/UI/callback fixture核实同一Promise、字段投影、草稿/提交保护、成功清空、失败保留与强制/嵌入两形式，退出0；antd 6.6.0 lint退出0、0问题。未连接真实HTTP/DB或浏览器，不把表单验证当密码轮换验收。没有新增测试脚本、临时环境或后台进程。

零Core Vite内存构建4产物/2319模块/6,811,907字节，无原业务后台/shared行业源码；13份定向文档910个本地链接/209个锚点、锁文件和需求/任务未改核对通过，退出0，`git diff --check`退出0。下一入口为完整公共组织/订阅/基础集成及Rental独立包；本片未跨原任务门槛，真实运行、更新回退、旧失败及统一待清理责任继续开放。

<a id="core-public-access-actions-20261115"></a>

## 公共成员口令恢复与普通角色删除（2026-11-15）

固定父版本 `60e2e6b2621f72b46841ee21a8c6e38794a0f972` 已普通推送并真实远端回读。公共[管理页面](../../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)与[路由](../../../packages/platform-admin/src/application.tsx)接原成员重置/角色删除接口，服务端原事务/审计和权限政策不变。目录对象之外、当前本人、非租户管理员操作管理员账号及固定/通配角色拒绝；已分配普通角色仍由服务端当前关联核定。

原ConfirmAction返回实际命令Promise，同步双触发只发一次；失败锁住再次确认，必须明确重读当前目录。重置失应答后的新重置会替换此前口令，页面明确说明，不自动重放或假造旧密码。成功结果与目录刷新独立，刷新显式throwOnError并单独提示，删除后对象消失不遮住原结果。同步修正创建/编辑结果：一次性口令在QueryState外显示，已保存Form不再连带禁用复制控件，按钮/输入在确认后卸载而非继续可提交。临时口令不写查询缓存、浏览器存储或日志。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit | 公共包235根/2495源、零Core Web5根/2496源、工单Web3根/2500源，均0诊断，无生成物写入 |
| 零Core Vite内存构建 | 4产物/2319模块/6,810,948字节，无原业务后台/shared行业源码，未运行正式环境配置或浏览器 |
| 实际组件/回调、权限及原固定角色模型，明确Hook/UI/query/session fixture | 重置同一Promise、原POST/DELETE路径、本人/管理员/未知对象拒绝、固定/通配角色拒绝、失败不自动重发、临时口令不缓存、刷新失败保留已确认结果及删除对象消失仍显示结果通过；租户创建/资料/状态原fixture复验通过。第一次验证在组件求值后才换真实模型，修fixture加载顺序后通过，未改产品判定 |
| antd 6.6.0 lint | 修改页面0问题；没有新增测试脚本、安装依赖、临时目录或后台进程 |

13份定向文档907个本地链接/208个锚点、锁文件及原需求/任务未改核对通过，退出0；`git diff --check`退出0。真实浏览器/HTTP/数据库和完整公共安全功能仍未验，原任务未跨档。下一入口为本人安全入口与公共组织/订阅/集成，随后继续Rental可独立包及真实更新/恢复验收。旧失败与统一待清理责任保持开放。

<a id="core-public-tenant-pages-20261115"></a>

## SaaS 无 Core 租户管理页面（2026-11-15）

父版本 `f59449e5c3cbd361ebe2e353bda3526854d03851` 已普通推送并真实远端回读，main仍为62ca。[公共管理页面](../../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)与[应用路由](../../../packages/platform-admin/src/application.tsx)增加租户目录、创建、资料及状态四条路由，共用已有目录/表单保存链。原Rental含品类/空间的租户入口原位保留，不以公共创建替代原业务初始化。

SaaS租户管理权控制目录、资料和状态；新增入口与直接URL另核初始化权，其他audience不会挂载目录查询。公共创建只发送租户与管理员资料，返回临时密码只在当前结果显示/复制，不写缓存。详情明确只发名称/简称；状态单独PUT并要求本次原因，冻结/停用/恢复沿原公共服务与同事务审计/会话处理，不授予或恢复已停用Core。公共人员/角色页面继续消费同一编辑器。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit | 公共包235根/2495源、零Core Web5根/2496源、工单Web3根/2500源，均0诊断。只读依赖与源码出口映射在内存，不写生成物 |
| 零Core Vite内存构建 | 4产物/2319模块/6,804,340字节，无原业务后台/shared行业源码，未运行实际Vite配置或浏览器 |
| 实际租户组件/编辑器与权限函数，明确Hook/UI/query/session fixture | SaaS/租户audience区分、初始化权单独核验；创建无业务字段、按钮双触发同一请求、详情仅允许字段、状态原路径/新原因、未知失败禁自动重发和当前页口令通过。初次fixture遍历未读取Alert.description，修验证visitor后通过；不是真实React/HTTP/DB |
| antd 6.6.0 info/demo/lint | 按实际Form/Select属性编写，修改页面lint 0问题；无依赖安装升级 |

13份定向文档904个本地链接/207个锚点、锁文件及原需求/任务未改核对通过，退出0；`git diff --check`退出0。源码与模块说明同步，没有新增测试脚本、临时文件或后台进程。完整公共组织/安全/订阅/集成及Rental独立包仍缺，本片不提升原任务计分。下一入口为账号重置口令/普通角色删除，再继续完整公共能力和业务包。真实环境、原独立验收及旧失败/待清理项仍开放。

<a id="core-public-access-pages-20261115"></a>

## 公共人员/角色页面及原权限组件共用（2026-11-15）

固定父版本 `bbf08040821d2eb88fdf2b118c0f08e1638ab01c` 已推送并真实远端回读，main仍为62ca。本片在[公共应用](../../../packages/platform-admin/src/application.tsx)接入人员/角色目录、新建与详情六条路由；菜单和直接地址使用当前服务端身份、tenant audience及原管理权限。没有Core也能维护公共成员和角色，角色权限与Core使用权仍分别配置。

[页面实现](../../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)消费原公共HTTP合同、完整授权目录、列表过滤及表单同步；保留角色scope/业务范围/按钮权限、人员组织/角色/管理员标记，普通新角色不默认Rental范围。固定管理员角色只读，管理员账号仅租户管理员可编辑，当前本人不能停用；角色选择另核角色管理权。按钮/回车共用Promise，草稿和进行中操作受原离开保护，失败须明确重读核对。已记录后目录刷新失败单独提示，不把成功当unknown。创建临时口令只在当前保存结果显示/复制，不进入查询缓存或存储。

原[权限编辑器与草稿模型](../../../packages/platform-admin/src/access.ts)实际迁入公共包，旧后台保留窄出口和原业务页面；原CSS/公开渲染来源/类名映射保持单源，[来源原文](../../../packages/platform-admin/src/features/access/roles-source/SOURCE.md)及CSS摘要保留。原历史来源入口保留短跳转，父版原文在Git。原Checkbox尊重父Form的禁用状态，固定角色及保存中不能通过权限勾选修改；原Rental字典不改，公共包复用实际所需44项原翻译。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit，源码出口与只读现有依赖映射在内存 | 公共前端235根/2495源、原后台642根/4211源、工单Web3根/2500源，均0诊断。未写dist/Client或安装依赖 |
| 零Core/工单Vite内存构建 | 各4产物、2319/2321模块，均无原apps/admin或shared行业源码；工单清单仍是明确fixture，不代表正式包安装/构建配置门禁或浏览器验收 |
| 原admin-permission-matrix测试 | 原7例全过，0失败/跳过/todo/cancelled；仅更新真实源码及mock依赖位置，归一对照原测试/断言不变。初次只读依赖解析失败，修验证路径后通过 |
| 实际页面/保存回调，明确Hook/UI/query/session fixture | 防重复提交、失败禁重发、已记录后刷新失败、角色隐藏字段保留、固定角色只读和临时口令当前页面显示通过；不是真实React浏览器、HTTP、事务或数据库验收 |
| antd 6.6.0 lint与原组件来源核对 | 编辑页/权限编辑器0问题；UIArc审计123条、99个UI出口、badHashes为0；迁移的来源/类名/CSS对照父版一致，仅Git换行差异 |

13份定向文档901个本地链接/206个锚点、锁文件及原需求/任务未改核对通过，退出0；`git diff --check`退出0。没有新增测试脚本、临时环境或后台进程。任务门槛复核未跨档，完整公共组织/安全/订阅/集成、Rental包与真实运行/更新回退仍缺，不提升原任务计分。下一入口为SaaS租户创建/编辑/启停及账号恢复；旧失败和统一待清理责任继续保留。

<a id="core-permission-registration-20261115"></a>

## 所选 Core 权限的显式部署登记（2026-11-15）

固定父版本 `3fdba3176c19a610ea75d29951c35b606e6e3687` 已推送并真实远端回读，主线仍为62ca。本片补齐原普通角色接口缺少Core权限目录的实际接点；公共API只接受已登记精确权限，不能用页面声明或管理员通配符替代普通成员角色配置。

[正式登记函数](../../../packages/platform-core-host/src/platform-core-permissions.ts)接受所选Core唯一清单和窄Permission事务，先核清单/重复Core及全部现存码的归属与类型，再登记带Core命名空间的ACTION元数据。重复执行保留原ID/RolePermission，名称可随兼容版本更新，其他Core和不再声明的历史权限保留。冲突先拒绝，函数不创建角色、分配Core或改成员授权。宿主须在Serializable事务调用，数据库失败沿原事务回滚，不自动重试。

[工单部署命令](../../../apps/example-tickets-api/src/register-permissions.ts)从显式进程配置取得同一锁/包，先核ID/版本/来源/摘要，再建立独立公共Client登记六项权限，退出始终断开。不加载.env，不启动HTTP或执行DDL；只在部署人员明确运行时写目录。实际命令和预期结果补入[宿主说明](../../../apps/example-tickets-api/README.md)，Core作者维护清单即可，不复制Seed。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit；本机Prisma5.22 WASM与官方generator在内存生成当前公共schema声明 | 公共Core宿主22根/882源0诊断，完整工单API6根/908源0诊断，窄新命令890源0诊断。源码依赖映射在内存展开，验证rootDir设仓库根；初次沿单包rootDir产生跨包路径诊断，修验证配置后通过。未改实际构建配置、写Client或安装依赖 |
| 实际清单→权限登记函数，显式存储fixture | 六声明登记；重复保留ID/更新名称；其他Core/历史保留；空Core无写；重复/无效清单、原归属或BUTTON类型冲突在修改前拒绝。无实际DB或角色授予 |
| 实际部署CLI与实际登记函数，显式包/文件/事务fixture | 包拒绝发生在创建Client前；一次Serializable事务登记六项；模拟第二条失败整笔不提交，成功/失败均断开Client；失败只输出稳定码，不泄漏驱动消息。不是MySQL事务或实际标准包安装验收 |

10份定向文档829链接/166锚点、锁文件及需求/任务未改核对通过，差异格式检查退出0。没有新增测试脚本、临时目录或后台进程；未运行会连接数据库的正式登记命令。下一入口为公共人员/角色编辑UI及完整公共服务，后续仍须Rental独立包、真实安装/运行、隔离/恢复、更新回退与独立接手。原PCH进度保留，旧失败和待清理责任不由本片关闭。

<a id="core-access-directory-ui-20261115"></a>

## 公共后台租户 Core 授权与成员目录接线（2026-11-15）

父版本 `8cdb4b397296b088ed270e6a09f707c915732b67` 已普通推送，实际远端同版；main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片在同一独占树将既有授权面板接到[公共应用](../../../packages/platform-admin/src/application.tsx)，未改原业务授权政策。

[Core管理页面](../../../packages/platform-admin/src/CoreAccessPage.tsx)分别提供 SaaS“租户 Core 授权”和租户“成员 Core 分配”。前者从公共租户目录及受控注册目录选择，后者从本租户真实成员及当前服务端assignable选择；管理者未分配给自己时仍可管理其他成员。地址参数只定位这些已读对象，目录之外的对象不挂载授权命令；查询失败关闭操作。菜单和直接URL共用[当前身份口径](../../../packages/platform-admin/src/application-access.ts)，非管理者/错误audience/本人范围不发起管理查询。

授权变更继续复用原面板、修订、同键收据和unknown只读核对，增加原离页保护；同一路由切换对象也经Router阻止提交中离开，未知结果的原编号仍存sessionStorage。本人分配变更沿原目录与Core缓存失效；不会自动给其他成员分配或改变角色。首页和默认侧面板分别提示租户未开通、成员未分配及SaaS管理入口，零Core保持准确空态。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TS5.9.3/noEmit，只读既有依赖 | 公共后台229根/2,488源、原后台642根/4,206源、工单Web3根/2,494源0诊断。初次误引用不存在的CoreSessionSummary类型，已改为正式CoreSessionContext推导，不新增同名私有合同 |
| 实际页面组合、目录queryFn与可见性函数，显式hook/UI/API fixture | SaaS读真实路径tenants及registered；租户读users和assignable，自己无业务分配仍可管理；目录外URL不挂命令；未验证/错误audience/own范围不读目录；服务端canManageMembers=false不查询成员。无React DOM、浏览器或网络 |
| Vite8.2.1/Rolldown + Tailwind内存构建 | 零Core4产物/2,309模块/6,721,805字节；工单4产物/2,311模块/6,786,395字节；均不含原apps/admin或packages/shared。配置/环境关闭、write:false；工单清单明确fixture，非实际包安装/磁盘门禁验收 |
| antd6.6.0 Select API/demo核对及定向lint | Core管理页、原授权面板、公共壳均0问题；首次lint误传两文件，分别运行后退出0。无新测试脚本 |

8份文档777链接/163锚点、锁文件一致性及正式需求/任务未改核对通过。完整人员/角色UI、Core权限登记的部署入口、公共订阅/组织/安全/集成、Rental独立包以及原任务真实环境/更新回退/接手仍待交付；没有将本片当PCH完整主实现或提升原百分比。真实HTTP/数据库授权提交、浏览器搜索/Portal/切换保护和持久化重读均未验。所有验证内存完成，无新增临时目录或进程；本片再次尝试核定原待清理环境归属/范围/链接/进程后用原生PowerShell删除，命令仍在启动前被自动审批拒绝blocked by policy，环境存在性另行只读确认，不称已删除。旧外观断言失败继续保留。

<a id="core-tickets-admin-host-20261115"></a>

## 工单 Web 声明接入同一公共应用（2026-11-15）

固定父版本 `6df3006cc72d0d8ac34f1a6701f51dd025f694b2` 已普通推送并回读同版，实际远端 main 仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片承接本树已明确归属的前端组合修改，未操作其他树或主线索引。

[公共应用](../../../packages/platform-admin/src/application.tsx)实际承接原零Core App及设置页面，提供正式 `/application` 工厂。零Core宿主只提供品牌和唯一会话；[工单Web宿主](../../../apps/example-tickets-admin/README.md)另传通过标准注册的四页贡献。菜单、Data Router直接路由与面包屑消费同一注册表，Core复用原主操作/表单/列表与请求，不修改公共内部路由。工单后台peer和类型入口改为独立公共前端，原Rental后台继续消费原兼容接点。

前后端标准包核验收束为 `/install` 的 `requireCorePackagePin`，核实际包标识、实现版本、固定来源和归档摘要。工单Vite配置要求显式部署锁，并核已准备标准包后才生成前端清单模块；源码工作区没有标准清单时拒绝，不生成假发行或自动授权。后台、Core与宿主导读已同步最小文件、命令和失败入口。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TypeScript 5.9.3，noEmit、只读现有依赖 | 公共后台227根/2,486源、工单Web 3根/2,492源、Core合同36根/220源、原后台642根/4,205源均0诊断；工单admin 2根/1,376源、零Core Web 5根/2,488源0诊断。服务端核包薄适配及其205源0诊断；初次验证误沿合同rootDir，改内存验证rootDir后通过，未改源码类型规则 |
| Vite8.2.1/Rolldown + Tailwind内存构建 | 零Core 4产物/2,305模块/6,693,455字节；工单4产物/2,307模块/6,760,975字节；均无原apps/admin或packages/shared模块。configFile/envDir/publicDir关闭、write:false；工单virtual清单明确fixture，未执行真实配置的磁盘标准包门禁，不是干净安装证据 |
| 实际工单四页贡献→注册→公共应用路由树→React Router匹配 | 列表、设置、新建和带对象参数的详情直接地址均匹配正确声明；菜单/面包屑同源，缺create权限拒绝该页面，缺成员Core项时业务菜单为空，零Core无业务路由。UI与会话为显式stub，无React渲染、浏览器或HTTP |
| 实际包静态检查、归档及固定包核验 | 显式内存文件系统fixture中，同包接受、错摘要及改代码拒绝，未执行包入口。前后端共用同一方法；当前Core文件已变化，不沿用旧32文件包摘要充当本版发行 |

定向文档核对8份、771链接、163锚点均可在本树或固定Git定位，工作区锁文件与包声明一致，正式需求/任务正文未变，差异格式检查退出0。首次文档核对因Git文件清单超过Node默认buffer失败，提高验证读取上限后通过，未改变检查范围或删引用。

主实现尚缺完整公共管理/授权UI，原Rental独立包、真实干净安装、HTTP/数据库/浏览器、原功能前后对照、独立更新回退和接手仍未验。本片不满足PCH下一档完整范围，原百分比保留。没有新增测试脚本、依赖安装、临时环境或后台服务；原待清理环境及旧外观静态断言失败沿原证据保留。

<a id="core-zero-admin-host-20261115"></a>

## 零 Core Web 宿主与原认证客户端共用（2026-11-15）

公共前端抽取已提交 `cfa7993ea35783716c768e95094d29a9f65006d0`，普通推送后真实远端任务分支同版，工作树当时干净；本片在该父版本继续。main实际远端仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，未进入其他作者树。

[独立公共Web](../../../apps/platform-admin/README.md)已有实际HTML、启动、路由、公共认证/改密与本人资料/账户主题色/租户名称/品牌名设置，默认不导入任何Core。完整原外壳与公共组件由正式包提供，权限过滤沿原当前主体及公共服务权限口径，普通账号不因此获得管理权。原Rental的HTTP改成窄存储/空间投影适配，同一公共客户端执行刷新锁、请求信封、取消和401清理；原存储key/跨标签锁名称、刷新收据监听与空间投影保留。公共响应信封移至platform-contracts，shared再导出唯一声明。

公共会话仅由原服务端登录、刷新及上下文响应验证；storage变化先失效和清缓存再读服务端，不将缓存当授权。身份/权限变化使旧页面及原请求失效。设置复用原草稿同步/离页保护与SaveButton，按钮/回车共用当前Promise，保留expectedRevision；后台读取不覆盖草稿，重新读取需明确确认，保存结果不明先核原设置。公共设置只覆盖本片有限字段，完整人员/角色、订阅、安全、组织、集成和Core管理UI继续按原任务交付。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TypeScript compiler API，5.9.3，当前公共合同源码/只读受管依赖，无emit | 公共后台224根/2,483源、零Core Web 6根/2,487源、原后台642根/4,205源均0诊断；公共合同4根/198源0诊断。最终复验零Core Web/原后台仍0诊断，622处本地文档链接可定位，锁文件元数据一致，差异格式通过 |
| 实际公共Web Vite 8.2.1/Rolldown + Tailwind 内存构建 | HTML/JS/CSS共4产物、2,304模块、6,683,479字节，无apps/admin或packages/shared模块；envDir/configFile/publicDir关闭，write:false，无服务/网络/文件产物。依赖/合同源码在验证进程中映射，不是干净安装或真实运行证据 |
| 原 `category-preparation-admin-fields` 中传输段，仍运行原断言 | query/session分别取消、完整返回及settled释放监听器通过。只把源码定位改到公共工厂内原request函数；未删断言、未执行该脚本其他领域场景，不称全脚本通过 |
| 实际Axios拦截器 + 显式内存adapter | 两并发请求仅一次刷新、原回放可返回；等待刷新时取消拒绝回放；500写入仅一次，不清理或自动重做；零网络 |
| 实际公共会话 + Axios显式fixture | 登录/稳定快照/退出中迟到验证拒绝/storage即刻失效再由服务端响应验证通过，退出原刷新会话仅一次；零网络，不是浏览器/真HTTP |
| `antd lint` 登录/改密与公共设置 | 两处均0问题，退出0；原vendor未修改，新增测试脚本0个 |

本片没有安装依赖、加载.env、启服务、连数据库/外部供应商、执行迁移或浏览器验收。真实登录与保存/重启读取、跨租户、完整原功能回归、工单正式前端接线与标准包独立安装均未验，原PCH下一档缺口保留。所有本片验证在内存完成，原840文件/91,808,304字节待清理责任清单继续沿接续§4，不称已删除。

<a id="core-public-admin-boundary-20261115"></a>

## 公共后台源码单源迁移检查点（2026-11-15）

固定父版本为 `c1eeb3b1ffa7b87578742b834976fc0186fc6c5e`，当天实际远端任务分支同版，main `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 已包含；暂存区无其他成果，无合并/挑选状态。本片仍只在负责人授权的独占树施工。

公共呈现实际移入 [platform-admin](../../../packages/platform-admin/README.md)，包含原 UIArc 适配、主题/语言/音效、侧栏/工作区/页头、休息与通知，以及原 Core 页面/表单/列表/授权面板。旧后台路径窄转接同一实现，Auth/HTTP/业务导航及通知详情仍由原宿主提供。公共运行时只消费服务端验证后的会话、唯一请求与查询代次，不读取业务凭据，不提供业务授权。

新 [PlatformShell](../../../packages/platform-admin/src/PlatformShell.tsx) 组合原外壳与正式页面注册表，菜单/面包屑按当前 Core 目录过滤；零 Core 保留公共外壳、铃铛、休息和面板，并提示联系管理员。Core 页面、主操作、原生表单关联和请求围栏使用同一公共适配。这个壳尚未进入独立无 Core Web 宿主；原 Rental 仍消费原 AppShell，不能以公共组件存在宣称独立后台已可运行。

查询缓存沿原时序抽成单一工厂。原 `AdminBusinessUiScope` 补齐当前权限/资料范围/地点范围/组织身份，防止迁移后列表实时状态弱化。原业务语言字典 5,712 项键值逐项相等；公共字典只含公共呈现，允许宿主追加。公共样式和动效构建适配单源，原后台保留 Rental 页面专属样式。34份移动保留源码/来源/许可与固定父版本相等，仅允许 Git 文本换行差异；通知保留源码已恢复原字节，别名适配共用动效 Hook。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TypeScript compiler API，5.9.3，只读复用已有依赖，虚拟解析，无 emit | 公共后台217根/2,474源、原后台642根/4,200源、Core合同36根/220源均0诊断；同一切片最终复验公共后台和原后台均保持0诊断，未输出编译文件 |
| 实际 `createAdminSessionQueries` 内存编译后执行 | 原请求 signal 中止、新代次与新 signal、旧缓存清除通过；未发 HTTP |
| 实际 Vite 8.2.1/Rolldown + Tailwind 4.3.3，`configFile:false/envDir:false/publicDir:false/write:false` | 公共 JS/CSS组合3产物、2,225模块、7,308,945字节；模块列表无 apps/admin 或 packages/shared。只读依赖路径及合同源码在验证进程内明确映射，未安装或磁盘输出，不是标准包干净安装证据 |
| 初次 Vite 内存构建 | 失败，验证依赖解析缺本树 node_modules、子出口别名前缀以及 CSS 多入口配置；修正仅内存验证配置后通过，源码正常构建仍依赖按锁文件准备的本树依赖 |
| 原组件只读审计，增加公共真实源码入口 | 123条/263唯一来源文件，badHashes=0，99项公共 UI 导出、60条有直接引用；不代表所有引用分支运行通过 |
| `antd lint` 公共 PlatformShell | 0问题，退出0；未改第三方 vendor，未新增测试脚本 |

原公共服务、完整订阅/组织/集成，独立无Core前端宿主、工单前端标准出口/实际宿主、Rental独立包与完整真实功能回归、浏览器/数据库/HTTP、升级回退及独立接手均继续缺失。原外观17例中1个旧静态断言失败继续保留，当前公共前端类型/构建不关闭该问题。605处本地文档链接均可在当前检出或固定Git定位，锁文件工作区元数据与包声明一致，暂存差异格式检查通过。PCH未跨下一原门槛，不调进度。

补记同一固定父版本的工单标准包验证。32文件/46,867字节，SHA-256 `a22f242b7dccb6a43110c64385ba22ad45be8dc3dca6fc2d55698e566c15846d`。实际编译字节、清单/声明/API/指南/迁移及篡改拒绝通过，严格门禁后实际 Nest 组合一个数据库 provider/8工单政策，组合未查询数据库。文件系统明确为内存 fixture；没有真实磁盘安装、HTTP或数据库验收。

本片验证均为 stdin/内存，无依赖环境复制或新测试脚本。原公共宿主临时环境删除仍被自动审批在启动前拒绝，现归集状态和责任清单沿接续§4，未重复创建同类环境；不能称全部临时产物已删除。

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

<a id="core-public-auth-extraction-20261115"></a>

## 公共身份、认证与原Rental兼容抽取（2026-11-15）

负责人明确“你这个工作树只有你，授权你全权负责”，解除本树PCH公共文件唯一作者窗口的阻塞；随后再次确认最终交付为可单独取出的Core包和底座源码，无Core底座可以独立构建、启动、登录和保存公共设置。此结果按原R01/A01与R11交付，不以隐藏菜单或全量构建后缺业务贡献替代。工作树仍为C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS，分支codex/platform-core-extraction，基线d170a5fa8db1cb56d166fb05246790c0ead29539；实际main62ca在祖先且远端核定，未操作main索引或其他树。原阻塞全文保留在固定d170及下节历史记录。

[公共身份声明](../../../packages/shared/src/platform-identity.ts)从原platform唯一声明抽50项身份、人员/角色、设置和运行时常量，新增正式@rental-os/shared/platform子出口，原platform及总index兼容再导出。Rental扩展继续原声明，不复制公共DTO；公共出口没有Core/行业import。

[身份仓储](../../../apps/api/src/modules/platform/platform-identity.repository.ts)从原仓储移出15个账号/会话/角色映射方法，原PlatformRepository继承同一实现；findTenantByCode/findUserForLogin和认证租户读取不include Rental档案/订单。公共身份不据租户存在声明已开通业务，Core使用权继续由授权目录裁定。原账号状态、角色投影、哈希、轮换及撤权保持。[公共认证](../../../apps/api/src/modules/auth/auth-session.service.ts)抽原21个签名/刷新/改密/保护方法及5个状态字段，Rental AuthService继承且保留原空间/品类/可信主体/员工分面；[PlatformAuthService](../../../apps/api/src/modules/auth/platform-auth.service.ts)只签operator公共身份，无Core不造空间或业务授权。

公共[认证控制器/DTO](../../../apps/api/src/modules/auth/auth-session.controller.ts)由原Rental控制器继承，旧LoginDto及请求DTO出口继续兼容。实际Nest测试容器已核原AuthService注入及8条继承/扩展路径均唯一，没有在主应用同时登记两个Controller。原安全默认与合并规则抽到[同一公共实现](../../../apps/api/src/modules/platform/platform-security-baseline.ts)，原平台保存继续原位。[外观存储](../../../apps/api/src/modules/platform/platform-appearance-data-store.ts)使用平台窄端口；原AppModule显式注入唯一数据库及旧客户端品牌读取，公共宿主不依赖旧客户端表。省略/清空/旧修订、首次保存品牌保留沿原服务。源码导读见[认证README](../../../apps/api/src/modules/auth/README.md)。

验证经stdin和本树单一output/.tmp/platform-auth-integration，复用已核锁定TypeScript5.9.3、Prisma5.22和已有Nest工具；无依赖安装或业务连接。最小生成准备曾因缺CLI wasm退出1，补同版本必要Wasm后实际Prisma generate退出0，238模型schema与原基线相同，原离线preload/audit违规0。五包真实声明及完整API核987根/2,186源0诊断；前一类型检查误给API开启声明输出出现非可命名类型，改回原API编译选项后只留下真实兼容诊断并修复，无产品断言放宽。

实际公共认证服务在明确平台表夹具下核登录/上下文、单次并发刷新、改密撤销、当前账号冻结和双租户隔离，退出0；未提供任何业务表。原固定d170仓储与当前角色投影、活跃/停用角色、相同令牌签名字节/验证和登录保护摘要对照通过。原tests/auth-login-lockout.test.cjs实际执行退出0，包含共享计数、阈值、清除、禁用策略、唯一/CAS冲突及内存路径；依赖定位缺项的失败仅修验证路径后复验。

原tests/admin-appearance-settings.test.cjs实际17例，16通过/1失败，cancelled/skipped/todo均0，所有服务/事务例通过。失败为最后页面静态断言禁止外观页name=themeColor，而固定d170页面早已提供账户主题色；基线与当前页面归一换行SHA-256均5f1474b2a254ef3b785d9ae9daa8001335b383bdc6c0e1294fd629161c867ee5。本片未改该页面或断言，保留旧失败，不宣称全绿。定向文档核595链接/155锚点，Harness README在当前稀疏检出中缺失但固定Git可读取，属于已登记未检出来源；正式需求/任务归一换行正文未修改。测试仅为显式legacy读取调整原夹具，MCP夹具只增加正式平台子出口解析，无新增测试脚本。

本片尚未装配独立公共AppModule/Guard或独立schema/迁移/Seed，未取得真实无CoreHTTP/数据库/浏览器、完整多Core/原Rental业务、安装更新/回退/独立接手/审查证据；原任务未跨下一档。下一片继续真实公共宿主、正式Core主应用及其同源OpenAPI/前端消费者。临时生成工具/Client/声明/运行共享产物与缓存共527文件、73349425字节，核绝对归属/无链接后全部删除，任务目录不存在，output/.tmp条目为0。仅留本节最小证据，没有新增服务进程或重复环境。

<a id="core-tickets-independent-host-20261115"></a>

## 工单标准平台适配与独立示范宿主（2026-11-15）

公共期限/物理计划已提交并远端回读df06578b2c8b79c7e8aef8ac91d3de819a9860a2，订阅声明末尾格式收尾f78e5bb3fe866743f7ec96f33283888e82651ef8同样上传。工作区/索引干净后开启本片，独占树和既有main62ca保持。

[工单platform-host](../../../packages/example-tickets-core/src/platform-host.ts)从原行业API组合抽为实际标准包子出口。消费公共身份、有限SQL、当前Core/成员/角色、原绑定、统一期限和同事务审计；原original-tickets-host仅转接同一实现和原订阅政策，领域状态/金额/权限及原收据规则不变。示范Core源码和清单新增实际适配文件/声明，领域总出口仍不导入Nest/Prisma/平台适配。公共业务审计只记Core原操作引用，在调用方同事务保存；业务正文留Core。

[公共依赖工厂](../../../apps/platform-api/src/core-dependencies.ts)、数据库和数据计划提供宿主正式子出口，不让新Core深层导入或复制公共源码。新增[工单独立示范宿主](../../../apps/example-tickets-api/README.md)及3个主源码入口，公共无Core构建不引用本应用或工单包。Nest应用公共/Core/工单共享唯一数据库provider与生命周期，标准Core和8条工单HTTP由同一实际工厂装配，不让父本地provider自动进入子模块。[工单Factory](../../../packages/example-tickets-core/src/nest.ts)从导出的实际依赖消费同一业务实例。

[严格包核验](../../../apps/example-tickets-api/src/deployment-package.ts)要求当前依赖中的Core是所选标准包：ID/版本/来源和重建归档摘要必须与固定锁一致。没有清单的作者源码树或来源/字节变化拒绝启动，不伪装成已安装。示范组合按真实公共物理计划与工单物理reader读取原Prisma账/执行状态，新业务期限来自公共reader；实际锁的包发行/数据库尚未验。

[迁移组合](../../../packages/core-contracts/src/deployment.ts)提供正式Core Prisma迁移名称和版本锁/包字节校验，只返回新文件Map；[示范准备命令](../../../apps/example-tickets-api/src/prepare-deployment.ts)将实际平台发行+已准备工单包生成新独占目录，成功显示pending。公共4份+Core1份SQL原字节保留，Core原账名固定core.example-tickets.tickets.initial且运行观察消费同源函数，目录排序和声明顺序不一致拒绝。命令不安装/执行迁移，不覆盖用户目录/活动组合；失败只清自己刚创建的候选。根构建/类型入口与lock/可选peer元数据同片维护。

| 验证 | 证据与边界 |
| --- | --- |
| 当前公共/工单/原API类型，实际Prisma内存声明 | 8包零诊断；公共7根/757源、工单宿主5根/772源、原API988根/2,204源零诊断，退出0，内存编译无磁盘产物/守卫违规。首次验证转接声明的相对Client位置没给内存同源映射，补验证解析后通过，未造产品shim |
| 实际工单Nest组合（严格包校验加入前） | 唯一公共DB供公共和业务、8政策/Controller和51同源API操作，组合零DB读取；固定来源/锁为显式offline fixture。严格包门禁加入后的干净标准包容器尚待实际包阶段，不沿用成已验 |
| 工单实际平台适配/MySQL/领域服务 | 创建和同键原结果、Core停用拒绝普通get但原收据按本人/对象受控可读、成员撤权、统一期限到期拒绝新建、审计失败回滚通过，退出0；SQL/availability为明确fixture，未连库 |
| 部署组合短命令 | 公共4+Core1准确SQL、确定原账名称/排序和坏包摘要拒绝通过，退出0；包内入口是明确静态fixture，不当可运行发行 |
| Root lock和3workspace | 新示范应用依赖、原工单新增可选peer以及公共宿主元数据匹配；未安装/网络获取包 |

首次新工单适配缺类型import/全局只读SQL接口，修真实端口后类型通过；不存在CorePackagePin类型按正式部署锁元素类型引用；实际部署组合的source索引/摘要检查保持原标准。没有新增测试脚本或删除原断言。独立包运行、真实DB/HTTP/完整四页后台、标准包安装/迁移/独立接手、双真实Core及升级回退/审查仍未验。

下一入口先从固定提交真实编译工单标准包，严格门禁后组合/授权/业务与迁移准备有限验证，再接公共后台壳和原Rental可取出包。当前原任务未因示范目录或51接口自动跨档；PCH-03/04/10完整门槛仍有上述缺口。旧唯一待清理环境自动删除拒绝继续保留，本片验证仅内存，没有新增临时环境/进程。源码/README/接口与原四册按同一切片提交普通推送，main未集成。

<a id="core-public-data-term-20261115"></a>

## 公共统一期限与真实物理数据观察（2026-11-15）

公共Core主装配提交3d306de05b861dd90c0465c4da9161c8b7351f09，首次push因schannel TLS handshake失败，远端仍8ea；原普通push重试成功，真实远端回读3d306de05、main62ca，工作区/索引收口后再开启本片。没有换远端/关闭TLS或强推。

[订阅公共合同](../../../packages/platform-contracts/src/subscription.ts)从原shared订阅声明移为单源，原shared继续再导出，原基础版/PRO、金额可空、期限和请求字段不变。[状态/排期投影](../../../packages/platform-server/src/modules/subscription/subscription-state.ts)与[周年/服务时区](../../../packages/platform-server/src/modules/subscription/subscription-term.ts)抽原算法，原SubscriptionService消费同一函数。订阅办理、专业功能/品类与收费政策仍在原服务，未重建收费机制。原正式SUB四册及进度保持。

[公共期限reader](../../../packages/platform-server/src/modules/subscription/subscription-reader.ts)在调用方原事务读取租户当前订阅和已到期排期，返回原revision与newBusinessAllowed；明确到期停止新业务，历史未登记保持原“待确认”兼容，不批量停業、不伪装永久、不自动创建期限或物化排期。公共Core装配消费该真实reader，替换此前零Core拒绝占位；零Core目录仍不开放业务。参数/提醒阈值与原SubscriptionService沿同一解析，原排期/未登记政策保留。

公共schema增加两个原订阅期限模型及三个原enum，当前22公共模型/9enum；字段、表名、精度/可空、期限与关系来自原schema。公共独立迁移引用原SUB两份不可变SQL的期限表/外键和追加列，新库链不覆盖旧组合库，也不创建收费/期限数据。新SQL SHA-256为ff2ca9614628d7b5282c22293bb81b8c6e70ce0d3d69be2da301fc0a89e7449b。

[平台数据计划](../../../apps/platform-api/src/platform-data.ts)明确0.1.0基线和4份迁移原文/Prisma名称，读取源码时逐份验证固定SHA-256，不从文件存在推导就绪。[结构预期](../../../packages/platform-core-host/src/mysql-structure.ts)只解析本链实际使用的CREATE/ADD COLUMN/FK，未知DDL拒绝；[物理reader](../../../packages/platform-core-host/src/mysql-physical.ts)读取information_schema实际表/引擎/排序/195列/53索引/7CHECK/18外键，核类型、可空、默认值、键和受执行约束。CHECK保留NULL/范围与and/or括号优先级，不能通过去括号改变语义。原Prisma账/迁移状态仍由既有mysql-deployment提供，真实查询失败不变成空成功。计划已提供，选中Core总组合消费及真实DB未验。

| 验证 | 结果与边界 |
| --- | --- |
| 状态算法原固定3d306/当前对照与公共reader | 正常/过期/待生效/未登记同原投影；排期接续/revision、明确到期拒绝及缺租户拒绝通过，不写订阅 |
| 原saas-subscription-service.test.cjs有效断言 | 20例全通过，fail/skip/todo/cancelled0，退出0；通过stdin实际载入原用例与当前服务/DTO，ts-node仅外部装载钩子，原声明/生成enum沿锁定来源。未新增脚本/改断言，未执行DB |
| 平台结构/实际metadata读取 | 固定4SQL解析22表/195列/53索引/7CHECK/18FK；正常和缺表/列型/键/CHECK停执/错约束/FK/默认值7类拒绝，BETWEEN等价且括号优先级差异拒绝，退出0；metadata为明确fixture，不称真库就绪 |
| 实际平台数据计划 | 4份源码摘要/版本/原Prisma名称核定，计划调用退出0，只读文件，没有物理库访问 |
| 原离线守卫下Prisma schema/WASM+官方生成类型与8包/两宿主 | 公共22/原238模型实际解析；8包零诊断；公共6根/756源、原988根/2,209源零诊断，命令退出0，守卫违规0，无新磁盘Client/dist/缓存/进程。仅在内存生成，不复制旧环境 |

首次结构解析漏掉原SQL索引名与括号间空格，修解析器接受原已使用语法后通过；原订阅测试装载第一轮漏新公共包映射，在唯一已有产物加只读解析后复验通过，没有新安装或产物。源代码期限/申请/订阅业务规则未改变，原失败/未验仍归原专项。

下一入口继续完整公共订阅管理/基础集成、所选工单Core实际受控锁/物理观察/授权业务HTTP与后台，再处理Rental可取出的包、多Core/AI、安装更新/回退与独立接手。本片不是全部订阅或全部平台完成；真实DB/HTTP/浏览器、旧库迁移/回退、独立审查/发布未验。原任务没有因22模型或20测试数自动升档。

期限/物理阶段df06578b2c8b79c7e8aef8ac91d3de819a9860a2已推送且真实回读。新增订阅声明继承原文件末尾空行，暂存空白检查报告该一处；后续仅裁掉末尾多余空行并复查，不改声明或业务，补证与原阶段一起保留。

本片只有内存验证，output/.tmp无新增文件，唯一既有91,808,304字节待清理环境及责任清单继续受自动审批blocked by policy；没有重复副本或绕过删除限制。资料与源码同片提交普通推送，固定结果在本对话/本记录承接。

<a id="core-public-assembly-20261115"></a>

## 公共Core宿主包与独立主装配（2026-11-15）

上阶段公共管理已提交8ea7953a0178c4c1b7a4e2ccc7dfa7ab351f1e21并普通推送，真实远端回读同一SHA、工作区/索引干净；main62ca仍在祖先。此片在原独占树继续，未接管其他树或main索引。

[platform-core-host](../../../packages/platform-core-host/README.md)为标准Core与公共SaaS的独立适配包。原8个管理/目录/范围/移除组合与4个HTTP/模块源码移到正式包，原路径只保留窄子出口或原订阅/审计薄适配；公共包不导入原API、shared行业合同、Rental、Prisma生成模型。事务按实际Tx受限公开SQL和公共身份，原租户/角色锁、Core锁、当前权限/统一期限及提交点复验保留。原工单继续消费相同身份与使用权，新旧不并行执行。

[公共AppModule](../../../apps/platform-api/src/app.module.ts)和[Core工厂](../../../apps/platform-api/src/core-assembly.ts)消费同一公共数据库，登记CoreHostModule、标准Controller、Guard准入与同源OpenAPI。默认目录明确零Core，本人目录不查授权表即可返回空集合，未知业务拒绝；选中Core须提供受控部署锁/实际数据观察及真实新业务订阅端口。默认零Core的拒绝不会被记成已提供完整订阅服务。原组合总AppModule仍未消费新Core管理，Rental保留原业务Guard/HTTP。

原Core授权/绑定两份SQL已按原生Move-Item单份移入公共宿主Prisma链，Git原字节及SHA-256相同。授权迁移ef03bb4bae3ff0337213cb1f87aa2ebeb8338faec016be05de645dfea54c2411，绑定迁移5666ecd0d42099cf0865e8d8116709d3f7a07c77d360972cbe5866f15fa1a8bb；SQL执行状态尚未核定，没有连库或应用迁移。公共schema新增六个所属平台的授权/成员/绑定/原操作模型，当前20模型/6enum无行业表。迁移字节用局部gitattributes固定；旧238模型schema/历史迁移未改写，已有组合库只能引入获准增量，不使用公共新库基线覆盖。

[Core主HTTP政策](../../../packages/platform-core-host/src/platform-core-http.ts)消费单源管理/本人目录/范围声明，具体Core业务从已登记http读取，错误按当前拒绝/不可用/冲突映射。原收据仍只读核同一原键及主体，不借当前状态推断旧操作结果或可重发。OpenAPI组合43操作/35路径与公共同源字段一致，无缺schema引用、重复operationId或隐式行业文档。

| 验证 | 实际证据与边界 |
| --- | --- |
| 5个公共/标准包独立类型 | platform-contracts1、platform-server33、core-contracts35、core-host8、platform-core-host19根，零诊断；正式出口无反向行业/生成模型依赖 |
| 当前schema实际Prisma内存验证/生成类型 | 复用原Prisma5.22CLI内的schema WASM和官方client generator，20及238模型均解析；声明/JS只在内存，没有新Client/dist或复制环境。schema/类型不是实际迁移或DB运行证明 |
| 当前独立宿主与原API类型 | 公共5根/748源和原988根/2,203源按当前官方生成声明及8包正式输出核对，命令退出0、全部零诊断、离线守卫违规0且无磁盘输出。此前旧生成物核两者零诊断只作为兼容补证，不冒充当前20模型产物 |
| 实际PublicAppModule/Nest容器 | 唯一DB、标准Core应用/Controller和Guard provider实际装配，签名零Core目录返回空集合且零Core/Rental业务表查询；未知绑定同步拒绝，容器关闭。DB为明确offline fixture，不启动HTTP |
| 标准Core原SQL/服务正常与拒绝 | 两个显式登记Core可分别授权但不自动分配成员；本人目录/业务HTTP仅本成员Core，旧修订拒绝，同键返回原收据；停用/重开保留同一绑定，成员撤权不随重开恢复；审计失败整笔授权/收据回滚通过。部署可用性/SQL为明确fixture，不声称双真实业务或真库安装通过 |
| 同源OpenAPI及锁 | 43操作/35路径、引用/operationId唯一；新workspace与两个API依赖锁元数据一致，未安装依赖 |

验证短命令最初出现fixture的return1拼写及未知绑定同步异常误用assert.rejects，修验证写法后正常/拒绝通过，未改产品断言。短schema/类型命令首次处理MCP exports条件时误读type，改验证按真实exports类型读取后继续，不修改包规则。本阶段没有新增测试脚本、跳过断言或扩大普通业务回归。

03/04主组合已进一步落地，但03仍缺完整公共服务/后台及选中Core运行，04仍缺原Rental主装配和真实多端授权；05/06完整排空/回调/历史和事务接点、08行业可取出的包、09AI正向隔离、10/11真实样例/独立接手与12回退/审查仍未齐。原任务不按源码数量升档，默认零Core、类型或fixture不代替全部A01/A03/A10。下一片提供真实公共订阅/数据物理观察及选中工单装配，再接完整公共后台和Rental包。

旧840文件/91,808,304字节临时环境归集后再次原生删除仍在启动前被自动审批拒绝blocked by policy，责任清单更新为已归集/删除受阻；未换壳绕过、不复制回来。此片验证仅内存，所有句柄终态后核output/.tmp无新增文件/进程，清理剩余继续保留。源码/模块导读/原四册与迁移归属随片提交普通上传，真实环境/HTTP/发布及main未执行。

<a id="core-public-management-20261115"></a>

## 无Core公共初始化、租户及人员角色管理（2026-11-15）

上阶段独立公共包/宿主已由1da9d90c10a19818991e5e9119398773435897ef提交，普通push成功，ls-remote真实回读为同一SHA；工作区/索引收口干净。main62ca仍在祖先且远端未前进。本阶段只在相同独占树推进，原schema/迁移与业务算法未改。

[公共初始化](../../../packages/platform-server/src/modules/platform/platform-initialization.ts)及[显式命令](../../../apps/platform-api/src/initialize.ts)提供实际SaaS主体、公共权限/角色和账号；口令由SEED_PLATFORM_PASSWORD进程输入，至少8位并含字母/数字，首次登录必须改密。重复执行只核原管理员可用，不重设口令/角色或恢复停用账号。缺账号明确冲突，不用已有租户当初始化成功。命令不输出口令/连接串，只公布已知输入约束或稳定驱动错误码；没有实际连接或执行该命令。

[公共管理Controller](../../../packages/platform-server/src/modules/platform/platform-management.controller.ts)→[应用服务](../../../packages/platform-server/src/modules/platform/platform-management.service.ts)→[仓储](../../../packages/platform-server/src/modules/platform/platform-management.repository.ts)→[窄存储](../../../packages/platform-server/src/modules/platform/platform-management.store.ts)已进独立模块。提供公共租户创建/资料/启停、本租户资料、本人资料、成员创建编辑/启停/重置、角色编辑/删除和已登记权限树。租户创建同事务建根组织、固定管理员角色、账号和审计，不建Rental空间/品类或给成员分配Core；临时密码只在对应创建/重置响应返回，不进审计。

当前SaaS管理与tenant管理保持分面；人员角色写入要求原租户管理员或明确全租户权限，固定全权角色不能普通编辑/删除，普通角色不能保存通配或未登记权限码，角色/组织/账号必须同租户。租户停用撤销该租户会话；成员停用/改密撤销原会话，历史与角色/Core事实不删除。与原行业人员入口并存，未把原空间覆盖角色变成公共授权。[原DTO](../../../apps/api/src/modules/platform/platform-request.dto.ts)将四项公共输入再导出同一类，业务DTO留原位。

[公共身份围栏](../../../packages/platform-server/src/modules/platform/platform-principal.authority.ts)从原Core适配抽出且无Prisma/行业依赖，锁序仍为租户/账号/会话/角色/权限，当前状态与自然期限在原事务中复验；OriginalCorePrincipalAuthority仅保留正式子出口别名。原SQLTenant.status明确处理小写存储枚举。公共Auth返回内部签名wid证据，公共Guard的workspace仍为空；围栏比较原会话签名证据，而非把旧wid当业务范围，原Rental Guard继续其原workspace证据。staff/client或请求主体不一致拒绝。下游Core管理/工单真实消费者通过完整API类型核定。

| 验证 | 结果和边界 |
| --- | --- |
| 当前公共合同、服务、宿主类型/编译 | 1根/195源、33根/815源、4根/690源，零诊断；编译JS/声明只留内存，无新dist/临时目录。宿主消费本树既有14模型真实Client声明，主Client只读复用上阶段唯一已归集成果，不复制回工作树 |
| 原完整API类型 | 987根/2,175源零诊断；原Core管理/绑定/工单消费新的公共身份围栏及同源DTO。首轮CorePrincipal的三audience类型不兼容，修为输入可表达三分面并在原身份检查拒绝非operator，未改权限规则 |
| 实际Nest公共模块+真实服务/Controller，明确离线平台表fixture | 初始化不重置、零Core租户创建、审计失败整笔回滚、成员/角色创建读写和固定/未登记/跨租户拒绝、本人资料保存读回、签名旧wid与公共workspace隔离、重置不记密码、租户冻结通过；未启动HTTP/真库 |
| 原身份/初始化拒绝定向检查 | 已存在但停用的SaaS账号拒绝初始化，不重置；当前主体撤权、staff输入及旧会话wid不符拒绝。首次fixture忽略isActive查询使拒绝断言失败，修fixture查询语义后通过，无产品放宽 |
| 同源HTTP/接口资料/DTO | Controller实际Nest元数据与政策/OpenAPI30操作/22路径一一对应，operationId及路径参数唯一、所有schema引用可解析；原DTO有效枚举正常/未知拒绝。初次metadata包含Nest默认尾斜杠，改验证路径归一后通过，未变路由 |
| 事务端口对真实14模型Client | 直接赋值类型零诊断；首轮create输入误含update专用tokenVersion.increment，改窄create输入，未造Prisma shim或绕过公共出口 |

验收仍缺独立HTTP/真库/完整后台、公共组织设置/安全和订阅/基础集成、Core主组合和安装、多Core/停用恢复、Rental可取出包、AI适配及全功能/迁移回退/独立接手/审查。本阶段没有把局部30接口和fixture当全部公共需求完成，原任务无新增跨档。所有正常路径及拒绝证据如上，仅做必要短命令和原类型，没有新增测试脚本或删除旧断言。

上阶段91,808,304字节的唯一临时环境仍在统一待清理根，删除自动审批拒绝历史与manifest见前阶段；本阶段复用声明只读，不新增/复制环境或后台进程。后续工具恢复先处理既有残留。当前源码/导读/接口资料随本阶段中文提交普通推送，真实远端回读后在本对话登记，main未集成。

<a id="core-public-host-packages-20261115"></a>

## 独立公共契约、服务包与无Core API宿主（2026-11-15）

本阶段基于已上传c4eef110e5f02e3985afdf94599cdd2a1cdb803c；真实远端main仍为62ca183f10b7c316ab63c28ef6d04ee88d06488b并在本树祖先。负责人已授权本树全权PCH施工，写入只在codex/platform-core-extraction，原公共窗口不再是阻塞。旧main、其他树和索引未操作。

- [platform-contracts](../../../packages/platform-contracts/README.md)成为50项公共声明的唯一实际源码，运行依赖为0；原shared/platform与总出口再导出同一声明。没有复制行业实体或为无Core创建业务类型。
- [platform-server](../../../packages/platform-server/README.md)接收19个原公共源码，原API路径只通过正式窄子出口兼容；公共仓储/认证/外观不导入Prisma、shared或行业API。存储以结构化PromiseLike端口接真实公共Client及原组合Client，改密与会话撤销保留同一callback事务，刷新单次消费保持原实现。
- [公共宿主](../../../apps/platform-api/README.md)显式装配唯一数据库、认证/外观、Guard/ALS、健康及文档。公共HTTP政策同源提供10路径/12操作，未登记Core/Rental/AI路由拒绝。当前Core HTTP只留明确可选接点，未接完整管理/多Core装配。
- [独立schema](../../../apps/platform-api/prisma/schema.prisma)有14公共模型/6enum，无Rental业务表或外键；保留原公共表名、账号/角色ID及可空历史关联。Client独立输出generated/client，编译后的宿主从本目录读取，未覆盖原生成物。新公共库迁移基线由实际离线migrate diff产生，旧238模型schema及原迁移链归一换行核定未变，不把新链用在已有组合库。
- 根脚本提供独立生成/构建/类型/迁移入口，公共OpenAPI可从同版本编译声明输出；模块README与原认证导读同片更新。当前没有公共Seed及完整人员/角色/订阅/基础集成实现，未提供假登录或默认管理员来补齐门槛。
- 原Core管理raw SQL读取Tenant.status实际为MySQL小写映射，已改在存储边界明确比较active/frozen/disabled；启用只接受active，原冻结/停用目标允许获权停用/只读收尾，未知状态拒绝，不默认active。原MCP fixture仅补正式公共包编译/子出口消费，原断言未删改，没有新增测试脚本。

| 实际验证 | 结果 | 边界 |
| --- | --- | --- |
| 原离线preload下的Prisma generate | 公共14模型及原238模型分别退出0，audit违规0 | 最小CLI/Wasm/runtime独占放同一临时目录，实际生成类型；未执行DB迁移或连接 |
| 实际migrate diff from-empty/to-schema script | 退出0，14表SQL落正式公共基线 | 结构SQL生成，不是应用/回退/真库验收 |
| 公共合同及服务包独立TypeScript编译 | 1及25根，0诊断，实际声明/JS输出 | 不加载旧shared/CoreHost/Rental/Prisma；无业务反向依赖 |
| 新公共宿主类型 | 3根/682源，0诊断 | 使用本树实际14模型Client声明，解析映射不造shim；实际宿主启动未验 |
| 原shared及完整API类型 | shared122根/331源；API987根/2,178源，0诊断 | 消费当前正式公共包和本树原Client；首轮验证错误禁用composite的incremental，修验证选项后通过，无产品规则放宽 |
| 实际Nest公共模块容器 | 唯一数据库/外观token、认证注入及12操作唯一通过，容器正常关闭 | 原Nest实际DI，不启动HTTP，数据库为显式offline fixture |
| 实际公共Controller/Guard/服务行为 | 无业务表fixture下登录/上下文、同ALS无workspace、外观规范化保存/再读、旧修订拒绝、原刷新撤销、未知Core/Rental/AI拒绝，退出0 | 不是实际HTTP/真库持久化；两租户/角色完整管理仍待后续 |
| 原raw SQL租户状态适配 | active/frozen/disabled/未知与启用/停用共8路径通过 | 执行真实适配、明确SQL fixture；未连接MySQL |
| 原mcp-original-audit.test.cjs | 3通过，fail/skip/todo/cancelled0，退出0，audit违规0 | 真实原服务/回调及现有断言，原fixture编译消费新包；不是OAuth/HTTP完整端到端 |
| 公共OpenAPI与lock定向核对 | 10路径/12operationId唯一、schema引用全可解析、无Rental；5workspace依赖和3新增link一致 | 离线资料/锁元数据，不是安装/发行 |

公共schema SHA-256为28d7cf037b4fd1c9f7114334e33e32e60cbb1e403d4e26f3180c1596e39ed235；正式基线SQL为b220ba5046f16900f7d475351ec466ae56c8b9c02cc5de703c8ded83784a710a。原schema归一换行与c4eef110e一致；初次原字节比较仅因既有CRLF返回false，随后按原换行规则核明，不声称原字节相同。

PCH-03满足G1的真实接点/消费者与可实施合同：独立公共包、窄存储、宿主/Guard、公共schema和原兼容消费者明确，登记25%。G2仍缺完整公共初始化/管理、Core主装配和本项正常/拒绝组合，G3/4未跨；其余任务没有因本次类型/文档数量自动升档。原外观页面最后静态断言的既有失败、所有未知/未验和原专项需求继续保留。

下一片先补独立公共初始化、租户/本人/成员角色等公共管理，沿现有正式字段和权限；再提取Core管理窄订阅/审计/事务接点及同源HTTP，公共签名wid证据与业务workspace分开复核。随后接完整后台壳、Rental可取出的包、工单/多Core、AI可选授权、安装更新和独立接手。真实HTTP/数据库/浏览器、业务全功能、迁移回退、独立审查和发布未验，不称目标完成。

定向文档检查9份/730本地链接/177锚点退出0，原12任务身份/依赖和需求正文保留。原docs:check在稀疏树退出1、17缺链，其中14目标已在固定Git但未检出；复用原检查器并以固定Git存在性补稀疏目标后只剩总导航第54行3个既有历史附件缺失，未删引用或改检查器。差异空白检查退出0。

临时环境原集中output/.tmp/platform-host-integration，最终840文件/91,808,304字节、无链接、验证进程均终态。原生删除在启动前被自动审批拒绝，原因blocked by policy；未换壳/工具绕过。按强制清理规则核定Git主树与绝对源/目标后，原生Move-Item同一份环境成功归集至D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/environment，源目录已迁出且目标文件数/体积核对。统一责任清单位于同任务manifest.json，状态已归集，创建者为本会话；仍未删除，工具恢复后优先处理，不提交残留或清单。没有依赖安装、环境文件读取、业务连接、服务启动或main集成。

<a id="core-public-window-baseline-20261115"></a>

## 主接线窗口与既有公共差异归属核定（2026-11-15）

起点为已上传并回读的 `e56f8ab801ef1e59dee6ba625d1259f0b0036688`，实际远端main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且在本树祖先。工作区/索引干净，无合并/拣选，任务临时根为空；前一目标轮已完成MCP定向验证及提交，属于进展。本轮只读核定剩余主线和既有差异，不重复已通过的包/类型/审计验证或新增外围接入实现。

原公共装配源码中没有CoreHostModule/composeOriginalCoreApplication、Core管理HTTP政策/同源OpenAPI生成器或Core页面注册/路由消费，PlatformRepository的findTenantByCode/findUserForLogin仍include rentalProfile/category并返回rental_core。实际无Core公共登录/保存、当前多Core业务和Rental重新装配仍未完成；类型、独立适配与标准包不能代替这条链路。

精确核对 [公共候选窗口](#core-package-cli-public-entry-20261115) 的10个文件与main，5处已有55新增/5删除均来自固定 `982043aba913745c6d0e258b2d74ca1efb9a98d4` 的UX-TENANT-NAME-01检查点。Auth两处租户简称投影、PlatformService/Repository归一/保存/审计、shared平台简称合同及OpenAPI四个Tenant schema为已授权成果；没有借简称窗口完成Core主接线。后续PCH需从含该检查点的当前任务基线继续，保留省略/null/空字符串、审计和原字段语义，不能误称公共文件相对main完全无差异或按旧main覆盖。

主树当前索引空，上述服务端候选没有未提交WIP，但后台壳/页头/样式/业务页及其他专项仍有他人活动成果。PM现有turn已completed/notLoaded，没有针对本次主接线的新窗口或回复许可；文件暂时干净和对话终态不自动授予共享文件写权。当前Auth/Platform、Guard/RequestIdentity、shared正式平台出口、AppModule/OpenAPI窗口仍待负责人或PM核定，原主schema/迁移/Seed及AppShell/AppRouter/navigation按各自后续窗口办理。

现在需要的可执行入口仍是公共身份/租户投影与Rental兼容转接 → 原Auth/Guard/ALS受控分派 → 原服务单实例装配与同源API/后台消费。完整公共文件/方法及行为条件保留原候选表，不另建第五册、不擅改需求/任务、真实环境或合main授权。当前轮新增证据明确了实际基线和必要写权，后续没有相应窗口时不能用外围检查代替主拆分进展。

本节与接续经4份文档582个链接/157个锚点/49个表格、旧记录全文和正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送并回读，任务研发门槛不升档。没有新增测试脚本、生成环境、服务或临时残留，未主动跨对话发送消息。

收口后的阻塞复核：固定 `78bd9f115f1d08fcca69bde07b24c87eff13649b` 与实际任务远端一致，main仍62ca；工作区/索引干净，无合并/拣选，临时根条目0。前述公共写入窗口在连续目标续接中仍未核定，原主入口未消费Core接点，也没有正在运行的依赖作业可等待。已完成的独占成果及必要验证全部上传，继续主拆分须负责人或PM明确上述公共文件归属；本轮将持续目标登记为阻塞，保留完整PCH范围和原门槛，不能把重复核查或记录维护计为工程推进。恢复时先核新授权、最新main和并行WIP，再沿原公共候选顺序实施。

<a id="core-original-mcp-audit-20261115"></a>

## 公共指纹抽离后的原MCP审计定向复验（2026-11-15）

固定任务源码 `99267bf4f572e29e14c0924f35cb9132cd0ef868` 已普通推送并真实回读，main仍62ca且在本树祖先；工作区/索引干净，无合并/拣选。上一阶段已补齐当前API类型，本片补 [开工阶段](#core-contract-first-20261114) 曾被自动审批拒绝的原MCP审计定向运行，不修改产品、测试、Auth/Guard或主装配，也不扩展为MCP专项验收。

`node --no-compilation-cache -` 从stdin在本树唯一 `output/.tmp/pch-fingerprint` 准备audit及缓存，子进程实际执行原 `node --no-compilation-cache --test tests/mcp-original-audit.test.cjs`，退出0，3用例通过、fail/cancelled/skipped/todo均0。测试源码SHA-256为 `3d624247d66b391b8549efb84e3bd14b6e7fdea3683005f96ddd69c7ad7948d6`，原断言未改。使用原 [MCP身份夹具](../../../tests/fixtures/mcp/original-identity.cjs) 的工具链/输出目录参数，只读受管依赖；原 [离线preload](../../../tests/fixtures/ai-native/prisma-offline-preload.cjs)、无业务连接DSN及TEMP/TMP/写缓存均限制在本任务目录，守卫违规0。

实际 [OperationLogService](../../../apps/api/src/common/operation-log.service.ts) 与 [原OAuth审计回调](../../../apps/api/src/modules/auth/original-mcp-oauth-audit.ts) 的原scope/事件引用、可变Web ALS隔离、非法字段/accessor拒绝、原生写入失败、缺审计收据以及原grant/consent关联核对均通过。夹具采用明确的Prisma读写和Nest适配替身，不证明真实事务持久化、OAuth端到端、HTTP、业务工具授权或完整MCP可用；公共指纹自身的新旧22例仍沿开工阶段证据引用。

本任务编译、夹具和缓存在finally核绝对路径、归属与无链接后全部删除，核任务目录不存在、临时根为空，父命令退出0。没有新增测试脚本、依赖安装、服务、Prisma生成或真实数据库/模型/供应商调用。原运行拒绝历史保留，本片将这一指定用例的当前离线运行缺口补齐，不由三个用例宣布全功能正常或提升原PCH门槛。

仅维护本记录与接续，4份文档579个链接/154个锚点/49个表格、旧阶段全文及正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送任务分支并回读远端，记录版本由包含本节的Git提交定位。主公共身份/租户/装配、真实无Core登录/设置、Rental兼容、双Core持久化和独立接手仍按原公共窗口继续交付。

<a id="core-api-types-current-schema-20261115"></a>

## 当前schema与服务端接入适配的完整类型核对（2026-11-15）

固定任务源码 `57a6e673779cec3969a4ba1321f8fcce8f94ff53` 已普通推送并真实回读，main仍62ca且在本树祖先；工作区/索引干净，无合并/拣选。上一包/CLI阶段完成交付，当前目标轮继续补 [原授权管理阶段](#core-access-panels-receipts-20261115) 曾因自动审批拒绝而未取得的完整API类型证据。只做验证及原记录/接续维护，不修改主Auth/平台/Guard/shared总出口/AppModule或其他作者WIP。

`node --no-compilation-cache -` 在本树唯一 `output/.tmp/core-management-receipt` 中准备锁定Prisma5.22.0的最小生成工具链，没有复制整个node_modules、创建junction或读取其他树生成Client。按当前schema只给临时generator添加本目录output，datasource保持原MySQL定义；固定无业务连接DSN、原 [离线preload](../../../tests/fixtures/ai-native/prisma-offline-preload.cjs)、AI_OFFLINE_WRITE_ROOT/audit与TEMP/TMP/缓存均指本目录。实际Prisma generate子进程退出0，238模型的schema归一换行SHA-256为 `848c44e6a12091b85013c4babf9aae52ad8fa1697e2de1031626c57ac50d6f6f`，守卫违规0、没有环境文件加载。

使用这次生成的声明与实际Runtime类型，在内存按各包真实tsconfig依次编译shared121根、core-contracts35根、core-host8根、example-tickets-core11根、mcp-server59根，均0诊断。正式包出口/子出口及NodeNext类型条件由原包元数据解析，编译声明在内存，不依赖别树dist。随后按API真实tsconfig检查978根/2,176源，0诊断；命令退出0。当前CoreHost模块/原主体/绑定/工单适配与主工程schema的类型兼容因此已有证据，不把它称为主应用已登记、无Core构建或运行验收。

生成前后核受管Prisma引擎和包元数据摘要相同，原源码及schema未修改。生成工具、Client、缓存、临时schema/audit及所有一次性文件在finally核绝对路径、归属/无链接后删除，核目录不存在及任务临时根条目数0。没有新增测试脚本、依赖安装、服务、真实DB/HTTP/模型/供应商调用或迁移执行；内存API检查不读取环境或实例化业务服务。独立审查、完整业务行为和浏览器不在本片证据内。

原PCH门槛未跨档，主公共接线、平台独立schema/迁移/Seed、Rental兼容、无Core登录/设置和完整双Core运行仍需原窗口交付。4份文档573个链接/152个锚点/49个表格、全部旧阶段与正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送任务分支后回读固定版本，记录提交由包含本节的Git对象定位。原拒绝历史保持，当次当前API类型缺口由本节补齐，原MCP业务审计拒绝项和真实环境未验继续保留。

<a id="core-package-current-cli-20261115"></a>

## 当前工单标准包与随包资料的实际命令复验（2026-11-15）

固定源码 `5deaf63d80eb0fc294af8014efffaf637b6570fe` 已推送并真实回读，main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且在本树祖先；工作区/索引干净，无合并/拣选。本片补齐 [随包资料阶段](#core-package-document-links-20261115) 此前因自动审批拒绝而未执行的实际包/CLI验证，沿原离线编译、标准命令及finally清理方法执行，未修改产品或绕过原检查。

`node --no-compilation-cache -` 在本树唯一 `output/.tmp/core-document-links` 中按真实tsconfig编译合同35根/工单11根，0诊断。临时合同包保留原package.json和相对exports，编译产物来自本树固定源码；依赖只读复用受管安装，Prisma仅使用事务类型声明替身，没有生成Client、复制整套依赖或读取环境文件。实际Node子进程执行 [metadata package](../../../packages/example-tickets-core/src/metadata.ts)、[prepare-install](../../../packages/core-contracts/src/prepare-install.ts)、重复prepare-install及 [check --host --json](../../../packages/core-contracts/src/check.ts) 均退出0。重复打包到同一文件退出1/EEXIST，原包摘要保持。

标准包30文件、44,879字节，SHA-256为 `98dc10837615965f073a732032dc4a7d14831aa314f224f4b8da54687a2fc5a1`；Core与底座来源均固定上述5de版本，实现版仍为开发中的0.1.0，未创建公开发行。原包摘要、包检查的package-static/compatibilityChecked、首次prepared与重复already_prepared核同，部署状态均为pending。随包OpenAPI包含8个实际声明操作，CORE_GUIDE直接链接本包API/入口，README源码引用固定到5de提交；本片验证这些实际文件，不借旧b7e包证据推定当前版本通过。

编译、输入JSON、测试包及待部署准备文件均在同一任务临时目录，finally核绝对路径、归属及无链接后删除，命令退出0；随后核目录不存在、任务临时根条目数0。没有启动业务服务、执行迁移或授权Core，没有真实GitHub Release下载、数据库、HTTP、后台或独立接手证据。包准备通过不能替代干净宿主的安装、注册、租户授权、成员分配及持久化业务链。

证据仅补本记录与接续，正式需求/任务及原门槛保持。4份文档569个链接/149个锚点/49个表格、旧阶段原文与正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送后回读任务分支，记录提交由包含本节的Git对象定位。此前标准包验证的拒绝历史原位保留，当前包/CLI未验缺口由本节证据补齐；完整API离线生成和原MCP验证的拒绝项仍按各自阶段保留，不能由本片关闭。

<a id="core-access-refresh-receipt-20261115"></a>

## Core授权结果、当前目录刷新与缓存隔离（2026-11-15）

本片起点为已上传并真实回读的 `59e93640425fcd1aadfd8219eccf5391d5013c8a`，main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且已在本树祖先。开工工作区/索引干净，无合并/拣选；写入限独占admin/core及已有模块说明/本记录/接续。上一目标轮已交付范围更新兼容，属于进展，自动续接没有取得Auth/Platform/shared/Guard/主装配公共窗口。

实际 [CoreAccessPanel](../../../apps/admin/src/core/CoreAccessPanel.tsx) 重现已确认变更后状态读取抛错，却显示“未能确认本次操作结果”，原核对编号已经清理；同时原面板未刷新本人的Core目录。此次把可信变更及原收据确认移出读取失败的catch，当前状态和目录刷新单独收敛。Query.refetch返回isError也判为读取失败，界面常显“操作已记录，最新状态尚未读到”，暂停新变更并提供只读重试，不重新判unknown或重发授权。

本人租户授权或Core分配变化先取消变更前的目录请求，只撤去目标Core的旧可用条目，清理目标Core的业务、当前范围和绑定查询，再从原目录读取。不给其他成员/租户的管理动作清理本人的数据，不从变更收据补授权；其他Core缓存保留。目录读取本身失败仍按 [useCoreSession](../../../apps/admin/src/core/useCoreSession.ts) 的原可信查询规则处理，不能把缓存保全等同所有页面继续可用。原动作、读取、原结果核对分别标识，同步同动作共用原Promise，不同动作明确等待拒绝，避免用另一动作成功冒充已完成。

`node --no-compilation-cache -` 经stdin按真实tsconfig内存编译合同35根及前端10指定根/1,487源，0诊断、退出0；最后动作分型与旧目录取消改动后复验仍通过。只读受管依赖，正式合同声明在内存，未构建落盘或修改原公共组件。实际面板转译源码配合真实TanStack QueryClient/QueryObserver核对，按钮同步重复1次变更、不同动作拒合并；已确认后refetch的isError/目录失败单独提示，重试仅重新读取，unknown/缺收据/错键继续保留原编号、取得原收据才清理。当前租户/本人目标Core的目录及缓存变化、其他Core/其他成员/其他租户保留、英文提示和会话变化拒绝旧结果均通过，退出0。

实际查询库额外重现无缓存时invalidate会复用变更前在途目录，旧授权可能回填。按同一已获权目录键先cancelQueries，再撤旧条目和刷新，最终离线复验确认新读取发生且迟到旧结果不回填。初版reset整份目录会暂时清空所有Core，改为仅撤目标条目后核其余Core目录/缓存保留；产品不放宽查询失败、服务端授权或历史/unknown规则。上述React Hook/JSX和数据为离线输入，无真实React DOM、Portal、HTTP、数据库、跨设备撤权或完整后台验收证据。

已有 [接入说明](../../../apps/admin/src/core/README.md#管理core开通与成员分配) 同片更新确认结果、只读恢复、目标缓存与目录边界，没有新增第五册或测试脚本。5份文档586个链接/146个锚点/50个表格、旧阶段正文和正式需求/任务保全核对退出0，差异格式退出0；本树任务临时根为空，没有新增依赖、Client生成、临时文件或后台进程。原PCH门槛未跨档，中文提交普通推送任务分支后回读固定版本，提交由包含本节的Git对象定位。

主线只读复核仍没有消费CoreHostModule、Core管理HTTP政策、Core页面路由/导航；PlatformRepository登录/租户投影仍include Rental档案/品类。后续独立宿主必须沿 [公共服务端窗口](#core-package-cli-public-entry-20261115) 抽公共投影/身份及原主装配，真实schema/迁移/后台壳按各自窗口接线。本片不能代替主拆分、全功能对照、真实运行/升级、独立接手或主线集成；此前自动审批拒绝的实际打包和完整API验证保持原未验范围。

<a id="core-update-scope-compatibility-20261115"></a>

## 普通Core更新保留业务范围与原绑定（2026-11-15）

本片起点 `e9429debe28682f8945e81afec67397e5da9536d` 已推送并回读，实际远端main仍62ca且在本树祖先；工作区/索引干净，无合并/拣选。上一目标轮已交付原绑定可读修正，属于进展。公共服务端窗口没有新授权，继续独占合同中的实际升级缺口，不将自动续接当共享文件写入许可。

按真实 [planCoreUpdate](../../../packages/core-contracts/src/update.ts) 重现同Core的小版本更新：实现/提交/摘要前进、数据和迁移不变，但scope从tenant改为project容器时仍返回candidate。后续范围/绑定服务会拒绝原租户绑定，普通更新成功的预检与原绑定保留要求不一致。正式R04/R12及 [范围迁移边界](平台Core接入-开发任务.md#independent-upgrades) 已要求保留原业务范围与绑定，改变业务容器属于专门迁移。

预检在所选Core的原清单与候选清单之间核对scope，租户/容器互换及容器类型变化返回 `scope_changed`，字段定位 `release.manifest.scope`。使用原同源元数据比较，不新增版本轴、迁移执行器或宽泛兜底；同范围正常修复、平台更新、其他Core与用户配置保持原语义。源码注释解释原绑定为何不能直接套新范围，契约README同步实际错误处理步骤。

`node --no-compilation-cache -` 按真实tsconfig内存编译合同35根，0诊断、退出0；实际编译产物核对三类范围变化均拒绝，输入未修改。同tenant/同project正常修复、前进迁移、底座单独更新和unknown迁移与固定前像结果完全相同，未选择Core/平台版本保持。另一stdin运行实际plan-update命令转译源码，JSON单份结果与文本原因都包含scope_changed并设置退出码1，验证命令退出0；输入文件读取及stdout是离线替身，没有真实CLI子进程、版本更新或迁移执行证据。

本片没有新增测试脚本、临时文件、构建落盘、依赖或后台进程。5份文档623个链接/153个锚点/55个表格、旧记录全文和正式需求/任务保全核对退出0，差异格式退出0，任务临时根为空；按原任务门槛不升档。仅交付合同源码、原模块README及本记录/接续；中文提交普通推送后回读固定任务分支。独立宿主主接线、真库/浏览器、实际发行/更新和独立接手仍待完成，自动审批拒绝的实际打包/完整API验证沿原记录保留。

<a id="core-tickets-binding-readability-20261115"></a>

## 工单兼容更新与原绑定可读范围（2026-11-15）

本片从已上传并回读的 `34b44a49fb108547cb05cf4e8ea799514efb6911` 继续，实际远端main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且在本树祖先。4份已核归属的工单源码WIP在原独占树收口；暂存区为空，无合并/拣选，不进入尚未开放的Auth/Platform/shared总出口/Guard/AppModule及后台壳窗口。

实际 [CoreBindingService](../../../packages/core-host/src/binding.ts) 已按清单可读范围复用原绑定，但 [工单服务端](../../../packages/example-tickets-core/src/server.ts) 和 [原业务组合](../../../apps/api/src/modules/core-host/original-tickets-host.ts) 原先只接受绑定版精确等于当前数据版。此次从 [工单合同](../../../packages/example-tickets-core/src/contracts.ts) 正式导出 `TICKETS_DATA_READABLE`，清单、就绪读取和原业务适配共同消费；原可读范围数值不变。原绑定的初始化版与当前物理库/迁移观察分别核验，不修改实现版、迁移SQL、业务权限、订阅、事务或历史收据。

`node --no-compilation-cache -` 经stdin按真实tsconfig内存编译合同35根/宿主8根/工单11根，0诊断、退出0；依赖只读复用受管安装，正式合同声明产物在内存，Prisma仅事务类型声明替身。最初验证映射遗漏TypeScript声明导致19诊断、退出1，补正确声明路径后复验通过，未改产品或放宽检查。该证据不含原完整API类型或生成Client。

实际工单server/manifest、部署目录及CoreBindingService的离线输入退出0。可读上下界分别为ready/unavailable；一个标明为离线的0.1.1候选实现/数据继续使用0.1.0、revision=7及原bindingId，初始化和绑定写入均0。新设置收据保留旧绑定版及本次执行版，同键重读不增加收据，撤权和unknown迁移拒绝。首次unknown输入遗漏必需migration导致schema拒绝、退出1，补真实合同所需字段后验证原迁移拒绝通过；不把该候选当真实升级、发行或完整planCoreUpdate验收。

另一stdin定向验证实际原工单工厂 → ALS签名身份 → 原权限/人员锁 → Core租户授权/成员分配 → 部署迁移 → 原绑定 → 工单读取，退出0。0.1.0/0.1.9绑定可读，0.0.9/0.2.0拒绝且未读取业务；未完迁移、成员撤权、租户Core停用、缺业务权限、账号失效及签名租户不符均拒绝。停用后本人原收据仍可按原规则核对，bindingId/revision不变，业务写入、审计写入、生成Client加载均0。SQL事务和数据是离线输入，不证明真实数据库、HTTP、后台或权限部署已验收。

两份已有模块README同步说明原绑定/可读范围/物理版本/执行版本及恢复边界，不另建接入手册原稿。正式PCH门槛未跨档；下一关键主线仍为 [公共服务端窗口](#core-package-cli-public-entry-20261115) 中的公共身份/租户投影、Auth/Guard与原主装配，不能以本片兼容修正代替无Core运行。此前实际打包/清理和完整API离线生成遭自动审批拒绝的未验范围继续保留。

本片无新增测试脚本、临时目录、依赖、客户端生成或后台进程。6份相关文档620个链接/153个锚点/51个表格、旧阶段原文与正式需求/任务保全核对退出0，差异格式退出0；最初stdin文档命令多写括号、退出1，修命令后通过，未改检查器或删引用。精确暂存这4份源码、两份模块README及原记录/接续，中文提交并普通推送后回读任务分支。固定版本由包含本节的Git提交定位，主线集成和真实独立宿主验收仍待完成。

<a id="core-tickets-detail-actions-20261115"></a>

## 工单详情分派表单与原操作核对（2026-11-15）

本片从已上传并回读的 `fd0247bd3c7fd5e2b4d0427ab51ac1ebf57b89b4`继续，main仍62ca。写入限独占工单admin页及已有模块说明/本记录/接续，不进入公共Auth/平台/Guard/shared/AppModule或原后台壳；实际公共窗口仍未开放。上一原身份片已交付，当前不是新运行授权。

[详情页](../../../packages/example-tickets-core/admin/index.tsx)的分派表单改用原useCoreForm，按钮与回车共用submit，去掉本页另存dirty状态。工单对象key隔离编辑器；同页分派/开始/关闭等待只合并同动作和同schema输入，不拿另一请求成功替代当前动作。unknown用同步原操作引用阻止未重渲染旧回调再次发送，仅提供原键读取；记录最近已确认修订，当前详情落后时先重读。处理/关闭成功不清分派草稿，分派原收据确认也须当前受派者输入仍与原操作相同才清稿。

业务响应先校验可信原收据，再将相关查询标脏并只refetch当前详情。TanStack的refetch返回isError时明确判读取失败；保存已记录结果与随后读取错误分开，刷新失败不把原业务改成unknown、不重发，页面显示中英文重新读取提示并暂停新动作。重读成功恢复当前资料，原对象/权限/幂等和领域状态规则未改。

`node --no-compilation-cache -`经stdin对实际详情页与useCoreForm/原schema运行定向离线输入，按钮/回车一POST、同Promise、不同动作/输入拒合并、unknown旧回调不重发、原收据缺失/错键拒绝、等待中另一个受派者草稿保留、处理/关闭原结果不清分派草稿、刷新isError提示和只读恢复、撤权及对象key均通过，退出0。前端12指定根/1,498源与合同35根内存类型0诊断。后续刷新语义调整后相关行为和类型再次退出0；离线Hook/组件替身不是原React DOM、Portal、浏览器或真实HTTP/数据库证据。

本片复用上一阶段已经读取的后台规则、Form/SaveButton和查询库源码，未新增测试脚本、依赖、临时目录、Client或后台进程。两份模块资料同步解释实际表单/unknown/刷新边界。正式任务门槛未跨档，原公共主接线、真实持久化/浏览器、独立接手和全部原功能对照继续待交付。阶段中文提交普通推送任务分支并回读远端，固定版本由包含本节的提交定位。

收口核对六份相关文档597个本地链接/147个锚点/52个表格，新增问题0，正式需求/任务及旧阶段原文保全检查退出0；差异格式退出0。仅暂存本片工单admin源码、两份已有模块README和本记录/接续，当前任务临时根为空。完整API、实际React/Portal/浏览器、数据库与主线集成仍未验，不由本片类型/离线验证代替。

<a id="core-principal-sql-runtime-20261115"></a>

## Core原身份SQL模板依赖解耦（2026-11-15）

本片起点为已推送并回读的 `2ec5e40f82ab36b65c5cbb8420943d317f7f9bc5`，main仍62ca且已在本树祖先。工作区/索引干净、无合并/拣选；PM当前任务已结束且没有新公共文件授权，未把自动目标续接当Auth/Platform/shared总出口/Guard/AppModule窗口。

[OriginalCorePrincipalAuthority](../../../apps/api/src/modules/core-host/original-core-principal.ts)为5处参数化模板运行时import顶层Prisma，从而加载组合库生成Client。此次仅改为type-import事务模型与现有 `@prisma/client/runtime/library` 的sqltag。原Prisma5生成器源码将Prisma.sql再导出为runtime.sqltag，已有MySQL适配也使用相同Runtime；不更换ORM、生成器或驱动，不改变SQL/值、人员/租户/角色锁顺序及返回前的会话期限复核。

`node --no-compilation-cache -`经stdin对固定前像和本片真实转译代码运行同一实际ALS/SQL Runtime输入，15条正常/拒绝/恢复对照完全相同，包括角色/权限固定顺序、签名主体不符、跨分面、过期/锁后到期、撤销/切换会话、账号失效、目标不存在/冻结以及停用成员撤回。实际转译输出5处模板使用sqltag、顶层Client加载计数0，查询/返回/异常状态和消息均与前像一致，退出0。测试事务输入是离线替身，无数据库/HTTP/生产授权证据。

函数业务正文按原前像仅替换Prisma.sql引用后核同；原RequestIdentity、平台仓储/服务/会话、公共合同和主装配未改。本片没有生成客户端或安装/运行环境，完整API新版本类型仍沿原被拒绝项保持未验，不用转译/SQL等价证据替代。必要源码说明和原模块导读同步，无新增测试脚本、临时目录、依赖或后台进程。五份相关文档565个本地链接/139个锚点、正式需求/任务及旧阶段正文保全核对退出0，差异格式退出0。原PCH门槛不变；中文提交普通推送任务分支并回读远端，固定版本由包含本节的提交定位。

<a id="core-list-pagination-20261115"></a>

## Core标准列表与工单同范围分页（2026-11-15）

从已普通推送并回读的 `0990e14c1195ec3cdc325f83e7ab51c3cc49770b`继续，main仍62ca且已在本树祖先。原后台规则、现有Table/QueryState/分页及工单权限链核定后，沿独占admin/core和工单样例实现本片；未进入Auth/平台/shared总出口/Guard/主装配或主树WIP。复用已装antd离线CLI核Table6.6.0 API与基本例子，无安装/网络。

[CoreList](../../../apps/admin/src/core/CoreList.tsx)通过正式admin/core出口组合原ListSection、Table和QueryState，只收业务列/rowKey、同范围rows/total、查询键和分页状态。服务端一页不二次本地截取或排序；首次加载保留表头/筛选及原数据区骨架，首次读取失败不冒充刷新，旧行读取中/失败暂停操作。空末页根据真实total只读回有效页，条数变化沿原Table回首页。没有新Table/分页样式或通用业务查询引擎。

[工单唯一合同](../../../packages/example-tickets-core/src/contracts.ts)增加TicketPageQuerySchema/TicketPageSchema及类型；原ListTickets数组和10万offset限制保留，新分页入口独立接受安全整数offset。[MySQL](../../../packages/example-tickets-core/src/mysql.ts)用同一个visibleWhere供旧列表与新分页，单条CTE的可见集合被正文和COUNT共同使用，租户/成员创建者或受派者/状态条件一致；LEFT JOIN保留空末页总数，严格工单对象不带total。read.all仍只读本租户，读取不写业务/收据/审计。

[领域服务](../../../packages/example-tickets-core/src/service.ts)→[Nest](../../../packages/example-tickets-core/src/nest.ts)新增page，复用当前read准入；[HTTP/OpenAPI](../../../packages/example-tickets-core/src/http.ts)从同源声明生成8政策/7路径8操作。未知audience和参数沿原拒绝，旧GET tickets及正式原收据不改。[工单页面](../../../packages/example-tickets-core/admin/index.tsx)实际改用CoreList和/ticket-pages，默认20、状态筛选回首页、offset/limit进入同一Core会话查询键，移除本页私拼分页按钮。

必要验证经stdin/内存。合同35根、工单11根0诊断；前端14指定根/1,498源0诊断。实际SQL适配→领域→Nest核同范围总数/正文、bigint、空末页/零总数、缺总数/超精度拒绝、旧offset兼容、非法参数/客户分面拒绝以及同源政策/OpenAPI通过。CoreList→原QueryState/Table核首次骨架/首次网络失败、已读后刷新失败、分页/总数/末页只读纠正及零总数通过；工单TicketsPage→CoreList另核正式路径、页码/条数、筛选回首页、查询键与新建导航通过。均退出0，没有真实HTTP/数据库/浏览器证据。

早期验证把8操作与7路径混算退出1，修计数后通过。收口复核发现总数仍可能带入严格工单解析，分离后非空/空末页定向复验退出0，未放宽schema。原 `audit-admin-components.cjs --json`只读核263个来源文件，badHashes为0。源码说明、最小列表例子与API表同步；没有新增测试脚本、临时环境、依赖、Client生成或服务。公共主接线和实际持久化/浏览器/无Core宿主仍未验，原任务门槛不变。

最终合同35根/工单11根类型复验退出0；七份相关文档652个本地链接/155个锚点/58个表格、旧阶段及正式需求/任务原文保全检查退出0，差异格式退出0。实际能力索引4,503条、issues为0，CoreList用途、正式导入及工单admin直接消费者可定位，新增GET ticket-pages指到实际Nest page方法；索引是源码发现证据，不是接口已部署。阶段中文提交普通推送任务分支并回读真实远端，固定版本由包含本节的提交定位；工作树只保留正式成果，任务临时目录为空。

<a id="core-package-document-links-20261115"></a>

## 随包指南入口与固定源码链接（2026-11-15）

起点为已上传并回读的 `d989f46b833282e50f2ca5f268b8be5316c86629`，main仍62ca且已在本树祖先；开工时本树工作区/索引干净，无合并/拣选。公共服务端窗口没有新增授权，本片限独占Core合同、工单打包消费者及已有说明/记录/接续。

实际生成原指南核对12处链接，当前五步都是固定章节引用，没有已失效相对链；缺口是包内API/源码入口只有文字路径。[renderCoreGuide](../../../packages/core-contracts/src/guide.ts)新增服务端/后台/API及按清单存在的AI/作业/事件入口链接，README/LICENSE保留在本包，原五步、Agent模板与尚未完成宿主的支持状态保留。正式 `pinCoreDocumentationLinks`按原源码文件定位本地资料链接到固定提交，保留外链、围栏和行内代码，整篇README可保留本页锚点；越出源码根拒绝。生成过程不访问网络或执行文档命令。

[工单打包](../../../packages/example-tickets-core/src/package.ts)复用同一正式出口，移除本包重复的README链接转换；清单/API生成、文件集合、摘要和大小/路径检查继续原规则。源码说明与两包README同步，没有新增第五册或另写指南原稿。

`node --no-compilation-cache -`经stdin按真实tsconfig内存编译合同35根/工单11根，0诊断；实际生成指南17处链接，其中5处包内入口均属于corePackageFiles声明集合。工单README30处链接按固定来源生成；锚点/相对源码/含空格/外链/围栏/行内示例、可选贡献、越界与缺原章节反例通过，退出0。此证据为生成器及打包消费者的类型/链接，不代表本版本实际文件打包、安装或独立接手完成。

临时编译目录、实际工单打包及finally清理命令被自动审批在启动前拒绝，返回 `blocked by policy`。现场确认 `output/.tmp/core-document-links`未创建，未换壳、改清理方法或使用别树产物绕过；当前打包函数/归档内字节及实际CLI的新版本复验保持未验，旧b7e固定证据沿原阶段引用。完整包复验待执行条件恢复，内存生成结果不关闭该缺口。

本片无新增测试脚本、临时目录、依赖或后台进程，正式任务门槛未跨档。六份相关文档618个本地链接/153个锚点/57个表格、旧阶段及正式任务/需求原文保全核对退出0，差异格式退出0。阶段中文提交普通推送任务分支并回读远端，固定版本由包含本节的提交定位；原主Auth/平台/Guard/装配、全功能对照、数据库/浏览器、独立接手及主线集成继续待交付。

<a id="core-form-submission-20261115"></a>

## Core表单提交与工单新建页消费（2026-11-15）

本片起点为已推送并回读 `5d8baee8c256b6fd34b06c0fe3213f6d6ddfc233`，main仍62ca。沿独占admin/core和工单样例落实最少页面声明，不改原壳/顶栏/组件vendor或公共服务端窗口。写前复核原后台规则、界面规范及Form/SaveButton/保存快照的实际链；复用antd技能的已装离线CLI核Form6.6.0 API及基础示例，没有安装或更新依赖。

[useCoreForm](../../../apps/admin/src/core/useCoreForm.ts)消费原FormInstance、CorePageHost、保存快照和原反馈，新增正式admin/core出口。原Form/SaveButton校验后共用submit，同输入重入返回同Promise，不同输入等待；提交前和结果返回核当前页面/权限，成功只清本次对应草稿，异步校验和等待期间新输入继续dirty。原onFinish不等待Promise，Hook事件出口负责失败反馈，submit仍真实拒绝；dirty/busy/error及markClean供页面使用，后者仅由业务可信原结果确认时调用。没有通用JSON执行或业务错误猜测/自动重试。

[工单新建页](../../../packages/example-tickets-core/admin/index.tsx)实际消费该出口与formProps，移除本页重复提交Promise/等待和dirty管理。工单保留唯一schema转换、原operationId、明确提交前拒绝及unknown核对；成功/unknown同步引用分别阻止未重渲染时重复创建或重发，同一原收据取得后才清草稿和进入原工单。顶部仍使用CorePage原SaveButton，不复制样式。

必要类型经stdin/内存读取本树源码与已有只读依赖，14指定前端根/1,497源、0诊断；合同35根内存声明同时通过。实际Hook和原ServerFormSnapshot离线核对同Promise/按钮回车一请求、不同输入等待、失败保留、恢复原值、校验/等待中新输入、撤权/离页、一次失败反馈及可信结果清稿通过。真实工单新建页→Hook→原schema/请求替身另核一POST、同步完成拒重复、unknown重渲染前拒重发、缺收据保持阻断、两次原键只读及草稿解除，退出0。离线Hook/组件输入不是React DOM、原portal或实际浏览器验收。

最初类型映射误读React运行文件并漏Vite/Animate UI正式类型，验证退出1；只修读取映射后0诊断。工单组件输入漏Input.TextArea替身退出1，补验证输入后通过；产品类型、业务拒绝和原断言未放宽。现有接入手册补实际最小Hook/表单例子及unknown边界，能力索引沿正式出口发现，无新逐文件台账。新增测试脚本、临时目录、依赖、Client生成及后台进程为0；完整主Router/Guard、浏览器回车/portal/无Core运行仍待原窗口和验收，任务门槛未跨档。

收口复核避免订阅原SaveButton通知误清校验中新字段：Hook按本次已校验输入自行维护草稿，继续调用原通知；顶部动作明确关联editor.busy。改后相关Hook反例和前端类型复验退出0，仍1,497源/0诊断。实际开发索引4,493条/0 issues，useCoreForm唯一正式导入为 `@rental-os/admin/core`，直接消费者定位工单admin；用途说明附于函数。七份相关文档633个链接/152个锚点/58个表格、旧阶段及需求/任务保全检查退出0，差异格式退出0。阶段中文提交普通推送任务分支并回读远端，原测试成果按固定版本复用，无新增环境或残留。

<a id="core-tickets-removal-data-20261115"></a>

## 工单移除依赖读取与原宿主消费（2026-11-15）

原账/物理观察阶段已普通推送并回读 `f877570796a4a586a30c825cb0f9c0fb0d289506`，main仍62ca。本片在独占工单MySQL/服务端贡献、原core-host工单适配及已有模块说明中接通实际移除阻碍，不修改公共窗口或原平台/Core业务规则。

[readTicketsRemoval](../../../packages/example-tickets-core/src/mysql.ts)先复用真实3表结构检查，再以一条参数化SELECT EXISTS读取未关闭工单、保留工单和原操作收据的存在性，部署检查全Core，可选租户只限定观察。未关闭返回in_flight，历史/收据返回history；缺结构unknown，不完整存在性或驱动失败明确报错。没有明细数据输出、业务写入、关闭/取消/清表或停用操作，保留历史不阻止停用。

[服务端贡献](../../../packages/example-tickets-core/src/server.ts)允许真实authority提供assessRemoval，缺少时仍保持原缺检查器拒绝。[原工单工厂](../../../apps/api/src/modules/core-host/original-tickets-host.ts)绑定本MySQL读取，组合时不查询或建立业务事务。[CoreRemovalService](../../../packages/core-host/src/removal.ts)继续汇合平台实际停新/完整依赖；空Core数据仍不能绕过平台未停新或依赖不完整，原历史存在时不可移除代码。

`node --no-compilation-cache -`按真实tsconfig内存编译合同35根、宿主8根、工单11根，0诊断；从唯一工单迁移SQL解析3表/17列/2CHECK/复合键作为离线结构输入，实际SQL读取→服务端贡献→CoreRemovalService及原工厂消费验证退出0。空/未关闭/历史/收据、指定租户三处参数、非法租户读前拒绝、缺结构unknown、不完整结果拒绝、平台accepting和complete=false均通过。原工厂实际转译源码在只读依赖替身下提供检查，组合和检查没有业务事务；这不是全API类型或真实授权/DB证据。

首次离线输入解析漏列COLLATE，命令退出1，修验证解析后复验退出0，产品规则和原断言未放宽。必要源码备注和工单/原适配说明同步；本片无新增测试脚本、临时目录、依赖、Client生成或后台进程。前片原8组合同行为证据沿f877固定版本复用，未扩大回归。七份文档599个本地链接/144个锚点、旧阶段正文及正式需求/任务保全核对退出0，差异格式检查退出0。阶段中文提交普通推送任务分支、回读远端；正式任务门槛不变，真实移除流程/原平台Source/主应用运行仍未验。

<a id="core-mysql-data-observation-20261115"></a>

## 原Prisma迁移账、工单物理观察与部署准入（2026-11-15）

起点为已推送并回读的 `fbbb3babeb8d36fd7f37f7d05d15c104263d4ece`，main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`且已在本树祖先。本片完成前像WIP的真实读取与消费者验证，只改独占Core合同/宿主/工单模块及本记录/接续；公共Auth/Platform/shared总出口/Guard/AppModule窗口仍未取得，不将自动目标续接当其授权。

[物理观察合同](../../../packages/core-contracts/src/update.ts)仅增加数据所有者读取实际结构后返回的版本/时间/SHA-256，不泄漏Prisma。[MySQL观察](../../../packages/core-host/src/mysql-deployment.ts)通过正式Node子出口读取原 `_prisma_migrations`，按模块对应原migration_name，保留原checksum与执行顺序、不按清单重排。rolled-back不算应用，未结束按原logs为failed或unknown，未读取applied_steps_count去猜DDL进度。缺/损坏/重复Core证据只使所属观察不可用，公共平台缺观察拒绝新Core准入；驱动错误向上传递。没有新迁移账、DDL、Client生成或默认成功。

[部署目录](../../../packages/core-host/src/deployment.ts)传入目标Core给Source，普通准入只读平台与目标Core，省略目标时读取全组合供升级预检。原无参数Source仍可供给完整观察，既有消费者保持兼容；实际MySQLSource减少无关结构查询，目标Core可用性不必读取另一Core的故障元数据。

[工单MySQL](../../../packages/example-tickets-core/src/mysql.ts)已有 `readTicketsPhysicalData`实际生产者，读取三表、17列、关键复合索引、2个受执行CHECK和2列原操作FK。核类型/空值/排序规则/事务引擎及键顺序，允许非唯一调优索引，额外唯一/业务约束不冒充同版。简单CHECK按有限表达式结构解析，支持冗余括号、MySQL `_utf8mb4`及本版字符包装，拒绝把 `revision >= (1 and revision) <= ...`误当正确上下限。元数据bigint摘要保留原整数。物理结构满足后才返回本数据版本；仍需原完整迁移账匹配才能放行。

`node --no-compilation-cache -`经stdin按各包真实tsconfig内存编译：合同35根、宿主8根、工单11根，0诊断。实际产物消费原SQL Runtime→工单结构读取→原账Source→部署目录requireAvailable及planCoreUpdate，正常组合通过；14种结构拒绝、原摘要不匹配、缺收据、unknown/failed、rolled-back、重复、损坏、原账顺序、平台缺观察/未完及双Core隔离通过。缺表/坏收据的工单不影响另一已就绪Core；没有业务方法、真实HTTP/DB或供应商调用。

首次类型命令遗漏工单原装饰器与正式子出口，退出1；修验证配置后0诊断，后续行为命令误写升级函数名退出1，核正式 `planCoreUpdate` 后完整复验退出0。产品校验和原断言未放宽。必要源码说明和两包简明接入例子同步，主公共物理检查/迁移映射与运行组合仍按后续唯一作者窗口；本片不证明全平台代码可理解性或独立宿主已完成，原任务门槛未跨档。

目标读取优化后再次按真实tsconfig内存编译三包，仍35/8/11根、0诊断；实际目录准入仅查询平台和目标Core的原账及结构，另一Core结构读取抛错不影响目标准入，全组合升级检查仍报告该错误。原checksum/缺收据/unknown/failed/rolled-back/重复、平台未完和目标缺观察的相关路径复验退出0。

原 `node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs`退出0，8组通过，skip/todo为0，临时编译/夹具由原after删除并核实不存在。七份相关文档的本地链接/锚点/表格和旧阶段正文保全检查退出0，格式检查退出0；正式需求/任务未改，门槛仍8.33%。本片新增测试脚本、常驻临时目录、依赖安装、生成客户端和后台进程为0。阶段中文提交普通推送当前任务分支并读取真实远端，固定版本由包含本阶段记录的提交定位；实际数据库/宿主运行及主线集成未验。

<a id="core-tickets-first-setup-20261115"></a>

## 工单首次设置与标准绑定页面消费（2026-11-15）

原公共服务端窗口核对固定 `32e4202cb1b31c121a857720d36ae56b527d555f` 已上传并回读，main仍62ca。本次自动续接没有收到对上一轮公共文件窗口问题的回答，沿独占admin/core、Core合同和工单样例继续完成可独立交付的实际接入缺口，不进入原Auth/Guard/AppModule/shared总出口或main活动WIP。

[useCoreBinding](../../../apps/admin/src/core/useCoreBinding.ts)消费原绑定/当前事实/收据HTTP，先核当前租户管理权、成员Core使用权与实际绑定，首次配置调用原服务，已有绑定直接复用。未知结果保留原键只读核对，sessionStorage仅保存Core/容器/operationId，不保存初始化配置或权限；范围/身份代次变化拒绝旧响应，同步双击共用一个Promise。当前绑定跨租户/范围拒绝，成功刷新绑定后仅将范围查询标脏，下一访问重新核实际就绪，避免设置响应途中重挂旧页。

[工单设置页](../../../packages/example-tickets-core/admin/index.tsx)作为第四个页面贡献，声明purpose=configuration并给出中英文单源名称，使用CorePage原主按钮；工单无额外配置，首次设置只调用平台绑定。未获租户管理权不提供写入动作，已设置返回工单导航；未知只提供原设置读取。主路由/Guard仍未装配，不能称完整可运行工单接入。[源码索引](../../../packages/core-contracts/src/repository-index.ts)同步解析正式CorePageText，配置页双语名称和purpose准确可发现。

stdin必要类型：Core合同35根、工单11根、前端3指定根/1,491源0诊断。真实Hook源码经离线输入核一次初始化、重入只读/缺收据不重发、不保存配置、原收据匹配、已有revision=7不重新初始化、同步双击同Promise、会话切换拒旧结果和管理撤权均通过；两个独立新操作各发送1次，原结果读取2次，没有真实HTTP/DB/浏览器。早期核对将同步拒绝当Promise拒绝、脚本module变量遮蔽及顶层await格式误用退出1，修核对脚本后通过，产品业务校验/原断言未放宽。

工单四页按原registerCoreAdminPages核对，设置purpose/英文标题、首次初始化动作、未知仅原收据和已有绑定导航通过；登记不执行业务。当前实际索引4,486条、issues0，3,632条缺直接用途说明及5条动态元数据仍保留。配置路径准确为 `/cores/example-tickets/setup`，注册状态仍source；无Core全平台源码/运行/接口验收未完成。

实际短说明同步平台绑定Hook和工单“开通→成员分配→首次设置→业务”路径，原三页旧锚点保留。主公共文件窗口仍是后续独立宿主必要条件，上一轮已交付具体范围待负责人/PM核定，不重复索取权限或跨对话通知。当前PCH门槛未跨下一档，验证经stdin/内存，不新增测试脚本、服务或生成环境。

原8组合同测试退出0、skip/todo为0；六份相关文档564个链接/136个章节锚点定向核对退出0，新增问题0，正式需求/任务百分比不变。差异格式检查退出0，原测试临时编译/夹具已清理确认，其他新增临时目录/服务进程为0。阶段中文提交普通推送后读取真实远端固定版本。

<a id="core-package-cli-public-entry-20261115"></a>

## 固定工单包命令实测与下一公共服务端入口（2026-11-15）

工单包及Git根定位固定于 `9a31c9c08c6b9478f491c6b18d173a02d2015568`、`b7e95bd13562f752ff48dd6f2983061c7c2a5c2b`，均已普通推送并读取真实远端确认。当前main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。按固定b7e版本对实际编译文件和正式包元数据完成独立Node子进程核对，没有用facade成功替代本次命令结果。

在本树唯一 `output/.tmp/example-tickets-package`编译合同35根和工单11根，0类型诊断；临时contract包保留原package.json/相对exports，不复制依赖。实际执行metadata package、prepare-install、重复prepare-install及check --host --json均退出0，重复输出同一包退出1/EEXIST且原包保留。完整工单包30文件、35,640字节，SHA-256为 `785ff9c6e7a87f07df5c68ef0ef6301295dc39f58b4eeca8b4067f023ae895cd`，Core/底座来源固定b7e，README/手册引用固定源码。准备状态仍为pending，不是运行安装、租户授权或真实业务验收。

第一轮子进程核对的临时包布局误将exports改成绝对路径，Node返回ERR_INVALID_PACKAGE_TARGET，退出1；只修临时布局为真实包内相对出口后复验通过，产品包元数据未改。失败的101文件694,348字节、成功的131文件903,322字节均在同一任务目录finally核绝对归属/无链接后删除，并确认目录不存在；没有累计环境、重复压缩包、node_modules或进程。

### 需要核定的公共服务端窗口

当前非冲突实现已提供统一原应用/Nest装配、HTTP政策、授权/绑定/原结果、本人Core目录/真实范围和页面接入；继续创建脱离原主应用的入口不能完成PCH-03。正式依据和当前接续均要求公共文件由唯一作者持有，当前未收到新的窗口授权。下列范围是根据main62ca源码核出的下一实施入口，不是已经修改或取得写入权。

| 公共文件与原方法 | 已核实际依赖及应交付的行为 |
| --- | --- |
| [PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts)：findUserForLogin/findTenantByCode/getTenant及原账号/会话映射 | 登录和公共租户读取仍include rentalProfile/category，租户摘要还统计Rental订单。先抽公共身份/租户投影及人员/会话仓储，Rental档案/空间/订单由显式业务适配补充，保留原password/账号状态/角色/撤权/审计和旧调用者行为 |
| [PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)：findUserForLogin/findTenantByIdForAuth/listUserWorkspaces/resolveSessionWorkspaceId及bootstrapTenant | 原通用服务仍注入Rental、持有演示品类/权限并在初始化中调用Rental。公共身份和租户创建须可不加载行业表/Seed；原Rental初始化走显式Core绑定与同事务适配，不能把原回调改可选成功或用合成空间补运行 |
| [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)：login/issueSession/buildLoginResponse/getSessionContext/resolveAccessContext | 原签名/会话/轮换继续复用。品类、空间和capability组装拆为Rental贡献；无Core operator会话合法且公共设置可用，staff/client仍按原专用身份，旧wid/会话切换、撤权及旧Rental角色映射不放宽 |
| [ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts)及[请求身份](../../../apps/api/src/common/request-identity.ts) | 当前普通请求默认用Rental空间user，新Core公共管理/业务须使用原同一签名上下文的tenantUser，并保留原accessSession/wid一致性。精确消费Core管理政策、会话GET、范围POST及http注册目录；未知路径/分面拒绝，原Rental/locationScope政策继续原位 |
| [共享平台合同](../../../packages/shared/src/platform.ts)/[包出口](../../../packages/shared/package.json)/[shared总出口](../../../packages/shared/src/index.ts) | 平台文件仍含行业枚举并type-import core。独立平台身份/租户/人员合同从唯一原声明抽取，旧出口兼容再导出，独立构建用正式中性出口，不复制DTO或按类型检查使用私有路径 |
| [AppModule](../../../apps/api/src/app.module.ts)/[OpenAPI总组合](../../../apps/api/src/contracts/openapi-document.ts) | 原根模块仍直接登记行业Controller/作业及原服务。以原实例的明确模块出口装配CoreHostModule和选中业务HTTP，统一消费同源OpenAPI，无Core不加载未选Core或行业作业；避免子模块重复创建Auth/DB或循环引用 |

主schema/迁移/Seed的全量抽离、前端AppShell/AppRouter/navigation及主品牌/UI活动WIP属于后续单独窗口，当前不抢改。上述服务端窗口取得后，先交公共投影/接口与Rental兼容转接，再推进独立模块/构建，随后原Guard/装配接线；真实数据库/服务/浏览器、迁移执行及合main仍按目标环境另行授权。原任务、前置和验收不因窗口准备而改变。

此处仅补本片实际命令证据与公共依赖，需求/任务百分比保持8.33%的原G1登记。本轮未主动跨对话发消息，完整范围留原记录和接续供负责人/PM读取；没有把PM的历史窗口或他人活动HEAD当新授权。

四册516个本地链接/130个章节锚点定向核对退出0，新增错误0；正式需求/任务正文和8.33%门槛登记不变，差异格式检查退出0。当前任务树新增验证临时目录已全部删除、无新增服务进程，未触碰main索引或后台作者WIP。证据/接续随本阶段中文提交普通推送并读取真实远端确认；共享服务端作者窗口仍需负责人或PM对当前具体范围核定。

<a id="core-tickets-package-20261115"></a>

## 实际工单标准包、同源资料与待部署准备（2026-11-15）

移除预检片固定 `7f7ea9634574683757d88c662324ed234da63ee5` 已普通推送并真实回读，main仍62ca。本片以实际工单编译产物验证标准包，不使用原格式夹具代替业务样例。源码/合同独占范围及现有版本/迁移保持，未发布正式发行。

[packTicketsPackage](../../../packages/example-tickets-core/src/package.ts)按唯一清单收集实际编译入口、后台TSX、迁移和许可，生成固定来源清单、同源OpenAPI和CORE_GUIDE.md。包README的源码/底座相对链接转换为固定源码引用，原README不另写一份。Node专用出口与CLI不进入领域运行入口，Core业务不因打包加载Node文件系统/归档依赖。

[metadata package](../../../packages/example-tickets-core/src/metadata.ts)增加同源标准包命令，pack:core前置构建当前Core/合同并检查固定提交与当前源码差异，拒绝未提交源码冒充发行。新.tgz使用wx写入、输出父目录无链接，失败不覆盖原包；准备仍沿平台同一inspect/archive/prepare链，结果准确为deployment=pending。最短命令及独立发行调用说明写[示范README](../../../packages/example-tickets-core/README.md#构建与打包)。

stdin内存类型退出0，Core合同35根/宿主7根/工单11根0诊断。实际编译集合形成30份声明文件，最终35,617字节标准归档，相同输入两次SHA-256相同；全部正式exports入口存在，迁移摘要一致，标准包静态检查通过。固定任务册生成的模板实际正文存在，包README无失效本地相对源码链接。最初额外断言误要求生成指南保留任务册内部core-agent-template锚点而退出1，核原生成器明确只抽正文后按真实模板正文复验通过，没有修改产品规则或已有测试掩盖失败。

实际packTicketsPackage→标准archive读回→prepareCoreInstall在本树单一 `output/.tmp/example-tickets-package`完成，prepared→同包already_prepared核字节复用；篡改已准备README拒绝覆盖，缺dist/http.js拒绝打包。没有网络、业务模块执行、迁移或运行安装，包完整性不等于干净宿主已授权可用。本次仅测编译包及待部署文件准备，真实GitHub发行/下载、主宿主/Guard、实际数据库/浏览器和独立接手继续待验。

临时目录只含本次stage/pending文件，finally核真实绝对路径/普通文件/无链接后删除并确认不存在，未保存重复整包、依赖或环境。打包节点源码纳入现有样例正式出口，不新增测试运行器/脚本；代码/API/简单手册随片更新。当前PCH门槛未跨下一档，固定来源字节为本次工作区核对输入而非正式发布包，最后提交后需按该固定来源再构建。

Core合同/宿主/示范包补正式typesVersions，Node10/CommonJS和NodeNext从实际包exports元数据解析；35/7/11根编译以发布元数据定位，私有Core别名为0。CLI通过stdin文件facade核单份JSON、源码差异先拒绝、wx新包写入及写失败清理，退出0，facade与真实包/prepare证据分别记录。最后一次包验证的57份临时文件294,913字节已删除并确认；未复制依赖或安装工具，package-lock的依赖元数据不变。

原8组合同测试退出0、skip/todo为0；六份相关文档591个链接/142个章节锚点定向核对退出0，新增问题0，原需求/任务及百分比保持。差异格式检查退出0。固定成果随中文提交普通推送，真实远端回读后继续按该提交准备正式发行，当前没有真实GitHub Release或运行安装验收。

后续实际隔离构建核对准备中，将metadata包命令的仓库根定位改为git rev-parse --show-toplevel，避免自定义编译目录依赖两级父路径假设。stdin命令facade核固定Git原文和根定位退出0；不改打包/授权语义，源码根变更随本阶段补充提交上传，真实子进程验证在该固定提交后进行。

<a id="core-removal-preflight-20261115"></a>

## Core移除依赖预检与原SaaS身份复核（2026-11-15）

HTTP政策片固定 `d34db2491f140e54bd7e9c0fa52183459642feb2` 已上传并真实回读，main仍62ca。本片按原05生命周期范围实现只读移除检查，沿独占合同/宿主/API Core适配提供实际消费者；不把部署级移除与租户停用、成员撤权或订阅到期混同。

[CoreRemovalService](../../../packages/core-host/src/removal.ts)汇合Core自有assessRemoval和平台准入/任务/回调/作业/历史依赖观察。缺Core检查器、准入accepting/unknown及平台依赖未完整核对都blocked，原结果不得借超时/无活动进程推断未执行。错误结构/错误Core原操作拒绝。只有stopped、完整及零阻碍时clear；clear是当前只读预检，不执行停新/排空/删除/迁移或授权部署。

[正式观察合同](../../../packages/core-contracts/src/lifecycle.ts)复用原blockers并增加平台观察及预检投影，HTTP/OpenAPI增加十一管理操作中的removal/read。[原reader](../../../apps/api/src/modules/core-host/original-core-removal.ts)在检查前后复核原SaaS主体及租户管理权，跨Core检查不持人员锁；应用工厂只在真实platformRemoval Source提供时组合，缺依赖Controller503，普通业务不被迫安装空适配。

stdin内存类型/实际服务与原主体核对退出0，合同35根、宿主7根、HTTP4根0诊断。缺检查器blocked、完整停新无阻碍clear、unknown/未停新/不完整多阻碍、错误贡献/异Core原操作拒绝通过；平台当前观察在Core检查后读取。原SaaS ALS/主体检查前后8次原账号读取、SQL/审计写入0，检查中角色撤回拒绝，缺平台reader503通过。OpenAPI十一操作同源生成，返回clear的限制明确写入资料。

真实平台排空、停止新准入、AI/回调/作业/历史各所有者的完整依赖Source、实际数据库/HTTP和部署移除尚未完成。工单未提供移除检查器时准确blocked，不写恒真检查。原完整API类型仍沿前片审批拒绝边界，当前PCH进度未跨下一档，主共享入口授权未扩大。代码及短说明同片维护，验证经stdin/内存无新增测试脚本或运行环境。

原8组合同测试退出0、skip/todo为0；七份相关文档607个链接/138个锚点定向核对退出0，新增问题0，正式需求/任务及百分比不变。差异格式检查退出0，原测试临时编译/夹具已清理核实，无新增进程或生成环境。固定成果随包含本节的中文Git提交上传，并以真实远端回读确认。

<a id="core-http-policy-registration-20261115"></a>

## Core HTTP政策标准登记与原身份准入（2026-11-15）

统一应用工厂固定 `d32735f01dabf5a148c29b281285e596c837d480` 已推送并真实回读，main仍62ca。本片沿独占Core合同/宿主、工单样例及API Core适配，将新Core HTTP方法/权限政策留在Core自身合同，避免每次业务开发修改底座Guard判断。

[HTTP政策合同](../../../packages/core-contracts/src/http.ts)定义Core/版本及自身路由、audiences、精确权限、business/original_receipt和新业务标记。registerCoreHttpRoutes只登记当前贡献，未知路由/分面不返回政策；重复、版本不符、权限未声明和同形/静态参数重叠拒绝。匹配沿原Express大小写与隐式HEAD，GET/HEAD重叠禁止；返回目录隔离副本、方法在组合后固定。旧Rental例外继续原兼容政策，不能由新Core自行占用。

[工单TICKETS_HTTP](../../../packages/example-tickets-core/src/http.ts)同时生成七条HTTP政策和[同源OpenAPI](../../../packages/example-tickets-core/src/openapi.ts)扩展，创建为新业务，收据为原结果读取，其余沿原业务。Nest方法/参数/schema及工单领域行为保持，没有额外手写权限表。

[实际部署目录](../../../packages/core-host/src/deployment.ts)接受可选HTTP贡献并核当前Core/版本/声明集合；没HTTP的Core可以省略，未登记路径仍拒绝。原应用工厂供给该同一目录及[authorizeHttp](../../../apps/api/src/modules/core-host/original-core-http-access.ts)，主Guard在原签名/ALS后消费当前租户主体、精确角色权、Core/成员授权及原订阅停新。原结果粗准入不要求重开业务，最终本人操作和对象可见性仍交原Core收据服务。当前只实现operator，staff/client需自身固定身份适配，清单不自授权。

stdin内存类型与实际合同/原主体调用退出0：合同35根、宿主6根、工单10根和HTTP4根均0诊断。7条工单HTTP/OpenAPI权限/分面/用途/新业务元数据一致，空目录/错误Core/版本/未知权限/路径/分面、重叠GET/HEAD及目录外部修改拒绝通过。末尾控制字符不匹配，GET的HEAD沿同一权限。

沿实际原ALS/主体/授权/订阅适配的离线SQL驱动，正常新建、过期新建403、旧只读、停用仅原收据、角色撤回和未知路由在SQL前拒绝均通过；31次SQL读取、2次新业务期限读取、SQL/审计写入0。原收据最终范围由工单原服务继续核定，当前没有真实Guard调用或DB/HTTP运行证据。

模块说明同步最短Core贡献和宿主接入步骤。主Auth/Guard、AppModule、数据迁移账及后台壳仍待已登记公共窗口；不以政策存在替代已接线接口，不改原业务、AI专项或原任务范围，当前PCH进度未跨下一档。验证经stdin/内存，没有新测试脚本、临时目录、服务或模型调用。

原8组合同测试退出0、skip/todo为0；八份相关文档621个链接/139个章节锚点定向核对退出0，新增问题0，正式需求/任务和已登记进度不变。差异格式检查退出0，原测试临时编译/夹具已删除确认，未新增生成Client或后台进程。中文提交/任务分支普通推送后读取真实远端固定版本。

<a id="core-application-assembly-20261115"></a>

## 原Core应用统一装配与Nest依赖可见性（2026-11-15）

原G1复核固定 `a64aa357ac72bb62085558fe58816dea79260a44` 已上传并回读，当前main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片沿原API Core适配独占范围实现真实应用组合；原AppModule、Auth/Guard、主schema及后台壳公共窗口未扩大，其他作者WIP保留。

[composeOriginalCoreApplication](../../../apps/api/src/modules/core-host/original-core-application.ts)组合已有原管理、绑定、当前事实、SaaS目录、成员目录与范围读取，统一使用原数据库、人员仓储、订阅、审计和一个受控部署目录。组合期间无数据库查询、初始化或作业启动。行业业务仍在所属Core组合，通用装配不自动引入工单/Rental。

[CoreHostModule](../../../apps/api/src/modules/core-host/core-host.module.ts)将三个Controller装配到原Nest容器，单一工厂提供同一应用实例；子provider从该实例取得管理、成员目录和范围reader。CoreManagementHttpApplication改为公共Core应用服务的必要方法集合，HTTP层不依赖原ORM适配的ReturnType。原三个单独DynamicModule入口仍可用，不与总模块重复挂相同Controller。

实际核出Nest模块可见性要求：父AppModule的本地provider不会自动供给子模块。主窗口须将既有原实例通过导出模块提供给CoreHostModule的imports/inject，不能另建Auth/数据库/审计，不能把原类名存在视为已装配。实际短接入例子及边界已写[本模块说明](../../../apps/api/src/modules/core-host/README.md#从一个应用工厂装配)。

| 必要验证 | 实际结果及边界 |
| --- | --- |
| `node --no-compilation-cache -`内存类型 | 退出0；Core合同34根/宿主6根/HTTP模块4根580源0诊断，HTTP闭包不读取原Prisma模型；全API类型仍沿此前审批拒绝保持未验 |
| 实际Nest TestingModule容器与三Controller | 退出0；应用工厂1次，Controller3个解析到同一实例；管理/会话/范围调用传递正确，缺原依赖导出时明确解析失败；容器close完成，没有监听HTTP端口或启动服务 |
| 实际原应用工厂/原ALS/主体与离线事务输入 | 退出0；组合时数据库/用户读取0、写入0；实际原主体链9次账号读取、25次SQL读取、SQL/审计写入0；空Core会话、SaaS目录、当前事实和原收据缺失准确，租户访问SaaS目录403 |

上述运行只读复用已锁定依赖，Prisma仅使用原runtime SQL模板，没有生成/读取别树Client、连接真实库、读取环境文件或启动服务。测试/核对经stdin和内存编译，未新增测试脚本和一次性磁盘目录。原全API离线生成审批拒绝、主Guard接线、主模块服务导出、原授权/绑定迁移账、完整无Core运行、Rental兼容和实际浏览器仍待后续公共片，当前原PCH进度未跨下一档。

五份相关文档514个链接/124个章节锚点定向核对退出0，新问题0；正式需求/任务与原进度不变，差异格式检查退出0。没有临时目录、进程或生成客户端产物。本片固定版本由包含本节的中文Git提交定位，任务分支普通推送后读取真实远端确认。

<a id="pch-identity-page-gate-20261115"></a>

## 身份与后台页面原G1门槛复核（2026-11-15）

声明路由片固定 `3cc35e9050dd58381d54ec0d1708e85e58faa613` 已普通推送并实际回读一致，main62ca已在本树。按原G1“获准实施后完成该项真实接点/消费者及可实施合同复核”核收04/07各25%。这不是G2主实现或G3正式装配完成，原A03/A07和完整专项验收仍未收口。01/02原G1保持，12项等权覆盖率从4.17%更新为8.33%；任务ID/范围/依赖/顺序和每档25%不改。

| 原任务 | G1固定证据与真实消费者 | 未跨下一档的缺口 |
| --- | --- | --- |
| PCH-04 | [原Auth/Guard/ALS及数据连接](#core-ownership-baseline-20261114)、[原主体/当前管理权](#core-original-management-20261115)、租户授权/成员分配及原收据的唯一合同与MySQL应用服务、[当前成员目录](#core-session-directory-20261115)、[Core范围读取](#core-scope-readiness-20261115)和工单真实主体消费已可定位；原audience/租户/会话/角色、目标成员、Core命名空间及返前复验均有正式接点 | 原Auth/Guard消费租户公共主体与新Core路由、Rental存量映射、实际迁移/部署、API/客户端/作业/AI直接URL的完整正常/拒绝链和所需真实环境未完成；G2/G3/G4不凭独立适配通过提前判定 |
| PCH-07 | [原后台壳/导航/缓存消费者](#core-ownership-baseline-20261114)已定位；独占CorePage/Route消费原PageHeading/WorkspaceHeader和ActionButton/SaveButton/ConfirmAction，授权面、会话/范围Hook、[单源菜单/面包屑及详情参数](#core-declarative-routes-20261115)和工单三页面按同一正式合同核对；普通业务/配置purpose及来源/授权/就绪分别表达 | 原壳/Rental/AI静态依赖抽离、主Router/菜单/面包屑/租户账号页挂载、发现安装与版本界面、无Core真实登录和公共设置保存、中英文/窄屏/Portal/回车/异步动作实页及完整验收未完成；不把局部React消费者当全后台主实现 |

03尚缺实际无Core公共宿主及选中Core构建配置的完整合同/消费者复核；05/06尚缺排空/移除、事件作业/回调、文件ACL等公共接点消费；08/09尚缺Rental真实重新装配和可选AI隔离；10/11/12的样例/资料虽随片准备，其干净组合、独立接手/更新/完整兼容和原审查仍有直接缺口。本次不按新增代码/测试数提高这些任务。

当前Guard精确缺口已核源码：`requiredPermissions`未消费十条Core管理合同，SaaS允许路径也未登记；Core会话GET和范围POST须作为原已登录operator自助政策精确登记。`canActivate`当前普通请求选择accessContext.user（Rental空间角色），Core公共管理应使用同一已签名上下文的tenantUser并保留accessSession/wid一致性、撤权与未知路径拒绝。旧Rental仍沿原空间和locationScope，不借Core接口放宽。所需Auth/Guard窗口和下面装配表由PM核定唯一作者，当前没有抢改共享文件。

主装配需把Core管理、会话、范围三个DynamicModule与真实原服务/部署锁组合；工单HTTP另按其七条操作登记，OpenAPI总组合消费对应单源生成器。DB最小片仅登记平台Core授权/绑定独立迁移账和选中工单迁移，不重放原历史SQL或执行Seed。前端最小片为原Routes展开createCoreRouteElements、原壳消费coreNavigationEntries/coreBreadcrumbEntries、原租户/账号页挂载授权面；原AppShell/BusinessShell/PageHeader/designTokens等在main仍有后台作者WIP，需先固定作者交接。

本次仅门槛复核及原三册当前现场同步，没有新业务源码、生成环境或服务操作。固定记录提供证据与缺口，不扩大共享文件授权。正式任务日常仅更改有据百分比及汇总。

四册485个链接及121个章节锚点定向核对退出0，新增错误0；12任务的ID/交付/前置/需求/验收列与前一固定版本一致，仅04/07百分比及算术汇总更新。12项等权 `(25+25+25+25)/12=8.33%`，正式验收仍0/12。差异格式检查退出0，无新增临时文件/进程，文档阶段中文提交及任务分支普通推送并回读真实远端。

<a id="core-declarative-routes-20261115"></a>

## Core路由、导航与详情参数的声明消费（2026-11-15）

范围就绪片固定 `756a53ed34b370ce9edf9ee1131c65e71c321fe1` 已普通推送并真实回读，main仍62ca。本片沿独占合同/admin/core及工单样例消费现有Router、会话和范围Hook，不改AppShell/AppRouter/navigation等原公共文件。

[createCoreRouteElements](../../../apps/admin/src/core/CoreRoutes.tsx)从受控页面登记生成原Route元素，先核本人Core/页面权限，再读真实范围和就绪。无权/失败不挂载业务正文，普通业务要求ready；Core可明确声明自己的configuration页面，在已获权且范围读取成功的未绑定/缺配置状态进入，动作和正式写入仍独立授权。主壳、PageHeading/WorkspaceHeader及原按钮继续使用，不创建第二套后台框架。

原Router匹配的登记参数通过可选routeParams和CorePageHost.params提供，真实binding通过同一host提供。当前授权修订、角色权限、绑定、容器和路由对象进入业务代次，变化时清理旧页动作/表单。工单 `createTicketsAdmin()`默认详情直接读取登记ticketId，不再要求作者手写宿主详情注入；旧可选详情组件仍兼容。

[导航生成](../../../packages/core-contracts/src/navigation.ts)从同一页面名称/菜单/父级及当前本人Core权限生成菜单和面包屑。参数详情不直接成为菜单，未获权Core不出现，父页无权仅显示名称不带链接。配置purpose进入同源开发资料；正式页面声明没有执行JSON表达式或另存一套菜单字段。

stdin内存编译/实际合同及路由调用退出0，Core合同34根、工单10根和前端3指定根/1,489源类型0诊断。无/已获权Core菜单、同源父级、无权父链接去除、已匹配详情参数、真实绑定供给、绑定修订变化更换页代次、无权不挂业务、未绑定配置页可进入及失败范围不挂载均通过。实际调用的是源码的原Route元素和适配方法，运行器只提供离线Hook输入；没有真实浏览器、主装配或Portal/Router宿主证据。

模块说明提供最短宿主装配与Core详情用法，主公共窗口仍须一次性消费新Route元素及导航/面包屑，不将新增Core的业务接入责任下放为修改底座内部。完整后台壳/无Core登录和设置、原Rental兼容、真实数据/浏览器与独立接手仍未完成，后续原任务门槛不凭本片代码增加。

原8组合同测试退出0、skip/todo为0；七份相关文档575个本地链接/125个章节锚点核对退出0，新增错误0，正式需求/任务正文保持。差异格式检查退出0，原测试临时编译/夹具已删除核实，没有新增测试脚本或服务进程。固定成果由包含本节的中文Git提交定位，任务分支普通推送后读取真实远端确认。

<a id="core-scope-readiness-20261115"></a>

## Core自身范围与真实就绪读取（2026-11-15）

会话目录片固定 `e127cef166395c6bdfa6ffb3a9142ac518208ffe` 已普通推送并回读一致，main仍62ca。本片按原02/04/05/07接点，在原独占合同/API Core适配/admin/core交付范围/就绪读取，公共入口窗口未扩大。

[范围合同](../../../packages/core-contracts/src/scope-http.ts)和服务端CoreScopeResolutionSchema提供唯一输入/输出及同源OpenAPI。当前operator只传Core及可选自身容器，原租户来自会话；unbound与真实bound/readiness分开。Core范围结构、历史绑定数据版本和就绪结果均沿正式合同验证，不使用静态清单或恒真适配证明业务可用。

[原范围组合](../../../apps/api/src/modules/core-host/original-core-scope.ts)在短事务先核原会话和当前Core/成员使用权，结束锁事务后调用Core自有resolveScope/readReadiness，再复核当前身份、授权和绑定。Core的绑定必须属于当前租户/范围，读取期间绑定修订/数据版本变化返回冲突。Core可能自持事务，跨该调用不持外层人员/授权锁，避免现有工单范围适配嵌套死锁；最终业务调用仍独立复验。对应[Controller](../../../apps/api/src/modules/core-host/core-scope.controller.ts)和OpenAPI只提供读取，不执行初始化。

[useCoreScope](../../../apps/admin/src/core/useCoreScope.ts)与原HTTP复用原认证/会话代次及范围查询键；响应不符当前租户/Core/容器明确拒绝。未验证或失败读取不返回旧绑定/ready，真实绑定且Core声明ready时才给出ready；页面角色仍由useCoreSession判定。相关模块说明和短接入用法同片维护。

stdin内存编译/实际组合定向验证退出0，合同33根/宿主6根类型0诊断；ready/配置缺项/未绑定、缺成员在调用Core前拒绝、跨租户/错误容器/异范围绑定拒绝、绑定并发变更冲突、未知范围结构及错误就绪贡献拒绝通过。Core调用均在父锁事务之外，11次绑定读取/11次lease复核；补充历史绑定0.2.0超出当前可读范围的拒绝通过，没有真实DB或业务写入。

前端正式Core入口2根/1,484源0类型诊断，Hook实际调用的ready、未验证/失败隐藏及异租户响应拒绝通过。开发索引当前4,458条、issues0，3,611条无直接用途和5条动态元数据缺口保留；新范围POST标记source。原完整API离线生成被审批拒绝的前片边界继续保留，当前Controller只做语法/登记定向核对，没有新完整API类型或浏览器证据。

下一公共入口为CoreScopeHttpModule.register(reader)、原Guard对应精确只读政策、OpenAPI总组合及主后台壳/路由消费当前目录、范围和就绪。无Core真实独立构建/登录/保存、完整Rental兼容、生命周期及独立接手仍未完成，不以新包和离线结果提升原后续任务门槛。

原唯一8组合同测试退出0、skip/todo为0；七份相关文档571个链接及120个章节锚点定向核对退出0，新增错误0，正式需求/任务正文保留。差异格式检查退出0，合同临时编译/夹具已由原after删除并核实；没有新增一次性脚本、进程或生成环境。本片固定版本由包含本节的中文Git提交定位，普通推送后读取实际远端确认。

<a id="core-session-directory-20261115"></a>

## 登录成员的Core目录与管理候选（2026-11-15）

授权管理片固定 `f97bb4c220100bf9c22c76428170077c116706c6` 已推送并读取实际远端一致，main仍62ca。本片继续在原独占Core合同、API适配和admin/core提供登录后目录消费，不修改原Auth/Guard、主装配、schema和后台作者WIP。

[会话目录合同](../../../packages/core-contracts/src/session-http.ts)通过正式出口提供当前租户/成员、已开通且本人获分配Core、原授权修订、精确业务权限及租户管理分配候选。只读GET不接收客户端主体字段；空Core目录合法。新增`canUseCorePage`只判断成员使用权与精确页面权限，数据范围/绑定/业务就绪仍由自身宿主接点核验。OpenAPI从同源schema生成，现有十个管理操作保持。

[原会话读取](../../../apps/api/src/modules/core-host/original-core-session.ts)复用OriginalCorePrincipalAuthority及原人员/角色锁，本租户授权和本人分配按复合条件读取；只登记获权Core，不返回平台通配符或其他Core权限。当前租户管理者另外读取已开通Core的分配候选，候选不是本人业务权。返回前复核同一会话及权限，等待期间撤回管理/业务权限会收窄输出。空受控组合不查询Core授权表、写入为0。[独立Controller](../../../apps/api/src/modules/core-host/core-session.controller.ts)由CoreSessionHttpModule.register(reader)装配。

[useCoreSession](../../../apps/admin/src/core/useCoreSession.ts)和[原HTTP消费](../../../apps/admin/src/core/management-client.ts)把当前目录接到原认证/查询缓存；tenant/member/session代次进入查询键，未验证会话和失败读取不暴露旧目录供页面授权。后台可据准确目录提示联系SaaS开通或联系租户管理者分配，Core配置/就绪另核。原AppShell/AppRouter仍需按公共窗口消费，目录源码存在不表示无Core后台已经实际运行。

stdin内存编译/实际函数调用退出0，合同32根0诊断；本人Core/精确页面权限、管理候选隔离、返回前撤权、成员撤回隐藏、空组合不查询Core表均通过，8次授权SQL读取、5次原lease返回前复核、写入0。OpenAPI生成及严格错误范围核对通过。原会话authority沿已验证实现复用，当前新reader验证使用离线事务输入，没有真实DB或新API全量类型证据。

前端正式Core入口2根/1,482源类型0诊断；单源GET路径与Hook核对退出0，未验证/失败读取均隐藏目录，精确权限判定成立。实际开发索引重新读取4,451条，issues0，5条动态元数据及3,604条无直接用途说明继续待整理；新GET明确标记为source，未冒称主应用登记。现有测试脚本未新增，验证经stdin内存运行，没有创建临时环境或进程。

下一公共接点为原Guard显式登记当前GET自助政策、AppModule提供原reader、OpenAPI总组合消费同源生成器、后台主路由/菜单消费当前Core目录及实际绑定/就绪。完整API离线生成仍沿前片审批拒绝边界保持未验，真实数据库/浏览器/无Core运行、完整Rental兼容和独立接手仍未完成，原PCH进度未跨下一档。

原8组合同测试退出0、skip/todo为0；七份相关文档559个链接和118个章节锚点定向核对退出0，新增错误0，正式需求/任务正文保持原值。差异格式检查退出0，原合同临时编译/夹具由原after删除并核实，本片无新增临时目录或进程。固定提交由包含本节的中文Git提交定位，普通推送后读取真实远端确认。

<a id="core-access-panels-receipts-20261115"></a>

## Core授权管理面与原操作只读核对（2026-11-15）

索引覆盖/部署快照片固定 `6ccf30ab8ef52df83db4a49e17af17330f3ef885` 已普通推送并读取真实远端一致，main仍62ca。本片沿已授权的独占core-contracts/core-host、API Core适配与admin/core施工，主壳/主路由/AuthGuard/AppModule/原schema未取得新的公共窗口。

[管理服务](../../../packages/core-host/src/access.ts)新增租户授权和成员分配两种本人原operationId读取，复用同一当前管理lease。原主体、目标租户/Core、成员、操作类型与原键分别核对；已停用的部署不要求重新开通才能查原结果。MySQL只锁已有锁行并读原收据，不创建锁/事实/收据/审计。`unavailable`只表示原结果暂未取得，不证明未提交。两个新HTTP输入/输出在[单源合同](../../../packages/core-contracts/src/management-http.ts)定义，[Controller](../../../apps/api/src/modules/core-host/core-management.controller.ts)和OpenAPI生成器同步消费，现有八条路径保留，增加两条原结果读取。

[CoreAccessPanel](../../../apps/admin/src/core/CoreAccessPanel.tsx)提供可嵌入原租户资料和成员资料的两个聚焦管理面，通过[正式admin/core出口](../../../apps/admin/src/core/index.ts)供宿主消费。可见面沿原已验证会话/SaaS或租户管理权；先读当前事实及修订，开通/分配使用原ActionButton，停用/撤回使用原ConfirmAction。按钮成功只来自真实Promise，原结果和当前状态分开显示，不复制样式或加第二个路由离开拦截器。

[管理HTTP消费](../../../apps/admin/src/core/management-client.ts)复用原认证/刷新/信封和当前会话代次，发送前解析输入、读取后解析响应。页面发送前保存原请求定位到本标签sessionStorage，以原主体/租户/对象/Core隔离；缓存不授予权限。网络/未知结果后只读原操作，刷新或重新进入恢复核对引用；收据暂缺继续锁住新的变更，匹配原键/对象/修订/状态后清除引用并另读当前事实。明确提交前拒绝才解除本次核对引用。主应用没有原宿主接线时不能将面板显示为可办理。

| 必要验证 | 实际结果及边界 |
| --- | --- |
| `node --no-compilation-cache -`合同/宿主内存类型与真实MySQL适配读取 | 退出0，31/6根0诊断；原结果两种读取、缺收据、异主体/异成员拒绝和当前管理撤权通过，10次SQL读取、3次lease返回前复核、写入0、审计新增0；没有真实数据库连接 |
| 同源HTTP/OpenAPI及Controller定向核对 | 退出0，十条原合同路径和Controller登记一致，OpenAPI十操作同源生成；Controller语法0诊断，完整API新版本类型未取得 |
| admin/core正式消费者类型闭包 | 退出0，2个指定根/1,480源0诊断；先前稀疏Vite声明解析缺失和查询联合类型/HTTP方法大小写错误已定位并修复后复验，未放宽类型或删除规则 |
| 原源码经stdin内存编译的HTTP与组件调用 | 退出0，错误/跨租户字段/迟到会话/预中止零调用验证通过；网络未知只发送1次，页面重建只读核对，缺收据保持引用，第2次原收据匹配后清除引用并刷新当前状态1次；当前权限撤回呈现拒绝，实际浏览器未验 |
| 原唯一合同测试 | 退出0，8组通过，skip/todo为0；没有新增或扩写测试脚本，原临时编译/夹具已删除核实 |

全API离线Prisma生成/类型及退出清理的单一命令在启动前被自动审批拒绝，返回`blocked by policy`，无进程退出码；`output/.tmp/core-management-receipt`未创建并已核实。本片不换壳、替换生成器或使用主树生成Client绕过拒绝，完整API类型保持未验。antd技能的CLI在本机未找到，按本轮禁止安装规则改读已锁定6.6.0类型和现有适配源码，不安装/升级工具。

主Guard、AppModule/OpenAPI总组合、实际存储/迁移账、原租户/账号页挂载、当前获权Core目录与绑定配置页、真实浏览器/数据库/无Core运行仍有缺口。当前面板输入来自实际目录，不提供自造默认Core或成员。原PCH门槛尚未跨下一档；代码、模块说明、API资料及本册同片维护，临时验证脚本均经stdin、不落地。

八份现行/模块说明定向核对562个链接及117个章节锚点，退出0，新增错误0；正式需求/任务正文、12项任务身份和原百分比保留。差异格式检查退出0，原合同测试临时目录已删除，审批拒绝的临时目录从未创建；本片未新增后台进程、一次性脚本或重复环境。该阶段由包含本节的中文Git提交定位，普通推送并回读远端后在本对话保留固定SHA。

<a id="core-index-deployment-snapshot-20261115"></a>

## 开发索引覆盖范围与部署目录快照（2026-11-15）

当前事实读取固定 `de60b689910847e0680a74e7bc77c410394b058c` 已推送并读取真实远端一致，main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片只改独占Core合同/宿主和对应说明，原公共文件窗口继续按接续办理。

[源码索引](../../../packages/core-contracts/src/repository-index.ts)将Git跟踪的workspace和独立客户端包清单与实际检出范围核对。未检出的包列为notPresent，已检出但未进入workspace扫描的独立包列为partial，不能以当前目录存在就认定全平台已覆盖。Git检出同时提供workingTreeChanged，明确当前源码可能包含未提交修改；`--check`发现issues、partial或notPresent时退出1，普通查询仍可取得已读取能力。实际用法同步到[契约包说明](../../../packages/core-contracts/README.md#找到平台已有的功能)。

[部署目录](../../../packages/core-host/src/deployment.ts)在组合时解析清单快照、保存绑定原服务实例的方法引用，并为目录调用方返回隔离清单。原输入、返回Map及其中的清单被修改时，不改变当前部署登记；Core仓储与业务状态仍由原服务实时读取。此处固定登记版本和方法，实际升级通过重新核定组合完成。用途及限制同步到[宿主说明](../../../packages/core-host/README.md#当前部署注册)。

| 必要核对 | 实际结果及边界 |
| --- | --- |
| `node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs`，NODE_PATH只读定位已锁定依赖 | 退出0，原8组全部通过，skip/todo为0；临时编译/夹具由原after删除并确认 |
| `node --no-compilation-cache -`内存编译与实际源码查询 | 退出0，CoreContracts31根/CoreHost6根均0类型诊断；4,435条，issues为0，5条动态元数据和3,589条无直接用途说明仍待整理，SaveButton单项JSON为1,690字节 |
| 同一查询覆盖与CLI核对 | 六个未检出包分别为enterprise-portal、miniprogram、staff-miniprogram、tenant-website、website-next及harness-plugin；全部明确标记，workingTreeChanged=true；精确Auth接口查询的检查模式退出1且JSON可解析 |
| 同一部署目录反例 | 修改原输入/返回Map/嵌套清单后登记保持；替换原方法后仍调用组合时方法，原实例的实时状态仍可变化；初始化一次，空组合及目标Core独立拒绝通过 |

最初内存类型核对缺少稀疏树的Prisma运行时声明映射，退出1；随后只读引用已锁定的library.d.ts完成0诊断。CLI内存运行器一度把Node内置模块误当编译文件，退出1；仅修核对加载器的内置模块分支后复验通过。没有修改产品校验或已有断言来隐藏失败。persistent Node工具在初始化内核前返回路径不存在，本片最终经stdin完成验证，未依赖该工具建立环境。

本片未新增测试脚本、依赖安装、Prisma生成、服务进程或数据库调用；stdin编译和目录核对只保留内存结果。未检出及动态元数据不等于已完成全平台说明。真实主应用装配、无Core运行、浏览器、数据库、独立接手及原后续任务验收继续列为缺口，原PCH进度未跨下一档。

六份相关文档定向核对522个本地链接和113个章节锚点，退出0，新增错误为0，正式需求/任务正文及12项进度保持原值。原`docs:check`退出1，稀疏树17处缺链中的14处在固定Git中存在，另外3处仍是总导航第54行既有历史附件缺失；固定Git补足范围后白名单核查只余原3处。定向核对曾因全仓文件列表超过Node默认缓冲区而退出1，改为按链接查固定Git对象后通过，未修改检查器。差异格式检查退出0，原测试临时目录已删除核实，本片无新增临时残留。

<a id="core-management-current-reads-20261115"></a>

## Core管理当前事实与修订读取（2026-11-15）

源码导读/直接消费者索引固定 `7064f15787d03a256523d7217e7df8b6563b4094` 已推送回读。管理变更必须取得当前授权/成员分配/绑定修订，本片补[原管理读取](../../../apps/api/src/modules/core-host/original-core-management-reads.ts)，输入/输出与三个HTTP路径沿原[单源合同](../../../packages/core-contracts/src/management-http.ts)登记，Controller和OpenAPI生成自动消费。

SaaS管理者可读指定租户Core授权，原租户管理者仅能读本租户成员及范围绑定。当前会话/人员/角色先锁，读取事实后再核当前权限和自然期限。停用及撤回事实保留原修订，缺记录返回unavailable。绑定定位带Core/租户/容器，读取未初始化或提交业务。

stdin运行真实原ALS、身份和读取组合，离线事务驱动核授权修订7、成员撤回修订4、绑定修订1、缺记录、分面越权拒绝、已撤销会话拒绝及零写，退出0。实际OpenAPI自动生成8条管理路径，新接口资料与原schema一致。主AppModule/Guard和后台消费仍待公共窗口，真实HTTP/DB证据按宿主阶段取得。

Shared121/合同31/宿主6/工单10/MCP59和API970根/2,163源完整类型0诊断。Prisma本树schema独占无引擎生成退出0/守卫0违规，35个临时文件38,375,949字节finally删除并确认目录不存在。4份文档425条链接定向新错0，diff检查退出0，新增测试脚本和服务为0。

<a id="core-source-reading-20261115"></a>

## 源码模块导读与直接消费者发现（2026-11-15）

仓库索引固定 `9197c04319a9f834c3c1003c8dd654a25782f838` 已推送回读。负责人要求全平台源码可读及开发Agent快速接手，本片在真实模块补[Auth](../../../apps/api/src/modules/auth/README.md)、[平台](../../../apps/api/src/modules/platform/README.md)、[Rental](../../../apps/api/src/modules/rental-core/README.md)与[AI Native](../../../apps/api/src/modules/ai-native/README.md)源码导读，分别链接实际入口→应用/领域服务→仓储/外部适配→消费者与验证。正式需求、进度和活动问题沿原四册，模块README说明稳定用途和约束。

能力索引增加公共导出直接import计数和前5个源码引用，复用TypeScript符号解析，源码入口及最近模块导读一起返回。源码模块索引包含原Core适配，5条新管理HTTP可从同一查询发现。当前扫描4,426条唯一条目/解析错误0，SaveButton正式出口直接导入48处，例子包含CorePage和工单页面，精确查询1,218字节；Auth API带准确模块导读，core-host模块及5管理API查询通过。上述为源码依赖定位，动态调用/真实运行仍由原链取证。

31根合同类型0诊断；stdin实际读取器和查询核定入口、直接导入、模块说明与新接口，退出0。首个短校验变量遮蔽Node module导致未启动，改变量名后运行通过。本片仅静态解析与文档，不启动服务、不生成Client或安装依赖；新增运行脚本/测试文件为0。

7份文档470条链接定向新错0，原8组合同退出0，diff空白检查退出0。源码导读只说明当前真实入口与边界，原业务实现和锁定技术规范继续原位。所有核对经stdin/内存和原合同独占目录，退出清理已核实。

<a id="core-github-repository-20261115"></a>

## 固定GitHub仓库清单与多Core索引（2026-11-15）

门槛/提交前期限片固定 `df7aaa0f270ed72164defaf93b8263b81a847b38` 已普通推送并真实远端核同，当前main仍62ca。按原02/03/07/11发现范围补 [GitHub仓库读取](../../../packages/core-contracts/src/github-repository.ts)，单Core读取根core.manifest.json，多Core根core.index.json使用唯一id/相对路径清单，schema在该正式Node出口维护，最多20Core。

读取公开仓库元数据→固定默认分支当前commit→带ref读取根索引及Core清单，核Contents普通文件/路径/大小/编码及Git Blob摘要。所有清单解析沿CoreManifestSchema，ID/来源与仓库索引匹配；默认只取元数据，显式--releases时复用原固定Release接口核Tag/提交/资产，仍标记未审核/包未检查。源码发行可早于目录维护提交，manifest.source.commit与所选Release一致后取得发行候选。

整仓状态与单Core状态分别表达，某个清单坏Blob或限流保留其他Core的有效资料。读取器支持no_manifest/invalid/partial、metadata_only/source_only/release_available/unavailable和原retryAfter。GitHubHTTP错误增加可判定status，404表示确实缺文件或发行，其余失败准确保留。CLI和简明手册同步作者根索引格式、单/多CoreTag及按需查看发行步骤。

31根合同类型0诊断，stdin内存编译运行实际读取器核单/多Core固定commit、Contents摘要/路径、缺清单/未发行、固定发行资料、429限流及坏Blob/越界拒绝，退出0。追加部分清单失败核其他结果保留，退出0。真实公开测试发行下载/安装仍未执行，当前验证使用受控HTTP响应输入。

原8组合同退出0，4份文档475条本地链接定向新错0，原12任务行/进度一致，diff检查退出0。新增正式Node出口与CLI一起维护，验证只在stdin/内存及原测试临时目录，原after清理已核实，新增测试脚本/服务/依赖为0。

<a id="pch-first-gate-20261115"></a>

## 首批工程门槛与提交前会话期限复核（2026-11-15）

Core管理HTTP固定 `3e8843239ca243bdf8eed87fac1309c63fea2a73` 已普通推送并读取真实远端一致。按原G1定义复核01/02真实接点、消费者与可实施合同，01/02各登记25%，12项等权覆盖率4.17%。正式A01～A12尚未完整验收，运行、独立接手和发布各按其原阶段门槛核收。

| 原任务与门槛 | 当前固定依据 | 后续缺口 |
| --- | --- | --- |
| PCH-01 G1 | [原数据/迁移/消费者及六公共片](#core-ownership-baseline-20261114)、受控无/单/双Core组合、原已支持/失败/未验链、[工单领域与边界](#core-tickets-domain-20261114)、[页面/API真实消费者](#core-tickets-admin-20261114)及最新main62ca恢复条件可定位 | 全平台逐模块整改、前后真实行为/构建对照及完整迁移账归属仍按后续门槛完成 |
| PCH-02 G1 | 唯一清单/版本/对象/服务/页面合同，租户授权/成员分配/绑定的正式类型和MySQL适配，[原身份/审计组合](#core-original-management-20261115)、[工单原授权消费](#core-original-binding-tickets-20261115)、[部署锁](#core-deployed-catalogue-20261115)及[管理HTTP](#core-management-http-20261115)按同一合同编译和必要行为验证 | Rental完整适配、主Guard/应用/后台及无Core独立构建尚未接通，完整标准冻结/生产消费者和验收仍有缺口 |

最终会话期限在原主体适配等待账号查询返回后再次核对，原数据库会话到期与访问令牌到期都准确拒绝。绑定和工单在等待当前Core/部署/订阅数据后再核相同lease，防止等待跨过自然期限而提交。本片只调整当前提交边界的必要复核，原身份签名/会话撤销/授权事实沿原来源保持。

持续任务的当前公共依赖仍集中在已登记六片。现有实现已提供可直接消费的Core管理政策/Controller、实际目录/原主体/绑定/工单组合及API生成器。原PlatformService/Repository、Auth/Guard、主AppModule/schema与后台外壳的窗口由PM逐片核定；当前接续记录准确接点供其读取，其他作者WIP有独立归属。

实际原主体正常lease、等待账号返回后访问期限到期及数据库会话期限到期均按原方法验证，退出0。Shared121/合同30/宿主6/工单10/MCP59及API969根/2,162源类型0诊断，Prisma独占生成0/守卫0违规，35文件38,375,949字节finally删除并确认。3份文档422条链接和12任务行算术通过，diff检查退出0。本片仅改原主体的必要提交点及原三册，新增测试脚本为0。

<a id="core-management-http-20261115"></a>

## Core管理单源HTTP与接口资料（2026-11-15）

部署目录固定 `416fb603dcc85da6b41b4a3a12693f3b254e23de` 已推送并实际远端回读一致。本片新增[管理HTTP合同](../../../packages/core-contracts/src/management-http.ts)及[同源OpenAPI生成](../../../packages/core-contracts/src/management-openapi.ts)，提供当前注册目录、租户授权、成员分配、初始化绑定、原收据只读五个操作。方法/路径、请求/响应、管理分面和权限来自同一正式声明，Controller与资料共用，成功信封沿原data/requestId。

独占API模块新增[Controller/受控模块](../../../apps/api/src/modules/core-host/core-management.controller.ts)消费原管理/绑定服务，以及[原目录读取](../../../apps/api/src/modules/core-host/original-core-catalogue.ts)锁当前SaaS主体/角色并投影正式显示字段。schema/权限/冲突/不可用分别有已知状态，未知错误沿原链抛出。原AppModule/Guard/OpenAPI总组合尚未取得新窗口，此片只提供其正式消费者；主Guard准确方法/路径政策可直接消费 `coreManagementHttpPolicy`。

30根合同类型0诊断，5路径/9schema及政策映射同源核对通过，绑定配置由Core唯一schema处理。stdin实际Controller与Nest元数据核5条登记路径、服务主体传递、schema400/权限403/冲突409/不可用503及模块绑定，退出0。目录读取实际原ALS/主体链核SaaS可读、租户管理员拒绝和显示投影，退出0；首读严格summary收到完整manifest报未知字段，修为明确选字段投影后通过，原严格schema保持。

API969根/2,162个源文件、Shared121/合同30/宿主6/工单10/MCP59根均0诊断，Prisma独占无引擎生成0/守卫0违规。所有生成器/Client临时文件35个38,375,949字节finally删除并确认不存在。真实主路由/服务/数据库/页面验收继续待宿主接线，原测试数量保持必要范围。

原8组合同退出0，4份文档407条链接新错0，diff空白检查退出0。目录投影修正后复核真实原主体读取，新增函数仅使用正式清单类型及同一summary schema。暂存范围为本片正式合同、Controller/原读取和模块说明及原记录/接续。

<a id="core-deployed-catalogue-20261115"></a>

## 受控部署注册与实际迁移可用性（2026-11-15）

原绑定/工单消费固定 `47764b60edbbc87e8d686e18e3926d9cace02153` 已推送回读。继续独占core-host新增[实际部署目录](../../../packages/core-host/src/deployment.ts)，消费原CoreDeploymentLock、受控服务端注册和数据观察合同。服务端集合与锁逐清单/来源/版本核同，部署目录供授权、初始化和业务使用当前availability；空Core组合合法。

`requireRegistered`只核受控装配事实，数据未就绪时撤回/停用仍可核已注册Core。`requireAvailable`读取原数据所有者的实际观察，平台与目标Core的版本、完整不可变迁移链和ready执行状态全部一致后允许新准入。某Core未完成迁移不阻断无关Core，平台公共迁移未完成则准确拒绝各Core。原包下载/准备和部署授权继续分别记事实。

必要类型合同28根/宿主6根0诊断，stdin运行真实目录核空/双Core、锁与实现集合冲突、未知Core、目标unknown/平台failed拒绝、其他Core仍可用和注册事实保留，退出0。实际数据观察在本片验证中为离线输入，真实DB来源、装配生命周期、Core管理HTTP/UI与无Core独立运行继续按PCH宿主窗口推进。没有新增测试脚本、安装依赖或临时环境。

3份文档356条本地链接定向核对新错0，diff检查退出0。本片正式包出口同步，暂存仅此源码与原记录/接续/模块说明，实际固定提交由包含本节的Git提交定位，普通推送后以远端回读核定。

<a id="core-original-binding-tickets-20261115"></a>

## 绑定及工单样例消费原主体、使用权和订阅（2026-11-15）

原Core管理适配固定 `05700e055763b36b9e66c713dd67bce048fd1ecc` 已推送回读。此片继续独占原Core模块，[当前使用权适配](../../../apps/api/src/modules/core-host/original-core-access.ts)读取真实租户Core授权、成员分配及绑定，输入始终来自原主体事务。新业务期限复用原SubscriptionService在同一事务的只读投影，现有到期/历史政策保持原来源。

[原绑定组合](../../../apps/api/src/modules/core-host/original-core-bindings.ts)接原租户管理权、Core/成员授权及订阅。容器型Core需自己的同事务范围/归属适配，缺失拒绝初始化；租户范围轻量Core直接消费公共范围。初始化和原OperationLog审计同事务，停用后原收据仍由当前有权管理者只读核对。

[工单宿主组合](../../../apps/api/src/modules/core-host/original-tickets-host.ts)接真实工单服务/MySQL与原身份、当前Core/成员使用权、业务权限和绑定数据版本。创建、分派、处理/关闭和原收据继续由工单领域决定，受派者必须是本租户有效获权成员。停用关闭普通查询和新动作，原收据只核本人原操作/当前对象权限；订阅到期仅沿原规则停止新增，已获权处理/关闭继续自身状态校验。原审计增加通用Core业务关联方法，Core适配映射自身对象，公共审计无工单实体依赖。

stdin运行实际原ALS/主体、绑定/工单组合、MySQL适配、原审计及领域服务，使用离线驱动/事务替身。绑定缺成员/到期拒绝，首次原审计与绑定一致，停用后只读原收据、重开不初始化通过。工单创建→分派→开始→关闭、到期停新/旧处理、停用普通读取拒绝、原收据零写及审计失败回滚通过，均退出0。首个绑定fixture未按operationId过滤返回错误原收据，修正离线存储映射后通过，生产原键校验保持。

本片原AppModule/Guard路由和正式数据迁移链仍待公共窗口。API必要示范包依赖与构建前置已同步，源码/说明及接口资料沿同版本合同维护，真实服务、DB锁和完整独立无Core运行须所属宿主阶段取证。必要类型与定向链接结果随本阶段收口。

收口类型为Shared121根、合同28根、宿主5根、工单10根、MCP59根及API967根/2,157个源文件0诊断，Prisma本树schema独占生成退出0/守卫0违规，声明全部在内存编译。finally删除35个临时文件38,375,949字节并确认目录不存在。3份文档348条链接新错0，root lock只新增API对示范包的依赖，diff空白检查退出0。无新增测试脚本、后台进程或外部业务访问。

<a id="core-original-management-20261115"></a>

## Core管理接原身份、角色与同事务审计（2026-11-15）

绑定服务及私有事务句柄固定 `80cc539cccd80d81a6c6767a29133308bb90473c` 已推送回读。本片继续非冲突源码，在API新增[原Core管理模块](../../../apps/api/src/modules/core-host/README.md)，只读消费原ALS和 `PlatformRepository.findUserById`，原OperationLog唯一窗口增加同事务Core管理收据方法。API包声明及root lock增加既有独立Core包依赖，dev/build/lint前置构建这些正式包。

原主体适配锁当前租户/人员/会话/角色与权限，复用原平台租户角色映射；提交前复核相同会话、令牌期限及管理权。租户授权要求当前SaaS管理者，成员分配要求原全租户管理权及本租户成员。目标成员已停用时允许撤回，目标租户冻结后SaaS仍可关闭Core，当前操作者不可停用或越权。Core权/业务范围继续由实际注册、授予、成员和部署来源决定。

`composeOriginalCoreManagement`连接实际CoreAccessService/MySQL适配，原审计使用本事务OperationLog写入，失败回滚Core授权与原收据。stdin运行实际原ALS/主体/管理组合与审计方法，核会话撤销/自然到期、锁顺序、停用成员撤回、冻结目标关闭、租户管理员不可授租户Core、SaaS授权及审计失败回滚，退出0。驱动和数据库为离线事务替身，真实Guard路由与DB锁仍待公共装配。

验证使用本树schema生成独占Prisma5.22无引擎Client，生成器必要文件/缓存全部位于 `output/.tmp/core-original-authority`。前两次缺包解析/Runtime声明均已退出清理，第三次用户缓存写入尝试被守卫阻止；显式APPDATA/LOCALAPPDATA后最终生成退出0、守卫0违规。先内存生成Shared/合同/宿主/MCP正式声明再核API，避免将MCP源码穿进API的rootDir。所有生成/临时验证资料随finally清理，未改产品类型配置或共享Client。

原AppModule/Guard、平台基础投影/创建和主schema仍待原公共窗口；本片交付真实原身份适配源码及消费者组合，尚未将其开放成可办理HTTP/后台入口。当前运行与数据库恢复的证据沿main62ca原阶段引用。

收口类型检查Shared121根、合同28根、宿主5根、MCP59根及API964根/2,145个源文件均0诊断，全部声明在内存生成。Prisma独占无引擎生成退出0/守卫0违规，finally删除35文件38,375,949字节并确认目录不存在。3份文档340条链接新错0，API依赖与lock一致，diff检查退出0；主线/独占树原输出和Client没有改写。

<a id="core-binding-runtime-20261115"></a>

## Core首次绑定、初始化和原操作事务（2026-11-15）

最新main运行修复的纳入及升级观察已固定在 `f510d3793b194823f767516ffdf6b658b3ecc770`，普通推送和真实远端回读一致。本片沿PCH独占core-host及公共core-contracts窗口，补[初始化输入](../../../packages/core-contracts/src/lifecycle.ts)、[绑定应用服务](../../../packages/core-host/src/binding.ts)和[MySQL私有适配](../../../packages/core-host/src/mysql-bindings.ts)。旧平台/Auth/Guard/AppModule和他人后台WIP继续按原窗口维护。

初始化输入租户从原主体确定，Core/容器须与清单范围一致。原操作键和输入指纹区分重复/冲突，首次在当前原授权锁下调用Core唯一初始化schema，业务、绑定、原收据及原审计同事务。已有绑定再次进入时复用，数据版本按当前Core可读区间核验；已有配置调整走Core本身接口，无初始化器的轻量Core可直接保存受权绑定。原收据查询专门复核当前读取权限和主体，缺收据为unavailable。

MySQL依次锁原身份，再锁tenant/Core，再核当前授权和Core范围；相同Core锁与授权管理复用。事务句柄保存在私有WeakMap，Core私有适配只能解析同一scope，回调退出即作废。两张[独立绑定迁移](../../../apps/platform-api/prisma/migrations/20261115020000_core_bindings/migration.sql)随原001排序，范围摘要保留tenant/Core/容器边界，绑定及JSON原收据同事务保存。代码只交迁移源码，原迁移部署链仍由数据所有者核定。

必要类型为合同28根、宿主5根0诊断。stdin运行真实绑定服务核首次/相同键重读/重开不初始化、不同输入拒绝、原收据与缺失、当前撤权/期限失败回滚、Core初始化失败、无初始化器可用及输入跨租户拒绝；MySQL实际适配核原人员→Core锁→授权→业务/回执/审计→最终复验，事务句柄跨范围/过期拒绝，原收据读取0写，均退出0。首个内存声明校验因Windows路径和virtual dist目录未映射报28个导出/驱动声明诊断，修正只读校验映射后0；行为检查将同步schema抛错误用rejects，改为按实际入口throws核对后通过，产品授权规则未放宽。

验证使用离线事务/授权存储替身，原身份/部署生产者、真实事务/DB锁、管理HTTP/UI与业务就绪读取继续待公共接线。源码、合同及接入说明同片维护，原测试和定向链接结果在收口时记录。所有验证经stdin/内存及原合同临时目录，沿原after清理，未新增测试脚本或运行环境。

收口核对原8组合同通过/退出0，3份文档345条链接新错0，core-host锁文件依赖元数据逐项一致，新迁移LF字节一致。`git -c core.whitespace=cr-at-eol diff --check`退出0；本片产物只含正式源码、迁移和原文档，临时目录已不存在。

<a id="core-main-runtime-sync-20261115"></a>

## 最新 main 运行修复同步与升级观察（2026-11-15）

能力索引片固定为 `df10b7b972c954b8fff9903b48c06f73ec1e1400`，普通推送后实际远端一致。跨日再次核工作区、索引、HEAD和GitHub，按负责人及PM当前固定同步要求纳入main `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，父为275064d40。合并提交 `854b2990dcf089b0e14c0517404400447270c17f` 已上传并回读一致，四个产品文件与原固定来源正文核同。管理后台记录顶部双方新增阶段冲突，完整保留简称字段及数据库恢复两段原证据，当前接续合并保留双方未完项。

原CHECK布尔修复、可信MySQL metadata引号包装及有界unsigned bigint修订读取随原源码纳入。真实260迁移/物理约束/14配置行转换/API运行证据继续由[主线恢复阶段](../../管理后台/管理后台-开发记录.md#main-database-runtime-upgrade-20261114)维护，旧迁移原文及checksum保留。能力索引在新组合源码28根类型0诊断、4,385条唯一记录及解析缺口0，退出0。本树只同步已提交源码，当前服务与真库证据仍来自PM原环境。

升级预检承接原DDL部分失败的恢复条件。[迁移执行观察](../../../packages/core-contracts/src/update.ts)增加明确ready/running/failed/unknown状态，以及原迁移标识/摘要、已知语句进度、物理回读摘要和固定恢复SQL来源。预检对任何模块未完成状态返回 `migration_incomplete`，包括本次未选择更新的其他Core。原观察字段向后兼容，新宿主须从所属迁移账明确提供状态，恢复后先核完整物理结构与原收据再重新观察。

旧观察与正常ready通过，前三ALTER已提交/第四失败、unknown/running及未选择Core失败均由真实schema和计划器拒绝，非法语句进度/ready额外字段拒绝。28根合同类型0诊断，原8组测试退出0，3份文档371条链接定向核对新错0，diff空白检查退出0。验证只使用stdin、内存及原测试独占临时目录，after清理已确认。此片纯预检读取输入，目标环境恢复、resolve/deploy和物理检查由原所有者按授权完成。

<a id="core-capability-index-20261114"></a>

## 开发 Agent 统一能力索引与接入查询（2026-11-14）

负责人提出所有功能组件应有注册入口，便于 Agent 知道已有功能和源码位置，并要求继续实施。本片据此补需求/任务v1.5，沿原01/02/11细化统一发现、正式来源、分类查询及独立接手定位。修订前两册固定在 `c72d1718df470e73f48ef657d469fc2e4fdd9037`，原12项任务身份、前置、顺序和G1～G4计分仍为原表。Core授权/成员分配独立层已随该提交普通推送并读取真实远端一致。

开发目录由正式来源汇集的实现选择在本片确定。新[索引合同与查询](../../../packages/core-contracts/src/development.ts)通过 `@rental-os/core-contracts/development` 出口提供，模块归属、源码/文档引用、导入/HTTP/页面入口及原元数据保持可机器读取。[只读扫描器](../../../packages/core-contracts/src/repository-index.ts)消费当前workspace包出口、TypeScript声明/JSDoc、Controller和共享常量、AppModule明确登记、原APP_ROUTES、Core页面贡献及UIArc来源，原注册源继续维护自己的规则。

[查询命令](../../../packages/core-contracts/src/capabilities.ts)支持关键词、种类、归属、标识及分页，默认20项、上限100项，标准输出可为单份JSON。来源标记working-tree和Git修订，覆盖输出压缩为摘要及具体缺口。`describeCoreDevelopmentCapabilities`从同一Core清单、页面/OpenAPI贡献生成Core目录。[源码读取器](../../../packages/core-contracts/src/repository-source.ts)复用仓库路径边界，只解析本仓声明，TypeScript为已锁定开发工具；函数调用保持未解析，Object.freeze仅语法读取参数。源码描述、明确宿主装配与当前运行授权分别标记，原AI基线及MCP工具发布继续由其原专项维护。

根README、[契约包说明](../../../packages/core-contracts/README.md#找到平台已有的功能)、原任务[能力索引](平台Core接入-开发任务.md#capability-index)、五步指南及随包指南生成器同步提供查询步骤。Core作者可查SaveButton/CorePage等实际导入及源码说明，工单3页/7接口可从同一个入口发现。

必要类型核对28根文件0诊断，原8组合同比对通过/退出0，唯一测试文件只增加编译器依赖的只读解析路径。stdin以内存真实编译和加载运行扫描，4,385条唯一条目，含1,049个API、99个UI出口、3,032个公共导出、123个UIArc来源、23个模块和59个页面；解析错误0，实际扫描期间写文件0、实际环境/输出目录读取0。SaveButton查询1,368字节，精确标识/分类/归属/分页与非法limit拒绝通过，实际工单清单+OpenAPI生成8条目录，随包指南含查询命令和固定文档锚点，均退出0。

最初扫描尚未读取Object.freeze常量和vendor类型，350个来源/路径缺口据实际原因修复。进一步发现21条重复路由源码，原AI通过观测/执行控制器继承及互斥装配消费这些声明；目录将同路径多个源码来源合并并保留显式AppModule出处。曾因重复标识校验退出1，修复后全索引唯一。5条静态元数据有运行表达式，原两个品类页面menu开关和工单三页面权限函数通过 `unresolvedMetadata` 明确标记。

源码用途梳理仍有实质缺口。当前3,547条索引条目未直接提供JSDoc描述，涉及类型/接口/页面和保留源码，目录给出准确入口，后续沿原4.3按关键职责和模块说明整改。当前扫描覆盖实际检出资料，其他未检出客户端、任意动态注册、完整OpenAPI字段/所有请求消费者、运行工具可用性及独立接手仍需所属切片核收。索引数量、源码存在和静态通过各有自己的证据范围。

验证经stdin/内存和原测试临时目录执行，原after已删除 `output/.tmp/core-contracts`。扫描期间只读取业务源码；同源目录另以内存编译运行工单元数据生成器核对。旧空目录的原生PowerShell清理在本片恢复可执行，核定两个绝对路径在独占树内、无链接且为空后按子目录→父目录删除，随后核实原路径均不存在。唯一待清理责任清单及已空的任务子目录也核对作者后移除，历史审批失败证据继续保留在工单阶段原记录。

本片没有新增测试脚本、依赖、服务或真实DB访问。下一片先纳入PM指定main修复 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，随后接真实公共宿主/当前授权与注册消费。

6份文档535条链接、106个锚点和57张表定向检查通过，12条任务行内容与原固定版本一致。新增主线修复锚点按62ca固定记录核验，随后纳入该提交。实际CLI以内存编译执行输出单份JSON，SaveButton精确两条入口、退出0。`npm run docs:check`在本稀疏树退出1，17个缺链包含14个固定Git中存在但未检出的目标和总导航3份既有历史附件；定向补核新增错误0，检查器覆盖边界保持原规则。

<a id="core-host-access-20261114"></a>

## 平台 Core 授权与成员分配应用层（2026-11-14）

前片工单三页面/请求/原收据已固定为 `45714bb998bb13d64c62f9a7cbd515c42e1e338d`，中文提交、普通推送及真实远端回读一致。继续PCH独占模块/非冲突源，新增[core-host](../../../packages/core-host/README.md)与必要root lock条目，稀疏检出只增加该包；原平台用户、Auth/Guard、schema/迁移链、AppModule与后台公共WIP没有改动。

[应用服务](../../../packages/core-host/src/access.ts)消费已有生命周期schema，将租户Core开通/停用与成员分配/撤回分别保存，原管理者/目标租户/成员由宿主当前authority验证。新开通核真实注册及部署可用，不自动分配或初始化；撤回允许业务已不可用，重开不恢复成员主动撤权、不续订阅。原操作键和修订控制重复及并发，历史收据不回写当前状态。

[MySQL适配](../../../packages/core-host/src/mysql.ts)与[四表独立迁移](../../../apps/platform-api/prisma/migrations/20261115010000_core_access/migration.sql)只拥有平台Core管理事实，未引用Rental/AI表。原人员/租户/角色先锁，再取得tenant/Core锁，变更、原收据和原审计同事务，最后复核原lease期限；管理权限不足在任何SQL前拒绝。SQL参数化，读取bigint修订经正式schema安全整数核对。真正原身份/部署生产者和HTTP/UI仍待公共窗口，不能用布尔字段或替身宣称已开放管理。

必要检查为3根源码类型0诊断；stdin运行真实服务核单/双Core独立授权、开通不自动分配、成员撤回/停用重开保留、旧收据不改当前修订、同键冲突、越权/跨租户字段拒绝、审计/期限失败回滚及部署不可用仍可撤回；真实MySQL适配另核参数化tenant/Core、authority先于SQL、原收据/审计/最终复核顺序及拒绝零SQL，均退出0。使用离线授权/存储/事务替身，不证明真实DB锁、原Auth或业务运行。没有新测试脚本、依赖/临时文件、服务或数据库访问，已知两个空目录原位审批阻塞仍未清理。

接入说明与源码同片解释公共服务边界、输入唯一来源、锁序、构建和未接线项。后续真实基础投影/公共租户创建→身份范围→授权/绑定事务→原AppModule/后台消费的顺序仍沿原六片候选；此次只交独立应用层，没有抢写尚未核定的公共入口。

3份文档319条链接定向核对新错误0，root lock原全部条目不变、只新增该包workspace及链接两项；`git -c core.whitespace=cr-at-eol diff --check`退出0。

<a id="core-tickets-admin-20261114"></a>

## 工单页面消费公共壳与原收据读取（2026-11-14）

期限复核片 `093458c448a27c8aa1591ed44d3dc8f990fcbcbc` 已推送并回读，继续独占 `apps/admin/src/core`/工单包及必要包元数据。原后台壳、AppRouter/导航、Auth/Guard/主OpenAPI仍未修改；main原后台作者的顶栏/样式与PM原本机迁移恢复继续独立，本片不访问其业务服务或共享库。

[工单后台](../../../packages/example-tickets-core/admin/index.tsx)提供列表、创建和详情三个真实页面组件/注册贡献，通过正式 `@rental-os/admin/core` 源码出口消费CorePage、原Table/Form/SaveButton/QueryState/离页保护，不加样式或复制壳。原admin包只新增该出口，现有企业读取经固定Git核无包深层导入，不扩大成UI重构；工单按所需peer使用React/React Query，包清单增加实际后台TSX入口，仍由受控宿主构建。

通用[Core请求适配](../../../apps/admin/src/core/useCoreRequest.ts)复用原HTTP认证/信封，限定本Core内路径和参数，生成Core/宿主身份/页面代次查询键。离页/代次变更中止原请求，返回后核当前会话/页面权限，StrictMode清理再挂载重新建信号，不继续使用已中止信号。它不是服务端授权，也不能以请求取消判断写入未发生。

工单列表用原表格/筛选与显式分页，新建/处理/关闭由CorePage声明当前主操作，分派用原Form/SaveButton。首次示范受派者填写正式成员ID，真实成员选择目录尚待公共适配。写入中保留表单和单次Promise，已知本Core提交前拒绝允许核正输入；网络/未知结果保留原操作键并常显提示，不能自动换键重做。

新增原操作只读入口 `GET operations/{operationId}` 与 `TicketsService.receipt`，只返回当前本人及对象范围允许的recorded原收据或unavailable；未查到不能推断未执行。页面核对只走GET，不再调用原写入。服务端固定purpose=original_receipt与普通business分开供宿主处理停用/到期善后，客户端不能选择；真实授权适配仍须实现。API同源映射现有7操作/6路径，文档同步原RequestIdInterceptor的 `{data,requestId}` 信封；判别联合导出复用唯一schema。

验证范围：后台和工单合并650根/3994源类型0诊断，独立页面tsconfig 11根/1490源0诊断，服务端10根0诊断；原合同8组通过含新增联合schema类型。AntD6.6原Table API/示例已查，新页面与CorePage lint均零问题。stdin核实际hook的Core前缀/路径拒绝、离页/会话/权限迟到响应、StrictMode/旧generation拒绝；实际页面JSX核未知创建转只读GET、unavailable不重发、已记录进入原对象、已知拒绝保持可编辑及3页注册；实际服务/Controller核原收据零写入、当前主体/对象可见性、7操作及信封文档，均退出0。上述为hook/HTTP/事务facade和静态类型，未冒充真实React挂载、Form回车、浏览器样式、原Guard或数据库通过。没有新增测试脚本、依赖副本、服务或临时文件，原合同测试产物已清理。

[平台接入说明](../../../apps/admin/src/core/README.md)及[样例手册](../../../packages/example-tickets-core/README.md)同片给出正式出口、三页面、缓存/请求、只读核对和原业务限制。实际主应用装配/数据迁移/当前授权、无Core及双Core界面/持久化、停用恢复和独立接手仍未完成；两个空目录原位审批阻塞继续按原责任清单维护。

5份文档380条链接定向核对新错误0，包peer/正式出口与lock一致，需求/原任务未变，`git -c core.whitespace=cr-at-eol diff --check`退出0。最终补齐分派草稿和核对中离页保护后，页面独立tsconfig复验仍11根/1490源0诊断；原收据/普通访问purpose分开也经最终服务端类型与短命令核对，退出0。

<a id="core-tickets-package-20261114"></a>

## 工单编译包闭包与提交前期限复核（2026-11-14）

HTTP片已固定上传 `7c779091231c7236d088e72d8763443d7fb19914` 并回读GitHub。基于该提交执行原TypeScript配置的真实program.emit，core-contracts先编译24根/48产物，工单从其声明产物编译10根/20产物，全部在内存writeFile回调，不落dist、不建依赖副本或临时目录。将真实输出、同源OpenAPI、迁移、LICENSE/README及固定任务生成指南按清单组成27文件包；标准包检查、USTAR/gzip往返及重复确定性均通过。该固定版本内存包23451字节、SHA-256 `e3eef62338c363642d2f0f43d2be2980a1ed73dcc8190fbb7c0e0a53daf94f38`；它是构建/格式闭包证据，没有保存为发行物或证明实际安装可用。

事务复核发现锁行不能冻结时间，因此在[MySQL适配](../../../packages/example-tickets-core/src/mysql.ts)增加authority同次授权返回的`revalidate()`，在领域/收据/审计之后、事务返回之前复核原会话/订阅期限。失效抛错令同事务回滚，不借另一主体重新授权。10根最终类型0诊断；stdin核真实适配的auth→锁→work→revalidate顺序及过期不提交，退出0。接口仍需原真实授权实现，未运行数据库。包说明同步该必需接点，前述包摘要只对应改动前固定版本，不套用到新版本。

<a id="core-tickets-http-20261114"></a>

## 工单 HTTP 与同源 API 文档（2026-11-14）

工单领域片固定 `f4e43b7e6849748118ef5a7c07666f4d91491740` 已提交推送并回读GitHub，main仍 `275064d40`。本片仅继续独占合同包、工单包与根lock必要peer项，未修改原AppModule/Guard/OpenAPI总组合、schema或后台壳。新增[HTTP合同](../../../packages/example-tickets-core/src/http.ts)、[Nest适配](../../../packages/example-tickets-core/src/nest.ts)、[OpenAPI生成](../../../packages/example-tickets-core/src/openapi.ts)和[元数据命令](../../../packages/example-tickets-core/src/metadata.ts)。

同一HTTP映射供给6个Controller方法的路径和生成文档，数据字段仍来自原工单Zod schema；公共[简单schema转换](../../../packages/core-contracts/src/schema.ts)只支持已明确的Zod3基础字段，未知refine/transform等拒绝，不静默漏约束。OpenAPI包含实际权限码、参数/请求/响应、原操作/修订及400/401/403/404/409/500语义；源码入口与构建后命令可导出同版本离线JSON，未将文档生成视为HTTP已上线。

Nest模块显式接业务service和原可信principal accessor，租户/创建者不取body。路径ticketId与body分开严格校验，重复/数组/空数字等查询不隐式变成合法值。已知输入/领域冲突映射明确状态，未知数据库/宿主错误保持抛出；原全局Guard默认拒绝仍有效，未经正式注册不放行新路由。私有nestjs peer入口与领域公共出口分离，未创建另一套认证或业务事务。

必要验证：新增10根Core源码类型0诊断；原单一合同入口8组通过含全部合同类型。首次schema转换器的穷尽分支读取never字段触发TS2339，修复后复验通过；离线边界核对又把正整数的语义从minimum0/exclusive转换成明确minimum1并保留严格性，再验通过。stdin读取真实Nest装饰器元数据，对照6方法/5路径、HTTP200、权限码/文档schema及当前主体/路径/body、400/409和未知异常传播；同时核文档默认值/可空、窄数字约束与不支持schema拒绝，退出0。元数据命令纯JSON与0/1退出也经实际源码核对，退出0。未新增测试脚本、启动Nest、查询数据库或执行模型；原合同验证临时目录已删除。

包说明与合同手册同步更新准确命令、输入/错误及未接线范围；工单清单现声明实际OpenAPI文件，打包前须由命令生成，不使用手写空文档。实际宿主权限适配、原主应用注册/文档组合、工单页面/持久化和无Core/双Core验证继续待交付。原MCP未验和两个空目录审批拒绝仍分别见原记录，不借本片类型通过关闭。

4份文档361条链接定向核对新错误0，工单peer依赖与lock一致，正式需求/任务正文未变；`git -c core.whitespace=cr-at-eol diff --check`退出0。

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
