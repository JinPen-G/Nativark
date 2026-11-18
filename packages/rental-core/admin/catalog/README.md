# Rental 商品与资产后台

商品目录、实物资产、状态历史和数量库存共用包内页面与客户端。品类字段、套装组成、库存模式、单位和原状态载荷沿原实现，数量余额和处置限制读取服务端事实。[页面贡献](index.tsx) · [页面声明](pages.ts) · [请求工厂](client.ts)

## 宿主接入

宿主用 createRentalCatalogPageContext 供给当前 AdminRuntime、唯一图片读取方法、包含租户与经营空间的 scopeKey，以及当前身份读取函数，再将上下文交给 createRentalCatalogAdminContribution。图片方法使用宿主现有鉴权传输，返回原 Blob，并接收查询取消信号。上下文在 JSON 和图片请求前后复验同一页面身份。[上下文](page-context.ts) · [原宿主上下文](../../../../apps/admin/src/features/catalog/legacy-catalog-context.ts) · [原鉴权图片读取](../../../../apps/admin/src/api/rentalCore.ts)

商品页使用 catalog/view 和 catalog/manage，资产与库存页使用 asset/view 和 asset/manage。原宿主继续使用 rental-core:catalog:view、rental-core:catalog:manage、rental-core:asset:view 和 rental-core:asset:manage，兼容地址为 /rental/item-groups 与 /rental/assets。宿主将两页和已有业务页面合并为同一 Rental 贡献，菜单顺序从原养护分组声明投影。[旧路由适配](../../../../apps/admin/src/features/catalog/legacy-catalog-page.tsx) · [统一 Rental 贡献](../index.tsx)

当前品类的商品、资产、定价与履约导航术语由同一纯模块组合，页面标题消费其结果。[导航术语](navigation-terminology.ts)

## 编辑与读取

三个表单复用现有编辑驱动，保存按钮与回车共用本次打开代次的校验及真实请求 Promise。型号先保存原对象，再逐张上传待选照片，已返回的型号 ID 和已完成照片留在当前代次，照片失败时保留输入与剩余文件。库存作业继续使用每次打开生成的原 idempotencyKey，保存载荷保留作业类型、数量、盘点零值、地点、批次与原因。[型号页面](CatalogPage.tsx) · [资产页面](AssetWorkspacePage.tsx) · [库存作业](StockOperationsPanel.tsx) · [编辑驱动](../orders/useOrderEditor.ts)

图片、资产状态历史和库存流水查询传递取消信号，缓存键绑定当前会话与经营空间。照片组件将对象 URL 绑定生成它的查询身份和原字节，身份或字节切换的首帧撤下旧图，并在替换和卸载时释放。订单等旧消费者通过同一照片薄适配接入当前宿主。[照片组件](ItemGroupPhoto.tsx) · [旧照片入口](../../../../apps/admin/src/features/catalog/ItemGroupPhoto.tsx)

## 列表与来源

导出字段、只新增导入、已存在编码检查、批量状态及修订预检沿原逻辑。批量保存前重新读取资料和当前管理权限，原重复冲突由同一错误判断处理。[列表能力](listCapabilities.ts) · [旧列表能力入口](../../../../apps/admin/src/features/listCapabilities.ts)

型号、资产和数量库存卡片保留原浏览、只读预览、关闭后命令与图片切换。按钮消费公共原生 UIArc 出口，样式与固定图片来源保留同一字节版本及许可说明。[型号卡片](catalogCards.tsx) · [资产与库存卡片](assetCards.tsx) · [图片来源](archive/product-listing/SOURCE.md)

原媒体及来源入口供既有导读沿原路径读取。导读转向本模块后可移除这两处薄转接。[原媒体入口](../../../../apps/admin/src/features/catalog/CatalogCardMedia.tsx) · [原来源入口](../../../../apps/admin/src/features/catalog/archive/product-listing/SOURCE.md)

## 验证入口

类型检查消费 Rental 后台与原宿主入口。现有列表交互、导航术语和后台结构断言定位同一业务正文，原路由边界继续留在旧宿主。浏览器、真实 HTTP、对象存储与完整标准 Core 装配分别验收。[类型配置](../tsconfig.json) · [列表交互](../../../../tests/admin-list-interactions.test.cjs) · [导航术语](../../../../tests/admin-navigation-terminology.test.cjs) · [后台检查器](../../../../scripts/validate-react-admin.cjs)
