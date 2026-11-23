# AI chat

本地聊天交互组件。布局参考当前公开演示，组件、会话状态及样式重新编写。默认回复、模型和工具调用均为模拟，不连接 AI 服务。

## 本地交互

- 顶部标题打开会话菜单，右侧切换模拟模型或新建聊天。
- 会话菜单保留原版 Today / Previous 7 days 分组，以及 Add region to orders、Partition the events table、Status page incident draft、Churn interview themes 四个完整示例。
- 模型菜单最前为 Everyday、Reasoning、Quick，默认 Everyday；其后保留官网示例的五个模型选项。
- Enter 发送，Shift + Enter 换行；输入法选词时 Enter 不会误发送。
- 回复按思考、工具、正文顺序流式展示；发送按钮在生成时变为停止，Esc 也可停止。
- 思考与工具可展开；编号引用在悬停、键盘聚焦时显示来源卡片。
- 默认数据库对话包含两轮完整示例：第一轮网页搜索展示两条搜索词、四条带站点图标与域名的资源；第二轮展开 `SELECT count(*) FROM orders;` 及 `40,213,880` 行结果。示例工具和数据均为本地模拟。
- 复制消息、代码；点赞和点踩只记录在当前页面。
- 编辑问题或重试回答创建新版本；切回旧版本可恢复该分支后续消息。
- 附件在本地显示文件名和图片缩略图，不上传；刷新页面后聊天和附件会清空。
- 向上滚动可暂停跟随，点击“Jump to latest”回到最新消息。切换会话保留各自滚动位置。

输入 `[error]` 可以演示失败状态。重试保留原问题，因此原问题含 `[error]` 时仍会失败；编辑问题移除该标记即可恢复正常演示。

## React 接入

入口：`src/components/ai-chat/AiChat.tsx`，命名导出和默认导出均可使用。复制整个 `ai-chat/` 目录和相邻的 `shared/` 目录，安装 `react`、`lucide-react` 和 `react-markdown`。源码页提供八个相关文件，包含工具面板与共享图标。

```tsx
import { AiChat } from './components/ai-chat/AiChat';

export function Dashboard() {
  return <AiChat style={{ '--chat-height': '680px' } as React.CSSProperties} />;
}
```

组件默认填满容器宽度，高度为 720px。通过 `--chat-height` 和 `--chat-column` 调整高度和消息列宽。颜色使用 CSS 变量并有独立回退值，可接入现有主题。组件样式随入口加载。

## 流式接口

传入 `respond(messages, { signal, model })`，返回 `AsyncIterable<ChatStreamEvent>`。只传递当前可见分支的消息；停止、切换会话和卸载会中止当前请求。接口必须遵守 `signal`，并把服务端流转换为以下事件：

```ts
{ type: 'reasoning', delta: '思考摘要' }
{ type: 'reasoning-end', seconds: 2 }
{ type: 'tool', tool: { id: 'search', name: '搜索', status: 'running' } }
{ type: 'sources', sources: [{ id: 'doc', title: '文档', url: 'https://example.com' }] }
{ type: 'text', delta: '回答片段' }
{ type: 'error', message: '服务暂时不可用' }
```

工具按 id 更新，可使用 `running`、`done`、`error` 三种状态。正文支持基础 Markdown、代码块和 `[1]` 格式引用；来源事件应先于对应引用。

搜索工具可提供 `kind: 'search'`、`queries: string[]` 和 `sources`；来源可附带 `brand`。数据库工具使用 `kind: 'query'`、`brand`、`input` 和 `output`，分别展示 SQL 和结果。模型可附带 `brand` 选择对应示例标识。

其他可选参数：`initialMessages`、`history`、`models`、`defaultModel`、`title`、`suggestions`、`greeting`、`placeholder`、`autoPlay`、`onFeedback`、`onModelChange`、`onNewChat`、`className`、`style`。初始数据在挂载时读取。自动播放默认仅用于无参数模拟预览；自定义初始消息需要自动回答末尾用户消息时，可显式设置 `autoPlay`。

附件当前只暴露名称、大小、类型及本地缩略图 URL，不包含服务器上传结果。真实服务接入时应按业务需要补充文件上传和附件 ID 映射。请保留项目中对应开源依赖的许可证。
