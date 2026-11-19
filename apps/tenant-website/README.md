# 租户消费者官网宿主

React、TypeScript 与 Vite 的 Rental 客户网站。完整页面与业务消费链在 [Rental 网站前端](../../packages/rental-core/clients/website-ui/README.md)，本应用供给浏览器寿命、公开构建参数、同一客户会话／运输、可靠原引用存储及资产。

## 入口

- [main.tsx](src/main.tsx)挂载原 StrictMode 与根组件。
- [App.tsx](src/App.tsx)向 RentalWebsite 提供同一 [website-host.ts](src/website-host.ts)。
- [styles.css](src/styles.css)导入正式网站样式，声明原 Manrope 字体。
- [vite.config.ts](vite.config.ts)沿原环境白名单、代理和端口配置构建。

原 src 页面、组件、数据和 AI 业务适配路径均转发到正式 source 出口，直接消费者继续使用同一实现。路由、主题、语言、样式及真实／演示隔离见 [前端导读](../../packages/rental-core/clients/website-ui/README.md)，设计依据保留在 [DESIGN.md](DESIGN.md)。

## 宿主输入

VITE_API_BASE 同时供给原公开工厂、认证及业务消费者，VITE_BASE_DOMAIN 和 VITE_DEFAULT_TENANT 供给原租户解析。客户运输与会话复用 [web-client](../../packages/web-client/src/session.ts)。原 localStorage、sessionStorage 和 LockManager 供给恢复及引用持久化，原拒绝、迟到响应与 unknown 恢复边界保持。

租户识别仍依次使用演示参数、显式 tenantCode、平台直接子域名、自定义域名绑定和正式默认租户。真实模式读取 public/bootstrap 和各服务 public/catalog，核对当前租户、渠道及经营空间／品类／结构版本，失败时保持原缺事实与恢复入口。

## 本地演示

`ai-offline` 模式关闭环境文件加载和业务代理，演示预约只保存在浏览器。

```powershell
npm run dev -- --mode ai-offline --port 4194
```

演示参数为 `?tenant=single`、`?tenant=double`、`?tenant=multiple`。已有依赖可启动，结束使用 Ctrl+C。真实域名、API 和发布接入沿专项授权。

## 资产与验证

原 [media](public/media)、[brand](public/brand)、[fonts](public/fonts)及图片 sidecar／字体许可继续由本宿主维护。图片署名从 [photo-sources.json](public/media/photo-sources.json)传入，assetUrl 保留原同源路径，迁入的前端包通过该配置读取。

现有 [离线组件入口](scripts/check-storefront-render.mjs)与[原断言](scripts/storefront-render-cases.tsx)覆盖演示路由及条件、存储、目录身份和 favicon。常规 `npm run build` 按原配置加载环境文件，离线构建须显式指定 `ai-offline`，把输出和缓存归入本树任务临时目录并在退出时清理。真实订单、支付、浏览器和发布分别核收。
