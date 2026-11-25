# Inbox triage

收件箱消息分拣组件。包含 Inbox、Snoozed、Archive，未读筛选，展开消息，归档、稍后处理、移回收件箱和撤销最近一次移动。六条消息及头像对应官网公开示例；操作仅改变本地状态，不连接真实邮箱。

## 复制与使用

复制整个 `src/components/inbox-triage/`，包括 `assets/`，以及 `src/components/shared/MeasuredHeight.tsx`。依赖 React 和 lucide-react；CSS 由组件导入。示例头像来自官网公开预览，移植时请保留来源并遵循相应许可；实际应用可替换为自己的头像资源。

```tsx
import { InboxTriage } from './components/inbox-triage/InboxTriage';

<InboxTriage />
```

组件使用内置示例数据，不接受 props；接入真实服务时需替换消息数据和移动、撤销处理逻辑。默认支持浅色，祖先元素设置 `data-theme="dark"` 后启用深色。颜色可通过 `--triage-*` 变量定制，字体使用宿主 `--font-inter` 或 Inter 回退。

## 操作

左右方向键切换目录，上下方向键切换消息；Enter 或空格展开并标记已读。`S` 稍后处理，`E` 归档，`U` 移回收件箱；操作后焦点移至相邻消息或标题，Undo 恢复消息和焦点。支持减少动态效果。

消息移出时收起并淡出，目录指示线滑动，状态提示短暂淡入；开启减少动态效果时取消移出和指示线的位移动画。动画期间可立即撤销。

## 来源

原始归档 `blocks/support/inbox-triage-pro/extracted/styles.css` 直接复用，变量按组件作用域接入；归档未含 Pro 组件 JavaScript，交互逻辑根据公开预览和说明补写。参考 [Inbox triage](https://uiarc.dev/components/blocks/inbox-triage)。
