# Rental 企业门户前端

[完整组合](index.ts)提供 `RentalEnterprisePortal`。浏览器宿主供给公开环境配置、样式与 React 挂载，企业会话、页面和原操作使用同一 Rental 实现。[原宿主](../../../../apps/enterprise-portal/src/App.tsx) · [浏览器挂载](../../../../apps/enterprise-portal/src/main.tsx)

`offline`、`publicHosts` 和 `development` 沿已有[企业会话配置](../enterprise/session.tsx)。域名列表由宿主部署配置提供。

```tsx
import { RentalEnterprisePortal } from "@rental-os/rental-core/clients/enterprise-portal";
import "@rental-os/rental-core/clients/enterprise-portal/styles";

<RentalEnterprisePortal offline={false} development={false}
  publicHosts={["portal.example.com"]} />
```

宿主先加载公共 UIArc/主题样式，按[原入口](../../../../apps/enterprise-portal/src/main.tsx)捕获邀请、应用动效偏好并挂载。入口保持原 BrowserRouter、QueryClient、Locale/Appearance/MotionProvider 和弹层作用域，面向同一浏览器应用实例。[薄宿主 Vite 配置](../../../../apps/enterprise-portal/vite.config.ts)通过公共 `platformAdminVite()` 复用同一适配，环境公开白名单、企业路径 rewrite 与 operator runtime 拒绝边界沿原规则。公共样式先于门户样式，构建使用锁定依赖。

消费本 UI 入口时，宿主须按其 package 依赖准备 `@rental-os/shared@0.1.0`，与 Rental 包声明的 Shared peer 版本一致。该 peer 的 optional 标记允许未消费这些 UI 出口的宿主省略依赖。

## 页面与调用链

[App](App.tsx) → [企业会话](enterprise-session.tsx) → [Shell](EnterpriseShell.tsx)与实际页面 → [原操作门闸](../enterprise/original-workflow-operation.ts)／[文件材料客户端](../enterprise/file-evidence/README.md) → 公共客户运输 → Rental 企业 Controller、领域服务与仓储。公共壳、UIArc、语言、主题和原表单快照从 `@rental-os/platform-admin` 已登记出口消费，材料与政策控件复用本包已有会员模块。

原路由包含 members、tasks、records、profile、applications、join、invites、join-requests、policy、approvals、orders、finance、exchange-approvals 与 extension-approvals。原路径、查询定位、邀请与恢复深链接保持；完整页面可从 `/clients/enterprise-portal/pages/<原组件模块名>` 消费，同一组合沿[原服务入口](../../../../apps/enterprise-portal/README.md)使用。

[申请／加入／邀请](WorkflowPages.tsx)、[政策](PolicyPage.tsx)、[预约审批](ApprovalsPage.tsx)、[订单](OrdersPage.tsx)、[财务](FinancePage.tsx)、[换货](ExchangeApprovalsPage.tsx)、[续租](ExtensionApprovalsPage.tsx)、[成员](MemberLifecycle.tsx)与[管理员](AdministratorEditor.tsx)保留现有完整交互。当前企业授权、audience、空间和字段投影由原服务端复核，父锁、金额、库存、批准、执行和原收据继续沿 Core 事实。

财务导出在读取前后核对发起时的页面。切换订单、企业或空间，或者离开财务页后，迟到的结果不会生成下载。应收、实款和核销仍分别读取原财务投影。

[原营业时区模块](../time.ts)由门户续租与客户小程序共用，保留 Intl、DST 拒绝与原设备回退，租期及费用由服务端裁定。

unknown 沿同一键、存储命名空间与 Web Lock 回读；页面隐藏、卸载、身份或材料变更保持原迟到结果隔离。浏览器 File/Blob、fetch、crypto、DOM、URL 和 img 回调在原组件中执行，具体字节核验仍委托已抽出的文件客户端。

## 验证入口

必要类型检查覆盖本组合、正式出口和原宿主转接。定向冒烟复用[企业消费者](../../../../tests/enterprise-consumers.test.cjs)，核原路由／菜单、Provider 顺序、身份和原操作寿命；业务正文与原组件逐一比对，附件沿前一片已通过证据。真实浏览器、HTTP、数据库、对象存储及完整企业业务验收需对应环境证据。
