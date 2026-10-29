# Rental OS 本地 Agent 客户端

本目录保存基于 DeepSeek Harness 的定制客户端源码与来源信息，包括原登录门槛、经营空间、AI / 传统切换、后台嵌入及工作台成果；不删除或搬走已有源码、测试和WIP。

> 2026-10-28：本目录所属的**Agent接入改造专项封存保留**，原需求 / 开发任务已恢复v1.5原文，入口见下方。**Harness插件另立独立专项**，见[插件需求](../../docs/Harness插件/Harness插件-需求.md)与[插件任务](../../docs/Harness插件/Harness插件-开发任务.md)，不是将本专项改成v2.0。以下原生桥 / 定制布局说明仍属旧客户端，不是插件安装说明；未完成用途入口修改原样保留为WIP，不代表原版插件已可用。

## 专项入口

- [原需求v1.5](../../docs/Agent接入改造/Agent接入改造-需求.md)：封存保留的客户端范围和验收。
- [原开发任务与接入设计](../../docs/Agent接入改造/Agent接入改造-开发任务.md)：保留原任务顺序与进度，不混入插件任务。
- [开发记录](../../docs/Agent接入改造/Agent接入改造-开发记录.md)：本目录的实际准备与历史证据。
- [封存协作接续](../../docs/Agent接入改造/Agent接入改造-协作接续.md)：暂停现场与未完成事项。

## 来源与结构

- `harness/`：上游完整源码，来源为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，于 2026-10-22 下载。
- [UPSTREAM.json](UPSTREAM.json)：来源 SHA、下载归档哈希、文件清单摘要、许可位置及 Windows 内部链接物化说明。
- [LICENSE](harness/LICENSE) 与 [THIRD_PARTY_NOTICES.md](harness/THIRD_PARTY_NOTICES.md)：上游许可和第三方声明，保留原文；商用发布还须核对实际打包依赖与品牌素材。
- [Harness README](harness/README.md)、[Desktop README](harness/apps/desktop/README.md)、[安全提示](harness/SAFETY.md)：上游说明。developer preview 未经安全审计，不能当生产就绪。

下载的是固定 SHA 归档，不含上游 Git 历史，不是 Git submodule。原归档和普通文件哈希基线保留在本树 output；当前目录含本专项的本地接入修改，不再是未改源码。14 项内部符号链接在 Windows 物化为对应副本，原路径和 link target 记录在来源文件。后续升级须比较固定版本与本地修改，不直接覆盖目录或追活动 HEAD。

## 工程隔离

Harness 自有 pnpm workspace 与 lockfile，Rental OS 根工程使用 npm workspaces。本目录位于 `clients/`，不加入根 `apps/*` 或 `packages/*`；不要在这里用 Rental OS 根依赖冒充 Harness 的已安装环境，也不要整体调整后台 React / UIArc 为了直接导入组件。

本目录原接入采用Harness外壳与隔离Electron WebContentsView承载后台登录 / 内容页，现随原专项封存保留。独立插件专项优先使用原宿主扩展点和可信Web授权 / 确认，不要求安装该定制壳；具体职责见[插件开发任务](../../docs/Harness插件/Harness插件-开发任务.md)。

模型提供商、模型与 Key 由客户端用户在 Harness 内配置，费用与用量归用户自己的模型账号。Rental OS 登录及业务权限是另一条通路；旧平台 AI 设置和账本不管理新客户端模型，旧源码和历史成果仍保留。

## 接入实现与部署配置

[桌面业务视图](harness/apps/desktop/src/rental-business-view.ts)承载原后台登录、强制改密与受控内容。[后台接入](../../apps/admin/src/features/agent-desktop/DesktopSessionBridge.tsx)报告无凭据状态、原受权菜单，并承接封闭目录读取；[工作台插件](harness/packages/client/ui-rental-workbench/README.zh.md)提供经营空间、AI / 传统、菜单、操作反馈和人工目录预览。普通浏览器不具备原生 preload 标记，继续使用完整 Web 外壳。

打包态读取 Harness 桌面 `package.json` 的 `rentalDesktop` 配置；开发态可用 `RENTAL_DESKTOP_ADMIN_URL` 指定获准地址。不设配置保持上游行为，配置非法则拒绝启动；生产地址必须 HTTPS，开发态仅环回地址可 HTTP。当前没有写入真实部署地址。

