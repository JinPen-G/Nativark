# AI side panel

当前官网 Team workspaces 文档与助手的本地重建。完整示例、调用接口、复制方法和验证范围见 [`../../../public/docs/ai-side-panel.md`](../../../public/docs/ai-side-panel.md)。

复制本目录，并同时带走 `../shared/BrandMark.tsx` 和 `../shared/reference-marks.json`。需要 React、lucide-react、react-markdown；样式由组件导入。默认文档、三个建议及回复均为本地演示；真实接入使用 `page`、`respond`、`onApply` 和 `onUndo`。

文档摘要、精简 Intro、补 Annual 价格列、原生选区上下文、字符串/异步流回复、停止/重试、差异确认、应用/放弃/独立撤销、关闭/重开及窄屏底部面板均已实现。小于 640px 时底部面板占组件高度的 74%，与当前公开预览一致。
