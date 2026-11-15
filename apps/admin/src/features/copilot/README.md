# 业务 Copilot：原侧栏接入订单 Agent

原右侧面板、上下文chips、输入、来源、确认弹窗、360px停靠及窄屏底部面板沿用原实现。业务页面通过这份侧栏直接运行原订单Agent。

## 调用与事实来源

[原面板](CopilotLayout.tsx) → [范围与输入状态](CopilotProvider.tsx) → [订单宿主生命周期](useCopilotOrder.ts) → [原订单会话桥](copilot-order-session.ts) → [原会话与任务API](../../api/aiConversations.ts)。打开、加入上下文和转接均不启动模型；用户在原确认弹窗核对实际订单及状态／费用／收款／下一步问题，明确确认后才按原受理、Task创建、模型准备及首次启动链执行。

DOM上下文只提供原对象定位和当前页面来源，不作为服务端事实。原Auth／Guard／ALS重新核验本人操作权限、租户、空间、数据范围和原订单。正文、订单事实及Task步骤分别来自原受权结果、原Core投影及原任务快照；模型描述不能当作支付、审批或履约成功。未接入的资料／配置场景继续走原人工页面，不以本地模板伪造模型回应。

## 原操作、转接与生命周期

同一订单的写链由原操作键和浏览器互斥锁保护；只保存最少原定位，原场景journal仍兼容同标签页转接。丢应答、停止或离线后只核对原操作，不换键重发。新对话必须先确认原链可结束，不能通过清空前端绕过unknown。停止本页交付不证明服务端任务已取消。

通过原登记导航转到Agent控制台时沿同一conversationId重新受权读取，不复制页面字段、不创建第二Task、不再预留预算。隐藏、关闭、切订单／账号／租户／空间、权限或会话纪元变化时撤回正文、预览、回调和未发送草稿，迟到回复不得进入新对象。

首次模型启动的journal读回后才开启客户端可见观测，正文绑定原conversation／turn／Task／Run／resultId。原可见边界核对实际正文和遮挡，连续两帧可见后才上报；重读、重开和启动丢应答后的恢复不会开启新窗口。补答通过原TaskClarification及原输入收据定位续跑Run，观测写入原OperationLog，独立保留模型累计资源和原费用账。应付金额直接使用原订单数值及共享币种格式工具。

原Table／DataTable／RecordCard／RecordDetailLayout及CopilotSection的上下文注册仍按原对象边界，不扫描任意隐藏内容。固定页面导航继续依原路由与页签权限，不接收模型任意URL、选择器或脚本。

## 样式与验证

原侧栏CSS、开关曲线、焦点约束、主题／圆角、动态偏好与点击音效保持。归档CSS对data-admin-content业务子树的[原构建排除](../../../config/copilotArchiveStyles.ts)继续有效，来源和许可见[SOURCE](archive/SOURCE.md)。

仅做必要内存模拟与类型检查，不新增测试脚本。固定证据及未验范围见[AI Native开发记录](../../../../../docs/AI%20Native/AI%20Native-开发记录.md#ain-native-console-direct-integration-20261115)。真实浏览器、数据库和供应商测试由负责人后续操作。
