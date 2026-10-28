# Selection toolbar

复用 `blocks/app-shell/selection-toolbar-pro/extracted/styles.css`，根据官网公开预览补充 React 交互。示例中的 Archive / Delete 只改变本地选择状态，不操作真实数据。原始归档缺少 Pro JavaScript；移植时请遵循资源许可。

复制 `src/components/selection-toolbar/`，依赖 React 和 lucide-react。组件自行导入 CSS。

```tsx
import { SelectionToolbar } from './components/selection-toolbar/SelectionToolbar';

<SelectionToolbar count={selected.length} noun="project" onClear={clear}
  actions={[{ label: 'Archive', onClick: archive }, { label: 'Delete', onClick: remove, destructive: true }]} />
```

`count`、`actions`、`onClear` 为必填；`noun` 默认为 item。动作支持 `label`、`icon`、`onClick` 和 `destructive`。使用方负责定位、真实数据操作、删除确认和清除选择后的焦点管理。
