# Rental OS 本地 Agent 客户端

本目录保存基于 DeepSeek Harness 的本地客户端源码与来源信息。首期接入 Rental OS 后台登录、经营空间、AI / 传统工作方式和已有业务页面；不重写 Agent，也不接平台模型计费。

## 专项入口

- [需求](../../docs/Agent接入改造/Agent接入改造-需求.md)：本期范围和验收。
- [开发任务与接入设计](../../docs/Agent接入改造/Agent接入改造-开发任务.md)：最小接入方式、任务顺序和进度。
- [开发记录](../../docs/Agent接入改造/Agent接入改造-开发记录.md)：实际准备与证据。
- [当前协作接续](../../docs/Agent接入改造/Agent接入改造-协作接续.md)：接手现场与未完成事项。

## 来源与结构

- `harness/`：上游完整源码，来源为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，于 2026-10-22 下载。
- [UPSTREAM.json](UPSTREAM.json)：来源 SHA、下载归档哈希、文件清单摘要、许可位置及 Windows 内部链接物化说明。
- [LICENSE](harness/LICENSE) 与 [THIRD_PARTY_NOTICES.md](harness/THIRD_PARTY_NOTICES.md)：上游许可和第三方声明，保留原文；商用发布还须核对实际打包依赖与品牌素材。
- [Harness README](harness/README.md)、[Desktop README](harness/apps/desktop/README.md)、[安全提示](harness/SAFETY.md)：上游说明。developer preview 未经安全审计，不能当生产就绪。

下载的是固定 SHA 归档，不含上游 Git 历史，不是 Git submodule。原归档和普通文件哈希基线保留在本树 output；当前目录含本专项的本地接入修改，不再是未改源码。14 项内部符号链接在 Windows 物化为对应副本，原路径和 link target 记录在来源文件。后续升级须比较固定版本与本地修改，不直接覆盖目录或追活动 HEAD。

## 工程隔离

Harness 自有 pnpm workspace 与 lockfile，Rental OS 根工程使用 npm workspaces。本目录位于 `clients/`，不加入根 `apps/*` 或 `packages/*`；不要在这里用 Rental OS 根依赖冒充 Harness 的已安装环境，也不要整体调整后台 React / UIArc 为了直接导入组件。

首次接入优先让 Harness 承载外壳和 AI，让隔离 Electron WebContentsView 承载原后台登录与内容页，后台只增加必要宿主模式。具体接口和实现按专项开发任务核对。

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

工作台不再手填Base URL：填写本次要检查的已配置Provider和模型ID，由 `catalogForModel({ selection, limit })` 经封闭 `rental:catalog-for-model` IPC取得原Host `llm.prepareCall()` 的适配器初始路由。两次准备的模型、端点、协议及准备参数指纹必须一致，均不得过期，仍须服务器当前政策允许该目的地。`preparationVersion` 只由准备配置、能力、重试和路由事实求指纹，不混入观察时间、密钥或宣称数据库配置修订。Host查询4秒截止，壳层控制5秒截止，原目录15秒截止，正常总等待最多25秒；新路径最多并发2次检查，不自动发起下一次查询。桥缺失或适配器无法解析时拒绝，不回退旧人工目的地桥；旧 `catalog` 仅保留已有人工预览兼容，不授予模型调用许可。

以下 POST 接口统一在 `/api/ai-native/desktop-business/` 下；字段从 [shared 合同](../../packages/shared/src/agent-desktop-business.ts) 和 [OpenAPI](../../apps/api/src/contracts/ai-desktop-business-schemas.ts)读取。身份由服务器当前会话确定，body 中 binding 只用于核对，不授权。

| 后缀 | 作用与边界 |
| --- | --- |
| `catalog` | 严格请求 ID / binding / limit / destination；原商品读权、当前政策及审计必须通过。最多50条；人工输入仅在本机按封闭语法解析，未指定数量时预览上限10条。 |
| `policy` | 当前配置管理者读取本空间政策；无记录为 `not_configured`，不自动启用。 |
| `policy/change` | 人类管理者用原 `operationKey`、预期修订和完整政策做 CAS；政策限定工具、目的地、数量及期限，不是模型配置或企业订阅。 |
| `policy/operation` | 当前管理权限下读取本人原保存收据；`not_observed` 不证明回滚，`AI_RESULT_UNKNOWN` 不换键重做。 |

