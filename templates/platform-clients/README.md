# 按需选择的客户端模板

客户网站、员工门店 Web、微信客户和微信员工是四个独立装配入口；选择一个端不启用其他端，零 Core 底座不加载这些模板。公共合同来自 `@rental-os/platform-client-contracts`，Web 视觉外壳来自 `@rental-os/platform-client-web`。租赁页面、HTTP 映射与业务规则继续位于独立 Rental 仓库。

基线：Zelo `d6ccb0dcad63ee2e06043b71c2651f326c7e8e3a`；Rental `1ca7374a64db65bada538254cc95aba7950ea588`。模板与合同是候选源码；尚未形成已发布的客户端发行资产，不能以模板编译或离线替身冒充 A03 实际业务验收。

## 宿主必须提供

1. 原客户或员工 `ClientSessionPort`：非敏感主体与会话/权限代次、当前 tenant/workspace、服务端验证的 location、原登录/退出/刷新及范围切换。客户和员工使用独立入口、会话与缓存。旧登录/切换响应在采用令牌前检查 `ClientLifetime`；退出同步清私有数据，迟到撤销不能清除新会话。
2. `ClientAccessPort`：从当前正式权威核 Core 安装/启用/发布、audience、成员/角色、对象与字段范围。`request`、`reference` 是对象定位输入，不是授权。普通业务和原收据目的分别检查；菜单可见、已登录、旧缓存都不构成放行。
3. `ClientContribution[]`：固定版本的登记路由、页面读取、搜索/扫码、动作准备和原收据读取。业务写入绑定原输入、目标、版本与事实。准备只分配/沿用原操作键，不执行写入；派发失应答保留原键，不更换键重试。

缺少任一真实接点时保持 unavailable。模板没有模拟账号、管理员替代身份或恒真授权。生产端口与 Core 原服务仍负责真正的跨租户、跨地点、字段和动作约束；UI 隔离只是客户端防护。

## Rental 最小接线请求

以下文件/出口是交给 Rental 原作者协调的**请求**，不表示固定版本已经存在，也未在本仓实现或修改：

| 请求位置 | 最少职责与正式来源 |
| --- | --- |
| Rental `clients/platform/customer.ts`，正式 `@rental-os/rental-core/clients/platform/customer` 出口 | 贡献“我的订单 → 订单详情 → 取消订单”；复用现有 `/clients/website`、`/clients/miniprogram` 的工厂，API 走 `/api/client/v1`，受众必须 `client`。 |
| Rental `clients/platform/staff.ts`，正式 `/clients/platform/staff` 出口 | 贡献“养护工单 → 工单详情 → 开始处理”；复用 `/clients/staff` 的 `createRentalStaffWorkOrdersApi`，API 走 `/api/staff/v1`，受众必须 `staff`，核当前 workspace/location。 |
| Rental 原 Web / 微信宿主的 session 适配正式出口 | 包装原客户 `@rental-os/web-client` 会话与原微信客户会话、员工原 Auth/session-context。保留原令牌逻辑，补生命周期采用检查及非敏感投影；通用层不接管 Auth。 |
| Rental 原当前准入投影出口 | 逐次取得 Core 开关/客户端发布、当前 audience/tenant/角色/对象/字段范围与修订；服务端仍独立拒绝。原收据需独立读取许可，即使普通 Core 已停用也不以缓存自行放行。 |

需要原作者确认或补齐的实际调用点：

- 客户列表：`createRentalWebsiteSessionClient().myOrders()` 对应 `GET /my/orders`；详情 `order(id)` 对应 `GET /orders/{id}`。小程序 `cancelOrder(orderId, reason, idempotencyKey)` 对应 `POST /orders/{id}/cancel`；`POST /orders/{id}/cancel/preview` 提供原预览。请固定适用于 Web/微信客户的正式普通取消工厂，明确目标版本/事实绑定、原幂等键与失败语义。
- **客户普通取消的原收据读取缺口**：固定版本未找到可由普通客户按取消原键读取结果的公开入口。请提供确切 export/method、API、当前本人范围与返回 `recorded/rejected/unknown` 的权威依据。不得拿当前订单状态、企业专属收据或 AI booking 收据替代。
- 员工列表：`listWorkOrders()` 对应 `GET /rental/v1/work-orders`；`startWorkOrder(id)` 对应 `POST /rental/v1/work-orders/{id}/start`。**固定方法未显式接收原操作键，也未找到该动作普通原收据读口**；请确认原幂等/版本约束、补可传原键的正式方法及对应收据读取。现有 inspection/handover 的 fulfillment receipt 不等于养护开始收据。
- 员工 Auth 现有 `login`、`switchWorkspace` 工厂内部直接 `saveSession`；需在采用旧响应前消费 `ClientLifetime` 或原等价代次。员工微信宿主 `src/core/session.ts` 是宿主内部文件，不能成为 Zelo 深层导入；请提供正式适配出口。范围切换候选只从原服务取得；手填 location 或 URL 不得切换权威范围。
- 会话投影至少需 `audience/tenantId/subjectId/sessionRevision/authorizationRevision`，以及实际适用的 `workspaceId/locationId` 和展示名称。角色、字段和对象范围留原权威；不能用客户端声明生成权限修订或允许结果。

## 剩余实际验收条件

PM 固定 ZP-01 运行组合与 ZP-02 贡献装配后，Rental 原作者提供上述固定出口和版本；再由获授权独立宿主验证客户和员工的登录/导航/真实页面与动作/退出、切身份和地点迟到响应、撤权/停用直达拒绝与 unknown 原收据。Web 桌面、平板触屏、手机窄屏分别记录。

微信需负责人提供客户与员工应用的已授权 AppID/开发者工具访问、请求合法域名及对应独立测试宿主/测试账号，并在两入口分别完成开发者工具与真机操作。AppID/账号在负责人配置处使用，不提交凭据。没有这些条件时可继续类型与离线流程核对，但微信宿主和设备证据明确未验；浏览器不能替代。没有原生 App、收银硬件、离线写业务、数据库迁移或部署承诺。
