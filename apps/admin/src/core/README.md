# Core 页面接入入口

页面适配的唯一说明随公共包维护，包含公共应用装配、路由/主按钮、表单保存、列表/详情、授权/绑定及请求边界。新Core从 `@rental-os/platform-admin/core` 导入。[Core页面接入手册](../../../../packages/platform-admin/src/core/README.md)

本目录是原后台的兼容转接，消费同一公共实现。[兼容出口](index.ts)

兼容宿主的 [Vite 配置](../../vite.config.ts) 为 Shared 源码转发的六个公共合同子出口声明 `optimizeDeps.include`，开发时按安装包正式出口预构建 CJS。生产构建沿 Vite 8 的原生 Rolldown 互操作，`build.commonjsOptions` 在该版本已无效。

默认品牌模块由同一配置在编译时读取 [静态 SVG 原稿](../../public/brand/nativark-icon.svg)，通过 `virtual:nativark-default-brand-icon` 供 [品牌函数](../app/brandIcon.ts) 消费。开发监听跟踪原稿变化，静态 URL 与模块共用该文件；原深浅色、遮罩、安全过滤和重着色逻辑继续由品牌函数维护。
