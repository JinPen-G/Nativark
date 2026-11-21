# 公共 Gateway

本模块持有原统一 Gateway 的执行、路由核验、调用准入与派发、容量与期限、模型端口及运输流程。宿主显式提供当前权限、配置与密钥来源、财务单账、审计、媒体读取和业务工具参加者。启用此模块须沿所选宿主的正式装配与权限入口办理。

## 入口与调用链

- [正式模块入口](index.ts)汇总公共实现与端口。
- [C03 facade](public-ai-gateway.service.ts)读取受控场景、复验当前主体与配置，并按公共合同发布结果。
- [统一执行器](unified-ai-gateway.service.ts)保留原 callId、摘要、准入与派发占用、计量收据、单账结算及 unknown 清理。
- [路由](gateway-routing.service.ts)消费宿主的当前主体与配置来源，经[Provider 路由器](provider-router.service.ts)核对当前配置和[能力证据](provider-capability.service.ts)。
- [运输](routed-model-transport.ts)消费注册协议适配器及当前密钥来源，调用前后复验配置，核查结果中的敏感内容，并保留流终止与容量释放语义。
- [账务端口](gateway-accounting.ports.ts)由原持久账参加者实现，Task/Run/Step、价格与原计量证据沿原记录关联。

## 业务参加者

[工具格式端口](gateway-tool-policy.ports.ts)提供原严格请求 schema、所需定义、`validateToolRequest(value)` 与 `validateNativeToolCall(value)`。前者返回类型谓词，后者返回布尔值。统一执行器的 `invoke` 与 `stream` 在路由、准入和预算预留前确认工具参加者，缺少时返回 `CAPABILITY_UNSUPPORTED`。C03 facade 继续按受控场景声明允许的调用方式。

[Native 结果端口](model-input/native-tool-result.ports.ts)携带原计划选择器、调用身份、配置与结果摘要。原结果读取器在 `resolve` 与 `assertCurrent` 中核对当前权限、原模型结果和业务收据。Gateway 按该材料执行一次已准入的后继调用，恢复继续核对原操作与原收据。

场景中的 `orderExplainTool` 字段作为历史摘要输入保留。实际工具名、输入及业务结果由注册参加者校验。

Rental 使用[原 C03 facade](../../../ai-native-server/src/runtime/public-ai-gateway.service.ts)和[原统一入口](../../../ai-native-server/src/runtime/unified-ai-gateway.service.ts)注册[严格工具参加者](../../../ai-native-server/src/runtime/gateway-tool-policy.ts)。[私有运输转接](../../../ai-native-server/src/runtime/routed-model-transport.ts)提供原 BYOK 配置与 Task 事务见证，原预算参加者沿[账务适配](../../../ai-native-server/src/runtime/budget/budget-gateway-adapter.ts)接入。

## 公共合同与验证

实现统一消费 `@rental-os/platform-contracts/ai-gateway`。[校验接点](gateway-contract-validation.ts)通过 `createAiGatewayDraftSchemas` 与 `validateAiLeafSchemaValue` 复用原严格 schema。`createGatewayContractValidators` 接收可选的业务格式参加者，返回 `isAiExecutionContext`、`isGatewayIntent`、`isGatewayConfig`、`isGatewayResult` 与 `isGatewayEvent`。结果及终结事件中的工具请求逐项通过原 schema 和已注册校验。

原验证入口为 [统一 Gateway](../../../../tests/ai-native-unified-gateway.test.cjs)、[C03 facade](../../../../tests/ai-native-public-gateway.test.cjs)、[路由运输](../../../../tests/ai-native-routed-model-transport.test.cjs)和[路由复验](../../../../tests/ai-native-gateway-routing.test.cjs)。验证按所选包的正式声明及原离线守卫执行，原断言与失败证据继续沿这些入口维护。