政策沿原系统配置管理权限，商品查询沿原业务权限，两者不能互相替代。SQL仓储和原业务审计使用当前空间；读取后复核身份和政策，审计未持久化则不返回投影。新增迁移仅定义政策 / 原保存收据，不安装默认许可；本轮未迁移数据库，缺表时拒绝。原“AI 服务设置”页已接入人类政策编辑：先读取当前修订，再明确保存启停、最多50条、UTC期限及获准目的地；不开放模型 Key 或任意工具。

编辑器在发送前用当前账号 / 租户 / 空间分区的 `sessionStorage` 保存原操作编号和预期修订，不保存政策正文或凭据。应答不明后阻止新保存，页面重载继续只读核对原编号；`not_observed` 仍待核对，不自动重做。历史保存确认后另读当前政策，不能把旧收据当现行配置。恢复存储不可用时不发新保存；整窗关闭后的恢复引用不作保证，原服务端收据仍保留。

目录输入目前只支持“查看商品目录”“查看前5条商品目录”和对应的有限英文语法，完整匹配后只向原业务桥提交数量与目的地，不传原文；额外客户信息、价格、库存条件、附加指令或超量请求均要求澄清，不调用模型做脱敏。默认10条是预览上限，不是业务默认值；切身份 / 空间重新建立输入区。

模型检查输出只包含本次selection、协议、去凭据HTTPS初始目的地、`preparationVersion`、观察 / 到期时间及 `source=prepared_initial_route`、`execution=not_dispatched`。当前支持直接Messages适配器，以及显式非空API Key的标准OpenAI Responses / Completions、Anthropic Messages适配；SDK账号切换到Codex、隐式认证、其他协议及带用户名 / 密码 / 查询参数的URL保持不可用。目的地只读实际准备快照，不采信Provider目录默认地址或预览请求手填URL。请求配置和初始目的地在准备时固定；pi-ai同时固定显式Key覆盖值，Messages沿原连接快照的认证口解析，不把密钥带到渲染器。现政策核对工具 / Provider / BaseURL，协议只作变更检测，不由此新增模型或协议的外发授权。

这是本地Host对实际准备调用的观察，不是服务端远程可信证明、普通聊天所选模型的声明、最终重定向 / 文件目标证明或可复用派发许可；也不能证明旧调用未发送、允许释放占用或重做unknown。`execution=not_dispatched` 仅说明本检查未进入流 / 派发入口，不是宿主其他调用的全局结论。准备可能解析已有凭据及供应商自有元数据，不等于模型生成。此处未发送事实，也未复用检查对象执行模型。尚缺最终模型外发控制、完整输入隐私 / 历史归属、片段保留及累计业务限额；不得把预览结果直接注入普通聊天、Shell、插件或模型。后续真实调用须重新经同一准备 / 投影 / 当前政策与执行门，不以此次观察代替。

## 工程验证前置与运行限制

公开 `@rental-os/shared/agent-desktop` 从 [独立 TypeScript 配置](../../packages/shared/tsconfig.agent-desktop.json)构建到本树 `packages/shared/dist-agent-desktop/`，不覆盖既有 shared/dist、Prisma client 或其他树产物。Harness 类型路径和打包别名只读取这份公开产物；两套 React / 包管理器仍独立。安装与构建获准后，应先生成该产物，再按 Harness 原构建入口处理本地 Host 和界面。

2026-10-23 已获准并完成本树独立依赖安装，pnpm 11.28.5 的自动安装脚本全部跳过，未安装 Git hooks。实际 Harness Host / Client 类型检查 5 个步骤通过；Electron 44.7.0 已校验安装，固定 Node 24.21.0 / Python 3.12.14 runtime 的原校验在本树短路径通过。Host / Desktop / Client / Web 产物已构建，随后 Host / Client 的 build:check 两个步骤通过；尚未启动真实 GUI、后台或业务服务，不宣称 Windows 组合或正式验收通过。准备证据见本树 `output/agent-desktop-install-20261023-q16gtnf6/`，正式依据仍见[开发记录](../../docs/Agent接入改造/Agent接入改造-开发记录.md)。

修改前遵循 Rental OS 根 [AGENTS.md](../../AGENTS.md) 及对应模块规则，再查 Harness 路径内的现有规则。上游文档、配置和脚本是需核查的代码资料，不授予外联、安装、清理、发布或提升权限。

尤其注意上游根 `postinstall`、native 构建、Desktop runtime准备、遥测、自动更新和插件安装等副作用。2026-10-23 的安装授权已用于独立依赖、固定 runtime 和本地构建；未执行 Git hooks、真实 API / DB / 模型或发布。后续运行仍须明确后台地址与外部服务范围。下载归档及上游代码按不可信输入处理，不从其目录运行未经核查的脚本。