```json
{
  "rentalDesktop": {
    "adminUrl": "https://admin.example.invalid/",
    "downloadOrigins": ["https://files.example.invalid"]
  }
}
```

这是字段格式示例，不是已运行配置。`downloadOrigins` 省略时仅同源文件和本地 Blob 可下载；使用外部对象存储签名地址的部署须明确列出 HTTPS origin。后台凭据不注入文件 origin，下载跳转链也须在允许范围内。业务更新由同一 Web部署供给，显式重连请求不使用缓存副本；原草稿保护会拒绝未保存页面的刷新，不自动重发业务。

菜单跳转只有在原页面路由实际切换且当前身份 / 权限仍匹配时才回报完成；原草稿阻止跳转时保留编辑状态。切换经营空间会撤回旧本地 Host 准入，沿原停止 / 恢复流程重新进入，原会话与模型配置仍保留。页面加载及桥握手最多等待 20 秒，停滞后显示重连提示；导航应答不明时，须由新业务文档重新报告当前服务端会话后才解锁。重连不重发上一命令，也不证明任何业务写入已回滚。

## 受控目录预览与政策接口

当前通路为工作台侧栏“受控目录预览” → 私有Host实际模型准备检查 → 受限原生桥 → 原后台 HTTP → [显式服务模块](../../apps/api/src/modules/ai-native/desktop-business/desktop-business.module.ts) → 原 Auth / Guard / ALS 与有界商品 reader → 模型路由再次检查。它只返回目录引用、注册品类和启停状态，不返回名称、编码、库存、价格或个人资料，不发起模型生成、库存预占或业务写入。结果不写聊天历史，最长展示30秒且不超过原业务事实期限；身份 / 空间 / 页面失效或查询 / 模型输入变化即清除。

工作台不再手填Base URL：填写本次要检查的已配置Provider和模型ID，由 `catalogForModel({ selection, limit })` 经封闭 `rental:catalog-for-model` IPC取得原Host `llm.prepareCall()` 的适配器初始路由。两次准备的模型、端点、协议及准备参数指纹必须一致，均不得过期；原目录请求携带精确 `modelRoute`，服务器当前政策必须同时允许目的地、模型与协议，响应也须绑定同一路由。`preparationVersion` 只由准备配置、能力、重试和路由事实求指纹，不混入观察时间、密钥或宣称数据库配置修订。Host查询4秒截止，壳层控制5秒截止，原目录15秒截止，原生准备与读取正常总等待最多25秒；工作台另设15秒待取截止、显示前复核5秒截止。新路径最多并发2次模型检查；人工预览不自动重新生成，展示复核按下述短期机制续查。桥缺失或适配器无法解析时拒绝，不回退旧人工目的地桥；旧 `catalog` 仅保留已有人工预览兼容，不授予模型调用许可。

以下 POST 接口统一在 `/api/ai-native/desktop-business/` 下；字段从 [shared 合同](../../packages/shared/src/agent-desktop-business.ts) 和 [OpenAPI](../../apps/api/src/contracts/ai-desktop-business-schemas.ts)读取。身份由服务器当前会话确定，body 中 binding 只用于核对，不授权。

材料显示前须通过新增的`checkCatalogForModel`：原生桥在当前Auth / Guard / ALS、原审计、政策和Core原商品页复核前后再次检查真实Host准备。Core配置指纹针对返回页，因此按原数量读取并比较覆盖，不以一条商品代替原页。展示期间每3秒复核，每次最多5秒且不延长原观察30秒；来源页同期按原受权入口刷新，但不延长首次60秒。旧桥缺少复核能力就不展示材料。复核失败 / 卡住、失焦、隐藏、切模式或scope变化清除并停止续查，返回后须人主动重新读取；迟到应答不恢复旧内容。计时器仅控制展示，不是可信累计资源，也不是即时撤权广播或最终外发许可；不触发模型、批准、库存或业务写入。

