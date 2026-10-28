# Rental OS 新官网模板（基于原站下载镜像）

下载来源：https://www.deepseek.com/harness/ 与 https://www.deepseek.com/en/harness/ 。

此目录保存网站公开发布的 HTML、CSS、JavaScript、字体、图片、SVG 和 Next.js 页面切换数据。原始下载文件保留，`rentalos/` 在本地服务的响应中适配顶栏和 Hero 的 Rental OS 品牌、双语文案、预约入口、下载状态及首屏业务窗口；其余模板展示和动效继续使用原文件。它不是 DeepSeek 未公开的 React/Next.js 开发工程；压缩的生产 JS 仍是压缩的生产 JS。

## 本轮修改入口

- `rentalos/copy.json`：Hero 的中英文文案及预约表单翻译。
- 部署方式区也在 `copy.json` 的 `harnessUse*` 中维护，替换原“开发者体验 / 命令启动 / 源码安装”，展示“云端使用 / 私有化部署”、定制与附加能力。保留双栏卡片和入场动效，两个按钮复用预约表单并带入咨询意向，不覆盖访客自行填写的内容；没有新增桌面客户端或安装/更新机制。
- 底部合作区在 `copy.json` 的 `harnessCta*`、`harnessPartner*` 中维护，展示“一起拓展租赁的可能”。四个按钮分别带入合作、行业方案、定制集成、附加能力共建意向，复用现有咨询表单；保留原粒子、网格、光晕与滚动动效，不再链接原站的生态资源。
- 页脚社交入口在 `brand.mjs` 的 `footerSocials` 中维护：X 与 GitHub 两个 SVG 图标直接打开用户主页，中英文一致；不再展示原微信公众号和二维码。中间统一显示 `Powered by PenG-AI · All rights reserved.`；隐私政策与用户协议保留对应语言的文字，但禁用跳转。顶栏桌面与移动端 GitHub 共用这里的 GitHub 地址。
- `harness/icons/rentalos-logo.svg`：复用旧官网的用户品牌 SVG，顶栏显示高度固定为原模板的 24px，宽度等比缩放。
- `rentalos/brand.mjs`：模板渲染适配，覆盖首屏 HTML、RSC 语言数据及对应客户端组件；不改写磁盘上的原始生产文件。
- `rentalos/preview.js`：可维护的首屏业务窗口组件，直接复用模板的窗口、CSS 模块、React 和语言上下文。Logo 下方提供“AI 管理 / 传统管理”双标签：AI 模式包含多业务对话、插件和自动化；传统模式切换为 Dashboard、订单、库存、会员与门店菜单和对应的简化后台页面，不显示聊天输入区。小屏沿用原模板收起侧栏的行为，窗口左上角面板按钮可展开业务导航。
- 预约、订单履约、门店协同对话采用“左侧对话 / 右侧 Agent 工作区”，展示资料准备、示例报价或任务安排、确认弹窗与执行回执。计时演示在切换场景、模式及卸载时取消；重播仅重置当前示例，不执行真实业务。中英文文案与示例数据在组件内，右下角模型标签保留原模板的 `DeepSeek-V41-Flash High`。插件配置、任务运行及确认动作均为前端演示，不连接真实 AI、通知或业务接口。
- `rentalos/capability-copy.json`：首屏下方四块能力介绍及内部演示的中英文文案。分别展示租户归还提醒配置、业务成果预览、周期经营计划、业务执行轨迹；归还提醒只在平台已开放的能力和租户权限内配置，不涉及新增租赁品类。
- `rentalos/capabilities.mjs`、`rentalos/capability-preview.js`：在响应中适配原四块动画组件。保留原卡片、图标配色、文件轮播、工具步骤、任务周期和时间线；增加文件预览、提醒/计划确认及步骤依据查看。首屏 HTML、语言数据与客户端使用一致的内容，原下载文件不覆盖。所有提醒、计划和回执仅为前端示例，不调用真实通知、AI 或业务接口。
- `rentalos/site.css`、`rentalos/site.js`：Logo 尺寸、表单样式及语言同步。
- `rentalos/demo-form.html`、`rentalos/demo-request.js`：复用旧官网的预约字段、校验、幂等重试与服务端回执判断。
- `rentalos/config.js`：沿用旧官网的公开 API 配置，提交地址为 `/public/demo-requests`。本地未配置时请求 `http://127.0.0.1:3000/api/public/demo-requests`；线上需填写 HTTPS API 前缀并配置其 CORS。

