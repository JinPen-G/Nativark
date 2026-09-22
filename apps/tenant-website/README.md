# Rental OS 租户消费者官网

独立于 `apps/website`（Rental OS 平台官网）的租户前台。当前是可交互的视觉演示，尚未连接后台、支付或实时库存。

## 本地预览

在仓库根目录运行 `npm run dev:tenant-website`，浏览器打开：

- 单品类：`http://127.0.0.1:4186/?tenant=single`
- 双品类：`http://127.0.0.1:4186/?tenant=double`
- 多品类：`http://127.0.0.1:4186/?tenant=multiple`

也可以运行 `npm run build:tenant-website` 做构建检查。

## 配置与未来对接

- `src/data/catalog.ts`：三套演示租户、品类与商品数据。`tenant.categories.length` 决定首页布局；品牌名、Logo、Hero 内容和主辅色由租户配置提供。
- `src/theme.ts`：统一将主辅色映射到 CSS token。以后后台主题色配置可通过 `Tenant` 数据传入，无须改页面组件。
- `src/i18n.ts`：统一维护中英文界面文案和演示数据的英文映射。顶部右侧按钮与页脚右下角选择器共享 `rental-os-tenant-language`，切换后会同步作用于所有路由；真实租户数据可通过 `*En` 字段提供英文名称、描述和规格。
- `src/theme.ts` 与 `src/styles.css`：提供跟平台官网一致的深浅色模式。首次进入跟随系统偏好，用户切换后保存到 `rental-os-theme`；租户官网顶部右侧的太阳/月亮按钮会同步切换整站背景、卡片、文字、表单和页脚。
- `src/data/siteRepository.ts`：页面唯一的数据访问入口。未来在这里替换为租户隔离的官网 API。当前演示预约仅写入浏览器 `localStorage`，不提交商家，也不锁库存。
- `src/types.ts`：`Tenant`、`Category`、`Product` 和演示订单的数据契约。

生产接入时需由后端提供租户识别、上架商品、实时库存/冲突检查、正式计价、押金、配送门店和预约提交接口；当前页面上的费用均标明为估算。
