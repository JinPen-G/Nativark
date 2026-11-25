# Agent run

基于已有 `blocks/ai/agent-run-pro/` 归档补全的交互组件。原始样式复制到 `original.css`，原变量限定在 `tokens.css`；官网现行差异由 `reference-update.css` 和 `integration.css` 接入，档案原文件保持不变。所有运行、测试及 PR 默认为本地模拟。

入口 `AgentRun.tsx`；演示与完整数据在 `agent-run-data.ts`，状态逻辑在 `agent-run-state.ts`，时钟在 `useSimulatedRun.ts`。复制时一起带走相邻 `shared/MeasuredHeight.tsx`、`BrandMark.tsx`、`reference-marks.json`；详见 [`../../../public/docs/agent-run.md`](../../../public/docs/agent-run.md)。
