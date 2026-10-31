# Harness 插件：开发记录

> 专项：Rental OS Harness 插件；建立日期：2026-10-28。
> 用途：按完整阶段记录本专项实际已做、剩余及证据，不作为第二份百分比台账。
> 正式范围见[需求](Harness插件-需求.md)，任务与研发进度见[开发任务](Harness插件-开发任务.md)，当前现场见[协作接续](Harness插件-协作接续.md)。原定制客户端历史仍保留在[Agent接入改造开发记录](../Agent接入改造/Agent接入改造-开发记录.md)，不搬来计作插件成果。

## 阶段：服务端输入错误的消费边界（2026-10-31）

MCP原只读注册已保留完整输入schema及原validator，仅替换失败issues的外发说明；两代完整响应不回显拒绝字段路径 / 值，非法参数在原权限 / 计量 / reader之前拒绝。修前敏感路径回显与修后源码 / 正式ESM3 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md#阶段输入校验错误的安全外发2026-10-31)。本端源码 / 0.1.1候选未改、不重复正常Host回归，不因服务端修复补造grant / 字段或提高任务档位；原实际schema仍拒绝不兼容Host。七份前像在[保全](../../output/mcp-input-error-closeout-20261031-hthswluh/)，所有output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：MCP声明代次的客户端边界（2026-10-31）

