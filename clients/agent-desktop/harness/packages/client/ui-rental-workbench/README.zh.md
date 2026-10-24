---
description: "选择 Rental OS 经营空间，在本地 Harness AI 工作台中显示现有管理后台页面。"
kind: "package-reference"
---
# @rental-os/dsh-client-ui-rental-workbench

[English](README.md) | 中文

## 概述

选择受权经营空间，在本地 AI 工作台和 Rental OS 后台页面间切换。业务菜单来自现有管理后台。工作方式切换不启动模型请求或提交业务表单。模型配置仍归 Harness；本包不接收业务凭据。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 应用组合声明此展示插件。只有配置了业务后台的 Electron 主窗口提供受控 Rental OS bridge 时，它才注册控件；普通 Harness Web 客户端保持原界面。

桌面部署选择原管理后台应用，凭据留在隔离业务文档。切换账号或经营空间前先保存或完成受保护草稿。重连仅加载获准文档，不重做上一条命令。配置和构建前置由 [Rental OS 接入入口](../../../../README.md)维护。

展开的侧栏还提供仅供人查看的目录预览。填写“查看商品目录”或“查看前5条商品目录”等受支持请求，以及当前空间政策已允许的 Provider 标识和 HTTPS Base URL。整句只在本机解析成1至50条的上限（默认十条）；原文、个人信息及不支持条件不会转发业务桥或模型。缺政策、停用、过期、无权或审计失败时不返回事实；切空间或到期后清除预览。名称、编码、库存和价格不返回。管理员在原 AI 服务设置页维护政策，沿用修订CAS及应答不明后的原键核对。此功能不是 Agent 业务模式、模型实际目的地证明，也不授权把结果放入聊天历史。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明 — 点击展开</summary>

插件向已有侧栏插槽、业务主面板和外壳通知层提供控件。Electron 负责原生业务视图；插件报告视图尺寸，并请求已注册导航、空间切换或封闭的目录预览。管理后台沿原认证、路由和 API 执行请求。已有布局在业务视图显示期间保留之前的 AI 主面板。

[客户端入口](src/client/index.ts)负责订阅和可撤销注册。[展示组件](src/client/Workbench.tsx)消费注入数据与回调。[共用协议](../../../../../../packages/shared/src/agent-desktop.ts)不含模型 Key 和业务凭据。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Rental OS 客户端接入](../../../../README.md)
- [Harness 客户端架构](../../../docs/subsystems/web-client.zh.md)
- [插槽](../../../docs/subsystems/slots.zh.md)
- [桌面端](../../../apps/desktop/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 桌面展示

#### 模型可见内容

无。本包不添加模型工具、提示词、业务页面内容或会话事件。

#### Token 影响

不直接产生模型 tokens 或调用。业务登录和导航不使用模型。

#### KV Cache 影响

本包不修改模型请求前缀。Harness 和已配置模型供应商继续负责请求构建及缓存可用性。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

接入将真实宿主、业务服务验证与隔离源码测试明确区分。

- Electron 渲染、上传下载对话框、打印和真实业务登录仍需获准后做原生宿主验证；隔离测试不等于正式验收。
- Harness 类型检查和打包前须先构建公开协议产物；两套工程保持独立依赖，本地已安装环境不能替代原生登录和页面验收。
- 本包不授予 Agent 访问业务 API 或页面 DOM 的能力，不增加平台模型账或服务端协作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作资料 — 点击展开</summary>

没有发布或生产就绪声明。当前验证证据统一见专项开发记录。

</details>