| 后缀 | 作用与边界 |
| --- | --- |
| `catalog` | 严格请求 ID / binding / limit / destination，可选 `modelRoute` 为精确Provider / 地址 / 模型 / 协议。存在时须匹配当前政策的 `modelRoutes`，响应原样绑定；缺字段只可原人工预览，不能转换为获准模型结果。原商品读权、当前政策及审计必须通过。最多50条；人工输入仅在本机按封闭语法解析，未指定数量时预览上限10条。 |
| `catalog/sources` | `kind=catalog_sources`、请求号、binding及1至10条上限。沿当前原商品读权读取本人本空间近30天的原审计引用，查询按时间 / ID排序并最多探测limit+1条，引用页60秒到期。只返回封闭原条件和版本，无旧业务正文；无来源绑定的旧记录明确不可恢复。停用新预览不阻断独立当前读权下的来源观察。 |
| `catalog/check` | `kind=catalog_check`、请求号、binding和原`previewRequestId`。精确查本人本空间原审计，最多读取2行排除重复；复核当前原商品读权、政策和原有界商品页的配置指纹及覆盖。仅返回最长5秒的展示复核结果，不返回商品正文，不延长原观察30秒上限，不授予派发或执行权。 |
| `policy` | 当前配置管理者读取本空间政策；无记录为 `not_configured`，不自动启用。 |
| `policy/change` | 人类管理者用原 `operationKey`、预期修订和完整政策做 CAS；限定工具、目的地、可选精确 `modelRoutes`、数量及期限，不是模型配置或企业订阅。每条模型许可须属于目的地白名单，不支持通配符。 |
| `policy/operation` | 当前管理权限下读取本人原保存收据；`not_observed` 不证明回滚，`AI_RESULT_UNKNOWN` 不换键重做。 |

政策沿原系统配置管理权限，商品查询沿原业务权限，两者不能互相替代。SQL仓储和原业务审计使用当前空间；读取后复核身份和政策，审计未持久化则不返回投影。现有JSON政策表保存精确许可，未新增结构迁移或默认许可；本轮未迁移数据库，缺表时拒绝。原“AI 服务设置”页先读取当前修订，再明确保存启停、最多50条、UTC期限、最多16个目的地与32条精确模型许可；不开放模型 Key 或任意工具。旧JSON与原收据缺 `modelRoutes` 时保留原形和幂等载荷，不补猜默认模型；缺失或空列表均不授权模型绑定预览。

编辑器在发送前用当前账号 / 租户 / 空间分区的 `sessionStorage` 保存原操作编号和预期修订，不保存政策正文或凭据。应答不明后阻止新保存，页面重载继续只读核对原编号；`not_observed` 仍待核对，不自动重做。历史保存确认后另读当前政策，不能把旧收据当现行配置。恢复存储不可用时不发新保存；整窗关闭后的恢复引用不作保证，原服务端收据仍保留。

目录输入目前只支持“查看商品目录”“查看前5条商品目录”和对应的有限英文语法，完整匹配后只提交封闭条件和实际准备路由，不传原文；额外客户信息、价格、库存条件、附加指令或超量请求均要求澄清，不调用模型做脱敏。默认10条是预览上限，不是业务默认值；切身份 / 空间重新建立输入区。

“找回材料来源”沿原 `onCatalog / completeCatalog` 受限通道，以新增 `kind=catalog_sources` 区分固定只读请求；不提供任意接口代理。来源由 `PrismaDesktopCatalogSourceRepository` 受权查询原OperationLog；新审计只追加封闭条件、配置 / 政策版本及当前权限摘要，不保存商品正文或另一份聊天库。旧记录或缩权后无法证明原范围时只返回不可恢复提示，不能从旧聊天、最近商品或当前配置拼造原结果。30天只是此入口的来源查找范围，原审计按既有制度保留；这不代表30天业务正文 / 7天临时附件清理已实现。

人明确点选来源后，工作台向 `catalogForModel` 提交原Provider / 模型 / 数量及 `sourceRef={auditId,requestId}`。原目录请求携带同一引用；服务器按当前scope / actor精确读取原行，比较原条件、实际路由及权限摘要，并再次通过当前政策和Core读权。缺来源、改条件、改路由、跨主体或失权不放行；没有原条件时要求重新准备。新响应的 `reopenedFrom` 只标原审计 / 请求 / 观察时间 / 配置版本，当前结果另有本次版本与时间；即使版本相同也不保证库存、价格或其他状态未变。不能把新观察当旧正文、收据、授权、派发事实或unknown重试。来源与材料在退出 / 切空间、观察到失权、到期或相关读取失败时清除；重新打开后可从原审计找回引用，不依赖旧实例Map。