macOS 和 Windows 下载选项保持原标签，在新预约入口的下拉菜单中以灰字标注“开发中”，不会触发原安装包下载。首屏业务窗口采用 Rental OS 的 AI Native 对话主入口和可切换的传统业务后台演示；下方四块能力区、部署方式区和底部合作区已适配租赁业务。页脚显示品牌署名、社交链接和不跳转的政策文字，原背景动画未改变。

修改 `copy.json`、`preview.js`、`capability-copy.json`、`capability-preview.js` 或服务端适配代码后，重启 `serve.mjs` 使缓存更新。首屏 HTML 与客户端交互由同一份预览组件生成，避免页面加载时先闪现原站内容。品牌适配依赖附带服务；直接静态托管原下载文件仍会展示原站内容。后续部署时需要部署该服务或先另行准备品牌化的静态产物。

## 本地打开

安装 Node.js 18 或以上版本，Windows 双击 `start-preview.cmd`，或运行：

```text
node serve.mjs
```

- 中文：http://127.0.0.1:8138/harness/
- 英文：http://127.0.0.1:8138/en/harness/

原站会按浏览器语言及 `NEXT_LOCALE` Cookie 决定语言，页面右上角可切换。双击 HTML 的 `file://` 方式不能完整运行 Next.js 导航与动态模块；需要使用附带的 HTTP 服务。

## 文件位置

- `harness/index.html`、`en/harness/index.html`：原站中英文主页面。
- `harness/privacy/`、`harness/terms-of-use/` 及对应 `en/` 目录：原站中英文政策页面。
- 各页面的 `index.txt`：Next.js 客户端导航需要的页面数据。
- `_next/static/`：原站发布的 CSS、运行时和页面 JS，以及延迟加载模块。
- `harness/images/`、`harness/icons/`、`harness/fonts/`、`fonts/`：原图片、SVG 和字体。
- `download-manifest.json`：下载地址、大小与 SHA-256 校验值；`failures` 记录未成功下载项。
- `serve.mjs`：本地静态服务，处理原站路径、扩展名省略及 Next.js RSC 请求。
- `__mirror__/country.json`：原站公开地区接口的下载快照，供本地下载菜单使用。
- `tools/download.mjs`：重新下载工具，运行 `node tools/download.mjs` 会更新下载文件。

## 本地运行适配与范围

本地服务器在响应 HTML 时插入地区查询适配及 Rental OS 的样式和脚本，并通过 `brand.mjs` 适配顶栏和首屏内容；磁盘上的原始下载文件不改动。地区菜单使用下载时的地区快照，不代表访问者的实时地区。

页面自带的聊天窗口、插件创建、文件预览、定时任务和轨迹动画是展示用演示，并不是一个可执行真实 AI 任务的后端。底部合作区已移除原 GitHub、文档、社区插件和论文链接；顶栏和页脚 GitHub 均链接至用户指定的个人主页，不代表项目的开源或授权声明。原政策页面下载文件尚未改写，页脚入口暂不跳转。未下载桌面安装包或这些外部网站。原站第三方统计并非页面动效的依赖，断网时其统计请求可能失败。

## 后续改站

原始文件继续作对照，当前指定区域通过 `rentalos/` 调整。若后续需要长期维护整站，优先取得作者原开发工程；没有原工程时，可按模块整理可维护的开发源码。不要把美化排版后的压缩 JS 当作已恢复作者原始工程。

原站品牌、版权及声明保持原样；应用项目的开源许可与官网各项素材的许可应分别核对。
