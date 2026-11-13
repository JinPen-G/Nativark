# Product listing 卡片来源

当前型号、实物资产和数量库存卡片按负责人提供的 [UIArc Product listing Screen](https://uiarc.dev/components/screens/product-listing/frame) 截图与 2026-11-13 原站实测调整。原站网格最小列宽 172px、间距 8px；卡片内距 8px、方形图片、图片后 10px 留白、13px 名称与两行紧凑事实。内容宽度 640px 及以下为两列、4px 间距、6px 卡片内距。几何值留在 ListCapabilities / RecordCard 的 `product-listing` 适配分支；原站页面完整源码未引入，不能称为官方 Pro TSX。

型号显示真实名称、编码、库存方式与状态/风险；资产显示型号名、资产编号、状态与地点；数量库存直接显示服务端可用/在手/预占/养护事实和原处置限制。完整规格、定价组、序列号与处置原因仍在原 Card quick look / BottomSheet，写入沿原权限与关闭后回调。选择入口按后台既有规则留在名称旁。业务图片继续完整 contain，缺文件明确显示不可用，不补造产品照片、销量、售价或销售渠道。

卡片初始以当前列表首项作为浏览项，持续显示与悬停相同的中性背景；打开其他项后跟随该项，筛选/分页后原项不可见时回落首项。浏览项不自动勾选复选框或加入批量操作，关闭详情不清除当前项。

开启独立 Copilot 后，以中间面板内宽（不扣正文内边距/滚动条）判定原站 640px 断点；面板仍宽于该断点时保持 172px 起宽的自动列数，避免仅因正文留白提前放大成两列。其他未使用分屏宿主的列表保留原内容宽度回退。

## 保留的图片组件来源

选型依据：[UIArc Product listing Pro](https://uiarc.dev/components/blocks/product-listing)。用户提供的本地组件库包含 2026-11-08 捕获的公开编译预览还原。取用时的 `ProductListing.tsx` 入口现保存在 `D:/工作文件/uiarc-pro-archive/preview/output/source-normalization/before/product-listing/ProductListing.tsx`，其原实现位于同一归档的 `required-pro/reference-runtime.js` 中 `72926` 模块。本适配固定保留取用版本，不跟随组件库后续入口改写；该来源不是付费原始 TSX，不重新声明为 MIT 或官方开源组件。

- `original.css` 从本地归档 `required-pro/original-css/cc0978301d564874.css` 原样保留；SHA-256 为 `5857988fbbcf19310b2ad1a658fbc591a79710ae6163db97be5cf1bdbd265d5b`。2026-11-09 同哈希副本位于组件库 `preview/output/source-normalization/reference-archive/required-pro/original-css/`。原来源为 `https://uiarc.dev/_next/static/css/cc0978301d564874.css`，沿用原归档许可边界。
- [CatalogCardMedia](../../CatalogCardMedia.tsx) 复用原产品卡的 media / image / hoverImage 子树和原哈希类名，保留照片交叉淡入；Next Image 的 fill 换成原后台鉴权读取的 `ItemGroupPhoto`，不带入示例照片、购物车或售价。
- [图片适配](../../CatalogCardMedia.module.css) 保留完整器材图的 contain 呈现；紧凑卡片由共享适配提供方形区域，原详情仍使用 190px 图像区。外部卡片继续使用原 UIArc Card：原抬升、只读 quick look、返回、移动 BottomSheet、Button 和 Checkbox 均由现有宿主负责。
- 只复用原 Pro 区块的图片呈现和实测 Screen 的卡片布局，不声称整套 storefront、右侧商品编辑器或快速加购功能已经接入。型号与实物资产没有购物车、颜色/尺码或单一型号售价契约，业务信息由各自卡片适配器提供。
