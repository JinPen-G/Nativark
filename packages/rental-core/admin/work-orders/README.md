# Rental 养护工单页面

本模块提供养护工单列表、看板、详情、历史、归还处置及原操作表单。页面通过公共 `CorePage` 声明主操作，表单通过 `useCoreForm` 共用确认与原生提交。HTTP、权限和经营空间来自宿主当前会话。前端入口的同伴依赖按原宿主版本声明为可选，领域总出口不会加载 React、后台或 MySQL 适配。

## 接入

从 `@rental-os/rental-core/admin/work-orders` 导入 `createRentalWorkOrdersAdminContribution`，传入发布清单的实现版本，以及返回 [RentalWorkOrderPageContext](page-context.ts) 的宿主 Hook。将结果与同版本清单交给公共 `registerCoreAdminPages`，菜单、标题和详情父级共同读取 [页面声明](pages.ts)。宿主只读取菜单/路由时从 `/admin/work-orders/pages` 导入，避免提前加载页面及看板；原营运菜单、路由和面包屑沿同一声明投影，兼容权限码与页面入口共用同一映射。

宿主 Hook 提供以下当前事实。

| 字段 | 来源与用途 |
| --- | --- |
| `api` | [createRentalWorkOrderApi](client.ts) 消费宿主唯一认证请求，保留 `/rental/v1` 方法与载荷 |
| `scopeKey`、`currentScopeKey` | 当前租户、成员、经营空间及权限快照，隔离查询与浏览器看板排序，并核对旧手势 |
| `permissions` | 当前维护、验收、订单读取及库存恢复权限，标准宿主同时核 Core 授权、成员分配和就绪 |
| `openOrder` | 由本宿主已登记订单页面生成的受控导航 |

页面标识为 `rental:work-orders` 与 `rental:work-order-detail`。标准登记生成 `/cores/rental/work-orders` 和带 `workOrderId` 的详情路径。详情引用列表作为父级，当前受权工单的 `workNo` 提供动态标题。

[原营运宿主薄适配](../../../../apps/admin/src/features/rental-core/MaintenanceWorkOrdersPage.tsx)保留 `/rental/work-orders`、详情深链接和 `tab=history`。它读取原 `rental-core:maintenance:view/manage/review`、`rental-os:order:view` 与库存恢复权限，将原会话代次和路由对象交给公共页面边界。页面登记负责定位，实际使用权沿当前会话与服务端核验。

## 源码路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [index.tsx](index.tsx)、[pages.ts](pages.ts) | 受控组件贡献、菜单、双语页名和详情父级，供宿主注册 |
| [MaintenanceWorkOrdersPage.tsx](MaintenanceWorkOrdersPage.tsx) | 原列表、详情、归还处置及六类表单，供标准贡献和原宿主共同消费 |
| [WorkOrderBoard.tsx](WorkOrderBoard.tsx)、[看板策略](workOrderBoardPolicy.ts) | 将受权工单映射到公共看板，手势请求原派工、开始、提交、验收或取消动作 |
| [client.ts](client.ts) | 工单及关联库存处置的十二个原 HTTP 方法，原 [rentalCoreApi](../../../../apps/admin/src/api/rentalCore.ts) 转接同一工厂 |
| [HTTP 入口](../../src/http-core.controller.ts) → [应用接点](../../src/http-applications.ts) → [原核心服务](../../src/mysql-core-runtime.ts) → [事实仓储](../../src/mysql-core-facts.ts) | 原 Guard/ALS 身份、租户/空间/地点与资料范围、工单状态和库存事务 |

公共 [UI 出口](../../../platform-admin/src/components/ui/index.ts) 提供原列表、详情栈、表单、浮层及看板。[CorePage](../../../platform-admin/src/core/CorePage.tsx)负责当前页操作，[useCoreForm](../../../platform-admin/src/core/useCoreForm.ts)负责真实提交、等待、失败及草稿快照。看板素材与构建适配的来源见[公共看板说明](../../../platform-admin/src/components/kanban-board/SOURCE.md)。

## 交互与验证

列表、看板、详情和历史沿原查询及刷新入口读取。查询传递原 React Query 取消信号。派工候选按当前地点读取，目录失败保留工单本身。确认与表单提交复用同一个 `useCoreForm.submit`，字段校验结束后再次核对原弹窗、目标和会话。成功沿原刷新与退出时序处理，失败保留输入。

在依赖就绪的仓库根目录运行前端类型与已有定向冒烟。

```powershell
npx --no-install tsc -p packages/rental-core/admin/tsconfig.json
node --no-compilation-cache --test tests/admin-work-order-board.test.cjs
```

[既有冒烟](../../../../tests/admin-work-order-board.test.cjs)覆盖原流转门槛、筛选后个人排序、旧宿主薄适配、弹窗退出与提交、重复提交、迟到校验，以及保留看板的实际键盘处理。浏览器、真实 HTTP/数据库与标准组合验收按实际环境核对；公共接入步骤见[Core接入手册](../../../core-contracts/README.md#五步快速接入)。
