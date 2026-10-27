# Agent run

沿用本项目已有 `blocks/ai/agent-run-pro/` 资料补全的 Agent run。预览入口 `src/components/agent-run/AgentRun.tsx`，目录路由 `/#/blocks/ai/agent-run`。

## 既有资料的复用

`original.css` 与归档 `extracted/styles.css` 字节一致，保留来源注释；`tokens.css` 复用原有变量并限定到组件内。`reference-update.css` 为当前官网公开页面渲染的样式规则，用来补齐旧归档之后更新的结构；`integration.css` 只处理新旧属性冲突、依赖控件与主题接入。原始归档未修改。新写的是缺失的 React 运行与审批逻辑，并非官方 Pro TypeScript。

## 完整示例

默认任务 Add rate limiting to the public API，由 Claude Sonnet 5.5 演示计划、读取 routes/package/Redis、搜索限流与 API key，然后等待审查两个文件。双文件标签包含完整 `rate-limit.ts` 与 `routes.ts` 统一差异。Approve 才会继续模拟写入、类型检查和 12 项测试。Reject 输入意见后修订为可配置 RATE_LIMIT，并排除 /health；再次拒绝会停止，保持未写入状态。完成后折叠步骤，展示完整结论、文件统计、检查结果及 Open pull request。Restart run 重播并清除旧结果。

所有代码、测试、文件写入和 PR 都是本地演示，不会执行命令、写入业务文件或创建真实 PR。

## 复制与接入

复制整个 `src/components/agent-run/`，并携带相邻 `shared/MeasuredHeight.tsx`、`shared/BrandMark.tsx`、`shared/reference-marks.json` 及标识来源说明。现有依赖 React、lucide-react 足够；组件直接导入 CSS。字体使用项目已有 Inter，或通过 `--font-inter` 提供。无需复制整个预览站的全局样式。

宿主需要提供以下基础颜色变量；它们由归档 `tokens.css` 引用，不能省略。深色主题在组件的祖先元素上设置 `data-theme="dark"`，并切换对应基础变量。以下为本预览站实际使用的值：

```css
:root {
  --neutral-0: #fff; --neutral-2: #f7f7f7;
  --neutral-7: #737373; --neutral-8: #666; --neutral-11: #202020;
  --background: #fff;
}
[data-theme="dark"] {
  --neutral-0: #1a1a1a; --neutral-2: #242424;
  --neutral-7: #a0a0a0; --neutral-8: #b5b5b5; --neutral-11: #ededed;
  --background: #131313;
}
```

```tsx
import { AgentRun } from './components/agent-run/AgentRun';

<AgentRun />
<AgentRun autoPlay={false} />

// 真实运行由应用维护状态，组件只展示传入的数据
<AgentRun
  task={task}
  run={run}
  onApprove={change => agent.approve(change.id)}
  onReject={(change, reason) => agent.reject(change.id, reason)}
  onOpenPullRequest={() => agent.openPullRequest()}
  onRestart={() => agent.restart()}
/>
```

## API

`AgentRunProps` 在入口文件导出：`task`、`model: { name, mark? }`、`script`、`run`、`autoPlay`、`onApprove`、`onReject`、`onOpenPullRequest`、`onRestart`、`className`。动作回调可返回 Promise，等待期间禁止重复提交；失败保留当前状态并展示错误。重启后旧回调与旧 PR 结果不能覆盖新演示。

`AgentRunState` 为 `{ status, elapsedMs, steps, result? }`。状态支持 idle、working、waiting、done、stopped。步骤使用稳定 `id`、`mark`、`verb`、`doneVerb`、`status`，可选 `target`、`doneTarget`、`durationMs`、`text`、`io: { input, output: string[] }`、`progress: { value, total }` 与 `change`。内置图标 think/read/search/edit/terminal/review，以及 npm/typescript/github 标识；`icon` 可传 ReactNode。

`ProposedChange` 为 `{ id, summary, files, outcome?, reason? }`；文件为 `{ path, status?, lines }`，每行 `{ type: 'add' | 'del' | 'ctx', old?, new?, text }`。结果为 `{ summary, files: [{ path, additions, deletions }], tests: { passed, total }, checks: string[] }`。数据类型由 `AgentRun.tsx` 重导出，定义见 `agent-run-state.ts`。

`run` 优先于 `script`；传入 live run 时，不会自动推进、写入、完成或添加演示结果，回调负责让应用更新状态。未传 run 时，`RunScript` 包含 `steps`、`result` 和可选的 `revise: { steps, result }`。参照 `agent-run-data.ts` 修改脚本，不必改布局。

`useSimulatedRun(script, { running })` 导出并返回 `{ state, start, restart, approve, reject }`。单一动画帧时钟约每 40ms 提交一次，组件离屏、标签页隐藏、等待审批时暂停计时。此模拟 hook 不连接真实服务。

`onOpenPullRequest` 返回或异步返回 `{ number, url? }`，或 void；报错显示可重试状态。未传时只模拟 PR #482，并向辅助技术说明。返回链接仅接受 http/https，页面不会自行导航。

Tab/Enter/Space 操作步骤，方向键、Home/End 切换差异文件。意见框 Enter 发送，Escape 取消并回到 Reject；审批后回到对应步骤。表格/代码在内部滚动。小于 520px 隐藏步骤时长并减少缩进，按钮占满一行，支持深浅主题及减少动态效果。

## 来源

公开参考：[Agent run](https://uiarc.dev/components/blocks/agent-run)。复用归档 CSS 和设计变量不等于全部代码独立原创；移植时保留这些来源说明及 React、Lucide、字体与服务标识许可。现有资料并未包含官方 Pro 组件 JavaScript。
