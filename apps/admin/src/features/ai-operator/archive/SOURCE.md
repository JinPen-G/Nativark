# 本地归档组件接入记录

日期：2026-10-27。来源：`D:\工作文件\uiarc-pro-archive\preview`。

## 来源边界

按来源 README 复制 `ai-chat/`、`agent-run/`、`shared/` 整个目录，附对应文档和 React、Lucide、ReactMarkdown 许可。`source-manifest.json` 保存复制时 SHA-256；它记录导入基线，不是修改后文件的当前哈希。

AI chat 为归档作者独立完成的实现；Agent run 保留公开归档 CSS 和变量、独立补全交互。不能把这些文件标成官方 Pro TypeScript。原归档和平台既有 vendor 均未修改。

## 接入修改

| 文件 | 必要适配 |
| --- | --- |
| AiChat.tsx | 原聊天状态可由租户 shell 托管，保留原分支算法；增加顶栏工作区入口；模型菜单移入两层输入框；本地化；接入共享动态偏好；附件对象URL由 shell 统一释放 |
| chat-state.ts | responder options 增加可选 chatId，用于隔离并发/过期运行 |
| chat-demo.ts | 去掉 `.ts` 导入后缀以兼容项目 TS 配置；原默认示例保留作来源资料，业务页面显式传入自己的本地 responder/history/models，不显示原编码示例 |
| ChatMarkdown.tsx / ToolCall.tsx | 仅本地化可见按钮和提示，Markdown、引用、来源卡片和工具面板保持原实现 |
| AgentRun.tsx | activityOnly 模式隐藏编码结果、PR与重启动作；保留运行步骤及其输入/输出折叠；本地化和共享动态偏好 |
| shared/MeasuredHeight.tsx | 保留测量弹簧，改读平台有效动态偏好 |
| ../archive-adapter.css | 主题色、字体、圆角和宿主尺寸；不改原 CSS 文件 |

业务数据、模拟事件和最终结果位于上层 `demo-response.ts`、`OperatorContext.tsx`、`capabilities.ts`。真实业务接入依然需要消息流、工具事件与结果回调。当前没有模型请求、业务API读取、写入、上传或调度。

## 文档

- [AI chat](docs/ai-chat.md)
- [Agent run](docs/agent-run.md)
- [平台演示与能力说明](../README.md)
