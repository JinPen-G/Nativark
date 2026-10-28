# Rental OS 官网 · Next.js 源码工程

沿用原站的技术路线：Next.js App Router、React、next-intl、Framer Motion，以及 WebGL / Three.js 动效。保留当前 Rental OS 官网的文案、布局、业务演示、预约入口和社交链接；这是从现有发布版迁移整理的可编辑源码，不是原作者未公开的开发工程。

## 启动和构建

需要 Node.js 20.9 或以上。依赖与锁文件位于本目录，不需要修改仓库根依赖。

```powershell
npm ci --workspaces=false
npm run dev --workspaces=false
```

也可双击 `start-preview.cmd`。源码开发预览默认 http://127.0.0.1:8140/harness/ ，修改组件后支持热刷新。

```powershell
npm run check:source --workspaces=false
npm run build --workspaces=false
npm start --workspaces=false
```

构建生成 `out/`，部署时发布其中的内容；`npm start` 是静态产物预览，不是旧镜像适配服务。开发和静态预览默认共用 8140，不要同时占用；静态预览可执行 `node tools/serve-export.mjs --port 8141`。

## 正常开发目录

```text
app/                     Next.js 路由和中英文布局
components/
  LandingPage.jsx        整页组件组合
  SiteHeader.jsx         顶栏、滚动态、移动菜单
  sections/             Hero、能力区、部署区、合作区、页脚
  demos/BusinessPreview.jsx  AI / 传统管理及 Agent 工作区
  effects/              WebGL 背景、交互网格、Three.js 粒子
  forms/DemoForm.jsx     原生 React 预约表单
  ui/                   按钮、徽标和下载状态菜单
  shared/               图标、演示配置和样式名称映射
messages/zh.json         中文文案
messages/en.json         英文文案
styles/                  格式化的原视觉样式与局部集成样式
public/harness/images/   图片
public/harness/icons/    SVG 和 Logo，保持原素材类别目录
public/harness/fonts/    原站展示字体
public/fonts/            原站公共字体
lib/site.js              公共链接、演示事件及配置
tools/                   静态预览、源码检查及一次性迁移工具
```

- 改普通官网文案：编辑 `messages/`。首屏业务演示的双语场景目前在 `BusinessPreview.jsx` 中维护。
- 改整页顺序：编辑 `LandingPage.jsx`。改某一块：进入对应 `sections/` 文件。
- 改图标或图片：在 `public/` 对应类别内替换，组件中使用 `/harness/...` 路径。
- `styles/foundation.css` 包含既有字体、主题变量和工具类；`styles/demos.css` 保留动画及原组件类名。`shared/styleNames.js` 将既有类名映射给组件，不是运行原 webpack 模块。
- 运行和构建不读取相邻两个镜像目录，没有 iframe、旧 webpack 运行时、HTML 注入或响应字符串替换。

## 路由与交互边界

- 中文 `/harness/`，英文 `/en/harness/`。根路径进入浏览器语言对应版本；中文以外默认英语，手动选择写入 `NEXT_LOCALE` Cookie。
- AI 管理、传统管理、预约、履约、门店协同、插件、自动任务和能力卡片保留前端演示。确认操作只产生示例回执，不连接真实 AI 或业务系统。
- 预约/合作入口共用 React 表单，保留咨询意向预填、人工输入保护、请求标识重试、超时与后端回执判断。线上配置公开构建变量 `NEXT_PUBLIC_DEMO_API_BASE_URL`（HTTPS，含 `/api`）；未配置时不伪造成功。仅本机 HTTP 预览可回落到 `http://127.0.0.1:3000/api`。
- 顶栏和页脚 GitHub、页脚 X 使用用户指定链接。页脚署名 `Powered by PenG-AI · All rights reserved.`；政策文字保留但不跳转。移动菜单尚保留迁移前已有的原模板外部文档/插件/论文入口，这些不是 Rental OS 自有资源。
- 原站字体、图标和着色器的来源不因迁移而变化；源码迁移不等于第三方素材已获得新的许可。

## 与旧目录的关系

`../deepseek-harness-clone` 是改写版镜像，`../deepseek-harness-original` 是独立原始下载副本。本次不覆盖它们，也不切换既有 8138 / 8139 的入口。

`migration-manifest.json` 记录原文件清单与迁移边界。`tools/migrate-reference.mjs` 仅用于最初的机械迁移：它读取旧目录并覆盖生成组件，**后续日常开发不要重跑**；直接修改现在的组件、文案和样式即可。新工程复制到其他位置后，安装依赖即可单独开发和构建，不需要带上旧镜像。

Next.js 原生路由与安装说明见 [官方文档](https://nextjs.org/docs/app/getting-started/installation)。

## GitHub 独立官网仓库

发布仓库为 `JinPenG-AI/rental-os-website`（旧地址 `Xiao0ozZ/rental-os-website` 已由 GitHub 重定向），源码直接位于仓库根目录。推送 main 后，现有 GitHub Pages 工作流会安装依赖、校验源码、构建并仅发布 `out/`；不会发布 node_modules、开发缓存或后端工程。旧官网仍保留在 Git 历史中。

工作流从 Pages 配置读取 `NEXT_PUBLIC_BASE_PATH`，自动适配 `/rental-os-website` 之类的项目路径；本地开发默认使用域名根路径。手动构建子路径时，PowerShell 使用 `$env:NEXT_PUBLIC_BASE_PATH='/rental-os-website'; npm run build`。构建后 `npm start` 会从生成的 `out/site-config.json` 读取路径，无需再次设置变量。

`tools/prepare-export.mjs` 为普通静态托管补齐 Next.js 分段预取文件别名并生成 `.nojekyll`，不修改页面内容。字体由构建器打包，品牌 SVG 继续保留在 icons 目录。

如需接通线上预约提交，在仓库 Actions 变量中配置公开的 `NEXT_PUBLIC_DEMO_API_BASE_URL`，值为实际 HTTPS API 前缀（含 `/api`），并在后端允许官网来源。本次不写入密钥、不猜测 API 地址，未配置时不会伪报预约成功。
