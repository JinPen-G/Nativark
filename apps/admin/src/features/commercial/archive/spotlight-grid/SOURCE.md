# Spotlight grid 来源

由用户指定复用 `D:/工作文件/uiarc-pro-archive/preview/src/components/spotlight-grid/` 的成品还原组件。归档来源为 https://uiarc.dev/components/blocks/spotlight-grid，捕获日期 2026-11-09；属于公开编译预览还原，不声称是付费原始 TSX。

- `original.js` 中卡片函数 `er` 逐字提取自 `reference-runtime.js` 的 8152 模块，SHA-256 为 `32a08c67764735399b76b758705a7d230ec8fdab4b9647a87dfa0107d517616a`。打包器依赖名称接回宿主 React / Motion / Lucide，减少动态依赖接现有平台偏好。
- 网格函数 `eo` 提取前 SHA-256 为 `28b4a1db2184b65b68d3f2961bffb0efb111ed147c970366b9e990dd718a9ded`。指针光点、弹簧参数、原地变形、Escape 关闭、焦点归还和 `inert` 均未改，只做以下适配：
  - 原示例卡片、预览、详情及其状态改为 `cards`、`renderMini`、`renderDetail` 插槽。
  - 去掉营销标题区，改用 `label` / `closeLabel` 提供无障碍文案。
  - 详情起点在所有宽度下都取被点击卡片的 `offsetTop`。原版只有两行卡片；优惠方案可能有多行，从顶部展开会跑出视口。
  - 当前打开的卡片被筛选掉时自动关闭详情，避免网格停留在 `inert`。
- `original.css` 是 `original-css/7374f9f63c98d453.css` 的原样拷贝，SHA-256 为 `60f3b407536df483bdf40adce4fe972be8a19807a016a851e1dfe8159d773ef2`。宽度与光效强度的调整放在 `../../discountPlanShowcase.module.css`。

原归档的使用许可范围继续适用，不将此目录重新声明为 MIT 或官方开源组件。
