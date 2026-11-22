# Rental 订单后台

订单列表、新建、详情及配货、资金、单据、承运和换货检查共用包内业务实现。原组件、字段校验、金额精度、历史快照、归还批次和原操作收据沿原逻辑维护。

## 接入入口

- [页面贡献](index.tsx)绑定当前宿主上下文，[页面声明](pages.ts)供路由、菜单和面包屑共用。
- [请求工厂](client.ts)复用宿主唯一认证请求，直接读取方法支持取消信号。
- [页面上下文](page-context.tsx)绑定当前已验证会话、Rental 经营空间、原权限、原单次请求和现有引用库，并由宿主供给客户预览、商品图片和 AI 事实入口。
- [原列表入口](../../../../apps/admin/src/features/rental-core/RentalOrdersPage.tsx)、[原新建入口](../../../../apps/admin/src/features/rental-core/RentalOrderCreatePage.tsx)与[原详情入口](../../../../apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx)通过薄适配消费同一实现，保留旧深链接。

宿主使用 `createRentalOrderPageContext` 固定页面的会话与范围。上下文的 `requestOriginal` 复用公共 HTTP 的单次模式，`references` 绑定[公共引用库](../../../platform-admin/src/operation-reference.ts)。三个换货 hook 在派发前保留原键，恢复沿原查询与收据进行。

订单和[养护工单](../work-orders/README.md)通过[Rental 贡献组合](../index.tsx)登记为同一个 Core。宿主通过已登记目标处理列表、新建、详情和养护导航。新建页面使用订单列表作为父级，继承原创建权限和 `/rental/orders/new` 兼容地址。

## 公共接点与装配

包配置提供 `admin/orders`、`admin/orders/client`、`admin/orders/logic` 与 `admin/orders/pages` 正式出口，分别指向 `index.tsx`、`client.ts`、`logic.ts` 和 `pages.ts`。后台类型配置同时包含贡献组合、订单和养护页面。旧宿主的列表、新建与详情导航均投影本模块声明，公共配置与最终授权映射由宿主装配维护。

[旧宿主适配](../../../../apps/admin/src/features/rental-core/legacy-order-context.tsx)从同源页面声明投影旧路径和权限，绑定原 `adminRuntime`、实际 AuthStore、原跨领域组件及引用库。订单编辑以打开代次隔离异步校验。原生提交直接等待本代次的 `validateFields`，按钮、回车与浮层确认共用公共表单保存方法。实际请求在途时保留编辑对象，失败保留原输入与未决引用。

`requestOriginal` 使用公共请求的 `retryAuthentication: false` 保持原单次派发，继承同一会话取消与迟到响应围栏。操作引用库从公共 `forms` 出口接入，原引用路径保留同源兼容转接。

确认订单、领取、归还与结算的阶段主动作由当前 `CorePage` 声明，通过 `CorePageActions` 放回原正文流程区。报价和创建保留原报价卡片的大尺寸满宽按钮，创建成功后的查看订单和继续新建保留原 `Result.extra` 位置，返回通过 `navigation` 槽位保留正文起点的原 text 按钮，继续使用当前登记的订单列表目标。`data-core-page` 与 `data-core-action` 共同限定定位目标，供订单 `action` 深链接聚焦当前可见的实际操作入口。禁用入口使用可聚焦容器，`allocation` 定位原配货分区。用户确认、业务执行及原结果读取沿原方法分别进行。

领取／归还检查先等待原办理锁和刷新结果，再打开原表单，失败保留原反馈并返回 `false`。同阶段、同归还批次共用在途 Promise，准备期间的其他批次返回 `false`。派发前、办理锁返回后和刷新完成后均复验原页面身份，卸载后的迟到响应停止写入 token、打开表单和播报旧错误。已确认的原办理 token 保留在原存储中，供原办理流程核对。

检查打开动作声明真实 `pending`，手动开始／结束办理和部分归还入口共用准备状态。公共打开驱动同步调用 `open`，订单准备等待和防重由本模块承担，通用异步打开合同仍由公共装配维护。直接交接、确认和结算返回原命令 Promise。

## 新建报价与客户原委托

[新建页面](RentalOrderCreatePage.tsx)复用原会员、预约身份、地址、租期、定价分组、优惠和增值服务控件，所有读取键绑定当前会话与 Rental 范围。先通过公共保存按钮或原生回车等待字段校验及服务端报价，再通过当前页命令提交该报价的原快照。创建后的列表、详情和继续新建动作沿正式页面声明处理。

[表单绑定](useOrderEditor.ts)保留原 `validateFields` 的字段与选项两种重载。同一编辑代次复用绑定对象，查询刷新期间的校验继续使用原对象。会员、字段或增值服务改变时清除已显示报价，旧代次的响应保持隔离。创建请求在途时保留输入，失败原因显示在原表单中，按钮使用公共等待与失败反馈。

[客户委托面板](EnterpriseMerchantOrderDelegationPanel.tsx)与[原来源 hook](enterprise-merchant-order-delegation.ts)读取客户已签原 D，分别处理来源核对、明确执行和 Core 原结果读取。原企业管理及订单操作权限、浏览器引用协调、来源字段核验和历史存储键继续生效，单次传输使用上下文 `requestOriginal`。执行结果为 `unknown` 时保留同一 D，后续从原结果入口核对。

## 验证入口

复用[订单列表呈现](../../../../tests/rental-order-list-presentation.test.cjs)、[订单命令边界](../../../../tests/rental-order-command-review.test.cjs)、[日期时间消费者](../../../../tests/admin-datetime-range.test.cjs)、[服务原引用](../../../../tests/rental-service-execution.test.cjs)和[企业消费者](../../../../tests/enterprise-consumers.test.cjs)的现有断言，类型检查消费正式包出口。列表语言呈现与原型同名文本的回退语义由[公共语言入口](../../../platform-admin/src/app/locale.tsx)提供。

宿主验收分别核对浏览器、真实 HTTP／数据库、对象存储及完整标准 Core 装配。
