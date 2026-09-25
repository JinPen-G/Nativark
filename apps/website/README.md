# Rental OS 平台官网（Marketing Site）

Rental OS SaaS 平台的对外营销 / 解决方案官网——面向摄影器材、露营装备、车辆载具、工程设备等租赁企业介绍平台价值并收集咨询线索。纯静态站点,不含登录 / 购物 / 结算(那是[租户消费者官网](../tenant-website/README.md)的职责)。

> **两个「官网」别混淆**:本目录是 Rental OS **平台自己的**营销官网;每个**租户对外经营**的官网是 [`apps/tenant-website`](../tenant-website/README.md)。

## 目录

- [背景](#背景)
- [页面结构](#页面结构)
- [本地预览](#本地预览)
- [部署](#部署)
- [目录结构](#目录结构)
- [配置](#配置)
- [相关文档](#相关文档)

## 背景

一个手写的单页营销站点(`index.html`),展示 Rental OS 的行业解决方案、平台能力与客户案例,并通过「预约咨询」表单收集销售线索。没有构建步骤、没有后端依赖、没有账号体系——它只负责讲清楚这套 SaaS 能做什么,并把有意向的客户导向咨询表单。

## 页面结构

`index.html` 单页,按锚点分区:

| 区块 | 锚点 | 内容 |
| --- | --- | --- |
| 行业方案 | `#solutions` | 四大行业:摄影设备 / 露营装备 / 车辆载具 / 工程设备租赁 |
| 业务场景 | `#scenarios` | 按典型经营场景说明平台如何解决 |
| 平台能力 | `#foundation` | 多品类内核、经营空间、能力治理等共通底座 |
| 客户案例 | `#customers` | 客户案例与评价 |
| 预约咨询 | `#consultation` | CTA 线索表单(按行业选择) |

已内置 SEO / OpenGraph / Twitter Card 元信息与 `SoftwareApplication` JSON-LD;深浅色模式跟随系统偏好并记忆到 `localStorage['rental-os-theme']`(与租户官网共用同一 key)。当前仅中文。

## 本地预览

纯静态,任意静态服务器即可(页面运行时从 CDN 加载 Inter 字体与 Iconify 图标,需联网):

```bash
npx serve apps/website
# 或
python -m http.server 8080 -d apps/website
```

浏览器打开对应端口即可。无需 `npm install`、无需构建。

## 部署

把 `index.html` 与 `assets/` 一起部署到任意静态托管:GitHub Pages / Nginx / 对象存储 + CDN。当前线上部署在 GitHub Pages(见 `index.html` 的 canonical:`https://xiao0ozz.github.io/rental-os-website/`)。

## 目录结构

```text
apps/website
├─ index.html          # 站点全部内容(内联 <style>/<script>,唯一入口)
├─ assets/             # 行业/能力/指标/客户配图(.png 与响应式 .webp)、二维码、Logo
├─ favicon.ico / favicon.svg / robots.txt / sitemap.xml
├─ design-qa.md        # 视觉走查记录
├─ 官网效果图.png        # 设计稿参考
└─ index_backup*.html  # 历史快照(非当前版本,勿改)
```

## 配置

无运行时配置、无环境变量、无 API 依赖。外部资源仅 Google Inter 字体与 Iconify 图标(均走 CDN)。

## 相关文档

- 平台整体说明:仓库根 [README](../../README.md)
- 租户对外经营的官网(多租户、可下单支付):[apps/tenant-website](../tenant-website/README.md)
