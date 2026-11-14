# 平台 Core 接入开发记录

建立日期：2026-10-31。

> 本册只记录阶段成果、缺口和证据，不修改需求/任务。工程尚未启动，文档不计研发完成；百分比只见[开发任务](平台Core接入-开发任务.md)。最新写入范围和下一入口见[协作接续](平台Core接入-协作接续.md)。

## 1. 依据与来源

- [需求v1.2](平台Core接入-需求.md)、[开发任务v1.2](平台Core接入-开发任务.md)。
- [接口与生命周期设计](平台Core接入-开发任务.md#contract-design)、[接入指南](平台Core接入-开发任务.md#integration-guide)：随本次需求澄清更新，仍为实施准备，非已发布SDK/API。
- 历史版本与原始接入设计见[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)，现行依据使用上述v1.2正文。
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