MCP端点已显式固定2026-07-28 / 2025-11-25，原SDK对非初始化未声明版本头拒绝、旧initialize仅反提议声明旧代次；修前200与修后400 / 零reader、源码 / 正式ESM两代客户端2 pass及当前原身份 / 目录公共出口缺口见[MCP记录](../MCP服务/MCP服务-开发记录.md#阶段声明协议代次与拒绝行为固定2026-10-31)。本端源码 / 0.1.1包未改，不重复正常Host回归；现代协议pin保持，未补业务授权或删Host schema约束。原任务门槛和真实安装 / OAuth / 字段 / 持久目标未验边界不变，七份前像在[保全](../../output/mcp-protocol-pin-closeout-20261031-u1giil4k/)，所有output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：同一MCP连接的显式资源选择（2026-10-31）

- AGP-04 / 05的适用可选材料消费增加`readResources`名称白名单与`/rental resources / resource <名称>`；默认省略、不自动读取，不接受任意URI。原[私有连接](../../clients/harness-plugin/src/oauth-session.ts)读取一页标准目录，选择原URI后读取单条text/plain资源，再读目录核对名称 / URI / 版本 / 说明；全部共用原15秒及更短连接截止、无分页聚合 / 缓存 / 重试。MIME / URI / 版本 / 字符 / 续页 / 重名拒绝，服务端原权限 / 计量 / release保持必需，不把Resources包装成原Tools schema的旁路。
- [原消息消费者](../../clients/harness-plugin/src/mcp-prompts.ts)复用模板的唯一在途 / 原idle maintenance所有者；模板与资源互斥，忙碌不排队。只向精确登录Agent / Session提交一条`rental-resource`来源、name / version / 原URI及relay形式的普通用户消息，原inbox / 日志 / Loop均保留正文；资源按数据消费，不替人批准 / 执行，自配模型费用照常。消息来源在日志重建 / 插件重载后仍触发完整256 KiB材料准入，不恢复业务资格。未提交的取消 / 断开 / 重载 / Agent销毁 / 模型服务移除沿原所有者撤回；已提交的Host历史不承诺删除。原共享mcpResources接口为继承式、无逐服务器子Agent过滤，当前不注册该provider或第二份资源Tools，只提供人类明确选择。
- 原runner执行`node --test tests/harness-plugin.test.cjs`，[首轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-20261031-1.log)退出1、2 fail，资源 / 模板联合返回值需显式区分才保留URI类型；改为discriminant、不加unknown断言后[第二轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-20261031-2.log)退出1、1 pass / 1 fail，测试在已销毁发起者绑定未清除时切回旧Agent，补原disconnect后仅复验`node --test --test-name-pattern 'Rental bundle loads' tests/harness-plugin.test.cjs`，[第三轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-20261031-3.log)退出0、1 pass。
- 补资源重载 / 模型服务移除后，[首次最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-final-20261031-1.log)与[第二次最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-final-20261031-2.log)各退出1、1 fail：测试误认恢复LlmRuntime会复活已关闭凭据owner与原Loop销毁的Agent。保留产品拒绝，明确重载插件并由原factory创建新Agent后[第三次最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-final-20261031-3.log)退出0、1 pass；补资源非法配置、blob、双正文及超限拒绝后[最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-final-20261031-4.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含本片全部strict / 公开声明 / 真tarball、原profile / Loader / Loop / OAuth及原材料 / unknown变体。列表零正文 / 模型，选择一条原消息 / 模型续轮；错Agent / 同Session异Agent、任意URI、旧名称、MIME / 版本 / 续页、忙碌、取消 / 断开 / 重载 / 服务移除均有实际拒绝与原日志不新增断言，纯资源来源重建及重载后超限零派发已验证。
- 包版本升为0.1.1，原0.1.0候选不覆盖。原runner执行`node clients/harness-plugin/scripts/build-bundle.cjs --out output/harness-plugin-resource-package-20261031-4rtwpztq/bundle --harness-root clients/agent-desktop/harness --npm-cli output/agent-desktop-install-20261023-q16gtnf6/node-extracted/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js`，[打包](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-package-20261031-1.log)退出0，[候选包](../../output/harness-plugin-resource-package-20261031-4rtwpztq/bundle/rental-os-harness-plugin-0.1.1.tgz)与[清单](../../output/harness-plugin-resource-package-20261031-4rtwpztq/bundle/bundle-manifest.json)已交用户，SHA-256 `f2b9e47c220c0f839f52de43b14f5752c1bbb0b3c6bd9bc7c9e72c98d55b77a9`，23文件 / 40,521压缩字节，与最终Loader归档相同，源码hash当前一致。原依赖 / 根lock及用户profile未安装，未签名 / registry发布。17份源码 / 说明前像在[保全](../../output/harness-resource-selection-closeout-20261031-1dqrvekf/)，本片audit无文件，旧失败 / output保留。
- 原AS / store / grant、业务权限 / 字段 / 计量以及模型、浏览器 / listener均为明确外部夹具；不是生产业务、真实原版安装或模型自主Resources工具消费。严格目的地 / 留存缺Host证据仍拒绝，AGP-01原75%及02～10原门槛未跨档；MCP首片身份 / 持久目标 / 字段 / 目录schema仍缺，持续目标尚未完成。未改原Harness / API / shared / Core / 知识 / 资金 / 文件存储，不安装、启服务、真实外联、迁移、提交 / 推送，无独立审查。

## 阶段：可选Resources的客户端接点核查（2026-10-31）

MCP新增精确Resources / 原权限计量 / 字段release编排，源码 / 正式ESM两代SDK最终2 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md#阶段精确resources发现与原读权编排2026-10-31)。本端只读原公开工具桥与mcpResources.register：未支持的输出会降通用JSON、PTC类型降unknown / Any，不能删原schema约束来开放；实际输入schema拒绝保持。原Resources接点支持provider注册但共享Tools有scope继承，当前Rental私有连接未注册资源provider，后续须补精确Agent / Session拒绝、材料 / 重放及撤回释放验证，不把Resources包装原业务来绕Tools前置。本端产品 / 预构建包未改、不重跑正常Host组合，原候选tarball仍对应已交付源码。固定身份 / 字段 / 持久目标与AGP连续G门未齐，百分比不提高；七份前像在[保全](../../output/mcp-resources-closeout-20261031-2ia1xc_k/)，旧output全部保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：预构建Bundle与原Loader消费（2026-10-31）

- AGP-01 / 10适用安装子路径新增[离线构建器](../../clients/harness-plugin/scripts/build-bundle.cjs)及`build:bundle`入口；全新目录严格编译、固定已安装声明版本、标准npm离线禁脚本pack、完整文件 / import / 公共入口 / SHA-512回验。源码 / 构建器SHA-256、构建版本、归档SHA-256与文件集合写入独立清单，失败留日志、已存在目录拒绝覆盖；不安装依赖、不写源码dist / 根lock，不含第二份Cordis、源码 / 后台 / node_modules或用户配置。构建可显式使用本树已有Harness声明，归档运行不依赖相邻源码；独立依赖安装仍未验。
- 既有[组合测试](../../tests/harness-plugin.test.cjs)由手工编译目录改为实际`.tgz`解包后加载原profile / Loader，全部原命令 / OAuth / MCP / AgentLoop / 材料 / 取消 / 卸载断言保留；解包前检查文件类型 / 路径 / 完整集合，解包后逐字节比较，NodeNext消费者仍验证公开声明。原runner执行`node --test tests/harness-plugin.test.cjs`，[首轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-bundle-package-20261031-1.log)退出1、1 fail：构建器漏读open标准顶层exports.types；修正后[组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-bundle-package-20261031-2.log)退出0、1 pass。追加交付清单 / 完整import检查后[最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-bundle-package-final-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo。新归档拒绝门额外运行`node --test --test-name-pattern 'Bundle pack refuses' tests/harness-plugin.test.cjs`，[负对照](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-bundle-pack-denial-20261031-1.log)退出0、1 pass，观察外部pack进程退出0却报告空集合时不写交付清单，不重跑已通过Host组合。
- 同一runner实际执行`node clients/harness-plugin/scripts/build-bundle.cjs --out output/harness-plugin-package-20261031-2vw_g0ti/bundle --harness-root clients/agent-desktop/harness --npm-cli output/agent-desktop-install-20261023-q16gtnf6/node-extracted/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js`，[交付日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-bundle-delivery-20261031-1.log)退出0，生成[候选包](../../output/harness-plugin-package-20261031-2vw_g0ti/bundle/rental-os-harness-plugin-0.1.0.tgz)与[清单](../../output/harness-plugin-package-20261031-2vw_g0ti/bundle/bundle-manifest.json)。归档SHA-256为`f0e44eaa2114bf5b5304581027c3d05ba58bf3e8c80afbbcf049c3d6b707fab0`，与最终原Loader测试的归档一致；23个文件、38,150字节压缩 / 128,587字节解包，bundled为空。实际npm保留一条继承的manage-package-manager-versions未知配置警告，退出0；本批各离线audit无文件。已将候选包 / 清单交用户保存，未签名或registry发布。
- 七份源码 / 文档前像在[保全](../../output/harness-bundle-closeout-20261031-k4ffqkqg/)，旧失败 / output全部保留。G门复核：AGP-01原75%不因打包达到G4，尚缺未含Rental补丁的用户原版安装 / 停用 / 升级和完整支持矩阵；AGP-10亦缺真实AS / Host / 业务及故障升级。当前原MCP身份 / grant、字段 / 持久计量与实际业务schema支持仍缺，其他任务不提高档位。本批未改插件运行源码、MCP / API / shared / Core / 知识附件 / 文件存储或原Harness，不安装到用户profile、启动服务 / 浏览器、外联、迁移、提交 / 推送，无独立审查。

## 阶段：原提案核对的客户端前置（2026-10-31）

MCP新增原选单提案只读子出口，不接decision / lease / 模型确认；原状态 / Core事实及原关联核对、两代SDK / 正式ESM组合2 pass与追加跨空间 / 查后失权的编译包1 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。原Harness实际schema仍拒绝UNSUPPORTED_SCHEMA，不删约束或注册，本端产品 / Host测试未改、不重复正常登录。原私有审查不能按schema直接外发，字段 / 固定MCP身份 / 持久目标未齐；AGP-08完整可信选择 / 报价 / 批准消费及执行仍未接通，不以MCP只读候选提高档位。[说明前像](../../output/mcp-proposal-read-closeout-20261031-6ngq3883/)和全部output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：原reader固定的消费者边界（2026-10-31）

MCP原对话结果 / Task恢复观察 / 精确操作 / 分页候选改为构造时固定原reader，原政策仍逐次读取；修前1 fail、修后源码 / 正式ESM及原组合5 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端产品 / Host测试未改，不重复无变化登录；实际输入schema仍不兼容、不删约束或注册业务，AGP和生产前置不因服务端修复跨档。[说明前像](../../output/mcp-reader-binding-closeout-20261031-wvwky9y3/)及全部output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：可信选择收据的客户端前置核验（2026-10-31）

MCP新增原quote-selection-read只读子出口，原状态 / 引用 / hash和当前权限读取验证见[MCP记录](../MCP服务/MCP服务-开发记录.md)：源码 / 正式ESM两代SDK组合2 pass，追加原查询后失权的编译包1 pass。原Harness对实际输入仍拒绝UNSUPPORTED_SCHEMA，未删约束、注册业务或把收据当模型选择 / 批准；本端产品 / Host测试未改，不重复无变化登录测试。原固定身份 / 字段 / 持久目标及AGP-08完整选择 / 报价 / 执行消费未齐，不凭MCP候选提高AGP档位。[说明前像](../../output/mcp-selection-read-closeout-20261031-ovz3nbu_/)及全部output保留，未安装、启服务、外联、迁移、提交 / 推送，无独立审查。

## 阶段：原Loader消费统一MCP服务（2026-10-31）

既有Host组合的独立AS主实现路径改用MCP正式service构造器，原发现 / code / token / MCP / disconnect均经同一服务，不再手工拼四个handler；原同意、grant、registration和store仍为外部事务夹具。原runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-service-composition-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前全插件strict / 声明、真实profile / Loader / Loop / SDK及既有材料 / unknown变体；断开后原family撤销、旧access标准401，凭据仍不进Session或存储原文。MCP正式ESM / 两代SDK2 pass与close迟到拒绝见[MCP记录](../MCP服务/MCP服务-开发记录.md)。插件产品源码不变，不重复建设AS。原AGP-02～09仍缺固定生产身份 / 字段 / 持久目标及实际业务消费或全部材料控制，AGP-10真实安装 / AS / Host / 业务及故障升级未验，连续G门不凭本地组合跨档。五份说明前像在[保全](../../output/mcp-service-closeout-20261031-rwukguyj/)，所有失败 / output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：同意内容比较的原Host消费（2026-10-31）

MCP原同意authorizer按普通JSON字段和值精确比较，不把存储键序当内容变化，额外字段及原授权内容变化仍拒绝；源码 / 正式ESM2 pass、修前1 fail见[MCP记录](../MCP服务/MCP服务-开发记录.md)。原runner执行`node --test tests/harness-plugin.test.cjs`，[原Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-consent-key-order-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含全插件strict / 声明及原Loader / Loop / SDK与主实现登录断开；本端源码不变。原生产身份 / 仓储 / 目标 / 字段和AGP门槛不变，[说明前像](../../output/mcp-consent-order-closeout-20261031-gi5k6b0t/)及全部output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：原选单结果的客户端前置核验（2026-10-31）

MCP原选单结果只读子出口已沿正式ESM及原请求绑定Task / 批准消费 / Core收据服务验证，保留committed / unknown / not_observed，不接执行或reconcile；实际命令及2 pass组合、追加跨用户拒绝的编译包1 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。原Harness校验器对实际输入仍拒绝UNSUPPORTED_SCHEMA，未删约束 / 新注册业务，本端源码与既有Host测试不变、不为前置片重跑正常登录。固定MCP身份 / 字段 / 持久目标未齐，AGP-08 / 09原门槛不因服务端只读候选提高；[说明前像](../../output/mcp-selected-order-closeout-20261031-77j3vdjv/)及所有output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：复用撤销主实现的原Host消费（2026-10-31）

MCP在原签发许可失效后仍沿原归属处置已用码 / refresh复用，不发新凭据；源码 / 正式ESM及跨client拒绝2 pass、修前1 fail见[MCP记录](../MCP服务/MCP服务-开发记录.md)。生命周期变更后，原runner执行`node --test tests/harness-plugin.test.cjs`，[原Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-owned-reuse-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，包含全插件strict / 声明、原profile / Loader / Loop / SDK及既有材料 / unknown路径；插件源码和驱动未改。原Web / grant / store仍为外部事务夹具，AGP原门槛及生产前置不因本次复验完成。五份说明前像在[保全](../../output/mcp-disabled-reuse-closeout-20261031-njilysni/)，全部失败和output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：原Loader消费随机一次性码主实现（2026-10-31）

既有[Host组合](../../tests/harness-plugin.test.cjs)独立AS主实现路径替换手工code保存，复用MCP当前原同意authorizer生成随机码并原子保存摘要 / 授权关联，随后标准303、token主实现、官方SDK握手及原disconnect撤销family / 旧access拒绝。原Web认证 / 同意和grant、store为明确外部事务夹具，不是模型声明批准或生产真库。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-persistent-authorization-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前全插件strict / 声明、真实profile / Loader / 原Loop / SDK及全部原材料 / 取消 / unknown变体；产品源码未改。MCP源码 / 正式ESM两实例并发、unknown commit和取消后零code交付2 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。生产仓储、可信原同意页 / grant及Auth / Guard / ALS、持久目标与字段仍缺，AGP原档位和全目标未满足。五份说明前像在[本片保全](../../output/mcp-persistent-authorization-closeout-20261031-yjki2af9/)，所有output保留，未安装、启服务、外联、迁移、提交 / 推送，无独立审查。

MCP当前资源回读已将缺family证据与明确无当前grant分开，缺证据保持unavailable；源码 / 编译包定向2 pass及修前1 fail见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端源码 / Host组合未改，不重复正常登录验证或计作新增客户端完成度；[说明前像](../../output/mcp-missing-family-closeout-20261031-ojrietjp/)及失败output保留。

## 阶段：原Loader消费token生命周期主实现（2026-10-31）

MCP已补原持久事务内码消费、随机token摘要存储、refresh轮换 / 复用撤销及当前资源回读，源码 / 正式ESM与原失败边界见[MCP记录](../MCP服务/MCP服务-开发记录.md)。既有[Host组合](../../tests/harness-plugin.test.cjs)增加独立当前owner的真实profile / Loader登录：标准AS元数据 / 授权回调 → 主实现随机token → 原SDK握手 → 原disconnect撤销family → 原access回读拒绝。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-persistent-oauth-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含全插件strict / 声明及全部既有原Loop / 材料 / unknown组合；access / refresh仅摘要持久、凭据不进Session日志、一次family与撤销结果均断言。存储及Web登录 / 同意 / 当前grant仍是显式外部事务夹具，未声明真库、真实权限或生产AS通过，产品插件源码本片未改。当前缺生产仓储 / 原Auth / Guard / grant / 审计、持久目标与字段，AGP原档位不凭本地组合跨G门。五份说明前像在[本片保全](../../output/mcp-persistent-oauth-closeout-20261031-73yc8v5l/)，所有失败 / output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查，持续目标尚未完成。

## 阶段：原登录消费精确授权码绑定（2026-10-31）

原Host登录的AS exchange夹具改为复用MCP S256 / client / resource / 精确callback校验，授权时保存实际code binding，host及临时loopback均经标准授权回调。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[首轮日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-code-binding-20261031-1.log)退出1：临时模式已选择新端口，但测试原码记录仍固定旧端口，真实绑定校验拒绝；仅修外部AS夹具记录，不放宽生产校验。随后[修正日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-code-binding-20261031-2.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前strict / 声明与真实profile / Loader / 原Loop / SDK及原回调清理 / 材料 / unknown组合。MCP源码 / 正式ESM及错proof运输3 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。原AS登录 / 同意、grant / 码一次性状态、HTTP / listener / 模型仍为外部夹具，不是持久码仓储或原子消耗验收；产品插件源码未改。五份说明前像在[本片保全](../../output/mcp-code-binding-closeout-20261031-kdern1wg/)，失败和全部output保留，原G门与持续目标未满足，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：原登录消费AS标准授权回调（2026-10-31）

既有[Host组合](../../tests/harness-plugin.test.cjs)的系统浏览器替身接入MCP public-client-authorization-endpoint：原SDK生成S256授权URL，经当前登记校验和明确外部AS登录 / 同意 / code边界，取得303 Location，再交原Host一次性回调。原state / issuer错误及重复回调拒绝保持，不再手工构造成功回调；产品插件不改Host或新建AS / UI。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-authorization-endpoint-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前strict / 声明、真实profile / Loader / Commands / Session / 原Loop / SDK、材料及失权生命周期；MCP源码 / 正式ESM 2 pass及迟到拒绝证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。实际AS认证 / 同意 / 一次性码和登记、浏览器 / listener / HTTP / 模型仍为外部夹具，不是持久grant / 原身份或真实登录通过。五份说明前像在[本片保全](../../output/mcp-authorization-closeout-20261031-qk3_5y_2/)，全部output保留，原G门与持续目标未满足，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：非法token表单拒绝的消费者边界（2026-10-31）

MCP标准token运输将非法UTF-8按400 invalid_request在登记 / AS前拒绝；源码 / 正式ESM回归2 pass及原失败见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端产品 / 既有Host测试未改，正常SDK表单行为不变，不重跑已通过的原登录组合；AS就绪、登记与签发仍为外部夹具，实际生产固定身份 / grant、持久目标、字段和业务schema未齐，AGP原G门与持续目标保持。五份说明前像在[本片保全](../../output/mcp-token-utf8-closeout-20261031-wogioahe/)，所有output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送。

## 阶段：原登录消费受控AS元数据（2026-10-31）

既有[Host组合](../../tests/harness-plugin.test.cjs)原登录的AS discovery改为经过MCP authorization-server-metadata发布代码，接同一固定外部AS文档，不再直接Response.json返回；原资源发现、token交换 / 撤销及原SDK继续消费，产品插件不复制AS或新建驱动。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-as-metadata-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前strict / 声明及真实profile / Loader / 原Loop / SDK、回调与材料 / unknown生命周期。MCP正式ESM与两代SDK discovery的2 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。原AS就绪 / 登记 / 签发、HTTP / listener / 模型及政策仍为外部夹具，不证明真实登录 / 同意、持久grant / 原身份或业务首片。原G门与持续目标仍未满足；五份说明前像在[本片保全](../../output/mcp-as-metadata-closeout-20261031-l8ta2lex/)，所有output保留，未改Host / vendor / API / shared / 后台 / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原风险描述的客户端前置（2026-10-31）

MCP七项固定运输映射补原R0 / R1 / R2风险类型，不开放业务或扩大客户选择结果；当前工具 / schema版本仍等实际生产者。源码 / 正式ESM、原baseline核对及全包strict的2 pass见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端插件 / Host测试未改，最近原登录 / disconnect消费标准token运输的1 pass保持原范围、不重跑；原字段 / 持久目标 / 固定grant及业务schema缺口未齐，不从映射描述提高AGP档位。五份说明前像在[本片保全](../../output/mcp-business-risk-closeout-20261031-oyyjw007/)，所有output保留，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，持续目标未完成。

## 阶段：原登录消费标准token／撤销运输（2026-10-31）

- 既有[Host组合](../../tests/harness-plugin.test.cjs)抽取本树运输源码加载器，原登录的官方SDK授权码交换与disconnect撤销经过MCP新token / revocation处理器，不再直接返回token HTTP夹具。原AS方法仍是显式外部签发 / PKCE / 撤销边界，登记为固定快照；后续并发refresh / 401 / unknown的专门原夹具保持，不称全部Host refresh已经过此处理器。插件产品源码本片未改，没有第二授权驱动、业务代理或Host补丁。
- 原offline runner执行`node --test tests/harness-plugin.test.cjs`，[初片日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-oauth-token-transport-20261031-1.log)退出0、1 pass。MCP补返回前登记复验后，[首次消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-oauth-token-current-20261031-1.log)退出1：测试登记reader每次重造expiresAt，真实复验拒绝变化、原login返回unknown。只改夹具读取同一登记快照，不放宽复验；[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-oauth-token-current-20261031-2.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前全插件strict / 声明、真实profile / Loader / Commands / Session / Tools / SystemPrompt / 原AgentLoop / SDK和原撤回、取消、回调清理 / 材料组合。预期非法配置警告保留。
- MCP源码 / 正式编译包2 pass、登记变化屏障及停用后撤销证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。拒绝迟到token不证明AS未签发或已回滚，200撤销不消除原unknown；原AS / 登记 / listener / HTTP / 模型及政策仍为外部夹具。原固定身份 / 持久grant、目标计量、正式字段及目录schema仍缺，AGP原G门与全项目标未满足。五份说明前像在[本片保全](../../output/mcp-oauth-token-closeout-20261031-t_54a7qq/)，所有失败 / output保留；未改API / shared / Prisma / 后台 / Host / vendor / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：AS预登记请求校验的消费前置（2026-10-31）

MCP已提供固定AS地址 / public client登记的授权请求预检查，实际消费官方SDK的S256 / state及精确回调规则；源码 / 编译包2 pass及原登记、AS尚缺的边界见[MCP记录](../MCP服务/MCP服务-开发记录.md)。它不签发grant或做原登录 / 同意，不能将校验成功当插件真实授权。原Task的calls是Gateway模型计量，不等于MCP20次业务调用目标；本端不自报人工豁免、不建local Map或借Run lease。插件源码与Host测试本片未改，未重复运行，最近固定目录运输名的原组合证据保持其原范围；原生产身份 / 字段 / 持久目标仍缺，AGP原登记不跨G门，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送，目标尚未完成。

## 阶段：固定目录运输名的原Host消费（2026-10-31）

MCP新增七项原业务码的版本化运输映射，四项读取与报价 / 提案保存、原批准建单分开；公共运行时 / 严格产物及两代SDK证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端既有真实Loader / 原ToolRuntime / AgentLoop夹具改用固定`rental_catalog_search`，插件源码不复制映射或扩大白名单。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-business-mapping-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前strict / 声明、原MCP工具桥 / 日志及原材料、撤回和unknown路径。schema / reader及外部身份 / HTTP / model / policy仍为明确synthetic；目录运输名兼容不是生产目录、原身份 / 持久目标或字段许可验收。真实目录公共schema和原生产前置未齐，原任务登记保持；无安装 / 启服务 / 外联 / 迁移 / 提交 / 推送，不接主线文件ACL活动WIP。

## 阶段：并发失权不提交迟到检查成功（2026-10-31）

- AGP-03原[check](../../clients/harness-plugin/src/oauth-session.ts)在发现结果提交点再次核对exact owner的当前connected状态，不只比较client对象。另一并发请求收到401 / 403时client可能未换；迟到发现不能恢复指引或发成功反馈。原单refresh / 无重试 / 原owner和截止不变，错误清空指引但不伪称远端撤销。
- 原offline runner执行`node --test tests/harness-plugin.test.cjs`，[修复前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-check-current-before-20261031-1.log)退出1：第一条真实SDK发现响应被屏障持有，第二条401令连接失效，第一条随后返回success。修复后[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-check-current-fixed-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前插件strict / 声明、原Loader / SDK / Loop和全部既有组合。两请求各发送一次，迟到结果error / 无指引，后续check不发旧token；屏障在finally释放，不使用sleep、增加超时或跳过原断言。
- 五份说明前像在[本片保全](../../output/harness-check-current-closeout-20261031-5448i1ty/)，失败及所有产物保留。AS / HTTP / listener / model及政策仍为外部夹具；无真实撤销 / 多实例 / 生产登录证据。原身份 / 持久目标 / 字段与完整恢复缺项保持，AGP原登记不跨G门，目标尚未完成。未改MCP源码 / Host / API / shared / 后台，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：回调清理失败不保留可用身份（2026-10-31）

- AGP-03在原[OAuth所有者](../../clients/harness-plugin/src/oauth-session.ts)把回调清理纳入登录完成条件。清理失败明确unknown，清空指引、取消连接寿命、撤下读取 / 模板、清除到期计时器并关闭原客户端；已知token只保留给disconnect的原撤销请求，不留connected入口，不重发 / 重新授权。关闭不确定或AS接受撤销都不把unknown自动变成已核实；本地拒绝不证明路由 / OS监听器实际关闭。
- 原offline runner执行`node --test tests/harness-plugin.test.cjs`，[修复前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-callback-cleanup-before-20261031-1.log)退出1：实际原Loader / OAuth SDK握手后，外部callback disposer抛错，登录报error但status仍“已收到凭据 / 完成握手”。[修复后日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-callback-cleanup-fixed-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前插件strict / 声明与原Loader / Loop / SDK组合。错误后unknown / 无指引、check / login零请求、known refresh只向原revocation请求、私人异常和token不进原日志均验证；后续原单refresh / 401 / 取消和业务访问拒绝断言保留。测试只在自己的listener替身控制清理失败，配置重载创建新实例不当成旧grant核对。
- AS / callback listener / HTTP / 模型和业务政策仍为外部夹具，未证明真实OS清理、远端grant或生产登录；原固定身份 / 持久目标 / 字段及完整恢复缺口保持，AGP原登记不跨G门、目标尚未完成。五份说明前像在[本片保全](../../output/harness-callback-cleanup-closeout-20261031-ydailcpr/)，失败及所有原产物保留。本片未改Host / vendor / API / shared / 后台或原AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，没有独立审查。

## 阶段：纯自动指引历史的材料上限（2026-10-31）

- AGP-05在[材料检查](../../clients/harness-plugin/src/model-material.ts)增加原system消息及一次调用system文字的版本化Rental指引识别。原Host把自动section记录为system-prompt消息，没有section名称；插件重载后只剩该指引的历史仍须执行完整256 KiB检查。识别只保留大小限制，不授予身份 / 工具、不改写消息 / 日志、不重发或启动业务；普通user消息引用和无关system指引不因此受Rental限制。已有Prompt / 工具记录和原Session检查保持。
- 原offline runner执行`node --test tests/harness-plugin.test.cjs`。第一份[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-guidance-material-before-20261031-1.log)退出1，窄Python插入测试时换行转义成为字面换行，导致SyntaxError；仅修夹具字符串，不当业务缺陷复现。第二份[修复前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-guidance-material-before-20261031-2.log)退出1，真实Loader重载后纯system指引超限未拒绝（Missing expected rejection）。随后补识别，并把验证改为原AgentLoop / JSON日志重建的实际system消息，不用手写消息冒充日志证据。
- [最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-guidance-material-final-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前插件全部源码strict / 声明、真实profile / Loader / AgentLoop / SDK及原取消 / 撤回 / 材料组合。重载且无登录 / initiator时纯日志system指引和一次调用system标记均拒绝超限；完整262,144字节可用，多字节增量拒绝且零adapter派发，原system日志不变。普通引用和无关system指引仍可派发，历史不能恢复旧工具或资源访问。外部AS / HTTP / browser / listener / 模型和服务政策为夹具，不等真实模型 / 磁盘重启 / 企业受管材料通过。
- 说明前像在[本片保全](../../output/harness-guidance-material-closeout-20261031-5j8i5mp4/)，失败日志和所有原产物保留。AGP-05仍缺正式字段 / 目的地 / 派生 / 完整留存与恢复控制，原任务登记不跨G门；全项目标未完成。本片未改Host / vendor / API / shared / 后台或原AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，没有独立审查。

## 阶段：指引快照的原Host消费（2026-10-31）

MCP instructions / Prompts已固定端点provider方法，并按普通JSON数据描述符捕获获准指引，拒绝getter / 字符串转换 / 继承字段，当前政策及撤回仍动态；修复前竞态、3 pass行为、根运输strict / ESM消费及全包超时边界见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端插件源码未改，原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-guidance-snapshot-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前strict / 声明、真实profile / Loader / 原Tools / SystemPrompt / AgentLoop / SDK与模板取消 / 撤回。预期非法插件配置的Loader警告保留，外部身份、浏览器 / listener、HTTP / 模型及政策仍为夹具，不宣称实际安装 / 登录 / 模型采用。原任务与全项目标未完成，生产身份 / 字段 / 计量、Host严格材料与目录合同缺口保持；未改主线公共WIP或Host，未安装、启服务、外联、迁移、提交或推送。说明前像在[本片保全](../../output/mcp-guidance-closeout-20261031-brw8u_6c/)。

## 阶段：固定MCP定义的原Host消费（2026-10-31）

MCP端点已固定构造时的工具定义 / schema和原provider方法，动态政策仍逐次读取；竞态修复与4 pass证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端只调整既有Host测试，令不兼容schema从该测试tools/list返回，不再靠修改端点旧定义制造新发布；原拒绝断言保持。`node --test tests/harness-plugin.test.cjs`沿offline runner执行，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-fixed-definition-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，插件源码未改，当前strict / 声明、真实Loader / ToolRuntime / 原Loop / SDK、取消撤回组合通过；外部模型 / HTTP / OAuth / 原业务政策仍为夹具。

目录公共schema、固定生产身份 / 字段 / 持久目标准入及Host完整schema支持未齐；本端可用名称仍限48字符，原HostpublicToolName未从正式包导出，不深导入、不另写命名算法。缺口保留，不通过改配置或削约束启用；原登记与正式验收保持，目标尚未完成。未修改Host / vendor / 主线公共文件，未安装、启服务、外联、迁移或提交 / 推送。

## 阶段：原元数据分页的消费前置（2026-10-31）

MCP原list候选已保留1～20条、原游标和page_not_total，源码 / 编译包两代SDK及原对话list实际组合退出0、2 pass；身份 / DB / 政策夹具及具体拒绝证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端插件未改，真实schema仍UNSUPPORTED_SCHEMA，不启用、不删约束、不计算总量；MCP分页通过不计作AGP消费。全项目标未完成，固定生产者和实际Host前置仍缺，原登记保持；没有安装、启动、迁移或外联、未提交或推送。

## 阶段：原操作收据消费前置复核（2026-10-31）

MCP原对话operation只读候选已按精确原键校验，缺收据不重发、不生成新键；两代SDK、当前MCP / shared编译产物和原对话readOperation仓储组合退出0、2 pass，实际证据及身份 / DB / 政策夹具边界见[MCP记录](../MCP服务/MCP服务-开发记录.md)。本端插件未改，原Host仍不支持真实输入schema，不削约束、不注册收据工具、不将MCP读取当AGP完成。AGP原登记保持。用户全项开发目标尚未完成，后续按原门槛推进，不接管主线活动审批 / 设置 / 对话变更；安装、服务、外联、真库 / 模型、迁移和发布仍未授权执行，未提交 / 推送。

## 阶段：原Task恢复观察的Host兼容边界（2026-10-31）

MCP新增原请求绑定Task / 步骤恢复状态只读候选，源码及编译包经两代SDK、原request-bound reader / Task仓储验证；not_observed不推定未执行，unknown原action与核对指引保留，跨用户 / 空间、原Task哈希错误及读后失权拒绝。命令、首轮夹具revision缺项与修正后通过见[MCP阶段记录](../MCP服务/MCP服务-开发记录.md)，本册不重复计实现。固定MCP身份 / 字段 / 持久目标仍缺，原Web身份 / DB和MCP政策仍为夹具，不当成生产接通。

插件源码本片未改，未重复运行未变的Host组合。原Harness对实际公共输入仍拒绝UNSUPPORTED_SCHEMA，未削减约束、注册恢复工具、发模型或加入取消 / 接管 / 重发动作。AGP-01维持75%，其余0%，正式0/10；G4实际分发 / 安装 / 真实环境及各项固定消费者前置仍缺。主线审批v2 / 设置恢复 / releaseUnstarted仅是通知，本端未读取其活动WIP或自动接入，后续获准消费需核对固定公共版本；不向其他会话发消息。前像见[本片保全](../../output/mcp-recovery-closeout-20261031-crwb66uu/)，当前接续保持本树范围，所有成果未提交 / 不清理，未安装、启服务、外联、迁移或推送。

## 阶段：原结果稳定快照的消费者边界复核（2026-10-30）

MCP原结果候选已补输入 / 完整结果稳定普通JSON快照，编译包经两代SDK实际调用原对话应用、原结果服务及artifact仓储；unknown空正文、内容哈希 / Run错配、换用户 / 空间和读后失权拒绝，读取前后持久状态不变。实际命令、首轮夹具失败与最终2 pass / 4 pass、私有32 KiB / 128 KiB和外发独立上限见[MCP阶段记录](../MCP服务/MCP服务-开发记录.md)，本册不重复计服务端实现。原Web身份 / 数据库及MCP政策仍为明确夹具，不能当真实MCP授权、持久计量或字段许可。

本批未修改Harness插件源码或新增业务工具消费。原Harness仍拒绝实际输入schema的UNSUPPORTED_SCHEMA，没有削减约束、启用工具或确认AIN-02全端冻结；本批也未重复运行未改动的Host组合，之前人类Prompt / 原Loop证据保持其2026-10-29范围。按原G门，AGP-01维持75%，其余维持0%、等权7.5%、正式0/10；AGP-01的G4原版实际安装 / 分发 / 所需真实环境及其他任务的固定生产者 / 消费前置未齐，不凭MCP原读取绿色跨档。

负责人“继续下一批”后恢复开发，接续已覆盖旧暂停现场；本树HEAD核对为69c6c89e，旧成果由整合线保全提交，本会话本批未提交或合并。记录 / 接续修改前像在[本阶段保全目录](../../output/mcp-stable-closeout-20261030-vlml49sy/)。固定AS / grant / 原身份、正式字段 / 来源 / 期限、持久目标及Host材料生命周期仍是下一入口；不因其他会话通知接管shared、后台、租户官网或主树权限 / Core / 支付文件。未安装、启服务、外联、读环境、迁移、清理、提交、推送或独立审查，所有output保留。

## 阶段：原结果消费缺口与重启收口（2026-10-29）

MCP新增原对话modelResult只读候选，复用shared正式输入 / 原结果与固定原关联校验，实际源码 / 编译包 / 两代SDK证据见[MCP阶段记录](../MCP服务/MCP服务-开发记录.md)。当前原Harness公开schema校验器对真实输入的minLength / maxLength / pattern等约束拒绝UNSUPPORTED_SCHEMA；没有削减schema、注册工具或将当前Tools / Prompt绿色算为该结果实际消费。原AS / Guard / ALS、外发字段 / 持久目标和部分原组件出口也未齐，不能确认AIN-02全端冻结或开放生产业务。按负责人重启要求收口，客户端本片源码未扩展，保留之前显式模板的最终离线证据；当前源码 / 文档 / 失败日志和output全部本树未提交，不清理、不提交、不向其他会话回复。任务原登记不变，下一入口按两专项接续，重启先核对树 / HEAD / WIP归属再继续。

## 阶段：人主动选择MCP模板与原消息消费（2026-10-29）

- AGP-04 / 05在[原插件入口](../../clients/harness-plugin/src/index.ts)增加默认关闭的`readPrompts`名称白名单、`/rental prompts`列表与`/rental prompt <名称>`选择；只接受一个合法名称，不收业务参数 / 附件，不写原命令参数。列表只读当前目录 / 版本 / 说明，不读正文、不发模型；正文经同一私有官方SDK连接读取，最多50项 / 无续页、单条user text、说明 / 正文版本一致、完整2,000字符及15秒 / 更短连接截止。名称不是授权，不自动读取全部模板或要求Tools启用，未增加依赖 / Host补丁 / 固定UI。
- [模板消费者](../../clients/harness-plugin/src/mcp-prompts.ts)以原Agent的`runMaintenance`空闲占用串行选择；活动turn或另一维护占用立即拒绝，不排队。最后检查原Agent登记、原Session、当前连接及取消后，同步通过`followup`提交普通`rental-prompt`用户消息，带名称 / 版本 / instructions形式与服务端归属正文。原inbox / user/message沿原Loop记录并组装，自配模型费用照常；反馈只确认提交，不是完成或业务批准。该来源通过原MessageSourceMap扩展，未新增持久事件或聊天库。
- 未提交阶段的命令 / Agent取消、断开 / 401 / unknown、Agent销毁、插件重载及模型服务移除取消 / 等待所属操作，迟到正文不注入。已提交普通Host历史不删除、已启动原模型不因本地断开被冒称停止；没有重放旧操作或换ID重试。原[材料检查](../../clients/harness-plugin/src/model-material.ts)增加已日志记录的Prompt来源识别，原消息重建 / 插件重载后即使无登录或initiator仍检查完整256 KiB，不授予读取权；丢来源 / 自动instructions / 派生摘要和最终Provider线包仍不保证。
- 实际使用既有offline runner执行`node --test tests/harness-plugin.test.cjs`：[首轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-explicit-prompts-20261029-1.log)退出1，原CommandRuntime取消抛AbortError，测试错误预期了返回错误结果；按原语义修断言，没有放宽权限 / 取消要求。[第二轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-explicit-prompts-20261029-2.log)退出0；补Agent销毁 / 插件重载及恶意响应消费后，[最终组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-explicit-prompts-final-20261029-1.log)退出0，1 pass / 0 fail / cancelled / skip / todo，含当前全部源码strict编译、NodeNext声明、真实profile / Loader / 原AgentRegistry / ToolRuntime / SystemPrompt / LlmRuntime / AgentLoop与官方MCP SDK。外部AS / HTTP / 系统浏览器 / 监听器、政策provider和模型输出仍为明确替身。
- 覆盖列表零正文 / 模型、名称白名单 / 未发布拒绝、忙碌维护占用、原Agent / Session变化、一次选择一条来源消息 / 原模型续轮、原JSON日志重建与Prompt-only材料重载；版本更新、字面变量、错版本 / 错角色 / 超限正文及私密错误拒绝；用屏障观察命令取消、Agent取消 / 销毁、断开、插件重载、模型服务移除的在途读取及迟到完成，零迟到消息 / 模型，无sleep / 自动重试。原Tools / instructions被动组合仍先验证Prompt正文零读取，选择入口缺失不阻断它们。
- 按原G门复核，AGP-01仍75%；AGP-04正式schema / 固定grant / 原目标准入、05完整字段 / 派生 / 发送 / 恢复设计未齐，不能借本片局部日志 / 来源检查跨档，其他登记及正式0/10不变。生产指引许可、真实OAuth / OS / 模型、磁盘 / 全fork及安装未验。未改正式需求 / 任务正文、原AGC / 工作台 / Harness / vendor、API / shared / Prisma / rootlock；未安装 / 启服务 / 外联 / 迁移 / 提交 / 推送，没有独立审查。服务端独立对话接点通知不授权本片接管或迁移该他线WIP。

## 阶段：MCP可选Prompts不阻断原工具消费（2026-10-29）

MCP新增标准可选Prompts发布，服务端实现 / 两代SDK / 取消差异及产物证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)，AGP不重复记实现。现行插件产品源码不获取Prompts或将其强制注入SystemPrompt；既有Loader组合为原MCP服务添加明确synthetic Prompt provider，用原AgentLoop验证Tools / instructions仍独立工作，Prompt正文零读取 / 零模型注入。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-optional-prompts-20261029-1.log)退出0、1 pass / 0 fail / skip / todo，含当前全源strict编译 / 声明、原工具桥 / Loop / 材料 / 释放。没有新增Prompt UI、真实模型采用或生产指引许可；任务原登记保持，未改原AGC / Harness源码、API / shared / Prisma / lock，未安装 / 启服务 / 外联 / 迁移 / 提交 / 推送。

## 阶段：原任务G门复核（2026-10-29）

- 按原[任务§7](Harness插件-开发任务.md#7-进度与执行边界)复核，不改任务范围或门槛。AGP-01的G1：已定位原MCP / HTTP / credentials / SystemPrompt / Tools / Loader消费者，固定dsh0.2.1-rc.2、协议代次及独立Bundle实施设计，明确必要授权增强和原生复用 / 不可保证项；G2：manifest / patch / 四项函数入口、固定peer / engines及唯一连接复用主实现已交付；G3：当前全源strict编译、NodeNext声明消费及真实profile / Loader / 原工具桥 / AgentLoop组合通过。故AGP-01登记75%；用户profile安装 / tarball / 未含Rental补丁原版的完整组合及所需真实环境属于G4，仍未通过。
- AGP-01的MCP-01共同依赖按适用子交付核对：协议 / SDK / resource地址规则已由生产者及消费者固定，不要求先等全部业务映射100%。MCP-01整体仍缺现行正式能力 / 公共schema / 首片字段；不能因该部分未齐，将Bundle已经完成的G1～G3倒退为零，也不能借Bundle把MCP-01提高。
- AGP-02治理 / 固定grant合同、03完整恢复 / 撤销适配、04正式工具 / 字段 / 原目标准入、05完整材料设计、06～09原资源 / 业务生产者、10完整组合均仍有原G1缺口。它们的局部代码及替身证据保留，不按测试数分摊为完成，登记保持。等权汇总更新为7.5%，正式0/10；这不是生产工具启用、真实登录或安装许可。
- 纠正此前以“未真实安装 / 完整生产者”一并阻止AGP-01所有档位的记录用法；旧阶段历史不覆盖，当前任务以本次逐门证据为准。没有独立审查、真实模型 / DB / 外联或提交 / 推送。

## 阶段：MCP内部主体契约的Host兼容（2026-10-29）

MCP verifier / 内部授权引用新增必需可信subject，注册、指引和返回前主体复核见[MCP记录](../MCP服务/MCP服务-开发记录.md)。Host不接收或持有该主体；既有离线AS verifier夹具按新内部契约提供synthetic subject，插件产品源码不因此增加字段、授权或旁路。`node --test tests/harness-plugin.test.cjs`经原offline runner，[消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-subject-consumer-20261029-1.log)退出0，1完整组合 / 0 fail / skip / todo，含当前strict编译 / 声明、原Loop / MCP / 日志、材料及服务释放。仍是外部替身，不计原Guard或生产授权通过；本片不重复记MCP实现、未安装 / 启服务 / 外联 / 迁移 / 提交 / 推送。

## 阶段：原模型材料准入与AgentLoop日志消费（2026-10-29）

- AGP-05新增`model-material.ts`，从原`llm/stream` waterfall检查完整中立请求的JSON序列化UTF-8字节，除取消signal外含消息 / system / Tools / history及重复表示，最多262,144字节；超限或序列化失败抛原`LlmError`的`RENTAL_MATERIAL_UNAVAILABLE`，不截断 / 改写历史、不发该次模型请求。绑定过的原Session在插件加载期间保留材料限制，断开只撤销调用资格，不让历史重用绕过上限；无关个人Session及正常大小输入保持原行为。原请求含`mcp__rental_os__`工具声明、toolHistory的声明 / 更新或调用 / 增删记录时，不依赖进程内登录标记或发起Agent也检查；插件重载后由这些已有记录收紧检查，不恢复业务授权。
- AGP-04只读工具注册置于该模型材料检查所有者下；缺原LlmRuntime时相关login拒绝，运行时移除LlmRuntime同步撤下读工具、使旧执行器不可用并关闭私有连接，不因其他Tools / Agents仍在就继续提供无检查的Rental读取。默认配置、无业务工具的连接检查与个人功能保持；原llm新增可选peer仅声明，未安装或改rootlock。
- 真实原AgentLoop以脚本模型输出驱动第一次MCP调用及第二次模型请求。已观察同源版本化指引进入`system/message`，释放事实经`tool/result`进入下一模型材料，`request/header`保留原准备记录；序列化Session事件重新创建对象后，`deriveMessages()`与原消息一致。这里只验证原日志重建，没有新增聊天库、原Host循环补丁或持久格式；磁盘写入、进程重启 / fork / 摘要恢复未验。
- 实际命令均经既有offline runner：`node --test tests/harness-plugin.test.cjs`，中立材料`harness-material-20261029-1.log`、原循环`harness-material-loop-20261029-1.log / -2.log`、断开Session`harness-material-session-20261029-1.log`均退出0。[服务生命周期组合日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-material-service-20261029-2.log)与最新[历史重放组合日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-material-replay-20261029-1.log)均退出0：1 pass / 0 fail / skip / todo，含全插件strict编译 / 生成声明消费、真实Loader / AgentRegistry / ToolRuntime / LlmRuntime / AgentLoop / MCP SDK。精确256 KiB可用、加1字节 / 多字节超限零模型派发、断开后旧Session仍拒绝、正常输入及无关Session仍可用；原循环断开后超限记录稳定错误且零adapter派发；移除模型服务后旧执行器和新登录均零请求。最新重放组合还验证插件重载后原日志重建的材料在无登录 / 无initiator时拒绝超限，单独历史声明和单独调用记录均覆盖；个人请求不受影响，旧历史不能恢复MCP业务访问。
- 服务组合第1轮退出1：夹具停用llm但仍启用必需依赖它的agent-loop，真实Loader拒绝启动。改为初始同步停用该原消费者，再按真实服务就绪依次启用；未修改Host、放宽启动要求或增加超时。先前绿色仅代表当时版本，最终证据为上述第2轮；全部失败与隔离产物保留。
- 剩余：该接点在文件 / 图片投影、adapter中间件和供应商线包之前，不保证最终HTTP字节或重定向目的地；无发起Agent且无上述工具记录的直接调用、仅含结果正文 / 指引的恢复、派生摘要 / 导出未纳入；Session对象重建、插件重载及跨重启不继承进程内材料标记。原工具记录仍存在的请求可重新收紧上限，但不是完整fork / 磁盘恢复或派生材料识别。标记不是授权，严格目的地 / 每次原权限 / 强制到期类别仍不得发布。普通聊天输入不由本插件预脱敏；实际模型、OS监听 / 浏览器、真实AS / 原Guard / 持久目标 / 正式字段及完整Host矩阵未验。
- 按原任务连续G门复核：AGP-05仅中立请求和同一Session生命周期子路径，完整输入 / 派生 / 外发与恢复设计尚未齐；AGP-04的正式schema / 原目标 / 字段生产者仍缺。其他任务不从此片推算，登记不按源码或测试量提高。没有改正式需求 / 验收、原AGC / 工作台、API / shared / lock或vendor，没有安装、启服务、外联、迁移、提交、推送或独立审查。

## 阶段：原公开MCP工具桥的精确Agent消费（2026-10-29）

- AGP-04新增`mcp-tools.ts`，通过原公开`createMcpToolDefinition` / ToolRuntime / Scope挂接同一私有OAuth连接，未改Harness源码或另建native业务通路。可选本地`readTools`名称只限制展示，必须由原契约作者提供；服务端发布、原权限 / 持久目标 / 字段前置不齐仍不得开放生产业务。默认无Tools、无自动请求；新增原Agent / Scope / Tools / MCP客户端peer仅声明，不安装或改rootlock。
- 登录 / 显式check后发现单页最多50个工具、无续页或聚合。只接受白名单、明确只读 / 非破坏、闭合schema且不需task扩展的发布项；Host不支持的schema整项不可用，不删约束。原名称直接发MCP、模型名称加`mcp__rental_os__`，一个官方SDK驱动、最长15秒及更短连接限制、无自动重试。只接单份相同文本 / structured投影，错误不将SDK / 服务端私密明细交给原工具桥。
- 注册只属于精确且仍活跃的Agent和原Session；其他Agent / 会话不可见，子Agent继承层使用原限制器过滤，直接旧执行器仍按精确主体拒绝。401 / 403、refresh unknown、断开、Agent销毁、服务移除及卸载同步撤回注册、取消generation并等待已接纳调用；旧generation迟到结果不能重新发布。原Agent登记已销毁时不能check重新注册。服务端未推送撤权不意味着本地列表即时更新，每次真实调用仍复验，显式check再同步。
- 实际命令：`node --test tests/harness-plugin.test.cjs`经原offline runner，最终日志`harness-tools-20261029-9.log`退出0，1完整组合 / 0 fail / skip / todo，包含全部当前插件源strict编译、生成声明消费、真实profile / Loader / AgentRegistry / ToolRuntime / SystemPrompt / 原MCP桥和官方SDK。断言正常结构化读取、私有字段不返回、原计量被调用、未知actor拒绝、其他Agent / 子Agent / 旧执行器拒绝、发布撤回、unsupported schema拒绝、在途断开迟到拒绝、Agent销毁和卸载移除。HTTP / OAuth / 浏览器 / listener及业务providers均明确synthetic，没有真实模型循环、原Guard / Core / 持久目标或外网 / 端口。
- 中途失败保留：第1轮退出1为夹具从CLI解析未声明的Scope peer；改从真实MCP包出口解析。第2轮退出1为原Tools需SystemPrompt且服务尚未就绪；夹具补真实服务，产品沿原`ctx.inject`等待Tools / Agents并在缺服务时拒绝发起相关登录。第3轮退出1为卸载后通过Context读取已移除服务；改捕获原runtime检查移除。第4～9轮均退出0，分别覆盖后续必要生命周期 / 输入 / 非法schema变体及连接绑定的原Session释放；没有增加超时、隐藏警告、删除断言或skip变绿。
- 具体剩余：当前Host的JSON Schema子集不接受minLength / minimum等约束，本片拒绝而非降级；正式业务schema需原作者与Host共同固定，不能私造同名DTO。原AS / 固定grant / Guard、持久目标准入 / 操作引用、字段政策和256 KiB模型材料组装仍缺，因此没有生产目录、报价或任务能力。实际模型请求持久重建、真实Host / OAuth / 数据库 / 安装也未验；AGP-04只读工具消费子片有证据，完整G1合同依赖未齐不按局部测试量跨档。
- 未改正式需求 / 任务规则、原AGC / 工作台、API / shared / OpenAPI / lock；所有旧output、失败及隔离产物保留。没有安装、启动服务、真实网络 / DB / 模型、迁移、提交、推送或独立审查。下一入口为原固定生产者及模型材料可控组装，而非再加检查命令。

## 阶段：断开失败仍撤回本地身份（2026-10-29）

- 断开在transport关闭前撤回本地client / token / 指引，关闭失败不能保留可用身份或跳过一次原远端撤销；结果保持unknown / 未确认。失败登录也先撤下client和指引再关闭。撤销响应的body清理放在原请求内，停止等待后迟到应答仍不恢复身份。没有重试、换ID或声称远端回滚。
- `node --test tests/harness-plugin.test.cjs`经原offline runner，最新`harness-disconnect-cleanup-20261029-1.log`退出0；真实Loader / strict编译与生成声明消费、OAuth / 版本化指引既有组合通过。测试仅在精确关闭窗口注入官方Client.close失败并立即恢复，实际断言远端撤销仍发一次、错误不含内部正文、随后check零请求；明确外部替身，不是OS transport故障实测。所有旧失败 / output保留。
- 不改变正式业务范围或任务档位；真实AS、grant / 原Guard、持久目标、正式字段 / 指引政策、业务工具、模型请求持久重建和真实Host仍未接通。没有安装、启服务、真实网络 / DB / 模型、迁移、提交或推送。

## 阶段：同源指引的精确Agent / Session消费（2026-10-29）

- AGP-04复用原可选`SystemPrompt`，登录后消费官方MCP的当前版本化instructions，不复制业务提示词、替换complete或创建renderer。`mcp:rental-os`注册仅在发起登录的精确Agent与其原Session仍一致时贡献字面文本，另一会话 / 新Agent即使复用Session、fork / 子Agent和Agent重绑定不能继承。`check`更新 / 撤回，失败清旧指引，到期 / unknown / 断开不贡献，卸载移除注册；没有自动联网或工具驱动。
- `node --test tests/harness-plugin.test.cjs`最新日志`harness-instructions-artifact-20261029-2.log`退出0，真实Loader / profile / CommandRuntime / SessionStore / SystemPrompt、全部当前插件源strict编译及声明消费通过；覆盖1份指引、字面变量、版本更新、撤回、跨Agent / 会话 / 重绑定拒绝、失败 / 断开和卸载实际移除。第一轮该组合亦退出0，二轮仅新增重绑定与卸载断言后复验。OS浏览器 / listener / HTTP仍外部替身，无真实模型 / 端口 / AS。
- manifest新增原SystemPrompt 0.2.1-rc.2可选peer / dev声明，不安装、不改根lock。缺该服务的原组合仍可登录但没有指引，不称所有Host自动采用。完整文字最多2,000字符；server同源发布和完整包证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。
- 未接真实Agent模型循环、模型请求持久重建、全部材料生命周期或业务Tools；AGP-04仍缺正式发布 / 字段 / 原目标及完整工具消费，不以组装成功当全部G门通过。下一入口为这些固定生产者及原公开工具桥；依赖不明记录后转无阻塞项。原AGC、工作台 / API / shared / lock与所有output保留，未安装、启动服务、迁移、提交、推送或独立审查。

## 阶段：临时数字loopback回调与MCP只读接点（2026-10-29）

- 登录配置新增明确`callbackMode`：`host`沿现有本机WebServer精确路由，`loopback`沿Node临时HTTP数字监听。操作系统`listen(0)`原子分配端口；实际callback与登记URL仅端口不同，数字host / scheme / path不变。一次性回调 / 取消后释放监听，OAuth SDK使用同一实际redirectUri交换码，无需改Electron或启动Harness WebServer。远端Web / HTTPS回调、真实OS监听和浏览器组合仍未验。
- `node --test tests/harness-plugin.test.cjs`经既有offline runner，日志`harness-loopback-artifact-20261029-2.log`退出0，真实Loader / profile / CommandRuntime、所有插件源strict编译及声明消费通过；临时监听 / 浏览器 / HTTP为明确外部替身，验证port0、数字host、精确实际callback、关闭及disconnect，没有实际端口或GUI。前一类型收口`harness-loopback-types-20261029-1.log`退出0，MCP拆分后的消费者复验`harness-oauth-introspection-consumer-20261029-1.log`退出0。
- 服务端只读注册及完整65,536字节输出已沿真实两代SDK验证，详见[MCP记录](../MCP服务/MCP服务-开发记录.md)。插件尚未把Tools挂到真实Agent；原公开`createMcpToolDefinition`可复用，但必须绑定原session、发布契约、材料政策及原持久目标，不能仅握手后全量挂工具。持续目标下跳过缺原生产者的能力，不用mock当生产依赖。
- 原AGC与冻结工作台继续保留，未动Harness主程序、公共Auth / Guard / shared、依赖lock或现有产物。未安装、真实联调、迁移、提交、推送或独立审查。原G1完整client / 材料 / 发布合同仍未齐，AGP登记不按局部源码与测试数跨档；既有记录的“无临时监听”仅描述前阶段，本阶段当前模式见README / 接续。

## 阶段：进程内OAuth登录与唯一MCP连接（2026-10-29）

- 负责人明确解决三项接入缺口并继续开发，随后设持续目标。客户端不改Harness主程序，采用独立Bundle私有的官方SDK连接；复用原人类命令 / 现有Host精确路由，不挂第二份静态headers客户端、不注册native业务工具。新增`/rental login / disconnect`，已连接`check`用现代`server/discover`，未登录继续原无凭据发现。
- `oauth-session.ts`以私有字段持有access / refresh，绑定发起命令的原session对象；`oauth-host.ts`只用已经运行的数字loopback Host监听器及系统浏览器。官方SDK负责S256、授权码交换 / refresh；严格state / issuer / 回调 / 重复参数 / scope / 到期，配置显式启用和给定期限。token不写默认credentials、文件 / env / 日志，没有共享token getter；重启需重新登录。单次refresh必须轮换，401 / 403不重发，取消后迟到交换 / refresh不发布可用身份；unknown不因本地断开解锁重复登录。断开 / 卸载 / 本地寿命到期先停本地请求、清凭据，再分别报告RFC7009接受或未确认，接受不冒充整个grant核验。
- 边界：纯Electron file/IPC、远端Web以及长期OS安全存储 / 跨重启恢复仍未实现；同进程恶意插件 / 任意代码和OS管理员不在本片隔离保证内。原authorization成功必须写共享credentials，故未造占位flow或用默认明文文件兜底。原Auth / AS / fixed grant / Guard仍缺生产者且公共文件归服务端作者，业务继续关闭；本片标准客户端不能代替服务端真实身份。
- 定向命令均经原离线runner：`node --test tests/harness-plugin.test.cjs`最终日志`output/agent-desktop-install-20261023-q16gtnf6/logs/harness-oauth-session-20261029-8.log`退出0，真实profile / Loader组合、strict编译 / 声明消费、S256 / 一次性回调、无共享凭据 / 无日志token、错会话拒绝、并发单refresh、401不重发、交换取消 / 迟到 / unknown锁和释放通过。OS浏览器 / listener / HTTP为明确外部替身，无端口 / 真OAuth / 模型。1 / 2轮为可选配置及类型错误，4轮退出124：等待refresh的测试屏障未观察提前失败，实际现代协议已经删除ping；第5轮明确捕获该提前失败后改用现代发现。3 / 6 / 7 / 8轮分别完成相关验证，全部失败 / output保留，不提高超时或删断言。超时后核对无本片Node遗留，未停用户已有进程。
- 前像 / 冻结指纹在`output/harness-oauth-session-20261028-m3kvbehy/`；新产物仍在私有`harness-plugin-loader-*`。新增open11.0.4及Host webserver可选peer声明，仅使用本树既有依赖做验证，没有安装或改rootlock。原AGC、暂停工作台、API / shared / OpenAPI不修改，没有提交 / 推送。

已复核任务门槛：客户端主路径有代码和Loader证据，但未完成真实原版安装、服务端身份、长期凭据 / 完整恢复和业务工具消费，AGP登记未跨完整门。继续推进MCP资源身份验证的独立接点；原Auth / Guard、AS / grant持久化与后台治理的公共归属及成熟AS依赖需明确落点，记录后跳过，不用假生产者代替。

## 阶段：OAuth前置核验与真实接入阻塞定位（2026-10-28）

- 新增`/rental oauth-check`，通过既有Bundle / Loader / CommandRuntime消费官方SDK的RFC8414 / OIDC发现。只检查配置的public client格式、回调格式、精确issuer / authorize / token / revoke端点及声明的授权码 / S256 / scope；不启动浏览器、生成PKCE verifier、接收回调、交换或保存token。成功仍明确远端登记 / 回调归属未验、未登录；原`check`继续只核资源发现。
- 公共有界流读取移到插件内`discovery-response.ts`复用，原`./connection`错误类出口兼容。OAuth总截止覆盖资源与AS读取，每路径最多一次，仅404允许相同issuer标准OIDC路径回退，禁止跳转 / 拒绝后回退 / 隐式重试。SDK OIDC解析会移除撤销扩展，故在同一份有界原文核对两个撤销字段，其余仍由SDK解析，不放宽撤销条件。
- 核对实际Host链后确认三项前置：原Auth / Guard仅Web可变空间且由服务端作者维护，尚无MCP AS / 固定grant；原MCP HTTP工厂只有静态headers，无Bundle可注入的OAuth provider / transport工厂；`authorization.commit`必须写共享credentials，默认明文文件可被同OS用户读取，服务本身无按调用者隔离。没有用空grant / 假flow、Web token或静态headers冒充登录，未修改Harness / vendor / 服务端公共文件。
- 验证沿既有离线runner及固定Node / preload。`node --test tests/harness-plugin.test.cjs tests/mcp-foundation.test.cjs`首轮退出1：原MCP基础9/9通过，插件strict编译发现readonly配置与OIDC扩展类型两处不匹配；修正后第二轮仅插件退出1，原因是新配置拒绝消息不在旧测试预期中。补精确预期并加入AS流卸载取消后第三轮退出0；追加302 / 403 / 500不重试断言后第四轮退出0。最终日志`output/agent-desktop-install-20261023-q16gtnf6/logs/harness-oauth-inspection-20261028-4.log`：真实Loader组合1 pass / 0 fail / skip / todo，包含strict编译 / 生成声明消费、标准发现、替换 / 超限拒绝、取消及安全反馈。预期非法配置警告保留；HTTP全为进程内替身，不是OAuth服务或真实登录验收。
- 前像与冻结指纹保存在`output/mcp-authorization-20261028-7sh5xpq1/`；新编译 / profile产物沿`output/harness-plugin-loader-*`保留。两项新源、插件入口 / 文案 / README和两份既有测试变更；没有安装 / lock / 公共装配 / 环境读取 / 外联 / 迁移 / 提交 / 推送。只读接点探索不是独立安全审查。

已复核G1：授权前置可以诊断，但安全凭据、受支持的单MCP连接接点、服务端固定grant和完整安装仍缺，AGP-01～03不提高原登记。下一片须解决真实生产者 / 接点，不继续以检查命令代替登录；未经新确认不分叉原Host或自建通用OAuth服务器。

## 阶段：独立Bundle与原人类命令接入（2026-10-28）

- 负责人要求先认真核对Harness插件接入要求，再推进下一片。重新读取原architecture、插件配置 / 发布 / 生命周期、package-surface、commands和真实Loader / profile / 兼容源码；确认Bundle与profile不是同一对象，`dsh.bundle.patch`才激活配置层，函数插件只导出`name / inject / Config / apply`，服务通过peer共享，注册与异步工作由Fiber释放。
- 独立`clients/harness-plugin/`新增`src/index.ts`、typed中英`locales.ts`与`cordis.patch.yml`，manifest增加`.`真实入口、Bundle声明、固定`engines.dsh=0.2.1-rc.2`及Cordis / commands peer。patch仅插入本插件，不修改原Host / Electron / 全局配置，不自动连接MCP。上一片`./connection`保留兼容；没有增加业务native Tools。
- `/rental status`直接读取配置状态、`/rental check`显式执行原无凭据发现；使用真实CommandRuntime而非模型工具，命令原始参数不入`command/run`，结果进入原命令反馈 / 会话日志。只接受status / check，拒绝附件、未知配置 / token / headers；成功仍提示“需授权”，没有OAuth或业务资格。实例内一次检查、重载替换注册、卸载先禁新命令再取消等待，迟到响应不继续发现。
- 新增`tests/harness-plugin.test.cjs`：严格编译当前3源文件到本树私有output，NodeNext消费者通过包出口核对生成声明；真实profile按manifest / patch解析Bundle，再由原boot / Loader加载编译产物和原SessionStore / CommandRuntime。HTTP仅进程内替身、agent仅提供命令所用session/id，不运行完整模型循环；包解析测试钩子仅把外部依赖指向本树已有公开包出口，不写入产品源码，不复制node_modules。
- 实测纠正：配置transform的输入 / 输出类型需明确；CLI安装范围不包含commands的直接解析入口，改从该包公开出口解析；Windows Loader夹具需file URL。第三方插件失败不会让boot整体拒绝，故核对真实failed fiber / 命令不可用，未改宿主容错规则；配置重载可以复用Fiber，改核对实际handler替换和单份注册，不比较Fiber对象身份。
- 实际命令均经既有`run-offline.py` / Node24.21.0 / 固定offline preload与本树audit / TEMP：`node --test tests/harness-plugin.test.cjs`最终日志`logs/harness-plugin-artifact-20261028-8.log`退出0，1项真实组合测试通过（0 fail / skip / todo），包含strict编译、生成声明消费、无配置零请求、日志不留原参数、发现仍未授权、重载不联网、单检查、卸载取消 / 迟到、停用及非法配置拒绝。此前1～4、6轮失败保留；5、7轮分别完成基础和生命周期复验。预期非法配置产生Loader警告，不是测试失败；没有关闭警告或删除断言。
- 本轮前像 / 冻结指纹在`output/harness-plugin-bundle-20261028-deonpuuy/`，每轮编译 / profile保留于`output/harness-plugin-loader-*`。只新增插件入口 / patch / locale、修改本插件manifest / README及新增定向测试；上一片连接逻辑、MCP服务代码、原AGC与暂停客户端WIP不改。

尚未执行依赖安装、真实profile安装 / 打包发布、GUI / 原完整Agent验证、真实OAuth / grant / 安全凭据或业务工具；当前是经过Loader验证的连接检查Bundle，不是完整业务插件。原MCP客户端OAuth / 固定grant到Guard / ALS、可信计量与字段释放仍是下一片前置。没有新建心跳、外联、迁移、提交或推送；未做独立审查，不提高原任务登记值。

## 阶段：连接发现适配开始实现（2026-10-28）

- 负责人已恢复MCP / 插件开发。本片建立独立`clients/harness-plugin/`的登录前发现适配，与新`packages/mcp-server/`受保护标准入口通过真实官方SDK进程内相接；返回`authorization_required`而非已登录，不创建定制壳、固定业务页面或第二套native工具。
- 发现请求不带token / Cookie，仅访问配置的HTTPS资源及精确RFC9728地址，校验resource / issuer / header方式；拒绝重定向、发现替换、额外回退和超大文档，取消中止元数据流且迟到结果不能发布状态。原版MCP HTTP接点尚只有静态headers，OAuth / 安全refresh及实际Host挂载仍待下一片，不用明文token兜底。
- 当前包仅`./connection`适配模块，没有`dsh.bundle`、Cordis入口、登录UI或原生MCP装配；README明确不能作为已安装插件。新manifest声明官方client2.2.0、TS6.0.3 / Node类型22.20.1，未安装 / 生成lock / dist；测试借本树已有SDK解析，不把Harness相邻源路径写进产品进口。
- 离线行为第二轮8/8，增补流取消与收口后仅相关4/4和3/3复验通过；两个源根strict noEmit通过。首轮TypeScript7入口失败及全部命令 / 退出码见[MCP开发记录](../MCP服务/MCP服务-开发记录.md)。没有真实HTTP / OAuth / 模型或Harness GUI验收，没有独立审查。原工作台5源码与`tests/agent-desktop.test.cjs`、原AGC文档保全指纹未变。
- 首片尚未闭合登录 / grant / 安全凭据 / 会话绑定 / 原业务读取与计量；保持AGP0% / 正式0/10，不以代码量或空工具列表计整项完成。下一步接原身份和实际Host入口，不安装、启服务或执行生产动作。

## 阶段：MCP优先与Harness消费者职责收敛（2026-10-28）

- 负责人明确同意MCP共建方向并要求更新两边正式文档。插件需求 / 任务升v1.1，独立MCP四册v1.0建立；从首片开始经同一标准MCP服务，原生Harness能力足够可直连，插件只补必要连接 / 授权 / 空间 / 会话 / 指引，不再先做专用业务API或重复native工具。
- AGP-01～10编号及0% / 0/10保持，按本次方向调整任务职责与跨专项依赖：OAuth / 后台 / 字段 / 原目标资源 / 业务适配分别归MCP-02 / 04 / 05～09唯一生产者；AGP只记实际Host消费者和组合验收，服务端通过不自动计客户端完成。联合首片不等待全部Prompts / 其他Host / 报价建单，但最小授权、投影和可信只读计量是前置。
- 只读核对原Harness mcp-client README、transport及server instructions：已有Tools / instructions，但所读HTTP创建只传静态config.headers；未发现该接点已消费OAuth provider的证据，不宣称登录 / refresh已接通。相关缺口交AGP-01 / 03核实并补标准MCP客户端适配，不复制Web token或以明文配置兜底，SDK重试需遵守副作用不重发。
- 自主呈现继续保留，MCP-05发布同源业务指引，AGP-04只补作用域 / 去重 / Host能力说明；Prompts可选且不保证自动加载。服务器64 KiB输出和Harness256 KiB可控组装分开，不假称可以控制任意Host全部上下文或删除其副本。
- `output/mcp-first-docs-20261028-e3npzky8/`保留本轮前六份文档和11项原AGC / 暂停客户端指纹。原AGC五份文档未改，旧MCP v0.3仅加现行依据提示并保留正文；导航改为MCP服务生产者、Harness消费者及原AGC封存三个入口。不改同树服务端源码 / tests / 依赖 / AI Native四册。
- 定向文档核查和diff检查退出0：两专项各10项需求 / 任务 / 验收连续、跨专项依赖无环，原AGC文档与暂停WIP指纹保持；初轮校验器匹配 / 编号解析问题及实际命令见[MCP开发记录](../MCP服务/MCP服务-开发记录.md)，未改业务规则迁就检查。
- 本轮仅文档，未创建插件 / MCP工程、安装、启服务、读环境、真实HTTP / DB / 模型、迁移、提交或推送。下一实施以两专项接续及当轮授权为准，旧客户端WIP不继续修改。

## 阶段：明确插件供给与Harness自主呈现（2026-10-28）

- 负责人要求与后台AI运营官的动态呈现方向一致：插件负责登录授权、数据权限及业务 / 展示提示词，Harness取得获准数据后自主决定文字、表格、图表、报告或展示文件，不让插件提供固定业务页面。
- 只读对照[AI Native需求第10节](<../AI Native/AI Native-需求.md#10-管理后台与任务交互ain-r10>)、当前后台`AiTaskWorkbench` / `ModelText`及Harness原system-prompt / tools / Document Preview资料。后台正式需求允许动态代码，但所读当前后台组件仍以固定组合和安全文本为主；没有把需求或接口存在当作已实现 / 可直接移植。原版HTML静态与脚本预览的安全能力不同，本轮未作真实宿主隔离验证。
- 插件需求增加§1.3和AGP-R04的提示词 / 原生展示约束；任务§2.5明确AGP-04会话内提示词贡献、05生成物数据释放、07事实输出、10原生展示与降级验收。工具schema仍约束事实，最终版式不固定；不替换完整系统提示词、不新增渲染引擎，不让生成代码取得凭据、直接请求后台或伪造批准。必要正式核对沿原可信Web，重新排版不重执行业务。
- 仅插件四册更新，原AGC文档 / 原MCP设计保持不动。AGP编号、任务依赖和0% / 正式0/10不变；同日初版v1.0记录本次补充，不将文档计实现。修改前四册和12项原专项 / 暂停源码指纹保留在`output/harness-plugin-presentation-20261028-ksrzsxab/`。
- 静态检查：`python -I output/harness-plugin-presentation-20261028-ksrzsxab/check-docs.py`退出0，四册45个本地链接 / 3个锚点有效，10项需求 / 任务 / 验收编号、任务依赖及百分比保持；12项原专项六册 / 暂停源码与测试指纹未变，原两册v1.5恢复hash仍一致。`git diff --check -- docs/Harness插件`退出0；新四册尚未跟踪，格式以Python逐文件核查为依据，暂存仍为空。
- 尚未编写运行时提示词包、插件工具或新界面；未安装、启服务、运行产品测试 / 构建 / 模型、访问真实HTTP / DB或提交 / 推送。后续真实消费和呈现验收按插件任务进行，本轮不接管服务端并行WIP。

## 阶段：插件方向核查与独立专项建立（2026-10-28）

- 负责人停止定制客户端开发，明确要把Rental能力连同登录做成可安装Harness插件：人登录并获得授权后，由原Harness调用获准能力，未登录只影响Rental工具，不限制个人功能。随后明确原接入改造专项先封存，插件需求和开发文档必须单独立项。
- 已核对本树固定上游的Bundle / 配置层、授权flow、工具注册 / guard、输出value和UI插槽；源码接点见任务第2节。当前Harness树含Rental定制补丁，不是未改原版；接口存在只构成设计依据，未作独立包安装或真实授权验证。
- 插件正式内容此前误写入原接入改造两册并标v2.0。本轮先保全纠正前像，再将插件内容转入`docs/Harness插件/`，按新专项建立v1.0需求、开发任务、开发记录和协作接续；保留已拟定的AGP-R01～R10、AGP-01～10及AGP-A01～A10，不改其业务规则、任务依赖和验收范围，不以文档计功能完成。
- 原接入改造的需求 / 开发任务从改向前v1.5精确快照恢复到原路径，封存状态写入原接续及导航，不改原两册正文、AGC编号或百分比。原记录 / 评审保留历史，MCP沿现有唯一文件共用并修交叉引用；新专项不替换旧专项，也不混用验收分母。
- 本轮基线`0f59d1d4`；纠正前9份文档和指纹留在`output/harness-plugin-project-split-20261028-icyl9v5g/`。原v1.5双份快照继续保留，来源见[基线索引](../Agent接入改造/历史归档/方案基线/2026-10-27/README.md)。旧工作台5个源码文件及桌面测试共6项WIP在恢复时指纹未变，未覆盖、清理或接管并行API / shared / 锁文件。

### 文档核查

- `python -I output/harness-plugin-project-split-20261028-icyl9v5g/check-split.py static-check.json`退出0：核查13份文档、207个本地链接和1个锚点；原两册与归档 / output共6份字节副本一致，新专项四册齐备，10项需求 / 任务 / 验收编号及插件正文业务规则、任务依赖未因分目录改变。原记录 / 评审历史、9份纠正前像和6项暂停源码 / 测试指纹保持，错误为空。
- `git diff --check -- docs/Agent接入改造 docs/Harness插件 docs/文档导航.md clients/agent-desktop/README.md`退出0；Git仅提示后续LF / CRLF转换。未跟踪的新专项四册已由上述静态检查单独覆盖，不能只用Git差异检查代替。

### 尚未实施与验证边界

- 未创建`clients/harness-plugin/`工程、Bundle manifest、插件grant / OAuth生产者、安全凭据适配或业务工具；不得把旧预览或定制窗口当作插件功能。
- 尚需按任务依赖先落实原版独立安装、身份授权、会话绑定、数据 / 凭据控制、可信资源与恢复，再开放最少目录闭环；后续报价、建单及协同分别验收。
- 本阶段只做文档恢复与静态核查，不运行产品测试 / 类型 / 构建、浏览器 / Electron、真实HTTP / DB / 模型或迁移；未安装、提交、推送或发布。原客户端旧测试只按原记录解释，没有独立审查或新插件正式验收。
