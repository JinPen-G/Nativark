# MCP 服务：开发记录

> 专项：Rental OS MCP 服务；建立日期：2026-10-28。
> 正式范围见[需求](MCP服务-需求.md)，研发进度唯一见[开发任务](MCP服务-开发任务.md)，当前现场见[协作接续](MCP服务-协作接续.md)。按功能阶段记录，不复制原AI Native、AGC或AGP历史作为本专项实现。

## 阶段：输入校验错误的安全外发（2026-10-31）

- MCP-03 / 05适用错误路径在[原只读注册](../../packages/mcp-server/src/read-tools.ts)保留官方fromJsonSchema的原validator / 完整JSON Schema转换，只将失败issues换成固定不可用说明。SDK在进入本端handler之前会呈现输入校验错误，因此不能只靠handler的catch保护私人字段路径；校验失败或异常仍拒绝，不返回有效输入、不删原schema约束，拒绝发生在原authority / accounting / reader之前。
- [既有测试](../../tests/mcp-foundation.test.cjs)沿两代真实SDK对嵌套字段路径、值、额外actor、缺字段及minimum / maximum作拒绝和零调用检查，发现schema与原完整schema相同、正常输入仍读取。原runner执行`node --test --test-name-pattern 'MCP read input errors' tests/mcp-foundation.test.cjs`，[修前](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-input-error-before-20261031-1.log)退出1、1 fail，完整wire实际回显synthetic敏感字段路径。修正后执行`node --test --test-name-pattern 'MCP read input errors|compiled MCP package|read registration keeps' tests/mcp-foundation.test.cjs`，[修后](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-input-error-fixed-20261031-1.log)退出0、3 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext正式出口、协议固定与原reader / OAuth / Resources组合；两代完整响应不含拒绝字段路径 / 值，原权限 / 计量 / reader零新增。
- 七份前像在[保全](../../output/mcp-input-error-closeout-20261031-hthswluh/)，失败与全部output保留。原providers仍为外部夹具，非生产字段审批 / grant / Guard / 持久目标；插件源码及0.1.1候选未改、不重复正常Host回归。固定生产身份、前台目标及目录公共外发schema仍缺，原任务完整G门不提高，持续目标未完成。未改API / shared / Core / 知识 / 文件存储或原Harness，未安装、启服务、真实外联、迁移、提交 / 推送，无独立审查。

## 阶段：声明协议代次与拒绝行为固定（2026-10-31）

