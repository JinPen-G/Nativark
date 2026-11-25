# AI side panel

按当前官网 Team workspaces 文档示例还原。左侧为文档，右侧为 Assistant / Claude Sonnet 5.5，包含摘要、精简简介、增加年付价格列三项完整示例。默认回复和文档编辑均为本地模拟，不调用模型或保存到服务器。

## 交互

- 选择正文后点击 Ask about selection，将原文作为上下文芯片带入；芯片可移除。
- Enter 发送，Shift + Enter 换行，输入法组合输入不会误发送。Stop 中止当前请求及文本流。
- 精简简介显示逐词差异；增加年付列显示表格差异。Apply 前页面保持原值，Discard 放弃建议。
- Apply 后对应内容高亮，Undo 按区块撤销。撤销简介不会抹掉已经应用的价格表修改；同一区块有更新时会提示先撤销较新的编辑。
- Esc 关闭助手并恢复到打开按钮。关闭后文档扩展，对话保留。
- 小于 640px 容器宽度时变为底部面板，背景文档不可操作。支持深浅主题与减少动态效果。

## React 接入

复制 `src/components/ai-side-panel/` 和相邻 `shared/` 目录。依赖 React、lucide-react、react-markdown，样式由入口加载。

```tsx
import { AiSidePanel } from './components/ai-side-panel/AiSidePanel';

export function Editor() {
  return <AiSidePanel />;
}
```

当前公开版本使用 `page`、`respond`、`onApply`、`onUndo`、`defaultOpen`、`suggestions`、`assistant`、`className` 和 `style`。完整类型见 `panel-state.ts`。不使用旧归档里的 `defaultPage` / `onAsk` / `defaultMode` 契约。

`PanelPage` 为 `{ title, meta?, blocks }`。区块包含稳定 id，类型为 heading、paragraph 或 table；表格使用 `columns: string[]` 和 `rows: string[][]`。

`respond({ prompt, page, selection?, signal })` 返回或异步返回 `{ text, change? }`。`text` 可为字符串或 `AsyncIterable<string>`；`change` 为 `{ blockId, after }`。停止或切换页面时 signal 会被中止；忽略中止的旧回复也不会覆盖当前页面。输入 `[error]` 可测试本地失败状态与 Retry。

`onApply(change, nextPage)`、`onUndo(change, nextPage)` 收到含 before、after、blockId 的变更及完整新页面，可返回 Promise 供组件等待。回调失败时保留原页面并显示错误。真实服务的鉴权、幂等与未知写入结果由应用处理。

传入新的 `page` 对象会取消旧请求并重置页面、对话及撤销记录。关闭和重新打开不重置对话。默认高度 720px，可用 `--side-panel-height` 调整；`--side-panel-page` 控制文档最大宽度。

## 还原边界

交互和样式独立编写，使用当前公开演示作为视觉依据，原始归档未修改，没有恢复官方 Pro TypeScript。当前样例不是实际产品承诺。复制组件时保留 React、Lucide、react-markdown 的许可证，以及共享标识来源说明。
