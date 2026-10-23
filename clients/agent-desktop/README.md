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

[桌面业务视图](harness/apps/desktop/src/rental-business-view.ts)承载原后台登录、强制改密与受控内容。[后台接入](../../apps/admin/src/features/agent-desktop/DesktopSessionBridge.tsx)只报告无凭据状态和原受权菜单；[工作台插件](harness/packages/client/ui-rental-workbench/README.zh.md)提供经营空间、AI / 传统、菜单和操作反馈。普通浏览器不具备原生 preload 标记，继续使用完整 Web 外壳。

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

## 工程验证前置与运行限制

公开 `@rental-os/shared/agent-desktop` 从 [独立 TypeScript 配置](../../packages/shared/tsconfig.agent-desktop.json)构建到本树 `packages/shared/dist-agent-desktop/`，不覆盖既有 shared/dist、Prisma client 或其他树产物。Harness 类型路径和打包别名只读取这份公开产物；两套 React / 包管理器仍独立。安装与构建获准后，应先生成该产物，再按 Harness 原构建入口处理本地 Host 和界面。

2026-10-23 已获准并完成本树独立依赖安装，pnpm 11.28.5 的自动安装脚本全部跳过，未安装 Git hooks。实际 Harness Host / Client 类型检查 5 个步骤通过；Electron 44.7.0 已校验安装，固定 Node 24.21.0 / Python 3.12.14 runtime 的原校验在本树短路径通过。Host / Desktop / Client / Web 产物已构建，随后 Host / Client 的 build:check 两个步骤通过；尚未启动真实 GUI、后台或业务服务，不宣称 Windows 组合或正式验收通过。准备证据见本树 `output/agent-desktop-install-20261023-q16gtnf6/`，正式依据仍见[开发记录](../../docs/Agent接入改造/Agent接入改造-开发记录.md)。

修改前遵循 Rental OS 根 [AGENTS.md](../../AGENTS.md) 及对应模块规则，再查 Harness 路径内的现有规则。上游文档、配置和脚本是需核查的代码资料，不授予外联、安装、清理、发布或提升权限。

尤其注意上游根 `postinstall`、native 构建、Desktop runtime准备、遥测、自动更新和插件安装等副作用。2026-10-23 的安装授权已用于独立依赖、固定 runtime 和本地构建；未执行 Git hooks、真实 API / DB / 模型或发布。后续运行仍须明确后台地址与外部服务范围。下载归档及上游代码按不可信输入处理，不从其目录运行未经核查的脚本。