- MCP-01 / 03适用协议子片在[原端点](../../packages/mcp-server/src/index.ts)给每个官方McpServer显式设置2026-07-28 / 2025-11-25；SDK默认还含2025-06-18、2025-03-26及更早代次，不能以默认库支持扩大本服务声明。非初始化请求的未声明版本头由原SDK拒绝，不进入reader；旧initialize仍按规范在业务执行前反提议唯一声明旧代次2025-11-25，不自行解析或改造协议层。
- 在[既有测试](../../tests/mcp-foundation.test.cjs)新增两代客户端请求的固定版本检查，原runner执行`node --test --test-name-pattern 'MCP protocol pins' tests/mcp-foundation.test.cjs`，[修前](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-protocol-pin-before-20261031-1.log)退出1、1 fail，2025-06-18请求实际200而非400。修正后执行`node --test --test-name-pattern 'MCP protocol pins|compiled MCP package' tests/mcp-foundation.test.cjs`，[修后](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-protocol-pin-fixed-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext正式出口及既有OAuth / 原reader / Resources组合；现代发现仅2026-07-28，旧代次2025-11-25正常调用，更早及未知版本头均400 / 零新增reader，旧initialize反提议声明版本。
- 原身份 / 业务providers仍是明确外部夹具，非生产grant、Guard / 字段 / 持久目标；协议通过不提高完整任务门槛。只读核对本树API / shared后，固定MCP授权、前台业务目标准入及目录外发公共schema仍缺；目录原schema留API私有模块，不能深导入或用测试schema开放。插件源码与0.1.1候选字节未改，不重复正常Host回归或发送同包。七份前像在[保全](../../output/mcp-protocol-pin-closeout-20261031-u1giil4k/)，修前失败与所有output保留。未安装、启服务、真实外联、迁移、提交 / 合并 / 推送，未改API / shared / Core / 知识 / 文件存储或原Harness，无独立审查；持续目标未完成。

## 阶段：原Harness显式资源消费（2026-10-31）

插件同一私有官方MCP连接已接资源目录 / 单项text/plain读取及返回前目录复验，默认关闭，人类名称选择复用原inbox / Loop，不注册第二份Tools或继承式资源provider；资源来源与256 KiB模型材料、取消 / 断开 / 重载 / 模型服务移除和0.1.1预构建候选的实际失败 / 通过见[插件记录](../Harness插件/Harness插件-开发记录.md#阶段同一mcp连接的显式资源选择2026-10-31)。本端产品 / 测试未改、不重复正常回归；此前Resources两代SDK / 全包strict证据保持原范围。原服务端providers仍为外部夹具，非生产字段 / 持久计量 / 当前Guard，MCP任务不凭客户端子片提高档位。17份前像在[保全](../../output/harness-resource-selection-closeout-20261031-1dqrvekf/)，旧output保留，未安装 / 启服务 / 外联 / 迁移 / 提交 / 推送，持续目标未完成。

## 阶段：精确Resources发现与原读权编排（2026-10-31）

- MCP-03适用可选Resources新增[原资源注册](../../packages/mcp-server/src/resources.ts)，根出口公开`McpResources / McpResourceDescriptor`及受保护配置resources，统一service沿原resource配置即可供给；不新增私有业务API或强制Tools改走Resources。原发布 / reader、Controller等价authority、持久accounting与release缺一不可，方法构造时固定但政策当前读取；无默认生产者。只允许当前目录的规范化同资源origin HTTPS精确URI，无credentials / query / fragment，不执行任意URI。发现不读正文，读取依次经原权限 / 计量 / reader / release；返回前原描述符与资源身份复验，变化或缺投影拒绝。
- 仅text/plain说明或原结果文字引用，版本归属包含在2,000字符限制；50项 / 普通数据描述符、getter / 稀疏 / 坏地址 / 外URI拒绝。完整首次认证至输出15秒 / 64 KiB沿原端点，现代SDK零TTL / private，旧代次字段保持其规范；模板列表为空、不订阅 / 通知。此片不生产批准文字、不做实际业务或原索引，不让Resources绕过自动目标或原字段政策。
- 原runner执行`node --test --test-name-pattern 'optional resources|compiled MCP package' tests/mcp-foundation.test.cjs`，[首轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-resources-20261031-1.log)退出1、2 fail：测试把标准cacheScope的private误当私人正文；仅限定泄露断言到实际contents字段，不修改产品。随后[组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-resources-20261031-2.log)退出0、2 pass；补缺release、描述符读取中改说明、精确50项和迟到reader结算后[最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-resources-final-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext公共类型 / 正式ESM与既有原结果 / OAuth组合。两代SDK实际观察权限 / 计量拒绝零reader、连续read零缓存、撤回 / 改版本 / 跨主体、getter零执行、完整包超限503和取消后信号终止 / 迟到不释放，原providers是明确外部夹具，未验真库 / 生产权限或字段政策。
- 另核对原公开MCP工具桥 / tools schema / PTC类型接点：不支持的原输出schema会降通用JSON，TS / Python类型降unknown / Any，不能据此削减原约束开放；当前不修改原Harness、不新增第二JSON校验平台，已有真实input拒绝保持。原`mcpResources.register`可接同一连接，但客户端尚未注册，后续须验证精确Agent继承过滤、完整材料与释放，不能把该服务端子片当Host消费完成。七份前像在[保全](../../output/mcp-resources-closeout-20261031-2ia1xc_k/)，全部output保留；MCP-03完整身份 / 发现矩阵及MCP-04 / 05生产者仍缺，百分比不提高。未改API / shared / Core / 知识 / 文件存储、未安装 / 启服务 / 外联 / 迁移 / 提交 / 推送，无独立审查。

## 阶段：预构建消费者的MCP组合边界（2026-10-31）

Harness新增实际预构建`.tgz`与校验清单，既有原Loader / OAuth / MCP / 原Loop组合改为消费解包后的正式入口；最终1 pass及归档负对照1 pass、候选包SHA / 实际构建日志见[插件记录](../Harness插件/Harness插件-开发记录.md#阶段预构建bundle与原loader消费2026-10-31)。本端MCP产品 / 测试未改、不重复正常回归、不提高进度。原HTTP / 浏览器 / listener及同意 / grant / store仍为外部夹具，不是用户原版安装或生产身份 / 字段 / 持久目标证据；业务工具与不支持schema保持未发布。本批未改主线知识文件 / 文件存储、API / shared / Core，未安装、启服务、外联、迁移、提交或推送；七份前像在[保全](../../output/harness-bundle-closeout-20261031-k4ffqkqg/)，全部旧output保留。

## 阶段：原选单提案只读核对（2026-10-31）

- MCP-07适用只读子交付新增[selected-proposal-read](../../packages/mcp-server/src/selected-proposal-read.ts)与正式子出口，私有schema装配复用shared原审批应用 / 提案schema，不改公共合同。原选择证明及精确proposal / 修订 / reviewedPayloadHash是唯一输入，拒绝decision / lease / confirmed / actor；原reader构造时固定，负责当前Guard / ALS、原选择 / Task / hash与Core事实。完整普通JSON快照及32 KiB请求 / 128 KiB私有结果通过后核对Task、proposal / 修订 / hash、单原建单动作inputHash与deterministic target一致；不重算金额、不批准 / 保存或执行、不注册业务。原提案状态不推定批准消费或Core收据，private scope / snapshot定位仍须独立release。
- 原runner执行`node --test --test-name-pattern 'selected proposal read|compiled MCP package' tests/mcp-foundation.test.cjs`，[组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-proposal-read-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo；追加跨空间及原查后失权后，仅复验`node --test --test-name-pattern 'compiled MCP package' tests/mcp-foundation.test.cjs`，[最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-proposal-read-final-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext声明 / 正式ESM、全部原只读候选与统一OAuth组合。
- 两代SDK覆盖pending_confirmation / confirmed / cancelled / expired / superseded及原目标键序不影响内容核对，坏Task / hash / revision / action / target / 金额缺失、生成自由文本 / getter、自授参数、撤回与取消迟到拒绝。正式ESM实际调用原请求绑定readSelectedProposal及原审批reader；原Core金额 / 币种一致、旧修订 / hash、跨用户 / 空间及查询后失权拒绝，正常 / 拒绝读取前后记录不变。测试投影不含原客户资料 / scope / snapshot定位；生产字段许可仍缺，Web / DB / MCP政策为外部夹具、API为transpileOnly。原Harness实际schema仍拒绝，未删约束或注册，本端产品未改、不重跑正常Host登录。
- 五份说明前像在[保全](../../output/mcp-proposal-read-closeout-20261031-6ngq3883/)，全部output保留。G门复核：MCP-07仍缺可信选择 / Core报价保存 / 提案提交完整链和副作用原计量，08仍只读原结果、未接批准后唯一执行，09云受理 / 取消未交付；首片固定MCP身份 / grant、持久目标、正式字段 / 目录schema仍由原作者交付，不能用更多不发布候选填为完成。未改API / shared / Prisma / Core / 后台 / Host / AGC及主线文件存储WIP，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原只读执行者固定（2026-10-31）

- 原对话结果、Task恢复观察、精确操作及有界分页四个候选在构造时绑定原reader，不再于每次调用读取可变binding.read；原schema / metadata与执行者保持同一代，变更须重新构造候选 / 端点。绑定方法仍消费原当前身份 / 政策，未冻结权限，未新增业务执行或发布；选择收据及选单结果已沿同一固定方式实现。
- 既有测试新增构造后替换reader的拒绝对照。原runner执行`node --test --test-name-pattern 'original task recovery read' tests/mcp-foundation.test.cjs`，[修前](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-reader-binding-before-20261031-1.log)退出1、1 fail，实际执行了替换方法。修正后执行`node --test --test-name-pattern 'original conversation result read|original task recovery read|original conversation operation read|original conversation list|compiled MCP package' tests/mcp-foundation.test.cjs`，[修后](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-reader-binding-fixed-20261031-1.log)退出0、5 pass / 0 fail / cancelled / skipped / todo，含全部MCP / shared strict、正式ESM和原reader组合；四项候选在替换方法后仍只执行构造时原方法，原撤回 / 取消 / 身份及快照断言保持。
- 测试窄Edit部分报fsync EIO；核对实际内容，仅恢复未落盘的定向修改，不覆盖其他成果，失败日志保留。五份说明前像在[保全](../../output/mcp-reader-binding-closeout-20261031-wvwky9y3/)。Host实际输入schema仍拒绝、本端产品未改，不重复正常登录；生产原身份 / 持久目标 / 字段缺口及G门不变。未改API / shared / Prisma / Core / 后台 / Host / AGC或主线文件存储WIP，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原可信选择收据只读消费（2026-10-31）

- MCP-07的适用只读子交付新增[quote-selection-read](../../packages/mcp-server/src/quote-selection-read.ts)及正式子出口，消费shared的AI_QUOTE_SELECTION_HTTP_CONTRACTS.read，不改原合同 / 业务码。固定原reader，普通JSON输入 / 完整结果快照和32 KiB / 128 KiB私有上限先于异步校验；原draftVersion / inputRef / selectionId必须精确相同，原reader复验当前身份、quote / input哈希及Task祖先关系，release仍独立控制外发。没有候选个人资料、模型选择、select / 保存、批准或执行，缺收据保持不可用，不用过期状态自授重选。
- 原runner执行`node --test --test-name-pattern 'quote selection read|compiled MCP package' tests/mcp-foundation.test.cjs`，[组合日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-selection-read-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext声明 / 正式ESM及既有原选单结果 / OAuth链。追加收据查询后原失权，仅复验`node --test --test-name-pattern 'compiled MCP package' tests/mcp-foundation.test.cjs`，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-selection-read-final-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo。
- 两代SDK观察selected_not_approved / expired / superseded及固定not_granted / not_created_by_selection，额外确认 / 订单 / actor / task参数、坏引用 / hash / 私人字段 / getter、撤回和取消迟到拒绝；正式ESM实际调用原请求绑定选择read与PrismaQuoteSelectionRepository。原selection / inputRef错配、篡改原inputHash、跨用户 / 空间、收据查后失权拒绝，正常和拒绝读取前后记录不变。Web身份 / DB / MCP字段计量为外部夹具，API源码transpileOnly；非生产grant、真库锁、正式字段或真实人类选择证据。原Harness对实际schema仍拒绝，不删约束 / 发布；本端源码未改，不重跑无变化的Host登录。
- 五份说明前像在[保全](../../output/mcp-selection-read-closeout-20261031-ovz3nbu_/)，所有output保留。MCP-07仍缺真实选择 / Core报价提案完整链，原身份 / 持久目标 / 字段及目录前置未齐，完整原G门不因收据只读子片提高；未改API / shared / Prisma / Core / 后台 / Host / AGC或他线文件存储WIP，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：标准控制面与资源服务统一装配（2026-10-31）

- 新增[service](../../packages/mcp-server/src/service.ts)正式子出口，原宿主以同一serializable store装配现有元数据 / 授权回调 / 一次码 / token轮换撤销 / 当前资源验证；固定issuer、resource、token端点及scope ceiling一致，各路径互异，有限寿命沿原上限。原登记、元数据、可信同意及签发 / 读权仍由原作者供给；业务Guard / ALS、持久计量和字段release独立必需，缺依赖不开放。fetch不监听 / 读环境，close先停新请求 / 取消已受理控制面并等待本端handler，unknown commit不重试或推定回滚。
- 原runner执行`node --test --test-name-pattern 'persistent OAuth token lifecycle|compiled MCP package' tests/mcp-foundation.test.cjs`，[首轮](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-service-composition-20261031-1.log)退出1、2 fail：新SDK授权请求夹具未给scope / state，实际严格授权400而非303；补齐请求、不放宽解析后[组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-service-composition-20261031-2.log)退出0、2 pass。追加close / 迟到原同意屏障后[最终](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-service-close-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext声明 / 正式ESM、原选单收据及既有OAuth组合；同一统一入口实际走code → token → refresh → MCP → 撤销及旧access401。close共享同一Promise，原迟到同意信号已取消、原记录无新增且不复活。
- 原Host独立主实现路径改用统一服务，不再逐个拼metadata / token / authorization / resource；原runner执行`node --test tests/harness-plugin.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-service-composition-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含全插件strict / 声明、原profile / Loader / Loop / SDK及既有失败变体。原Web / consent / grant / store仍为外部事务夹具，TLS / 真库 / 生产权限与API装配未验，不因统一构造器存在宣称AS就绪。五份说明前像在[保全](../../output/mcp-service-closeout-20261031-rwukguyj/)，失败及所有output保留。
- 逐项原门槛复核：MCP-01仍缺完整身份 / 数据 / 字段合同；02仍缺生产登记 / 同意 / grant和原Guard / ALS；03依赖的固定原身份未齐；04持久目标 / 分类计量、05正式字段政策、06目录schema / reader未交付；08只有原收据只读子片，09没有云发起 / 取消适配；10没有完整首片 / 真实Host发布证据。当前完整任务未跨原连续25%门槛，不按构造器或测试数改百分比。未改API / shared / Prisma / Core / 后台 / Host / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：持久同意按内容精确核对（2026-10-31）

- 原同意authorizer对请求及两次原同意快照用Node isDeepStrictEqual精确比较普通JSON内容，不因存储对象键序变化误拒绝；数组顺序、额外字段、原state / client修订 / scope变化仍拒绝，普通JSON描述符快照、当前原authority、唯一关联 / commit后交付和unknown不重发保持。
- 原runner[修前定向](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-consent-key-order-before-20261031-1.log)退出1、1 fail：完全相同请求的键序反转被判unavailable。修正后执行`node --test --test-name-pattern 'persistent OAuth token lifecycle|compiled MCP package' tests/mcp-foundation.test.cjs`，[源码与编译包](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-consent-key-order-fixed-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，覆盖请求键序 / 二次同意与grant键序反转及内容拒绝，含全MCP / shared strict、正式ESM及原选单收据组合。原runner执行`node --test tests/harness-plugin.test.cjs`，[原Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-consent-key-order-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo；插件源码不变。
- 五份说明前像在[保全](../../output/mcp-consent-order-closeout-20261031-gi5k6b0t/)，失败与全部output保留。store / Web同意 / grant仍为外部事务夹具，API原读为transpileOnly；原生产仓储 / 身份 / 字段 / 持久目标缺口及G门不变，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原选单执行收据只读消费（2026-10-31）

- MCP-08 / 09的适用只读子交付新增[selected-order-result-read](../../packages/mcp-server/src/selected-order-result-read.ts)及正式子出口，共用schema装配增加shared原AI_QUOTE_SELECTION_DRAFT_SCHEMAS，不改公共合同。仅接原选择证明，原reader方法固定；完整普通JSON快照及32 KiB请求 / 128 KiB私有结果校验后核对source / order相同，仍由原release给出外发字段。原reader负责选择 / Task / phase / 批准消费 / Core结果关联，结果没有选择证明不据schema推定。原not_observed / unknown保持retryable:false / sideEffect / 原核对指引，不发模型、不start / reconcile / cancel / approve或建单，构造不发布。
- 原runner执行`node --test --test-name-pattern 'selected order result read' tests/mcp-foundation.test.cjs`，[初片日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-selected-order-read-20261031-1.log)退出0、1 pass；`node --test --test-name-pattern 'selected order result read|compiled MCP package' tests/mcp-foundation.test.cjs`，[组合日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-selected-order-original-20261031-1.log)退出0、2 pass，含所有MCP / shared strict、声明 / 正式ESM。随后补原跨用户拒绝，仅复验`node --test --test-name-pattern 'compiled MCP package' tests/mcp-foundation.test.cjs`，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-selected-order-final-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo。
- 两代SDK读取原committed / unknown / not_observed，执行 / identity参数、坏source / 支付推断 / 私有字段 / getter、旧发布和取消迟到拒绝；编译包实际调用原请求绑定选单Task readResult，fixture setup明确走原批准 / runner及Core外部替身产生一次收据。首应答丢失后只读原committed，隐藏原消费收据时保持unknown；原用户 / 空间、selection / Run / inputHash错配及读后失权拒绝，读取前后原记录相同、Core提交仍一次。Web身份 / 数据库 / MCP发布计量及字段仍为外部夹具，API源码为transpileOnly，不是固定MCP身份、MySQL锁或生产外发证明。原Harness仍拒绝实际输入schema，不削约束、未注册到Host、不提高AGP档位。
- 五份说明前像在[保全](../../output/mcp-selected-order-closeout-20261031-77j3vdjv/)，全部output保留。完整MCP-08执行及09云发起 / 取消、原身份 / 持久目标 / 字段仍未交付，原G门及持续目标未满足；不把只读收据计为原批准建单完成。未改原API / shared / Prisma / Core / 后台 / Host / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：失去签发许可后的凭据复用处置（2026-10-31）

- MCP-02的码 / refresh复用分支先执行原归属核验及固定client / resource约束，提交原family撤销后才抛invalid_grant；不再以当前签发许可失败提前跳过撤销。新凭据仍须原当前grant / 登记修订，撤销不扩大签发权；外client、resource或原归属拒绝不改他人family，归属缺证据仍不可用，原事务不重试。
- 原runner定向[修前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-disabled-reuse-before-20261031-1.log)退出1、1 fail：原已用码复用、签发许可失效时family未撤销。修正及补refresh / 外client / resource / 归属拒绝 / 旧登记修订后执行`node --test --test-name-pattern 'persistent OAuth token lifecycle|compiled MCP package' tests/mcp-foundation.test.cjs`，[源码及编译包](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-disabled-reuse-fixed-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict与正式ESM；两个凭据分支均断言family撤销、无新access / refresh、恢复签发许可后旧access仍无效。
- 生命周期主实现变更后沿既有原Loader组合执行`node --test tests/harness-plugin.test.cjs`，[消费者日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-owned-reuse-20261031-1.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含全插件strict / 声明及原profile / Loader / Loop / SDK。Host自身不新增AS或重试；store / 原grant与Web身份仍为外部事务夹具，非MySQL锁、生产AS / 权限证据。五份说明前像在[保全](../../output/mcp-disabled-reuse-closeout-20261031-njilysni/)，失败与所有output保留，原生产仓储 / 身份 / 目标 / 字段缺口和原G门保持。未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原同意后的持久一次性码签发（2026-10-31）

- MCP-02新增[persistent-oauth-authorization](../../packages/mcp-server/src/persistent-oauth-authorization.ts)及正式子出口，供标准授权handler消费原已完成可信同意 / 当前grant。原authority在同一事务内定位并锁住原浏览器身份、同意、登记及固定grant；model / URL确认不能自授。函数不建账号、grant、同意页或权限库。输入与原同意精确request一致，核对client resource scopes / grant修订和最短期限后生成32随机字节code，仅摘要、原authorization / grant及修订入库；code配置最多600秒，不滑动延长原同意 / grant。
- 原store提供同一serializable事务与authorizationId唯一关联、code摘要及原审计 / 收据原子写入；重复原授权不发行新码，不恢复明文或换ID，unknown commit不重试。插入后重读当前原同意，变化 / 失权拒绝；code只commit后交付，取消后可能已提交仍不交付、不宣称回滚。明确原denied才返回access_denied，缺同意 / 未完成 / 坏证据保持unavailable。
- 原offline runner执行`node --test --test-name-pattern 'persistent OAuth token lifecycle|compiled MCP package' tests/mcp-foundation.test.cjs`，[首次日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-persistent-authorization-20261031-1.log)退出0、2 pass；追加取消commit屏障后[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-persistent-authorization-final-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全部MCP / shared strict、NodeNext声明 / 正式ESM及原候选 / OAuth组合。源码与编译包覆盖随机code摘要和原关联、后续token真正消费、两个authorizer共享事务并发只一枚code、原request / client / 期限错误、denial、二次同意失权rollback、unknown commit只一次且已持久 / 再次拒绝、取消后仍可能commit但零code交付。
- 原Host独立主实现组合替换手工code保存：可信原Web同意夹具 → code authorizer → 标准303 → token主实现 → 原SDK握手 → disconnect撤销family / 旧access拒绝；[原Loader日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-persistent-authorization-20261031-1.log)退出0、1 pass，详细见[插件记录](../Harness插件/Harness插件-开发记录.md)。当前原Web同意 / grant与serializable store仍为外部事务夹具，非真实登录、MySQL锁或原身份生产装配；原API只读组合仍transpileOnly。
- 资源回读补缺family的拒绝分类：access存在但family证据缺失为unavailable，不等同已撤销；原authority的undefined仅表示已确认无当前grant，不可读证据须抛错。原runner定向[修前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-missing-family-before-20261031-1.log)退出1、1 fail，实际invalid与缺证据约定不符；修正后执行`node --test --test-name-pattern 'persistent OAuth token lifecycle|compiled MCP package' tests/mcp-foundation.test.cjs`，[修后日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-missing-family-fixed-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，覆盖源码与全部shared / MCP strict、正式ESM。插件正常路径未改，不重跑已有Host组合；此补充的五份说明前像见[保全](../../output/mcp-missing-family-closeout-20261031-ojrietjp/)。
- 五份说明前像在[本片保全](../../output/mcp-persistent-authorization-closeout-20261031-yjki2af9/)，全部失败 / output保留。当前生产仓储 / 原Auth / Guard / ALS与可信同意 / grant创建、审计、目标准入和正式字段 / 目录schema仍缺，完整G门与持续目标未满足；不以新增authorizer接口宣称生产持久化。未改API / shared / Prisma / 后台 / Host / vendor / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原持久事务的token生命周期主实现（2026-10-31）

- MCP-02新增[persistent-oauth-tokens](../../packages/mcp-server/src/persistent-oauth-tokens.ts)及正式子出口，主实现不再直接返回外部签发token：原事务内读code / 当前grant，校验S256 / 精确client resource callback与原subject / scope / grant修订，建立唯一family并消费code、生成32随机字节access / refresh，仅SHA256摘要落库；access取配置最多900秒及原grant / family最短期限，refresh轮换不滑动延长family。refresh旧摘要标used，新token同family；code / refresh复用先提交family撤销，再在事务外抛invalid_grant，避免错误回滚安全撤销。撤销沿原归属，不因停用client失去入口，未知 / 外client不改变他人family，hint不隐藏另一token类型。
- 原serializable store及当前grant / client authority必需，无local Map默认实现、账号 / 角色 / grant创建、同意页、数据库adapter或事务自动重试。唯一digest、码到family唯一约束、一次码 / refresh CAS、锁住原授权直到提交由原仓储实现；当前authority仍必须接原登记 / 同意 / tenant / 权限。取消、插入失败与未知commit区分；凭据仅commit成功后交付，未知或取消不重试，不推定已回滚，原AS负责未交付凭据核对与撤销。
- 同子出口提供createPersistentOAuthResourceVerifier，用实际access摘要读取family及原当前grant，逐次核对主体 / client / resource / scope / grant修订 / 最短期限和family撤销；事务内两次原当前读、普通JSON持久快照、getter与坏记录拒绝，不缓存或刷新。family撤销令先前access及全部refresh不可用，内部可信主体仍不等于业务Guard / ALS或字段许可。
- 原offline runner执行`node --test --test-name-pattern 'persistent OAuth token lifecycle|compiled MCP package' tests/mcp-foundation.test.cjs`。主实现及资源回读日志[mcp-persistent-oauth](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-persistent-oauth-20261031-1.log) / [resource](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-persistent-oauth-resource-20261031-1.log)均退出0、2 pass。补仓储坏记录验证后[首轮final](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-persistent-oauth-final-20261031-1.log)退出1、2 fail：测试把getter植入state，事务夹具structuredClone先执行并普通化，产品没收到坏记录，Missing expected rejection；仅把注入移到真实readAccess返回点。随后[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-persistent-oauth-final-20261031-2.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、正式ESM及全部既有候选 / OAuth组合。
- 源码 / 编译包经官方SDK交换 / refresh / MCP握手，用随机token验证摘要存储、两个service共享串行化事务的码 / refresh竞争、已用凭据撤销实际family、旧access拒绝；原subject / client / grant修订 / scope变更、第二次当前失权、getter零执行、错误proof、过期、插入失败整体回滚、unknown commit只一次且可能已持久、取消后仍可能commit但零token释放均覆盖。serializable store及grant authority为显式外部事务夹具，不是真MySQL锁 / 持久化或原身份授权。随后既有Host测试新增本主实现消费，不替换或删掉原失败变体；[原Loader组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-persistent-oauth-20261031-1.log)退出0、1 pass，随机access / refresh经原登录 / 断开，family撤销后原access拒绝、Session日志与存储无凭据原文，详细见插件记录。
- 五份说明前像在[本片保全](../../output/mcp-persistent-oauth-closeout-20261031-73yc8v5l/)，工具Write首个长JSON请求解析失败、未写文件，后拆为有效创建及窄Edit；失败日志与全部output保留。原AS可信登录 / 同意 / grant持久创建、真实仓储 / 当前身份与审计、原Guard / ALS、目标计量和字段 / 目录schema仍缺，完整G门与持续目标未满足，不把事务接口当生产persistence。未改API / shared / Prisma / 后台 / Host / vendor / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原授权码S256与精确请求绑定（2026-10-31）

- MCP-02新增[authorization-code-binding](../../packages/mcp-server/src/authorization-code-binding.ts)及独立正式子出口。原AS在原子consume / issue事务内提供原码记录，校验当前exchange的client / resource / 精确redirect_uri和S256 verifier；数据描述符仅取必需字段，私人字段不读取，缺项 / getter / 非规范base64url或43～128字符verifier错误统一invalid_grant，SHA256使用恒时摘要比较。没有code仓储、grant / expiry / 撤销判断、消费或签发效果，不返回可重用许可；原AS仍负责lookup、当前授权、一次性状态及token原子提交。
- 既有token transport的外部AS夹具复用该校验，合法形状但proof错误返回400 invalid_grant且AS只一次，不重试。原offline runner执行`node --test --test-name-pattern 'authorization code binding|OAuth token transport|compiled MCP package' tests/mcp-foundation.test.cjs`，[首次日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-code-binding-20261031-1.log)退出0、3 pass；追加实际错proof运输断言后，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-code-binding-final-20261031-1.log)退出0、3 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext声明 / 正式ESM及全部原候选组合。源码 / 编译包均消费官方S256、verifier边界、原client / resource / callback绑定与getter零执行。
- 原Harness组合改用本校验后[首次日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-code-binding-20261031-1.log)退出1：host固定回调通过，但临时loopback生成新端口，夹具原码记录仍使用旧固定redirect_uri。仅让外部AS夹具在授权步骤保存实际回调 / challenge，并令临时模式同样经标准授权handler取得303；不放宽交换时精确回调检查。原`node --test tests/harness-plugin.test.cjs`的[修正日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-code-binding-20261031-2.log)退出0、1 pass，详细见[插件记录](../Harness插件/Harness插件-开发记录.md)。本地夹具记录不当持久AS或码一次性消费，原登录 / 同意 / grant及真实DB仍未验证。
- 五份说明前像在[本片保全](../../output/mcp-code-binding-closeout-20261031-kdern1wg/)，所有失败 / output保留。原固定身份 / 持久grant、目标准入及正式字段 / 目录schema仍缺，完整G门与持续目标尚未满足；校验算法不填生产依赖。未改API / shared / Prisma / 后台 / Host / vendor / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原AS授权结果的标准回调运输（2026-10-31）

- MCP-02新增[public-client-authorization-endpoint](../../packages/mcp-server/src/public-client-authorization-endpoint.ts)及正式子出口，复用既有当前预登记 / S256检查，按固定授权地址、Origin、GET和最长30秒处理。原AS收到冻结的请求及原浏览器Request，唯一负责真实Web认证 / 同意、clientRevision及政策的提交复验和原子一次性码；运输不渲染登录 / 同意页、不读密码、不建grant或token，也不以Cookie替代业务身份。缺AS返回503，不启监听器或第二业务API。
- 原AS结果仅code或固定access_denied，普通JSON快照拒绝getter、私人字段、任意redirect / 不支持状态。回调只取已验证原redirect_uri，再加原state / 固定iss和code或error；完整Location最多16,384字节，空303含no-store / no-referrer / CSP。返回前重校当前登记及原请求；输入错误不向未验证callback跳转，撤回 / 到期 / 修订变化或取消后零Location，原AS最多一次、不重发。迟到码被拒绝不证明原签发回滚或撤销，核对沿原grant。原人类登录 / 同意等待及恢复仍属原AS宿主，本函数没有UI或跨请求持久交互。
- 原offline runner执行`node --test --test-name-pattern 'public authorization endpoint|compiled MCP package' tests/mcp-foundation.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-authorization-endpoint-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo。源码 / 正式ESM消费官方S256请求，验证原code / denial回调、错误输入不重定向、私人字段 / getter零执行、精确clientRevision / 原WebRequest，以及AS等待期间四类登记变化和取消屏障；每次AS只调用一次，无迟到Location或重试。当前全MCP / shared strict、正式声明、原四项只读候选及现有OAuth组合亦通过，API原读取仍transpileOnly。
- 原Harness浏览器替身改为消费此handler返回的303，再交原Host一次性回调；原错误state / issuer / 重复回调断言保持，不再手工拼成功URL。[Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-authorization-endpoint-20261031-1.log)退出0、1 pass，详细见[插件记录](../Harness插件/Harness插件-开发记录.md)。原AS登录 / 同意 / code、登记、浏览器 / listener / HTTP / 模型与政策仍为外部夹具，没有生产AS / grant / 原身份或真实DB证据。
- 五份说明前像在[本片保全](../../output/mcp-authorization-closeout-20261031-qk3_5y_2/)，所有output保留。当前原Auth / Guard / ALS适配、持久AS / grant、目标计量及正式字段 / 目录schema仍缺，完整G门和持续目标未满足；不通过增加运输接点替代生产依赖。未改API / shared / Prisma / 后台 / Host / vendor / AGC冻结成果，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：非法token表单的协议错误分类（2026-10-31）

[标准token运输](../../packages/mcp-server/src/oauth-token-endpoint.ts)将非法UTF-8解码错误在解析处返回400 invalid_request，而非外层503服务故障；登记读取和AS调用均为零，不回显输入。同时纠正源码说明：client_id只是public client标识，不是客户端认证，原AS仍校验code / PKCE或token归属。原offline runner执行`node --test --test-name-pattern 'OAuth token transport' tests/mcp-foundation.test.cjs`，[修复前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-token-utf8-before-20261031-1.log)退出1，实际503而预期400。修复后加compiled MCP package的[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-token-utf8-fixed-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，源码 / 正式ESM均验证坏字节零登记 / AS派发及完整既有strict / 组合。正常token和Host请求未变，不重复跑原Host；最近Host证据保持其原范围。五份说明前像在[本片保全](../../output/mcp-token-utf8-closeout-20261031-wogioahe/)，失败 / output全部保留。原持久AS / grant、固定身份 / 目标 / 字段缺口与G门保持，不当生产授权，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：原AS当前RFC8414元数据发布（2026-10-31）

- MCP-02新增[authorization-server-metadata](../../packages/mcp-server/src/authorization-server-metadata.ts)及独立子出口，固定HTTPS issuer / authorization / token / revoke、scope ceiling、合法Origin和path-aware RFC8414 GET。原AS当前source方法构造时绑定，两次读普通JSON快照；原source缺失 / 撤回、故障、两读内容变化或取消迟到返回503，未许可Origin / 非GET / 非精确路由拒绝。完整请求等待最多30秒、metadata最多配置65,536 UTF-8字节、no-store。只接code / S256 / none、原AS实际授权码及可选refresh能力；私有字段 / getter / 未支持扩展拒绝，不过滤成成功，不发grant或模型。
- 已核对官方SDK的oauthMetadataResponse会按资源origin发布AS文档并额外形成资源说明，不适用于本独立AS的精确issuer路由；此片复用官方OAuthMetadata公开类型及客户端parser，不深导入SDK或另安装框架。没有OIDC provider、动态client登记、AS token仓储、Web登录 / 同意或网络监听器；source为原AS发布许可，测试返回文档不当生产AS已就绪。
- 原offline runner执行`node --test --test-name-pattern 'AS metadata|compiled MCP package' tests/mcp-foundation.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-as-metadata-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo。源码及严格编译的正式ESM子出口经官方2026-07-28 / 2025-11-25 discovery及Harness原OAuth metadata检查，覆盖当前两读、精确字节 / 超1字节、缺AS / 停用、非法Origin / 方法 / 路径、错issuer / token端点 / scope / code能力、私人扩展 / getter零执行、撤回和屏障取消后零二次读。全MCP / shared strict、声明及既有映射 / token和原四项候选组合同时通过，API原读取仍transpileOnly。
- 原登录的AS discovery改为消费此运输，真实profile / Loader / SDK / Loop与最新[Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-as-metadata-20261031-1.log)退出0、1 pass，细节见[插件记录](../Harness插件/Harness插件-开发记录.md)。原AS发布许可、登记 / 签发、HTTP / listener / 模型及政策仍为夹具，不是生产登录、grant或真实DB证据。固定原身份 / 持久目标、正式字段与目录公共schema仍缺，MCP完整G门及持续目标未满足。
- 五份说明前像在[本片保全](../../output/mcp-as-metadata-closeout-20261031-l8ta2lex/)，旧失败 / output全部保留。定向检查器`check-current-instructions.py mcp-as-metadata-static-20261031-1.json`退出0，检查43文件 / 279本地链接、9项冻结哈希未变，MCP / Host两份验证均无audit文件、暂存为空、错误0；`git diff --check`退出0，仅LF→CRLF提示。结果位于`output/harness-oauth-session-20261028-m3kvbehy/mcp-as-metadata-static-20261031-1.json`，不检查锚点 / 外网 / 业务完成。未改原API / shared / Prisma / 后台 / Host / vendor / AGC冻结成果或他线WIP，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：七项运输映射的原风险描述（2026-10-31）

- MCP-01在[固定映射](../../packages/mcp-server/src/capability-mapping.ts)补七项原风险：四读取R0、报价 / 提案持久保存R1、原批准建单R2，类型从shared正式出口复用AiRisk。依据[原需求R04 / R05](<../AI Native/AI Native-需求.md#4-业务工具契约ain-r04>)与本专项R04 / R07，不改原业务码、运输名、权限或发布方式；三项副作用仍不能经只读构造器，可信已选客户结果不扩大为候选个人资料。风险是固定描述，不是当前原生产者ready或授权。当前实际原工具 / schema版本未交付，不拿draft-1或历史baseline-1冒充生产版本。
- 原offline runner执行`node --test --test-name-pattern 'fixed business mapping|compiled MCP package' tests/mcp-foundation.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-business-risk-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo。源码与正式ESM子出口核对七风险及原baseline副作用存在性，四read经两代SDK正常 / 撤回 / 写名拒绝；当前全MCP / shared strict / 声明及原四项候选组合通过，最新token登记屏障也在编译包执行。baseline仅是历史描述证据，不作为实时权限、成熟度或生产handler；AS / DB / 业务政策仍为夹具，API原读取transpileOnly。
- 五份说明前像在[本片保全](../../output/mcp-business-risk-closeout-20261031-oyyjw007/)。本片插件 / Host源码及其测试未改，不重复运行已通过的原登录组合；字段 / schema、原固定身份 / grant与持久目标仍缺，MCP-01全项G1及持续目标尚未满足。不改正式需求 / 任务百分比、API / shared / 后台 / Host / vendor / AGC，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：标准token／撤销运输与返回前登记复验（2026-10-31）

- MCP-02新增[oauth-token-endpoint](../../packages/mcp-server/src/oauth-token-endpoint.ts)及正式子出口，严格处理固定HTTPS授权码交换、refresh与RFC7009撤销表单。client / resource / 回调固定，未知或重复字段、Web cookie / Bearer、secret / DPoP及未许可Origin拒绝；请求 / 返回字节有界、完整等待最多30秒、响应禁止缓存。原登记reader / AS方法构造时绑定；AS单次调用，原持久AS负责clientRevision提交复核、登录 / 同意 / grant、码一次性 / PKCE、refresh轮换 / reuse及token归属。没有本地issuer、token仓储、第二业务API或自动重试，缺AS返回503。
- 标准输出只释放Bearer / expiry / scope及适用refresh，拒绝私有字段 / getter、非法值、超限或未轮换refresh。原AS完成后、响应返回前重读当前登记，丢失、停用 / 到期、修订或内容变化拒绝迟到token；拒绝不证明签发回滚，必须沿原grant核对。停用 / 过期但仍登记的client仍可向原AS请求撤销已知token，200只表示AS接受，不证明整个grant已核实。取消 / 超时拒绝迟到结果、不重发，预期OAuth错误与私人故障分开。
- 原offline runner先执行`node --test --test-name-pattern 'OAuth token transport|compiled MCP package' tests/mcp-foundation.test.cjs`，[初片日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-oauth-token-transport-20261031-1.log)退出0、2 pass。增加当前登记屏障后，`node --test --test-name-pattern 'OAuth token transport' tests/mcp-foundation.test.cjs`的[修复前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-oauth-token-current-before-20261031-1.log)退出1：等待AS期间删登记，旧实现仍返回200。补复验后相同定向加compiled MCP package，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-oauth-token-current-fixed-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含全MCP / shared strict、NodeNext声明与正式ESM及原四项候选组合。源码与编译子出口均消费官方SDK交换 / refresh，屏障覆盖两条签发路径五类登记变化、撤销停用client与取消迟到，AS每请求最多一次、拒绝结果无token。
- 原Harness登录 / disconnect改为经过此运输；既有Loader / 原Loop / SDK严格组合证据及固定登记夹具修正见[插件记录](../Harness插件/Harness插件-开发记录.md)。登记、签发 / 撤销、HTTP / listener / 模型及政策仍为外部夹具，API原读取仍transpileOnly，未验证真实AS / DB锁 / 多实例或登录 / 同意。持久AS / grant到原身份、目标计量、正式字段与目录公共schema仍未交付，任务不凭局部运输跨G门，持续目标尚未完成。
- 五份说明前像在[本片保全](../../output/mcp-oauth-token-closeout-20261031-t_54a7qq/)，失败与全部output保留；本片未改原API / shared / Prisma / 后台 / Host / vendor或AGC冻结成果，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。

## 阶段：预登记public client的授权请求校验（2026-10-31）

- MCP-02新增[public-client-authorization](../../packages/mcp-server/src/public-client-authorization.ts)及正式包子出口，从固定AS地址的浏览器GET请求校验code / S256、唯一resource、scope、state和登记redirect_uri。拒绝重复 / 未知参数、actor / workspace / client secret、scope扩张和非登记回调；HTTPS完全相等，数字HTTP loopback仅临时端口可变，不放localhost / 通配 / 任意scheme。原登记reader方法在构造时绑定，每次两次当前读取及稳定普通JSON快照，停用 / 到期、修订或内容变化、未知 / 坏响应和取消迟到均拒绝。安全错误不含原登记资料、token或私人异常。
- 返回只是AS内部请求快照和clientRevision，不登录、跳转、签发code / token、创建grant或给业务授权。真正签发必须由原AS在可信登录 / 同意和当前政策事务中复核登记修订，此预检查不能跨等待复用为签发许可。当前SDK2.2.0只有资源认证 / discovery，没有完整AS；根及Harness现有依赖也无可直接采用的oidc-provider / oauth2-server。未安装新框架、自建账号或用静态token补生产成功；原身份 / AS / 持久grant生产者仍缺。
- 原offline runner执行`node --test --test-name-pattern 'public client authorization precheck|compiled MCP package' tests/mcp-foundation.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-public-client-precheck-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo。源码及正式ESM子出口消费官方SDK生成S256 / state请求；原生IPv4 / IPv6只变端口、HTTPS精确匹配、协议坏参数零登记读取、当前停用 / 到期 / 修订 / getter零执行、安全失败和屏障取消晚答不复查均通过。当前全MCP / shared strict、声明 / 正式出口及原四项候选组合亦通过；登记 / DB / MCP政策仍为夹具，APItranspileOnly，不记真实AS / 数据库事务证据。
- 同时核对MCP-04原[持久资源门](../../apps/api/src/modules/ai-native/runner/persistent-task-runner-resource-gate.ts)、[原证据源](../../apps/api/src/modules/ai-native/runner/prisma-task-runner-resource.source.ts)和[原ports](../../apps/api/src/modules/ai-native/task-execution-budget.ports.ts)：原calls是Gateway模型invocation，确定性读取消耗step / active_ms / output_bytes；写入要求原Run lease，恢复按原保存计划不重置。它不是MCP“20次自动业务调用 / 2只读并发 / 1副作用”的持久目标，不能用calls替代、借lease给客户端或重新初始化。本片不改原账本；仍需原作者交付目标 / 调用关联、四类路由计量、原索引和unknown接点，不新建本地Map。
- 插件源码及既有Host消费本片未改，不重复跑未变Host。五份说明前像在[本片保全](../../output/mcp-public-client-closeout-20261031-jz3raujm/)，旧失败 / 产物全保留，未改API / shared / Prisma / 后台 / Host / 主线文件ACL活动WIP，未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。完整MCP-02与原04等固定生产者缺口仍未齐，不凭预检查 / 测试量跨G门，全项目标尚未完成。

## 阶段：固定原业务码到MCP运输名（2026-10-31）

- MCP-01新增[capability-mapping](../../packages/mcp-server/src/capability-mapping.ts)及独立正式包子出口，`rental-mcp-capability-map-1`只标运输映射，不冒充原schema / 能力 / grant版本。按原需求R04的七项原码从shared正式运行时出口核对，固定目录 / 可用性 / 可信已选客户结果 / 原订单事实读取，以及报价保存 / 提案保存 / 原批准建单的下划线运输名；原码不改，映射表冻结，不全量开放AI_TOOL_CODES。客户结果不等于敏感候选读取，quote.preview会保存原快照，明确quote_save而非只读。
- `createMappedBusinessRead`将固定原读码绑定到原作者的说明 / schema / reader；未知码、直接运输名、报价 / 提案 / 建单码不能经只读构造器注册。构造仅捕获schema副本及原reader，不调用Core、模型或Task；publication / authority / 原持久accounting / release仍必需，缺项不因名称或映射存在而ready。没有复制目录私有DTO或编写外发字段政策。
- 原offline runner执行`node --test --test-name-pattern 'fixed business mapping|compiled MCP package' tests/mcp-foundation.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-business-mapping-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo。源码 / 正式ESM子出口两代SDK消费四个固定读名，写入名 / 原点号名 / 当前撤回拒绝、reader构造零调用 / 方法固定及原权限 / 计量同名关联通过；当前全MCP / shared源码strict、NodeNext声明 / 正式出口以及四项原结果 / 恢复 / 操作 / list候选的原reader组合亦通过。此前两次全包超时日志保留，此次是新的完整通过证据，不删断言 / 加超时或复制旧产物。API仍transpileOnly，DB / OAuth / MCP政策明确夹具，不计生产授权或真库通过。
- 原Harness现有组合夹具改用`rental_catalog_search` / 原Host命名空间，未修改插件源码或复制一套产品映射。`node --test tests/harness-plugin.test.cjs`的[消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-business-mapping-20261031-1.log)退出0、1 pass，含插件strict / 声明、真实profile / Loader / ToolRuntime / 原Loop / SDK及材料 / 撤回 / unknown组合。说明明确synthetic schema / reader，名称可消费不等于实际目录或首片闭合；生产目录公共schema、原字段 / 固定身份 / 持久目标仍缺，其他未命名原索引 / Task动作等原作者固定合同。
- 五份说明前像在[本片保全](../../output/mcp-business-mapping-closeout-20261031-exmwr84_/)，未改正式需求 / 任务范围或百分比、API / shared / Host / vendor / 主线WIP；未安装、启服务、外联、迁移、提交 / 合并 / 推送，无独立审查。映射子交付并非MCP-01全项G1，原固定身份 / 数据 / 字段合同未齐，完整任务登记不凭代码或测试数跨档。持续目标尚未完成。

## 阶段：客户端并发失权的检查提交点（2026-10-31）

Harness在原check发现提交点复核当前连接，一条401 / 403令其失效后，另一迟到成功响应不能恢复指引或反馈成功。原Loader / SDK屏障复现与[修复后日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-check-current-fixed-20261031-1.log)退出0、1 pass见[插件记录](../Harness插件/Harness插件-开发记录.md)；MCP源码未改，不重计服务端实现或真实撤权证据。原生产身份 / grant、持久计量 / 字段与业务首片缺口保持，未安装、启服务、外联、迁移、提交或推送。

## 阶段：客户端回调清理失败的授权状态（2026-10-31）

Harness OAuth登录已将回调清理失败纳入unknown处理，不保留可用connected身份 / 指引，旧check / login零请求，已知凭据只供原撤销；AS接受撤销不消除清理不确定性。修复前真实Loader / SDK握手后错误仍显示connected的复现及[修复后日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-callback-cleanup-fixed-20261031-1.log)退出0、1 pass见[插件记录](../Harness插件/Harness插件-开发记录.md)。MCP源码本片未改，不重复计服务端OAuth实现；身份 / listener / HTTP / 模型和政策仍为夹具，生产AS / grant / 原身份 / 字段 / 持久目标缺口及原登记保持。未安装、启服务、外联、迁移或提交 / 推送，目标尚未完成。

## 阶段：纯指引历史的客户端材料限制（2026-10-31）

Harness已在原llm/stream接点识别日志system消息及一次调用system中的版本化Rental指引，插件重载后没有工具 / Prompt来源时仍检查完整256 KiB；文字标记只加限制，不恢复权限或改写日志。实际原Loader / AgentLoop日志重建、精确上限 / 多字节超限、个人引用及原访问拒绝的证据见[插件记录](../Harness插件/Harness插件-开发记录.md)。`node --test tests/harness-plugin.test.cjs`沿offline runner执行，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-guidance-material-final-20261031-1.log)退出0、1 pass，含当前插件strict / 声明与原组合；首轮测试转义错误及随后拒绝缺口复现保留。MCP源码本片未改，不重跑无关服务端验证，不把客户端大小检查当正式字段许可、持久目标或最终Provider线包保证。生产前置与原登记不变，无安装 / 服务 / 外联 / 迁移 / 提交 / 推送。

## 阶段：指引provider与普通JSON快照（2026-10-31）

- MCP-03 / 05在原[instructions](../../packages/mcp-server/src/instructions.ts)、[Prompts](../../packages/mcp-server/src/prompts.ts)及端点中固定原provider方法身份；方法仍读当前政策，撤回不冻结。指引只捕获version / text，目录只捕获name / version / description的自有可枚举数据字段；普通JSON快照在异步复验前完成。getter、继承 / 隐藏字段、自定义对象、非字符串版本 / 名称、稀疏或自定义数组整项拒绝，忽略私有字段不执行访问器或转换。不新增业务能力、字段许可、模板正文、通知或模型调用；2,000字符 / 50项、15秒 / 64 KiB限制及当前资源 / 发布复验不变。
- 先执行`node --test --test-name-pattern 'guidance methods and ordinary snapshots' tests/mcp-foundation.test.cjs`，[修复前日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-guidance-snapshot-before-20261031-1.log)退出1，真实SDK请求屏障期间替换原provider后实际发布injected_prompt。修复后相同定向退出0；当前最终`node --test --test-name-pattern 'guidance methods and ordinary snapshots|optional prompts|versioned instructions' tests/mcp-foundation.test.cjs`，[行为日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-guidance-final-20261031-1.log)退出0、3 pass / 0 fail / cancelled / skipped / todo，覆盖两代SDK、原方法固定 / 动态撤回、getter和字符串转换零调用、非法材料、原版本 / 超限 / 取消路径。
- 首轮带compiled MCP package的组合及随后仅compiled的诊断均退出124，日志为[mcp-guidance-snapshot-fixed](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-guidance-snapshot-fixed-20261031-1.log)与[mcp-guidance-artifact-diagnosis](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-guidance-artifact-diagnosis-20261031-1.log)。两份私有产物均停在shared全包编译前段，没有shared / MCP dist或消费者产物；不将超时计通过、不加超时或删原全包测试。将本片额外调用移到不依赖shared的根运输验证，原四项业务候选完整编译 / 原读取断言原样保留；此次没有新的全shared / 全MCP组合通过证据。
- 私有`check-guidance-artifact.cjs`按根index及实际依赖闭包严格编译、声明消费和两代SDK ESM根出口运行，不复制旧产物或依赖。首次退出1，Prompts数组descriptors的TypeScript映射类型将length推成number，不能直接取.value；改用Object.getOwnPropertyDescriptor读取真实数据描述符，不断言any或削检查。最终[根出口日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-guidance-root-artifact-final-20261031-1.log)退出0、0诊断 / 两代消费；源码文件计数按Windows规范路径，前一绿色日志的0计数只属诊断输出误计，不当完整源数。
- 原offline runner执行`node --test tests/harness-plugin.test.cjs`，[Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-guidance-snapshot-20261031-1.log)退出0、1 pass，含当前插件strict / 声明、真实profile / Loader / ToolRuntime / SystemPrompt / AgentLoop / SDK和取消 / 撤回；插件源码未改，AS / HTTP / browser / listener / 模型和政策仍是外部夹具，不当生产登录或真实模型采用。测试单行补入期间Edit数次fsync EIO，先核对内容未写及磁盘，再窄Python替换该唯一调用 / 屏障点；未覆盖整份WIP。短文件操作一度阻塞，均最终退出0，所有日志和产物保留。
- 五份说明前像在[本片保全](../../output/mcp-guidance-closeout-20261031-brw8u_6c/)。本片没有独立审查、安装、启服务、外联、迁移、提交 / 合并 / 推送；未改主线API / shared / 后台 / Host / vendor / 原AGC。固定grant到原身份、持久目标、正式字段和目录公共schema仍未交付，MCP / AGP原登记不跨G门，持续全项目标尚未完成。

## 阶段：固定注册定义与动态原政策（2026-10-31）

- MCP-03在[read-tools](../../packages/mcp-server/src/read-tools.ts)捕获每个端点的工具定义与reader / publication / authority / accounting / release方法，输入输出schema脱离原对象并冻结，端点只校验 / 发现 / 调用同一固定定义。原provider方法仍读其当前状态，不冻结grant或撤回，不用定义快照代替逐次授权。定义变更须重新装配端点，不允许异步发布期间换reader / 名称 / schema、插入工具或替换释放函数。
- 先执行`node --test --test-name-pattern 'read definitions stay fixed' tests/mcp-foundation.test.cjs`，[修复前竞态日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-definition-race-before-20261031-1.log)退出1：屏障等待publication后改原定义 / 注册列表，实际发现changed_read及injected_read而非固定原工具。不是猜测或扩大超时。修复后`node --test --test-name-pattern 'read definitions stay fixed|read registration|released JSON|compiled MCP package' tests/mcp-foundation.test.cjs`，[收口日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-definition-fixed-20261031-1.log)退出0、4 pass / 0 fail / cancelled / skipped / todo，含当前全源strict、四项候选 / 原读取与两代SDK。屏障同时验证原reader / schema不换、旧provider方法仍根据当前撤回拒绝，原JSON / 包装上限与权限回归通过。
- 原Harness消费夹具改为只在本测试tools/list线上响应中模拟将来不兼容schema，不再修改端点已捕获的旧定义；非法schema仍实际拒绝，不删原断言。既有offline runner执行`node --test tests/harness-plugin.test.cjs`，[Host日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-fixed-definition-20261031-1.log)退出0、1 pass，含插件strict / 声明、真实profile / Loader / ToolRuntime / 原Loop / SDK及生命周期组合；OAuth / HTTP / 模型 / 业务provider仍为外部夹具，不等真实登录或业务完成。
- 目录首片核对发现具体原接点缺项：aiCatalogReadInputSchema及AiCatalogReadProjection仍仅在API原作者文件，shared没有对应公共运行时schema；旧桌面结果的human_preview / not_sent不可直接外发。不能复制私有同名DTO、旁路读取或补零成功，等待原作者固定公共合同及生产身份 / 字段 / 持久目标。原Host公开出口也未导出publicToolName，插件仍仅接受48字符原名；不深导入或另写截断 / 哈希规则，长名称兼容缺口保留。原任务不因此跨G门，目标尚未完成。
- 仅本树MCP、既有两测试及专项说明 / 记录 / 接续变更，未改Host / vendor / API / shared / 主线WIP；未安装、启服务、外联、迁移、提交或推送。五份说明前像在[本片保全](../../output/mcp-definition-closeout-20261031-jt1qs5l6/)，失败和全部产物保留，无独立审查。

## 阶段：原对话元数据有界分页（2026-10-31）

- MCP-04 / 06新增[conversation-list-read](../../packages/mcp-server/src/conversation-list-read.ts)独立子出口，沿原公共list输入和完整结果schema，拒绝owner / 身份 / 任意URL及超原1～20限额参数；一次只读一页，保留page_not_total和原nextBeforeId，不聚合、推断总数或重建索引。完整返回须同请求状态、条数不超请求、ID不重复，非空续页游标是满页末项且不能等于输入游标；无效完整结果在release前拒绝，不裁剪修补成功。
- 既有offline runner执行`node --test --test-name-pattern 'original conversation list|compiled MCP package' tests/mcp-foundation.test.cjs`，[分页日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-page-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo。源码 / 编译子出口经两代SDK覆盖空页、精确20条、非法参数、条数 / 状态 / 续页 / 私有字段、撤回与取消；编译包实际调用原对话应用list，读后失权拒绝且状态不变。同时执行原结果 / Task恢复 / 原操作的既有组合，MCP / shared全部源strict和NodeNext消费通过，API仍为transpileOnly。外部身份 / DB和MCP政策为明确夹具，未验真库、生产身份或Host消费。
- 正式原索引 / 字段 / 用途和持久目标仍未齐，新增元数据分页不代表MCP-04本人业务操作索引完整，0% / 正式0/10及AGP原登记不跨档。原Harness不支持实际schema，不删约束或启用。五份说明前像在[本片保全](../../output/mcp-page-closeout-20261031-6ya6mekq/)，未修改原API / shared / 后台 / 主线WIP，未安装、启服务、外联、迁移、提交、合并或推送。目标仍未全部完成。

## 阶段：精确原对话操作收据只读适配（2026-10-31）

- MCP-04 / 06新增[conversation-operation-read](../../packages/mcp-server/src/conversation-operation-read.ts)子出口，复用shared原对话operation请求 / 完整响应，仅接版本和operationKey。原返回与捕获原键必须相同，闭合schema / 普通JSON快照 / 私有字节限额及原release独立保留。observed不变成业务执行成功，not_observed保留not_proof_of_no_commit、retryable:false和原读取指引；不发新键、不重放create / archive / delete / release、不取消Task。根运输不加载或发布候选，生产字段许可 / 固定身份 / 持久计量仍必需。
- 既有offline runner执行`node --test --test-name-pattern 'original conversation operation|compiled MCP package' tests/mcp-foundation.test.cjs`，[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-operation-20261031-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含当前MCP / shared strict与外部NodeNext声明 / 正式包出口、三项候选两代SDK组合。编译包实际调用原对话应用 / readOperation仓储，正常与缺收据不改状态，跨用户 / 空间、查收据后失权拒绝；源码 / 编译包也覆盖原键错配、非授权参数、坏状态 / 私有字段、输入输出等待期快照、getter零调用、撤回与迟到取消。外部身份 / DB、MCP政策仍为夹具，API执行transpileOnly，不记真库 / API类型或Host验收。
- 用户设定全项开发目标，按正式需求 / 任务门槛持续推进；这不授予主树或他线公共文件写权，也不替代安装 / 真实联调 / 迁移 / 发布授权。固定生产身份 / grant、持久目标 / 原索引生产者、正式字段及Host支持仍缺，完整MCP / AGP原登记不跨档，目标尚未完成。未改API / shared / 后台 / 主线活动WIP，未安装、启服务、外联、迁移、提交、合并或推送。五份说明前像在[本片保全](../../output/mcp-operation-closeout-20261031-mqpyr2yd/)，所有失败 / 通过日志、依赖与隔离产物继续保留。

## 阶段：原请求绑定Task／步骤恢复状态只读适配（2026-10-31）

- MCP-06 / 09新增[original-task-recovery-read](../../packages/mcp-server/src/original-task-recovery-read.ts)及独立子出口，复用shared的AI_SCENE_REQUEST_HTTP_CONTRACTS.recovery与原请求 / 完整恢复schema，仅输入原版本 / inputRef。根运输不自动加载或发布；原名称 / 外发schema、publication / 原authority / 持久accounting / release仍由唯一作者交付。没有第二业务API、Task选择器、模型、取消、接管、恢复执行或重发动作；本片不消费主线通知中的releaseUnstarted增量。
- 原完整schema装配抽取为包内[original-read-schema](../../packages/mcp-server/src/original-read-schema.ts)，既有modelResult适配复用同一实现；保留闭合分支、所有引用和约束，缺组件 / 覆盖shared组件拒绝。输入 / 返回先普通JSON快照，再32 KiB / 128 KiB私有字节限制与公共schema校验，步骤最多50条；外发限制与原政策不变。原恢复返回没有inputRef，Task关联和读前后权限只能由原reader核对，不能以合法schema或可见Task ID自授权。
- not_observed保留retryable:false和原核对指引，不当成未执行或零消耗；unknown步骤保留原actionId、possible及reconcile_original_action，取消Task不删除原结果。测试覆盖严格输入、无Task分支、终态Task带unknown步骤、稳定输入 / 输出、getter零执行、坏状态 / 自动执行字段 / 51条 / 私有字段在release前拒绝、缓存撤回及取消迟到。原Harness仍拒绝真实输入UNSUPPORTED_SCHEMA，未删约束、注册消费者或确认全端冻结。
- 编译包经两代官方SDK实际调用composeRequestBoundOriginalScenes.readRecovery → 原请求Task回源 / 当前授权 → AiOriginalSceneRecoveryService / 原Task权限与步骤查询。种入既有Task / step的夹具不跑执行器；原Task输入哈希损坏、换用户 / 空间及读步骤后失权拒绝，缺Task明确返回not_observed。正常及拒绝前后完整存储状态相同，没有追加Task / Run / Step或模型调用。原Web身份 / DB、OAuth及MCP政策仍为明确夹具，不是生产MCP身份、真实锁 / 事务或字段许可；原API以既有ts-node执行，不记API严格类型检查。
- 原offline runner执行`node --test --test-name-pattern 'original task recovery|original conversation result|compiled MCP package' tests/mcp-foundation.test.cjs`，[首轮日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-recovery-20261031-1.log)退出1：源码原结果及新恢复2 pass，编译包组合1 fail，原因是本片种入的旧step缺原恢复schema必需revision。补齐夹具revision:1，不修改schema、生产reader、超时或断言；只复验`node --test --test-name-pattern 'compiled MCP package' tests/mcp-foundation.test.cjs`，[修正后日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-recovery-20261031-2.log)退出0、1 pass / 0 fail / cancelled / skipped / todo，含当前MCP / shared全源strict编译、NodeNext声明 / 正式包出口及两项适配的两代SDK / 原读取组合。失败日志与所有私有产物保留，不重跑未改的Host。
- 固定生产身份 / grant、持久目标、正式字段 / 用途 / 来源 / 期限及实际Host支持仍缺，按原连续G门不提高MCP-01～10的0% / 正式0/10，AGP原登记保持；07 / 08未实施，原09的云发起 / 取消意图也未接。当前HEAD核对69c6c89e、暂存空，未修改API / shared / Prisma / 后台 / 原AGC / Harness或主线WIP，未安装、启服务、外联、迁移、提交、合并、推送或独立审查。五份说明修改前像在[本片保全目录](../../output/mcp-recovery-closeout-20261031-crwb66uu/)，当前静态 / 冻结 / audit核对结果文件为`output/harness-oauth-session-20261028-m3kvbehy/mcp-recovery-closeout-static-20261031-1.json`，其范围不代表正式业务验收。

## 阶段：原结果稳定快照与原读取链组合（2026-10-30）

- MCP-05 / 06 / 09在既有[原结果候选](../../packages/mcp-server/src/conversation-result-read.ts)中补输入与完整原结果的稳定普通JSON快照。先按数据描述符复制、序列化并校验字节，再等待公共schema校验；原对象在等待期间变化不改变已捕获请求 / 事实。getter / toJSON零执行，隐藏字段、undefined、非有限数字等在原release前整项拒绝，不以JSON转换丢失事实。原[外发快照](../../packages/mcp-server/src/read-tools.ts)抽取为包内[共用实现](../../packages/mcp-server/src/json-snapshot.ts)，不是shared公共出口，也不重建业务精度或计价算法。
- 原私有请求完整上限32,768 UTF-8字节，原Web结果完整上限131,072字节；精确结果字节上限可私下校验，超1字节拒绝。之后仍必须经过原释放政策，并独立满足外发2,000字符 / 50条、32,000投影字节和65,536完整MCP响应字节限制；没有扩大外发范围、裁剪正文或更改原schema。合法后继Run仍由原reader的来源链核对，不用初始turn.runId简单相等破坏原历史。
- [既有验证入口](../../tests/mcp-foundation.test.cjs)把编译包子出口接到原composeAiConversationRequests → 原对话仓储 → 原请求绑定结果reader → AiOriginalSceneResultService / artifact仓储，实际执行原Auth / Guard / ALS及原关联读取。夹具准备阶段创建对话 / 受理和任务元数据，再种一条已有UNKNOWN step / artifact；读取阶段不发模型、不追加Task / Run / Step，正常与拒绝路径前后持久状态相同。两代SDK均验证unknown空正文、artifact内容哈希 / Run错配、换原用户 / 空间及正文读后失权拒绝。
- 原Web身份来源和数据库、OAuth身份及MCP publication / authority / accounting / release是明确夹具；外发observation透传schema仍仅测试使用，不是生产字段许可。这次不再只用替身返回原结果，但也没有MCP固定grant到原身份映射、真实MySQL锁 / 事务或生产部署证据。MCP / shared全源严格编译到私有output，外部NodeNext消费者从正式包出口取得声明并运行产物；原API运行使用既有ts-node transpileOnly，不把它记为API严格类型检查。全局require.extensions与resolver在最小组合范围恢复，未覆盖公共dist / Prisma client或安装依赖。
- 本树既有offline runner执行`node --test --test-name-pattern 'original conversation result|compiled MCP package|released JSON' tests/mcp-foundation.test.cjs`，[首轮日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-stable-snapshot-20261030-1.log)退出1、2 pass / 1 fail：原结果与JSON检查通过，原API组合夹具的ts-node报TS5107，原因是Node10模块解析在已有TypeScript6被弃用。仅把夹具改用Node16模块 / 解析，不设置ignoreDeprecations、增加超时或放宽断言；失败日志及产物保留。
- 定向修正后执行`node --test --test-name-pattern 'original conversation result|compiled MCP package|released JSON|read registration' tests/mcp-foundation.test.cjs`，[原读取与外发收口日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-stable-original-final-20261030-1.log)退出0、4 pass / 0 fail / cancelled / skipped / todo。追加直接输入等待期变更及getter拒绝后，仅复验`node --test --test-name-pattern 'original conversation result|compiled MCP package' tests/mcp-foundation.test.cjs`，[最新输入与编译包日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-stable-input-final-20261030-1.log)退出0、2 pass / 0 fail / cancelled / skipped / todo，含当前MCP / shared严格编译、正式包出口与原读取链。离线沿本树preload、固定无效DATABASE_URL及绝对audit / writeRoot / TEMP / cache，不启动服务或访问真实HTTP / DNS / DB / 模型。
- 按原连续G门复核：MCP-01仍缺全项能力 / 字段 / 固定客户端合同，02缺原AS / grant / 当前身份，03缺固定认证出口，04缺持久目标，05缺正式字段 / 用途 / 来源政策，06 / 09依赖的适用固定出口仍未齐，07 / 08没有本片交付，10没有真实首片 / 其他Host及发布门证据。MCP-01～10维持原登记0%、正式0/10；不按局部原读取链或测试数量估分。Harness真实输入仍被原校验器拒绝UNSUPPORTED_SCHEMA，未削约束、注册业务或确认AIN-02全端冻结；客户端本批源码未改，AGP原登记保持。
- 负责人“继续下一批”后恢复本树实施；当前核对HEAD为69c6c89ed0a5fbb7d5f97b2257bd0fe17a56d247，之前成果已由整合线保全提交，本会话本批未提交 / 合并。当前改动仅MCP快照 / 适配、对应测试和本包说明 / 两专项记录接续；修改前五份说明保全在[本阶段前像](../../output/mcp-stable-closeout-20261030-vlml49sy/)。[静态核对结果](../../output/harness-oauth-session-20261028-m3kvbehy/mcp-stable-closeout-static-20261030-1.json)退出0：检查35文件 / 164本地链接，9项冻结哈希未变、所列6份验证无audit文件、暂存为空，错误0；`git diff --check`退出0，仅有Git的LF→CRLF提示。静态结果只覆盖运行时对应文件与链接，不代表业务验收。未改主树、API / shared / Guard / Core / 支付 / 后台 / 原AGC / vendor / lock；未安装、启服务、外联、迁移、清理、提交、推送或独立审查。

## 阶段：原对话模型结果的标准只读候选（2026-10-29）

- MCP-06 / 09新增[原结果适配](../../packages/mcp-server/src/conversation-result-read.ts)及独立包子出口，从`@rental-os/shared`正式出口消费ain-conversation-draft-2的modelResult输入 / 完整返回schema与原类型；不修改shared / API / schema / 原Host。固定名称、原reader、原组件补充及外发schema必须由原作者显式提供，构造不自动注册，publication / 原Controller等价authority / 持久accounting / 外发release仍必需。没有HTTP代理、Web token透传、任务 / 模型 / Core写入或新状态机。
- 输入按公共严格schema拒绝身份、reader / 模型 / tool名和未知字段；返回先完整结构校验，再核对conversationId / admissionKey、原request / inputRef / capabilityVersion、taskId及精确resultId。available保留未验证模型文本与候选非批准语义；unknown / failed / stale不补正文、不自动重试。material_erased只准原erased分支、null结果和原Task定位，不恢复材料。原reader仍须负责真实权限、Run / 来源及读前后关联复验，此候选不能替代它。
- 实际发现三个生产前置：①原对话HTTP组合重新解析Web Bearer，没有MCP固定grant到原Guard / ALS适配；②完整结果引用AiOrderExplainRequestDraft / AiOrderExplainInput，当前只有原API组件定义，shared未发布，故只能装配原作者固定组件，缺组件拒绝；③完整Web schema传递依赖使Tools发现超过64 KiB。改为私下校验完整原结果、公告原字段作者的独立闭合投影schema，未删除约束、提高上限或裁剪事实。原Harness校验器仍对真实输入schema报UNSUPPORTED_SCHEMA，不为启用该Host移除限制。
- 既有offline runner执行`node --test --test-name-pattern 'original conversation result|compiled MCP package' tests/mcp-foundation.test.cjs`。日志mcp-original-result-20261029-1～4均退出1，分别暴露缺原组件、隔离编译zod类型路径、SDK JSON Schema扩展类型、完整发现超限及夹具误用active订单状态；定向修正本片适配 / 夹具，保留失败和output。第5轮退出0；最新[收口日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-result-final-20261029-1.log)退出0、2 pass / 0 fail / cancelled / skip / todo。两代真实SDK覆盖三场景unknown / failed / stale、order available、erased、严格输入、原关联错误在release前拒绝、撤回缓存、晚到取消及2,000字符限制不截断。没有生成模型答案或真实DB / HTTP。
- 当前shared全部源和MCP全部源严格编译到私有output，外部NodeNext消费者从shared运行时出口和MCP子出口取得生成声明与产物，不修改public dist / installed client、不复制依赖、不安装 / 更新lock；编译包消费重复相同两代SDK拒绝 / 正常断言。测试原reader / authority / accounting / release为明确替身，外发schema内observation是测试专用透传，不是生产字段政策。原组件在测试只读加载原API定义，不在产品深导入API或伪造同名DTO。
- 本次按负责人“收口，重启电脑”暂停继续开发，源码 / 测试 / 四册及所有失败日志 / 隔离产物留在本树未提交，HEAD仍0f59d1d4、暂存空。重启后先核对归属，再处理原身份 / 发布 / 字段 / 持久计量和正式组件出口，缺前置保持不发布。MCP-01～10原登记0%、正式0/10不变；AGP没有原结果业务消费或全端冻结确认，不向其他会话发消息。未安装 / 启服务 / 外联 / 迁移 / 提交 / 合main / 推送，没有独立审查。

## 阶段：首个Host显式模板消费者（2026-10-29）

Harness已消费原标准Prompts：人主动列表只读目录 / 版本、不发模型；主动选择从同一当前连接取模板，经原Agent空闲维护占用提交一条有来源 / 版本的原用户消息，原Loop与日志可重建。精确Agent / Session、版本 / 完整文字及取消 / 断开 / Agent销毁 / 模型服务移除 / 插件重载拒绝迟到正文，实际实现及失败修正见[插件阶段记录](../Harness插件/Harness插件-开发记录.md)。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-explicit-prompts-final-20261029-1.log)退出0、1 pass / 0 fail / cancelled / skip / todo，含当前插件strict / 声明及原Loader / AgentLoop / 官方SDK。没有修改MCP服务源码、另造Prompt发布或自动SystemPrompt；服务端发布 / 前后验权仍由原实现负责，AGP消费不重复计MCP实现。真实政策provider / AS / grant / 原Guard / 字段 / 原计量及生产模板仍缺，真实模型 / GUI未验；MCP-01～10原登记及正式0/10保持，未安装 / 外联 / 迁移 / 提交 / 推送。

## 阶段：可选版本化Prompts与独立Host采用（2026-10-29）

- MCP-03 / 05新增内部`McpPromptsProvider`及`prompts.ts`，通过官方SDK类型化`prompts/list / prompts/get`处理器发布最多50个当前获准模板。原provider按同一可信subject / client / resource / scopes分别过滤目录、读取当前审查文字；获取前后重读发布目录并复核身份，撤回 / 描述或版本变化 / 正文版本不一致 / 缺正文整项拒绝。没有业务参数、reader / Core、Task、云模型或第二批准能力；非空arguments / cursor及未知名称为安全InvalidParams。
- 正文与说明复用原instructions格式和完整2,000字符限制，整包同受15秒 / 64 KiB及返回前身份检查。仅显式provider启用Prompts，未配置不声明；不发布listChanged、Resources、completion或任意提示词代理。标准Prompt user消息不是强制SystemPrompt，现行Harness工具桥不自动读取或采用；Tools / instructions不依赖这项可选能力，未自行批准生产提示词或字段。
- 原offline runner执行`node --test --test-name-pattern 'optional prompts|versioned instructions' tests/mcp-foundation.test.cjs`，[第二轮日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-20261029-2.log)退出0、2 pass / 0 fail / skip / todo；[6源strict类型](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-types-20261029-2.log)退出0、0诊断。覆盖真实现代 / 旧版SDK当前列表 / 正文、版本更新 / 撤回、非法参数零正文读取、2,000字符精确与超限、50 / 51项、重复名称、合法单项但完整响应超限503、私密provider错误及迟到取消。
- [当前编译包 / Prompts组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-artifact-20261029-1.log)退出0、2 pass：从真实包出口编译并加载NodeNext消费者，在两代SDK取得同一版本化Prompt及synthetic只读事实；现代取消单独观察原请求signal中止，旧版关闭端点后观察原shutdown中止，迟到provider完成用屏障等待，没有sleep / 自动重试或放宽限额。[Harness组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-optional-prompts-20261029-1.log)退出0、1 pass，含当前strict编译 / 声明及原Loop / MCP / 材料检查，确认服务端声明Prompts后Tools继续驱动原Loop，Prompt正文零读取 / 零注入。
- 第一轮退出1：取消后立即断言provider signal已中止不适用于旧版stateless，它的取消通知不能中止另一个请求实例。实现补SDK处理器`mcpReq.signal`与原端点signal交集；测试分别验证现代请求取消及旧版原端点关闭，不把客户端取消当远端停止证据。旧请求仍由15秒截止 / shutdown限制，取消不推定未消耗。第一轮类型退出0；失败及全部output保留。补充正文读取后同client / scope但subject变化拒绝503的断言；身份复验后再次检查取消，已取消时不发起provider读取。最新[收口组合日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-final-20261029-1.log)退出0、2 pass，包含当前全源编译 / NodeNext包出口与两代SDK，不把之前绿色当最新源码证据。
- 当前仅传输 / 发布消费者实现，原政策provider为明确synthetic；真实AS / fixed grant / 原Guard、字段 / 来源 / 用途发布、持久目标和生产模板仍缺。Prompt UI及真实模型采用未验。按原任务G门，MCP-05全项仍缺正式字段 / 来源政策设计，MCP-03固定认证 / 公共业务schema依赖未齐；本子片不按测试数提高完整任务百分比，AGP-01及其余原登记保持。未修改正式需求 / 验收、API / shared / Prisma / lock / 原AGC / Harness / vendor，未安装、启服务、外联、迁移、提交或推送，没有独立审查。

## 阶段：释放JSON不静默改写事实（2026-10-29）

- MCP-05返回包装改为先按普通JSON数据描述符取得一份独立快照，再生成同源文本 / structuredContent；非有限数字、负零、undefined / bigint、自定义对象、getter / toJSON、稀疏数组、隐藏 / symbol字段和循环整项不可用，不执行自定义转换，也不把缺值或异常金额改成null / 零。复用对象引用不等于循环，合法重复事实仍按每份表示计量；2,000字符 / 50条及32,000投影 / 64 KiB整包上限不变。
- 本树shared没有可复用公共JSON快照出口；未安装依赖或借Host util使MCP服务反向依赖整个Harness。此处只验证原release返回的未知JSON材料，不在原业务DTO重建精度工具或金额算法。原字段许可和原reader前置仍未接，严格序列化不是数据释放许可。
- 原offline runner执行`node --test --test-name-pattern 'released JSON|read registration' tests/mcp-foundation.test.cjs`，[JSON释放日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-json-release-20261029-1.log)退出0，2 pass / 0 fail / skip / todo。真实两代SDK覆盖合法重复 / null / 布尔值、11种非法投影整项拒绝、getter / toJSON零调用、无私人错误、原边界及schema仍有效；不是业务金额 / 真实库验收。[5源strict类型日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-json-release-types-20261029-1.log)退出0、0诊断；[Harness消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-json-release-consumer-20261029-1.log)退出0，当前原Loop / SDK / 材料 / 生命周期组合通过，非真实外部业务。
- API / shared / 原AGC / Prisma / lock / vendor未写，没有安装、启服务、外联、迁移、提交或推送。MCP-05正式字段 / 用途 / 来源与期限生产者仍缺，不按包装子片或测试数量提高完整任务档位。

## 阶段：编译包出口与两代SDK消费（2026-10-29）

- 既有MCP测试新增隔离产物路径，按当前`tsconfig / package.json`严格编译全部源码至独立`output/mcp-package-consumer-*`，不写公共dist、复制依赖或更新根lock。NodeNext外部消费者从真实`@rental-os/mcp-server`包出口读取生成声明，消费endpoint / verifier / 内部subject / instructions契约，再加载已编译消费者和包产物；运行阶段不源码转译、不深导入本包src。测试resolver只为该产物的外部SDK进口定位本树既有公开安装。
- 原offline runner执行`node --test --test-name-pattern 'compiled MCP package' tests/mcp-foundation.test.cjs`，[产物消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-package-consumer-20261029-1.log)退出0，1 pass / 0 fail / skip / todo。全源 / 声明strict编译、实际ESM出口、匿名401、可信subject内部消费与现代 / 旧版SDK认证发现、空Tools正常返回通过；无实际业务工具、端口、HTTP外联 / 模型 / 数据库。空列表不当业务成功。随后最新只读产物消费[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-package-read-consumer-20261029-1.log)退出0，当前严格JSON快照 / 主体引用编译产物经两代SDK实际调用synthetic只读工具，断言冻结主体进入原adapter、释放结果无私人字段；正常投影不是生产字段许可。
- 尚非root依赖安装、tarball / 用户profile分发、真实AS / 原身份 / 持久目标 / 字段 / Core或完整协议验收；MCP-01 / 03 / 10按原连续G门不凭编译产物补齐未交付合同或生产前置。未安装 / 改lock、启服务、迁移、提交、推送或独立审查，全部隔离产物保留。

## 阶段：可信主体引用与响应前同一身份（2026-10-29）

- MCP-02资源验证契约新增必需`subject`，RFC7662返回同一可信AS的`sub`；它不是业务角色、Web token或模型自报actor。该内部不透明主体与token / client / resource / scopes形成不可变请求引用，交给原发布 / authority / accounting / release及instructions provider，避免原适配只能重新解析token或丢失被验证主体。原Guard / ALS映射、固定tenant / workspace / grant及撤销生产者仍未实现，缺前置不开放业务。
- SDK认证对象由本端私有WeakMap关联该引用，不保存token全局索引或额外协议身份字段；本端预先写相同resourceMetadataUrl，避免官方Bearer helper为追加metadata复制认证对象。通过真实两代SDK验证内部引用消费，不改SDK / vendor。注册前、执行前 / 读后和整包返回前比较subject / client / resource / scopes及当前expiry；同client / scopes但subject变化整项拒绝，未发送事实，不能用client一致替代主体一致。
- [定向MCP日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-subject-20261029-1.log)：原offline runner执行`node --test --test-name-pattern 'resource audience|RFC7662|read registration|trusted subjects|versioned instructions|both supported' tests/mcp-foundation.test.cjs`，退出0，6 pass / 0 fail / skip / todo。覆盖必需主体、introspection只输出内部可信字段、两代注册 / 指引provider得到同一冻结引用、发布阶段换主体零reader、投影后换主体安全503且无事实 / 私人主体泄漏；既有有界投影 / 发布撤回与协议亦通过。
- [5源类型日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-subject-types-20261029-1.log)退出0，TypeScript6.0.3 strict noEmit、0诊断。[Harness消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-subject-consumer-20261029-1.log)退出0，当前插件strict编译 / 声明、真实Loader / MCP / 原AgentLoop / 材料限制及释放组合通过；测试verifier同步新增synthetic subject，不用假原Guard补生产依赖。
- 此片仅修MCP内部可信身份传递，不增加公共业务DTO、AS实现、持久授权或后台开通，也不更改正式需求 / 原任务验收。MCP-02完整G1固定grant / 原权限设计仍缺，任务不因内部引用或测试数量跨档；API / shared / Prisma / lock及他线成果未写，没有安装、启服务、真实HTTP / DB / 模型、迁移、提交、推送或独立审查。

## 阶段：首个Host模型材料与原日志消费（2026-10-29）

- 本片不改MCP生产者，Harness原AgentLoop用脚本模型驱动已发布只读MCP，再把同源指引及释放事实送入下一轮中立模型请求；原Session事件可序列化重建相同消息。真实Loop / LlmRuntime / Loader及SDK是原实现，模型、HTTP / AS / listener与业务providers为明确外部替身，不代表真实业务授权或模型自主呈现通过。
- AGP从原`llm/stream`接入256 KiB中立材料限制，同一Session在本插件加载时断开后仍检查；原请求保留工具声明 / 调用记录时，重载后无登录 / 无initiator也重新收紧检查，但不恢复授权。LlmRuntime缺失 / 移除同时阻止读工具发布。最新命令、退出0证据及服务组合首轮夹具失败见[插件开发记录](../Harness插件/Harness插件-开发记录.md)，不重复计服务端建设。最终Provider线包、文件 / 图片扩张、目的地、磁盘与跨重启 / fork恢复仍未保证。
- MCP-05只可消费原负责人明确批准的外部释放类别；严格目的地 / 逐次授权 / 强制到期证据缺失继续不可用。原AS / 固定grant / Guard、持久目标与正式字段schema未齐，不以Host局部上限、脚本模型或可重建日志开放生产工具。未安装、启服务、真实HTTP / DB / 模型、迁移、提交或推送，完整任务登记不从消费者证据自动提高。

## 阶段：Harness原工具桥客户端消费（2026-10-29）

- 本轮未改MCP服务端实现，AGP-04复用原公开工具桥 / ToolRuntime / AgentRegistry消费受保护MCP，只读列表 / 调用及当前撤回通过真实SDK。精确Agent / Session绑定、子Agent与旧引用拒绝、无自动重发、在途取消 / 迟到及卸载证据见[插件开发记录](../Harness插件/Harness插件-开发记录.md)，不重复记服务端实现或当成真实原权限通过。
- 首片生产AS / 固定grant / 原Guard / 持久目标 / 字段schema仍未交付，业务不得发布。新发现兼容缺口：Harness原schema子集不支持minimum / minLength等约束，消费者拒绝而非去约束；业务合同须由原作者共同固定，不能在MCP / 插件私造同名DTO绕公共出口。256 KiB模型材料和真实模型 / Host仍未验。
- 本轮只插件源码、manifest、既有测试及两专项记录 / 接续变更；未改API / shared / lock、未安装 / 启服务 / 外联 / 迁移 / 提交或推送。完整G门依赖未齐，MCP / AGP任务登记不因局部消费者绿色自动提高。

## 阶段：字段与列表上限、单份释放快照（2026-10-29）

- MCP-03 / 05只读投影沿正式限制递归检查：每个外发字符串最多2,000字符、数组最多50条，超过整项不可用。先序列化已释放对象为一份JSON快照，再由同一快照生成文本与structuredContent；原provider后续可变对象不造成两份不同结果。投影32,000字节和整包65,536字节检查仍分别保留，不拿字段合法代替当前释放政策，也不允许reader全量读后只过滤输出。
- 原组合只增加必要边界：精确2,000字符 / 50条可返回且text与structured相等，2,001字符 / 51条拒绝；分字段合法但总投影或重复包装超限仍拒绝，真实现代与旧版SDK一致。`node --test --test-name-pattern 'read registration' tests/mcp-foundation.test.cjs`日志`mcp-output-fields-20261029-1.log`退出0；5源strict noEmit日志`mcp-output-fields-types-20261029-1.log`退出0、0诊断。没有扩大回归、删除断言或放宽schema。
- 同一输出schema实例同时用于SDK公告与返回前验证；无效释放结果在本地转安全错误，不能让SDK校验明细回显私人字段。追加非法输出回归后`mcp-output-schema-20261029-1.log`退出0，5源strict noEmit的`mcp-output-schema-types-20261029-1.log`退出0、0诊断；不另写第二套schema或降级放宽。
- 生产原权限、持久目标、字段 / 来源政策和业务schema依旧未接；没有真实目录注册、数据库 / 模型 / 发布或独立审查。源码限制不代表整项验收，任务档位未跨完整门槛；下一入口见接续。

## 阶段：版本化服务器指引与首个Host消费（2026-10-29）

- MCP-05新增内部`instructions` provider，原政策作者交付审查后的当前外发文字 / 版本；未认证不读取，undefined为未发布，坏版本 / 完整2,000字符超限或失败不可用。完整归属 / 版本文字也计入文本上限，并沿15秒 / 64 KiB整包及最终资源复验。没有自行批准字段 / 提示词、注册Prompts / Resources、调用模型或建立任务。
- 真实官方SDK分别从现代discover与旧版initialize取得同一版本；更新读取当前值、撤回不保留、私有provider错误不返回。`node --test --test-name-pattern 'versioned instructions' tests/mcp-foundation.test.cjs`最终日志`mcp-instructions-20261029-3.log`退出0；最新5源strict noEmit日志`mcp-instructions-types-20261029-2.log`退出0、0诊断。此前`mcp-instructions-20261029-1.log`对指引与只读注册两组合退出0。
- AGP使用原`SystemPrompt`消费同源指引，精确Agent及其原Session一致才出现在组装中，更新 / 撤回 / 失败 / 断开 / 卸载处理见[插件记录](../Harness插件/Harness插件-开发记录.md)。实际模型请求持久重建与真实采用未验，不把组装验证当完整模型或数据治理通过。
- 静态收口：`python -I output/harness-oauth-session-20261028-m3kvbehy/check-current-instructions.py current-static-20261029-1.json`退出0：29份当前源码 / 配置 / 文档、106个本地文件链接、9项冻结指纹未变、4份相关offline audit无记录、暂存为空。定向`git diff --check`退出0；全树检查曾报告他线rootlock两行空白，未抢写修正。HEAD仍`0f59d1d4`，未提交。
- 仍缺生产AS / grant、原权限适配、持久目标、发布政策及正式业务schema；MCP-05主投影生产者未齐，不以传输辅助接口提高完整任务档位。后继接真实固定生产者和原工具桥；生产依赖不明确时记录后跳过，不使用占位许可。原需求 / 任务编号和验收不改，未安装、启服务、迁移、提交或推送。

## 阶段：原授权只读注册与完整响应限制（2026-10-29）

- MCP-03注册编排已接官方SDK：每项只读要求原发布 / Controller等价权限与ALS / 持久计量 / 外发投影四个provider，输入和输出使用原作者闭合schema。当前发布过滤列表，缓存名称直接调用仍复验；原权限 → 原计量 → reader → 投影，文本及structuredContent只送投影。没有消费原目录或开放生产Tools，synthetic测试不代替原Guard、持久目标或字段许可。
- 首次认证、工具执行与完整响应共用最长15秒信号；最终整包在发送前再次核验当前资源身份、expiry及scope，最多65,536 UTF-8字节。投影32,000字节只提前拒绝；JSON转义 / 文本 / structuredContent重复超过完整上限返回安全503，不截断成业务成功。资源验证失败、安全错误和缺依赖均不返回原私人资料。
- 实际命令经原offline runner：`node --test --test-name-pattern 'read registration' tests/mcp-foundation.test.cjs`日志`mcp-read-registration-20261029-3.log`退出0，1组合通过，包含真实现代及旧版SDK列表 / 调用、非法输入、发布撤回、权限 / 计量 / 投影顺序、私有字段、投影及重复包装超限、读后身份失效。第二轮所选迟到身份路径通过，整包断言退出1：实际SDK已返回503，但其错误文本不包含状态码；改在HTTP适配直接断言503后复验，未改变生产拒绝或放宽上限。最新`check-types.cjs`日志`mcp-read-tools-types-20261029-2.log`退出0：4源strict noEmit、0诊断。
- 不到G1完整合同门槛：真实AS / 固定grant / 当前原身份适配、持久目标和获准字段schema仍缺，MCP-01 / 02 / 04 / 05 / 06不因注册层或测试数量跨档。原能力映射及公共schema由原作者维护，未抢写API / shared / lock。MCP-03的固定认证出口未齐，注册组合证据不冒充完整装配。下一入口为Harness单连接的原公开工具桥消费，缺完整前置仍不启用真实业务。
- 原临时loopback客户端模式已在真实Loader及外部监听替身验证，详见[插件记录](../Harness插件/Harness插件-开发记录.md)；未实际监听端口、开浏览器、连AS / 数据库 / 模型。没有安装、迁移、提交或推送，没有独立审查或正式验收。

## 阶段：固定AS资源身份验证与取消（2026-10-29）

- `packages/mcp-server`新增RFC7662 introspection verifier，经固定HTTPS AS端点、显式客户端认证和client / scope白名单，每次请求重新读取active / issuer / 单resource audience / subject / expiry，不缓存有效身份，不发行token、不映射或绕开原业务Guard。AS提供当前grant / client / tenant停用证据仍是生产依赖；缺失不开放业务。
- 原`ResourceTokenVerifier`增可选signal，兼容旧单参数消费者；入口转发请求 / 关闭 / 截止信号，新适配拒绝迟到结果并取消有界读取。安全错误区分invalid401与证据不可用500，未知异常仍不输出AS正文、凭据或subject。配置与HTTP边界拒绝重定向 / 超限 / 重试，无环境读取或新依赖。
- `node --test tests/mcp-foundation.test.cjs`经既有offline runner，日志`mcp-introspection-20261029-1.log`退出0，11 pass / 0 fail / skip / todo；真实官方SDK运输与新增当前active / 无缓存 / allowlist / 拒绝 / 字节 / 取消路径通过。私有`check-types.cjs`对3源strict noEmit退出0；实际日志`mcp-introspection-types-20261029-1.log`。插件既有Loader消费在MCP出口拆分后复验日志`harness-oauth-introspection-consumer-20261029-1.log`退出0。全部仅HTTP进程内替身，不是生产AS / 真库授权验收。
- 本片完成资源认证适配，未接原Guard / fixed grant / 后台政策 / 持久目标准入 / 字段目录，不把认证当业务授权。客户端Token私有内存边界沿前阶段；原API / shared / lock / AGC / Harness源码不改。没有安装、启服务、迁移、提交或推送。继续无阻塞的工具注册 / 版本化安全输出接点，实际业务仍要求全部原生产者。

## 阶段：首个客户端OAuth标准连接（2026-10-29）

- Harness已实现私有进程内OAuth / S256 / callback / exchange / 单refresh / 原session绑定和专用官方SDK握手，禁止自动重新授权 / 重发，没有业务工具。真实Loader与外部HTTP / 浏览器 / listener替身通过，详见[插件记录](../Harness插件/Harness插件-开发记录.md)；不是Rental AS / grant或服务端身份完成。
- `packages/mcp-server`仍未接真实AS和grant，原公共Auth / Guard / schema / 装配归服务端作者。本轮不伪造授权、不写共享凭据，后继先补可独立实现的资源验证与取消 / 当前身份交付，再按明确归属接原权限；MCP计量 / 字段 / 业务工具依赖不跳过。用户持续目标允许记录问题后做无阻塞项，不自动授予安装 / 迁移 / 真实联调或公共文件抢写。

## 阶段：授权前置核验与生产者缺口（2026-10-28）

- Harness消费者新增标准OAuth元数据核验命令，检查明确配置的issuer、public client回调格式、S256 / scope和精确端点，结果不代表远端登记或grant有效。官方SDK的RFC8414 / OIDC读取、拒绝与取消已通过真实Loader离线组合；完整命令 / 退出码见[插件记录](../Harness插件/Harness插件-开发记录.md)。原MCP基础9/9回归通过，`packages/mcp-server/`本轮没有修改，不计新增服务端实现。
- 原`AuthService.resolveAccessContext`仍从Web session取当前空间；`ApiAuthGuard`及内部业务authority会再次验Web身份。当前未找到MCP OAuth AS / grant持久化，已有Web token不作替代；Auth / Guard / schema / 公共装配继续由原服务端作者持有，本轮未接管。
- Harness原HTTP transport缺动态OAuth注入点，默认credentials文件和共享读取接口不足以隔离通用工具。本轮不造私有API、假AS或静态token演示。MCP-02真实AS / 固定grant / 当前身份适配、AGP安全凭据与单连接接点仍为联合阻塞，不能只承诺下一轮补登录而继续堆检查器。未安装、启服务、连外部环境、迁移、提交或推送，任务登记不变。

## 阶段：Harness消费者接入原Bundle与Loader（2026-10-28）

- 本轮沿原MCP统一通路，只推进Harness消费者：独立Bundle / patch / Loader四项导出及原人类命令`/rental`接入，配置 / 检查反馈不进模型，仍仅登录前发现而非OAuth或业务授权。`packages/mcp-server/`及`tests/mcp-foundation.test.cjs`保持上片实现，没有新开MCP能力或借Web凭据。
- 真实profile解析、Loader、CommandRuntime、SessionStore与编译包消费验证通过；HTTP和正向身份仍是进程内替身，没有端口 / GUI / 真实服务。完整命令与失败 / 通过、产物和未验边界见[插件开发记录](../Harness插件/Harness插件-开发记录.md)，不重复记服务端进度。
- MCP下一缺口仍为原OAuth / grant / 当前Guard、正式字段释放及持久目标计量；不能把Bundle可加载、空Tools或发现成功当作授权已完成。未安装依赖、改根锁、修改并行API / shared / OpenAPI、迁移、提交或推送。

## 阶段：受保护MCP协议入口与登录前发现（2026-10-28）

- 负责人明确开始按两专项文档推进开发。本片新增独立`packages/mcp-server/`和`clients/harness-plugin/`接入模块及一份`tests/mcp-foundation.test.cjs`，不修改正在并行写入的API装配、Guard、shared出口、OpenAPI或根锁文件。原AGC与6项暂停客户端WIP保持，开工指纹在`output/mcp-foundation-20261028-9j4ghqjm/`。
- 服务端使用本树已有官方`@modelcontextprotocol/server` 2.2.0，提供不监听端口的`createProtectedMcpEndpoint().fetch(Request)`：显式开关、HTTPS / 精确路径 / Origin、标准Bearer挑战、RFC9728资源元数据、resource / 到期复核、请求字节上限和取消 / 关闭后的迟到拒绝。未提供原身份验证器返回503；不伪造AS元数据、不发行token、不提供业务工具，认证后的空Tools只验证标准运输。
- 客户端使用官方client 2.2.0解析资源发现，限制到配置资源和精确metadata地址、预期issuer及header凭据方式；不带凭据、禁止重定向 / 额外回退、限制声明和流式字节、取消释放读取。成功只为`authorization_required`，未取得登录或业务资格。
- 已核对原Auth / Guard / ALS和目录路径：现有Web会话由session当前空间决定，业务reader权威入口还会再次解析Web凭据；不能用MCP token伪装operator或仅填ALS。原`AiCatalogReadFactsService` / `listItemGroupsPage`可后续复用，但MCP grant、正式外部字段政策和原持久目标计量仍未接通，因此不注册目录工具、不借原`human_preview / not_sent`许可。
- 仅新package声明固定SDK / TypeScript6.0.3 / Node类型22.20.1，未安装或更新根lock；当前不是root工作区安装 / 产物就绪。测试与私有类型检查明确从本树Harness已安装SDK解析，生产源仅按包出口导入，没有复制生成物或相邻源码深层运行依赖。`clients/harness-plugin`尚无Bundle manifest或原Host注册，不称已可安装。

### 实际验证

全部Node命令经已有`output/agent-desktop-install-20261023-q16gtnf6/run-offline.py`，固定Node24.21.0、原offline preload / 无效DATABASE_URL及本树绝对audit / TEMP / cache。HTTP使用`Request / Response`进程内适配，无socket、DNS、数据库或模型调用；正向身份为明确synthetic verifier，不是生产授权。

- `node --test tests/mcp-foundation.test.cjs`首轮退出1：根实际TypeScript7.0.2不再提供旧compiler API，测试transpile入口失败；改用已有Harness TypeScript6.0.3后第二轮8 pass / 0 fail / 0 skip / 0 todo，退出0。首轮失败保留，未修改权限或断言变绿。
- 后续仅复验修改范围：`node --test --test-name-pattern 'refuses disabled|standard challenge|negotiates both|client metadata stream' tests/mcp-foundation.test.cjs`为4 pass；进一步关闭Promise / 字节上限捕获后，`--test-name-pattern 'late identity|client discovery rejects|client metadata stream'`为3 pass，均退出0。新增流取消用明确开始 / 结束信号，无固定sleep。真实官方SDK分别断言协商2026-07-28和2025-11-25、空Tools及业务调用拒绝，不是手写协议替身。
- `node output/mcp-foundation-20261028-9j4ghqjm/check-types.cjs`最终两个真实源根strict noEmit、0诊断，TypeScript6.0.3，退出0；只做私有解析映射，不覆盖公共dist。日志为既有安装目录`logs/mcp-foundation-*.log`，本片audit日志未产生拒绝记录。中间SDK json模式提示已通过使用原auto响应模式消除，不是隐藏日志。

### 尚未完成

未装配到API监听器、未建立原OAuth AS / grant / 后台治理、未接原权限链或安全凭据存储，未接原业务工具 / 累计计量 / 字段许可，也未完成真实Harness连接或Bundle安装。验证器等待有界且迟到拒绝，不意味着不合作的验证器或HTTP适配已真正停止；生产仍须补真实截止与清理。

下一片为MCP-02原OAuth / grant与Controller等价授权的实际适配，同时衔接AGP-03安全凭据 / 原连接入口；原公共文件仍须核对归属，不能替他线写入。尚未达到MCP-01或AGP-01整个G1范围，不改任务0% / 正式0/10。未安装、启服务、读环境、联网、迁移、提交或推送；没有独立安全审查或生产验收。

## 阶段：MCP优先与Harness联合首片立项（2026-10-28）

- 负责人在确认“插件授权 / 数据 / 提示词、Harness自主呈现”之后，明确采用MCP共建方向并要求同步插件和MCP的需求 / 开发文档。新建`docs/MCP服务/`四册v1.0；插件两册升v1.1，MCP首片优先、Harness首个客户端，原AGC两册和历史继续封存。
- 服务端协议、OAuth / grant / 后台、现行工具 / 字段投影、原目标计量与业务适配统一归MCP-01～10及原作者。AGP仍保留01～10，但只负责Host消费、必要连接授权适配、会话指引和原生呈现，不另造私有业务API或重复native工具。两专项首片共同安排、验收分母独立，登记均为0% / 0/10，不以此立项计进度。
- 原`docs/Agent接入改造/MCP服务-接入方案.md`v0.3研究正文原样保留，头部增加当前依据指向；其P1～P7仅历史建议，正式映射见本册任务。旧协议 / 客户端命令沿当时研究解释，本轮没有联网复查或执行。
- 只读核对Harness原`mcp-client` README、transport和instructions接点：已有标准运输 / tools / instructions，但所读HTTP工厂仅传config.headers；不能宣称OAuth / 安全refresh、凭据及当前业务限额已满足。已把原生优先、只补必要标准MCP客户端适配、单驱动及SDK重试核查列为联合任务，不为演示复制Web token。
- 明确服务端输出与Host整体模型上下文的控制范围：MCP保证自身64 KiB结果及服务端累计；Harness可控组装仍有256 KiB门槛，不假称MCP可计量任意Host全部上下文。Tools / instructions / 可选Prompts分开，Prompts不保证自动加载，模型忽略指引仍不得越权。
- 本轮工作树基线`0f59d1d4`，开工暂存为空且无合并 / 摘取中状态。前像与指纹保全在`output/mcp-first-docs-20261028-e3npzky8/`；原AGC五份文档和暂停客户端六项源码 / 测试不修改，不接管同树API / shared / OpenAPI / tests / 依赖及AI Native文档WIP。

### 文档核查

- `python -I output/mcp-first-docs-20261028-e3npzky8/check-docs.py static-check-2.json`退出0：10份文档、152个本地链接 / 3个锚点有效，两专项各10项需求 / 任务 / 验收编号连续，包含阶段追加条件的20项依赖图无环；11项冻结文件、6份前像、原AGC两册v1.5指纹及旧MCP研究正文 / 插件历史保持。
- 首轮`static-check.json`退出1：检查脚本用字面短语匹配漏掉需求中的同义表达，且依赖解析未完整识别紧邻中文的编号和跨专项省略前缀。修正脚本并将一处阶段依赖明确写为`AGP-08`后复核通过，没有为变绿删除需求或放宽业务规则。
- `git diff --check -- docs/Harness插件 docs/MCP服务 docs/Agent接入改造/MCP服务-接入方案.md docs/文档导航.md`退出0，Git仅提示后续LF / CRLF转换；未跟踪的新文档已由Python逐文件检查，不用Git忽略未跟踪内容代替验证。未作独立审查或产品验收。

### 已做与剩余

已完成正式文档和职责 / 依赖设计。尚无本专项MCP Server、OAuth / grant生产者、Host授权适配、实际业务工具或跨Host验收；下一实现从MCP-01 / AGP-01固定合同，接02～06适用只读安全链及Harness消费者，不开始报价 / 建单或开放字段。

本阶段仅文档核查；未安装依赖、修改产品源码、启服务、读取环境、连接真实HTTP / DB / 模型、执行迁移、提交或推送。不是独立安全审查、正式业务验收或上线许可。
