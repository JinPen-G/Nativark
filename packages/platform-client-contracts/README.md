# 可选客户端合同

`@rental-os/platform-client-contracts` 定义客户网站、员工门店 Web、微信客户和微信员工的贡献与页面寿命。业务代码仍由独立 Core 提供，客户和员工分别装配，不接受 `operator` audience。普通底座和未选择这些端的 Core 不依赖本包。

[合同](src/contracts.ts) → [页面寿命](src/runtime.ts) → [一次派发及原收据](src/operations.ts) → [展示状态](src/view.ts)。Web 与微信消费者沿同一正式出口接入。`CorePrincipal` 沿 `@rental-os/core-contracts` 正式出口复用。

## 由宿主提供的原权威

- `ClientSessionPort` 委托原客户或员工 Auth；账号、令牌签发/存储、刷新、租户/空间切换和撤销都留原实现。本包只接受已验证的非敏感会话投影。`sessionRevision` 在重新登录时变化，`authorizationRevision` 在角色或数据范围变化时变化，已验证地点单独携带。
- `ClientAccessPort.authorize` 在读取/动作前与交付前重新核当前 Core、受众、成员、对象与范围。它不得根据前端声明权限、菜单或缓存恒真放行；服务端仍独立拒绝未授权请求。原收据使用独立 `original_receipt` 目的，不要求已停用 Core 重新开放普通业务。
- `ClientContribution` 显式登记稳定 Core/版本及命名空间内路由、列表读取和动作；只有 `navigation: true` 进入顶层导航，详情通过带参数的登记目标进入。不扫描 API 或接受任意 URL、HTML、SQL。扫码只定位登记路由，服务端另核当前对象。
- `ClientOperationStore` 持久保留业务原键、动作和目标定位，不保存凭据或业务正文；按当前 audience/tenant/本人/空间/地点分区。不要将 sessionRevision 当作持久存储分区，否则重新登录会丢失待核操作。可复用 `clientOperationOwnerKey`；本地分区不是原收据授权。

`ClientLifetime` 不依赖 DOM 或微信全局。运输可通过 `onCancel` 取消本次网络请求，但取消不证明已派发的业务回滚。`current/assertCurrent` 必须在原认证适配采用登录/范围响应之前使用；通用层不能替原 Auth 阻止其内部错误地保存旧令牌。

## 切换与恢复

调用 `createClientRuntime({ surface, session, access, contributions })`。页面用 `read`，路由直达与菜单进入采用相同准入；`scan` 的返回只允许登记目标。默认没有业务缓存。相同页面新查询、会话变化、退出、切范围或 `invalidate` 会作废原读取，迟到成功和迟到 401/403 都以 `stale` 丢弃，不能清空新会话。

`signIn/signOut/selectScope/refresh` 委托原会话端口并立即隐藏旧业务。切换候选只能由 `scopeChoices` 的原服务提供，采用后以原会话观察为准。外部撤权/停用事件由原宿主更新会话修订或调用 `invalidate`；每次业务和返回前仍检查真实权威。退出调用的原适配必须同步清本机私有数据，之后才等远端撤销，不能让旧撤销结束清掉新登录。

原会话复核抛出 `ClientError("anonymous")` 时回到登录入口；其他缺权威或服务错误保持不可用，用户可委托原退出后重新登录。会话/范围复核清除对象定位后回到登记首页，不留下缺参数的详情页；明确等待登录的深链仍由新会话复权。此处理不创建身份或采用未经原服务验证的凭据。

`createClientOperations(runtime, store)` 在准备前复权，Core 提供原键和绑定后的 `execute`。先持久保存定位，再只派发一次；同一范围/动作存在待核引用时禁止再次准备。`unknown` 只保留原引用，`readReceipt` 只调用所属 Core 的原读取，不换键或执行。来源改变、未保存输入或状态修订冲突由 Core 拒绝，界面不重算业务事实。原结果已观察但本地定位清理失败不会把 recorded 改成 unknown。

原页面可提供 `actionBasis` 安全版本/预览定位，展示协调在动作准备时原样传递；它不是权限、批准或用户任意填写的版本。Core 必须拒绝已变化的依据，必要时沿原确认/批准流程。持久化等待属于原动作寿命，等待期间切页/切身份后不再派发；已保留定位仍由原收据决定结果。

## 接入与验证边界

`createClientView` 为各端提供同一订阅快照；切身份/范围同步清页面、输入、搜索和动作反馈，未知结果只保留隔离存储中的原定位。`suspend/resume` 供后台/前台生命周期使用。`createClientOperationStore` 只持久化投影后的原引用，损坏定位不会静默删除以绕过待核门槛；宿主应按端和可信 API 来源提供独立命名空间，防止切换服务器后误读旧原键。命名空间会编码，不是权限。跨标签并发最终仍由 Core 原幂等与版本规则保证。

本包为可选源码候选，根 workspace/lock 已显式登记；单独准备同版依赖后使用 `npm run build` 或 `npm run lint`，不隐式安装依赖、启动服务或迁移。本包构建配置包含 DOM 类型以核对上游公共合同源码，运行代码不读取 window、AbortController、Storage 或 wx。

Zelo 接入基线为 `d6ccb0dcad63ee2e06043b71c2651f326c7e8e3a`，首个业务贡献来自独立 Rental；当前固定双仓组合、实际接线与缺口统一见[客户端模板](../../templates/platform-clients/README.md)。业务页面/API 不复制到本包。类型和进程内宿主替身不能代替真实 Auth、撤权、数据库、微信开发者工具或真机验收。
