# Product listing 图片区域来源

选型依据：[UIArc Product listing Pro](https://uiarc.dev/components/blocks/product-listing)。用户提供的本地组件库包含 2026-11-08 捕获的公开编译预览还原。取用时的 `ProductListing.tsx` 入口现保存在 `D:/工作文件/uiarc-pro-archive/preview/output/source-normalization/before/product-listing/ProductListing.tsx`，其原实现位于同一归档的 `required-pro/reference-runtime.js` 中 `72926` 模块。本适配固定保留取用版本，不跟随组件库后续入口改写；该来源不是付费原始 TSX，不重新声明为 MIT 或官方开源组件。

- `original.css` 从本地归档 `required-pro/original-css/cc0978301d564874.css` 原样保留；SHA-256 为 `5857988fbbcf19310b2ad1a658fbc591a79710ae6163db97be5cf1bdbd265d5b`。2026-11-09 同哈希副本位于组件库 `preview/output/source-normalization/reference-archive/required-pro/original-css/`。原来源为 `https://uiarc.dev/_next/static/css/cc0978301d564874.css`，沿用原归档许可边界。
- [CatalogCardMedia](../../CatalogCardMedia.tsx) 复用原产品卡的 media / image / hoverImage 子树和原哈希类名，保留照片交叉淡入；Next Image 的 fill 换成原后台鉴权读取的 `ItemGroupPhoto`，不带入示例照片、购物车或售价。
- [图片适配](../../CatalogCardMedia.module.css) 仅绑定后台既有 190px 图像区与完整器材图的 contain 呈现。外部卡片继续使用原 UIArc Card：原抬升、只读 quick look、返回、移动 BottomSheet、Button 和 Checkbox 均由现有宿主负责。
- 本次只复用 Pro 区块的图片呈现部分，不声称整套 storefront 或快速加购功能已经接入。型号与实物资产没有购物车、颜色/尺码或单一型号售价契约，业务信息由各自卡片适配器提供。
