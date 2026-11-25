# Core 页面接入入口

页面适配的唯一说明随公共包维护，包含公共应用装配、路由/主按钮、表单保存、列表/详情、授权/绑定及请求边界。新Core从 `@rental-os/platform-admin/core` 导入。[Core页面接入手册](../../../../packages/platform-admin/src/core/README.md)

本目录是原后台的兼容转接，消费同一公共实现。[兼容出口](index.ts)

兼容宿主的 [Vite 配置](../../vite.config.ts) 为 Shared 源码转发的六个公共合同子出口声明 `optimizeDeps.include`，开发时按安装包正式出口预构建 CJS。生产构建沿 Vite 8 的原生 Rolldown 互操作，`build.commonjsOptions` 在该版本已无效。

默认品牌实现通过 [品牌兼容出口](../app/brandIcon.ts)复用公共后台，Zelo 黑白定稿及来源在 [公共静态目录](../../../../packages/platform-admin/public/brand/zelo-source.json)。旧 `virtual:nativark-default-brand-icon` 标识为兼容保留，读取同一公共黑色原稿并跟踪变化；当前公共品牌函数直接选择原黑白 SVG。租户图片安全过滤和独立 favicon 回退继续由公共实现维护。
