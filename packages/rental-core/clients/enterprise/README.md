# Rental 企业 Web 客户端

[入口](index.ts)提供企业会话、业务请求工厂与原操作门闸。宿主传入离线模式、登记公共域名和开发模式，页面通过 `useEnterprise()` 消费当前身份、企业选择及请求。[门户配置入口](../../../../apps/enterprise-portal/src/enterprise-session.tsx)沿同一实现供给配置。

从正式出口导入并包住企业页面。域名列表使用部署时登记的公共入口，配置由宿主提供。

```tsx
import { EnterpriseSessionProvider } from "@rental-os/rental-core/clients/enterprise";

<EnterpriseSessionProvider offline={false} development={false}
  publicHosts={["portal.example.com"]}>
  <EnterprisePages />
</EnterpriseSessionProvider>
```

本客户端复用同一版本的 `@rental-os/web-client`、React 与 Rental 合同。独立类型入口是 [clients/tsconfig](../tsconfig.json)，门户通过声明的包依赖消费；需要变更基址或环境配置时在宿主接点办理，不在 Core 内读取环境文件。

## 调用链与用法

[会话协调](session.tsx) → [企业请求工厂](client.ts) → [公共 web-client](../../../web-client/src/session.ts) → Rental 企业 HTTP → 原授权、领域服务和仓储。客户登录、刷新、退出及空间切换继续使用公共 web-client 的同一会话存储与 Web Lock。[企业读取入口](../../src/http-enterprise-read.controller.ts)和[工作流入口](../../src/http-enterprise-workflows.controller.ts)复核专用客户身份、企业关系、当前角色、空间、动作及字段投影。

`EnterpriseSessionProvider` 接收 `offline`、`publicHosts`、`development` 和 `children`。在同一 Provider 下，`useEnterprise().read<T>(path, signal?)` 读取原客户端路径，`write<T>(path, body, method?)` 使用原 POST 或 PUT。独立页面宿主也可用 `createEnterpriseBusinessClient(boundary)`，供给当前商户、会话 generation、读取 signal、当前寿命检查和拒权回调。服务端返回的企业准入与当前会话的商户、本人须一致。

读请求复用公共运输已有的认证刷新。写请求关闭认证重放，调用者须先经原操作门闸可靠保存原键，再明确派发一次。隐藏、卸载、企业或空间切换和撤权取消读取并隔离迟到结果，取消后的写入结果仍需按原收据核对。

## 原操作与兼容

[原操作门闸](original-workflow-operation.ts)供给 `useOriginalWorkflowOperation(scope, recovery?)` 及本人保留引用读取。原门户[兼容入口](../../../../apps/enterprise-portal/src/original-workflow-operation.ts)消费同一门闸。存储继续按 scope、商户、本人、当前服务空间及企业隔离，Web Lock 与原键保持原命名空间。持久材料仅包含 opaque 原引用，表单与凭据留在当前内存。

结果未知时调用 `recover(afterRead)` 读取登记原路径。`not_recorded`、超时、取消及重新登录均保留原引用。续租、换货和交接的明确结束操作继续核对原 K/C、本人、订单、空间与原用途，结束失应答也只能读取原收据。恢复入口的 `recovery` 限定当前善后权限下的精确只读路径。当前服务端权限、企业付费及自费投影和原 Core 金额、批准、执行、收据契约各沿原业务实现。

## 契约与验证入口

企业合同从本包的[企业合同](../../src/enterprise.ts)、[工作流](../../src/enterprise-workflows.ts)、[费用](../../src/enterprise-expense.ts)、[换货](../../src/enterprise-exchange.ts)及[交接](../../src/enterprise-transfer-decision.ts)单源消费。页面其他既有合同仍沿 shared 兼容出口。

必要类型检查覆盖本入口、两个门户转接和直接原操作消费者。已有[企业消费者](../../../../tests/enterprise-consumers.test.cjs)提供会话寿命、原写入与恢复的定向行为入口，使用原离线隔离约束与明确替身。浏览器、真实 HTTP、数据库及资金证据按各自环境核验。
