# Rental 工作台与经营报表

本模块提供运营概览、经营报表及直属库存、客户和地点贡献展示。页面通过底座的 `CorePage`、UIArc、主题、语言和动效接点呈现，宿主供给当前会话、业务范围、客户预览和已认证的 JSON／文本传输。[页面贡献](index.tsx) · [底座页面接点](../../../platform-admin/src/core/CorePage.tsx)

## 接入与旧宿主

1. 使用宿主已验证的会话、当前会话读取器和原范围键创建页面上下文。JSON 与 CSV 回调在读取前后复核同一身份、权限及经营空间，迟到结果按原请求失败处理。[上下文](page-context.tsx) · [原身份投影](../orders/page-context.tsx)
2. 将上下文钩子交给 `createRentalOperationsAdminContribution`，与其他 Rental 页面合入同一贡献。页面、菜单和标题从同一声明读取，详情目标使用已登记的 Core 页面定位。[贡献工厂](index.tsx) · [统一 Rental 入口](../index.tsx) · [页面声明](pages.ts)
3. 将本模块语言资源并入宿主同一个 `LocaleProvider`。客户预览由宿主绑定现有会员上下文和授权文件读取，报表行继续保留历史姓名与类型。[语言资源](messages.ts) · [客户预览](../membership/CustomerPreview.tsx)
4. 原后台入口通过薄适配消费同一正文，继续使用原 `adminRuntime`、范围键和 `requestText`。工作台的页面描述沿原导航首选 `report:view`，兼容宿主通过 `rentalOperationsLegacyPageAllowed` 保留报表、订单或养护查看权限任一准入。经营报表要求原报表查看权限。[旧宿主适配](../../../../apps/admin/src/features/workbench/legacy-operations-context.tsx) · [兼容准入](pages.ts)

## 请求与服务端事实

请求工厂提供原工作台待办、经营报表、CSV 导出及支付／退款核对方法，复用订单客户端的空间档案和地点读取。筛选沿原合同，经营空间由服务端会话解析，CSV 由原始文本传输返回。[请求工厂](client.ts) · [订单请求](../orders/client.ts)

报表通过原 Controller、报告应用和仓储读取金额、客户／地点分类以及库存快照。CSV 沿原报告响应与字段投影生成，支付／退款结果由原资金域提供。[HTTP 入口](../../src/http-core.controller.ts) · [报告仓储](../../src/mysql-reports.ts) · [CSV 生成](../../src/report-csv.ts) · [待办投影](../../src/workbench.ts) · [支付运行时](../../src/mysql-payment-runtime.ts)

## 页面与直属展示

- 运营概览按原期间筛选订单。指标同时核报表和对应订单／资产查看权限，待办独立读取，刷新与支付核对继续位于原页头工具和次操作区，支付核对保留原权限、在途状态和实际 Promise 结果反馈。[工作台](WorkbenchPage.tsx) · [指标明细](WorkbenchMetrics.tsx)
- 待办保留重点／表格视图、分页、悬停预览、固定和键盘操作。已访问表格在视图切换时保持挂载，刷新移除的固定项随结果清除。详情目标由稳定订单／工单标识和对应权限决定。[待办列表](WorkbenchTodoQueue.tsx) · [日期与定位投影](workbenchPresentation.ts)
- 经营报表保留日期、地点、客户类型和客户标识筛选，以及分析和五组明细视图。查询占位限定同一业务范围，读取失败时清除旧金额展示，导出使用同一组筛选和权限。[经营报表](WorkspaceOperationReportPage.tsx)
- 库存与资产沿读取瞬间的快照呈现。金额和客户／地点名称读取原报表事实，图例选择只作用于当前图表。贡献、税额和异常费用继续保留原展示口径。[库存快照](insights/InventoryOverview.tsx) · [贡献分析](insights/ContributionExplorer.tsx) · [报表分析](insights/ReportAnalysis.tsx) · [共享展示](insights/OperationalCharts.tsx) · [图例选择](insights/chartVisibility.ts)
- Split bar 保留原 CSS、几何、标签布局、图例、键盘和动效实现，减少动态偏好消费底座同源接点。原来源和哈希清单随实现保留。[Split bar](insights/split-bar/SplitBar.tsx) · [来源说明](insights/split-bar/SOURCE.md) · [来源清单](insights/split-bar/source-manifest.json)

## 验证入口

仓库根目录执行 `node --test tests/admin-workbench-interactions.test.cjs`。该用例核原待办交互、期间边界、权限定位和本模块请求／旧范围拒绝行为。浏览器、真实 HTTP／数据库／支付与完整宿主验收由对应宿主阶段提供证据。[定向用例](../../../../tests/admin-workbench-interactions.test.cjs)