模型检查输出只包含本次selection、协议、去凭据HTTPS初始目的地、`preparationVersion`、观察 / 到期时间及 `source=prepared_initial_route`、`execution=not_dispatched`。当前支持直接Messages适配器，以及显式非空API Key的标准OpenAI Responses / Completions、Anthropic Messages适配；SDK账号切换到Codex、隐式认证、其他协议及带用户名 / 密码 / 查询参数的URL保持不可用。目的地只读实际准备快照，不采信Provider目录默认地址或预览请求手填URL。请求配置和初始目的地在准备时固定；pi-ai同时固定显式Key覆盖值，Messages沿原连接快照的认证口解析，不把密钥带到渲染器。精确模型政策只是当前预览条件，不放开真正的模型发送。

返回的 `material` 是 `purpose=human_preview / modelRequest=not_sent` 的封闭JSON内容与SHA-256；外层原目录保留actor / scope / 政策修订与hash / 配置版本 / 请求号及初始路由。内容仅含本次 `item_1` 等序号引用、受控品类 / 启停枚举、查询 / 到期时间、配置hash和结果覆盖 / 缺项；内部对象编号、个人身份、原始文本、Provider地址、商品名 / 编码、库存与价格不进入内容。壳层生成，工作台复核规范内容和SHA后显示；指纹不是签名、执行依据或收据。结果最多30秒，在条件编辑、观察到的身份变化或本次准备变化时撤回；尚无服务端失权即时广播。仅存临时界面状态，不入聊天 / 摘要 / 文件，不实现30天 / 7天留存制度，也不能据此宣称完整历史隔离。旧Host / Web若缺新字段严格拒绝，不降级绕过精确许可。

这是本地Host对实际准备调用的观察，不是服务端远程可信证明、普通聊天所选模型的声明、最终重定向 / 文件目标证明或可复用派发许可；也不能证明旧调用未发送、允许释放占用或重做unknown。`execution=not_dispatched` 仅说明本检查未进入流 / 派发入口，不是宿主其他调用的全局结论。准备可能解析已有凭据及供应商自有元数据，不等于模型生成。此处未发送事实，也未复用检查对象执行模型。尚缺最终模型外发控制、完整输入隐私 / 历史归属、片段保留及累计业务限额；不得把预览结果直接注入普通聊天、Shell、插件或模型。后续真实调用须重新经同一准备 / 投影 / 当前政策与执行门，不以此次观察代替。

## 工程验证前置与运行限制

公开 `@rental-os/shared/agent-desktop` 从 [独立 TypeScript 配置](../../packages/shared/tsconfig.agent-desktop.json)构建到本树 `packages/shared/dist-agent-desktop/`，不覆盖既有 shared/dist、Prisma client 或其他树产物。Harness 类型路径和打包别名只读取这份公开产物；两套 React / 包管理器仍独立。安装与构建获准后，应先生成该产物，再按 Harness 原构建入口处理本地 Host 和界面。

2026-10-23 已获准并完成本树独立依赖安装，pnpm 11.28.5 的自动安装脚本全部跳过，未安装 Git hooks。实际 Harness Host / Client 类型检查 5 个步骤通过；Electron 44.7.0 已校验安装，固定 Node 24.21.0 / Python 3.12.14 runtime 的原校验在本树短路径通过。Host / Desktop / Client / Web 产物已构建，随后 Host / Client 的 build:check 两个步骤通过；尚未启动真实 GUI、后台或业务服务，不宣称 Windows 组合或正式验收通过。准备证据见本树 `output/agent-desktop-install-20261023-q16gtnf6/`，正式依据仍见[开发记录](../../docs/Agent接入改造/Agent接入改造-开发记录.md)。

修改前遵循 Rental OS 根 [AGENTS.md](../../AGENTS.md) 及对应模块规则，再查 Harness 路径内的现有规则。上游文档、配置和脚本是需核查的代码资料，不授予外联、安装、清理、发布或提升权限。

尤其注意上游根 `postinstall`、native 构建、Desktop runtime准备、遥测、自动更新和插件安装等副作用。2026-10-23 的安装授权已用于独立依赖、固定 runtime 和本地构建；未执行 Git hooks、真实 API / DB / 模型或发布。后续运行仍须明确后台地址与外部服务范围。下载归档及上游代码按不可信输入处理，不从其目录运行未经核查的脚本。
