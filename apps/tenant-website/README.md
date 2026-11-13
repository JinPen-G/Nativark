# 租户消费者官网

React 19、TypeScript 与 Vite 8 实现的租赁前台。一套网站按租户配置呈现品牌、已发布品类、商品和取还门店。平台营销站入口见 [apps/website](../website/README.md)。

## 本地验收

当前分支为 `codex/tenant-website-redesign`。在本目录双击 [start-preview.cmd](start-preview.cmd)，或执行以下命令。

```powershell
npm run dev -- --mode ai-offline --port 4194
```

- [多品类演示](http://127.0.0.1:4194/?tenant=multiple)
- [单品类演示](http://127.0.0.1:4194/?tenant=single)
- [双品类演示](http://127.0.0.1:4194/?tenant=double)

`ai-offline` 模式关闭环境文件加载和业务 API 代理。演示预约只保存到当前浏览器。已有依赖可直接启动，结束预览使用启动窗口中的 `Ctrl+C`。

## 全站设计

演示品牌采用一程租赁，配色为白色、深海蓝和少量暖黄。自托管 Manrope 搭配系统中文字体，新建几何标志、海边场景和商品摄影。设计规则及当前验证结果分别见 [DESIGN.md](DESIGN.md) 和 [design-qa.md](design-qa.md)。

首页提供品类、门店和完整时间查询。桌面将查询与场景照片组合，手机优先显示查询。单品类商户展示二级分类，双品类和多品类商户展示已发布的一级分类。精选商品来自目录，具体可租状态在选定条件及正式报价中确认。

目录支持搜索、分类、排序和查询修改。详情提供商品信息、规格、租期、数量及取还方式。查询条件连续传入预约。演示预约保存商品快照、门店、时间、联系人和估算金额，随后可从我的订单查看。重复保存复用同一记录，存储失败提供错误反馈。

账户覆盖地址、优惠券和通知。说明页面覆盖门店、租赁指南、帮助搜索、用户协议、隐私政策及缺失页。中英文、深浅色、键盘焦点、减少动态效果和窄屏布局贯穿全站。

## 源码入口

| 入口 | 职责 |
| --- | --- |
| [App.tsx](src/App.tsx) | 路由及按需加载 |
| [SiteContext.tsx](src/SiteContext.tsx) | 租户、目录、主题、语言及加载恢复 |
| [SiteLayout.tsx](src/components/SiteLayout.tsx) | 导航、页脚、手机菜单与路由焦点 |
| [styles.css](src/styles.css) | 全站唯一样式入口及响应式规则 |
| [RentalFinder.tsx](src/components/RentalFinder.tsx) | 首页租赁查询 |
| [CatalogConditions.tsx](src/components/CatalogConditions.tsx) | 目录条件编辑、确认与取消 |
| [siteRepository.ts](src/data/siteRepository.ts) | 页面目录边界与本地演示记录 |
| [remoteSite.ts](src/data/remoteSite.ts) | 公开 bootstrap 与目录映射 |
| [authClient.ts](src/data/authClient.ts) | 现有客户认证和业务接口消费者 |
| [RemoteBooking.tsx](src/components/RemoteBooking.tsx) | 真实报价与预约入口 |
| [OrderPages.tsx](src/pages/OrderPages.tsx) | 本人订单、付款意图及原业务恢复消费者 |

`@rental-os/shared` 和 `@rental-os/web-client` 从正式出口导入。Vite 本地源码别名优先解析 TypeScript，避免同目录旧 CommonJS 文件进入浏览器。

## 租户与数据

租户识别依次使用以下入口。

1. `?tenant=single|double|multiple` 读取静态演示目录。
2. `?tenantCode=xxx` 显式指定业务租户。
3. `VITE_BASE_DOMAIN` 下的直接子域名解析租户编码，保留平台用途子域名。
4. 自定义域名通过公开 `site-resolve` 查询已绑定租户。
5. `VITE_DEFAULT_TENANT` 提供独立部署的默认租户。

本地缺省打开多品类演示。自定义域名归属查询失败且没有正式默认租户时，页面提供加载失败与重试入口。

真实模式先读取 `public/bootstrap` 的品牌、协议和已发布服务，再读取各服务 `public/catalog`。响应必须匹配当前租户和渠道，目录另核对经营空间、品类及结构版本。单个目录失败会显示重新加载提示。真实目录加载期间，演示商品保持隔离。

客户会话继续使用共用协调器。报价、库存、押金、订单、支付结果、企业审批和 AI 原材料由既有服务与消费者提供。前端沿原租户、本人、经营空间与操作键边界呈现事实。

生产接入沿原域名绑定、DNS、HTTPS、API 和渠道发布配置，实施及联调须遵循对应专项授权。

## 验证入口

在仓库根目录执行类型和离线组件检查。

```powershell
node apps/tenant-website/node_modules/typescript/bin/tsc -p apps/tenant-website/tsconfig.json --noEmit --incremental false
node apps/tenant-website/scripts/check-storefront-render.mjs
```

离线组件检查覆盖18种路由场景、3种演示租户、2种语言、2种主题，共216次渲染，另含9项 favicon 和19项定向行为检查。脚本将临时产物集中到本树任务目录，并在退出时清理。

本次生产前端构建采用 `ai-offline` 模式和独立临时输出，结果与内置浏览器记录见 [验收记录](design-qa.md)。常规构建可在本应用目录执行 `npm run build -- --mode ai-offline`。真实业务、支付、微信宿主及发布沿正式验收门槛核对。

## 图片与字体

图片位于 [public/media](public/media)。生成图的完整提示词、派生图来源及外部照片许可随图片 sidecar 保存。外部照片署名集中在 [photo-sources.json](public/media/photo-sources.json)，关于页提供来源与许可入口。Manrope 许可随字体保存在 [public/fonts](public/fonts)。

## 正式资料

- [需求](../../docs/预约网站/预约网站-需求.md)
- [开发任务](../../docs/预约网站/预约网站-开发任务.md)
- [开发记录](../../docs/预约网站/预约网站-开发记录.md)
- [协作接续](../../docs/预约网站/预约网站-协作接续.md)
