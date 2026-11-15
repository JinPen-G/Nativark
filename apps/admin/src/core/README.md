# Core 页面适配

这个入口把 `@rental-os/core-contracts` 的页面与操作声明接到当前 React 后台的原组件。Core作者提供正文、路由信息和业务方法，框架呈现标题、按钮、加载及确认反馈。正式源码入口为[本目录index](index.ts)，Core从 `@rental-os/admin/core` 导入，当前后台内部也可使用 `@/core`；这是现有React构建的源码包出口，独立前端发行仍待宿主拆分。

## 页面只声明当前操作

下面是页面代码的最小形态。`openEditor`由业务打开自己的编辑器，不会在打开时创建记录。

```tsx
import { CorePage } from "@rental-os/admin/core";

export function TicketsPage() {
  return <CorePage actions={[{
    id: "create",
    label: "新建工单",
    kind: "open",
    emphasis: "primary",
    permissions: [{ resource: "ticket", action: "create" }],
    open: openEditor
  }]}>
    {/* 这里放本Core的列表/详情正文，复用原Table、QueryState等适配。 */}
  </CorePage>;
}
```

页面的名称只在路由描述中填写，`CorePage`从宿主当前注册项读取。`actions`随实际业务状态变化，离页后自动从原页头卸载；每页操作ID唯一，最多一个`primary`。没有操作时传空数组或省略，不保留业务按钮占位。

| kind | 业务填写 | 实际呈现 |
| --- | --- | --- |
| `navigate` | `to: { coreId, pageId, params? }` | 原Button，按登记目标和当前权限导航 |
| `open` | `open` | 原Button，仅打开表单或弹窗 |
| `command` | `execute`，可选`confirmation`和`confirmTone` | 原ActionButton或ConfirmAction，等真实Promise后反馈 |
| `save` | 当前`form`及`onSave(values)` | 原SaveButton，先校验再等待同一业务请求 |

业务请求要返回`mutateAsync`等真实Promise；业务拒绝必须抛错，HTTP成功但业务`ok=false`也要在本Core的类型化API层转成失败。领域错误、金额和unknown由Core解释，适配器不猜测返回对象或自动重试。普通失败使用原反馈入口，字段校验保留原Form提示，确认失败保留原ConfirmAction状态。需要常显的业务限制放正文，不能只放瞬时提示。

`disabled`和`disabledReason`表达当前不可用状态，附加`permissions`交给宿主判断显示；最终动作仍由服务端授权。动态命令标签可传原 `ActionButtonIntent` 的 `intent`，不自行写图标规则或CSS。危险命令显式声明确认文案和 `confirmTone: "danger"`。

## 列表只提供业务列和读取结果

`CoreList`复用原Table、筛选工具栏、分页、加载和QueryState。提供稳定rowKey、业务列、当前查询结果与分页状态，Core仍负责自己的schema、可见范围和实际请求。服务端返回 `{ rows, total }`，total与正文使用相同筛选和授权范围；只有数组的接口可继续用原Table，不把数组长度当作总数。[列表适配](CoreList.tsx)

```tsx
import { CoreList } from "@rental-os/admin/core";

<CoreList query={query} queryKey={queryKey} rowKey="id" columns={columns}
  pagination={{ offset, limit, onChange: (next, size) => { setOffset(next); setLimit(size); } }}
  controls={filters} />;
```

`query`来自本Core原useQuery，包含data/isPending/isFetching/error/refetch；分页默认条数由本Core明确选择，条数变化沿原分页回首页，筛选变化也应重置offset。服务端的一页不再本地截取/排序，未提供服务端排序合同默认关闭；导出/批量按自己的正式接口另接。首次加载只显示Table数据区骨架，首次读取失败显式提示；刷新失败或读取中暂停旧行操作。总数缩小后只读回有效页，不重发业务动作。宿主仍负责当前身份与Core页面权限。[实际工单分页](../../../../packages/example-tickets-core/admin/index.tsx)

## 保存保留原 Form

将 `CorePage`放在表单内部，让原页头portal能关联实际Form和回车提交。`useCoreForm`接业务唯一保存方法，按钮用 `editor.submit`，Form展开 `editor.formProps`，无需分别维护提交状态和错误事件。[表单Hook](useCoreForm.ts)

```tsx
import { CorePage, Form, Input, UnsavedChangesGuard, useCoreForm } from "@rental-os/admin/core";

type Values = { subject: string };

export function TicketEditor() {
  const [form] = Form.useForm<Values>();
  const permissions = [{ resource: "ticket", action: "create" }];
  const editor = useCoreForm({ form, onSave: saveTicket, permissions });
  return <Form form={form} layout="vertical" {...editor.formProps}>
    <UnsavedChangesGuard dirty={editor.dirty} busy={editor.busy} />
    <CorePage<Values> actions={[{
      id: "save", label: "保存", kind: "save", emphasis: "primary",
      form, onSave: editor.submit, disabled: editor.busy, permissions
    }]}>
      <Form.Item name="subject" label="标题" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
    </CorePage>
  </Form>;
}
```

以上`saveTicket`/`openEditor`需要本Core自己的实现，例子不是已接通的工单业务。SaveButton及Form先校验，`submit`等待真实保存Promise；同一输入同步重入共用一次请求，等待中换输入不能另发。Form事件中的异步失败使用原反馈，直接调用submit仍向调用者拒绝。`dirty/busy/error`供业务呈现，恢复初始值可解除未保存状态；校验或保存等待中的新输入保留为草稿，离页/身份变更或撤权后的旧结果不标为已保存。主动调用submit前须自行使用 `form.validateFields()`，它接收的是已校验值。

业务转换、冲突和unknown继续由Core解释，不在Hook猜测响应或重试。已可信读取原收据且当前草稿对应原操作时，才调用 `markClean()`，不能以按钮点击或超时清稿。工单新建和详情分派页已有实际消费，unknown后保留原键只读核对，原结果暂缺不会重发；同页另一业务动作的成功不代表这份表单已保存。已确认的业务收据与后续查询刷新分别处理，刷新失败沿只读查询恢复。[工单表单](../../../../packages/example-tickets-core/admin/index.tsx)

## 请求和缓存沿用公共边界

`useCoreRequest()`返回原HTTP封装的`request`与当前Core/会话/页面代次的`queryKey`。请求只传Core内路径如`/tickets`，它补 `/cores/<id>`，查询参数单独传`params`；不允许外部URL、上级路径或借其他Core前缀。返回值是原平台`{ data, requestId }`中的data，调用方用业务schema核对响应。

请求仍经原Axios身份/刷新/信封，不另建客户端；离页、宿主代次变化会中止原请求，响应返回后再核会话代次和当前页面权限。React严格模式清理再挂载会建立新的中止信号，不把旧已中止信号带入新页面。该前端限制不授予服务端权限，也不能判断中止的业务写入是否已经提交。

Core使用`queryKey`作为自己的查询前缀。正常列表、表单与详情复用本出口的原Table、QueryState、Form及UnsavedChangesGuard；已装配的业务需要取消/核对时由自身原操作收据负责，不在通用请求层重做。实际使用示例见[工单页面与首次设置](../../../../packages/example-tickets-core/admin/index.tsx)，没有另建壳或按钮样式。

## 管理Core开通与成员分配

SaaS租户资料中使用 `CoreTenantGrantPanel`，租户成员资料中使用 `CoreMemberAssignmentPanel`。传入当前已读取的对象与Core的id/name，面板从原会话判断可见管理面，再通过服务端读取当前授权及修订。两个管理动作分别保存，新Core不会自动分配全员。[管理面](CoreAccessPanel.tsx) · [同源HTTP消费](management-client.ts)

```tsx
import { CoreTenantGrantPanel, CoreMemberAssignmentPanel } from "@rental-os/admin/core";

// 平台租户资料页，tenant和core来自实际读取。
<CoreTenantGrantPanel tenant={tenant} core={core} />;
// 本租户成员资料页，member来自原成员目录。
<CoreMemberAssignmentPanel member={member} core={core} />;
```

开通/分配先读当前修订，停用/撤回显示对象和后果并确认。界面未保存业务表单，不另挂一个路由离开拦截器。发送前将原请求定位写入当前标签的sessionStorage，按原操作者、租户、对象和Core隔离；它只用于刷新或重新进入后核对，不能自授权、自动重发或证明已提交。明确的提交前拒绝解除本次核对引用；网络失败/未知结果只提供“核对原操作”。原收据暂缺时继续保留引用，取得收据后再读取当前状态。

已确认的变更与随后读取分别处理。当前状态或Core目录刷新失败时显示“操作已记录，最新状态尚未读到”，暂停新的变更；“重新读取”只调用原读取，不重发授权/分配。本人使用权变化先取消变更前的目录请求，撤去目标Core的旧可用条目并清理其业务/范围/绑定缓存，再读取真实目录；其他Core缓存保留，给其他成员或租户变更不清理本人的业务数据。完整目录读取失败仍沿原查询和权限边界处理，不把保留缓存当当前授权。同步重复点击只合并同一动作，不同变更、读取或原结果核对不能共用另一动作的成功。

`coreManagementApi`提供登记目录、变更、绑定、当前事实、原收据及会话/范围的类型化方法，使用 `@rental-os/core-contracts` 唯一路径/schema和原HTTP信封。请求与迟到响应受当前会话代次和中止信号限制。可单独在自己的管理页使用这些方法，但不得根据本地缓存或清单开放服务端权限。当前面板和Controller已有真实代码，原主路由/Guard/部署链尚未挂接，浏览器与真实数据库验收仍待完成。

## Core首次设置

Core在自己的配置页使用 `useCoreBinding(coreId, container?)`。Hook先读原绑定，当前租户管理权与成员Core使用权满足后调用 `initialize(configuration?)`；没有初始业务配置的Core省略参数。已有绑定直接复用，业务配置更新仍走Core自己的接口。[绑定Hook](useCoreBinding.ts)

```tsx
const setup = useCoreBinding("my-core");
// 初始化动作返回原Promise；未取得当前状态或存在未知操作时不可提交。
const completeSetup = () => setup.initialize();
const readOriginal = () => setup.reconcile();
```

`busy`、`original`与当前读取/管理权限决定动作。网络或未知结果保留原operationId，只调用reconcile；缺原收据继续保留引用，不能换键重做。本标签sessionStorage只保存Core/容器及原键，不保存初始化配置或权限；刷新/重入仍读服务端收据。身份/Core范围变化中止旧请求，已有修订不被当成新的初始化。成功先刷新原绑定、标记范围查询失效，下次访问重新读取实际就绪。

配置页面声明 `purpose: "configuration"`，用原CorePage呈现动作；公共壳与服务端授权仍沿原宿主。实际示例是工单设置页，它没有业务初始化配置，完成绑定后再进入工单。当前主AppRouter/Guard尚未接线，这些源码和离线验证不能称为已运行的完整接入。

## 读取登录成员的Core目录

`useCoreSession()`从 `coreManagementApi.sessionContext(signal)`读取原服务端的本人Core目录，复用认证会话与原查询缓存，identity/tenant/session代次进入查询键。未验证会话或读取失败时不返回旧目录供页面授权；当前精确权限通过 `canAccess(coreId, permissions)`查询。[Hook](useCoreSession.ts) · [合同](../../../../packages/core-contracts/src/session-http.ts)

`data.cores`用于过滤受控注册的业务入口；`data.assignable`仅是当前租户管理者可给成员分配的Core候选，可供上面的成员面板选择。`tenantHasRegisteredGrant`区分联系SaaS管理员开通与联系租户管理员分配。业务配置、范围及真实就绪仍由宿主/所属Core核定，不能只把这个Hook赋给恒真可用性。原主壳/路由未接线时，这些源码不表示无Core后台已经运行。

## 宿主只装配一次

受控组合先用 `registerCoreAdminPages`登记各Core贡献，再在原Routes中展开 `createCoreRouteElements(pages, { brandName, containers? })`。原RequireAuth、AppShell和WorkspaceHeader仍是唯一外壳；新Core只加自身贡献到组合，不给每个Core复制菜单或路由实现。[路由适配](CoreRoutes.tsx)

```tsx
// pages是受控registerCoreAdminPages的成功结果；放在原已认证Routes内部。
<Routes>
  {existingRoutes}
  {createCoreRouteElements(pages, { brandName })}
</Routes>;
```

路由先读本人Core/页面权，再读实际Core范围和就绪；未获权或失败读取不挂载业务正文。Core页面通过 `routeParams` 可选prop或 `useCorePageHost().params`取得当前已匹配的登记参数，绑定通过同一host读取。成员授权、角色/范围/绑定或对象变化使业务页代次变化，清理旧动作与表单。配置页面可在元数据声明 `purpose: "configuration"`，在获权且范围读取成功的未绑定/配置缺项状态仍能进入；它自己的动作继续核原权限及服务端校验。

菜单使用 `coreNavigationEntries(pages, context, locale)`，面包屑使用 `coreBreadcrumbEntries(pages, page, params, context, locale)`，均由同一份页面描述生成，当前无权父页只显示名称不带链接。主壳/路由/面包屑总消费尚未接线，需原公共窗口一次性装配；这些源码验证不替代实际浏览器验收。

宿主可用 `useCoreScope(coreId, container?)`读取当前Core自己的绑定及就绪。结果按原租户/成员/Core/容器和会话代次隔离，未验证或失败读取不返回旧准入结果；`ready`仅在当前真实bound/ready结果成立。先以 `useCoreSession`核成员/页面权，再将Core范围结果用于业务页面准入。配置缺项/未绑定分别给出正式配置入口，不能补空成功；最终API仍重新授权。[范围Hook](useCoreScope.ts)

`CorePageHostProvider`接收[CorePageHost](CorePage.tsx)并包裹对应业务路由。`page`须直接来自`registerCoreAdminPages`返回的`pages`；宿主提供平台品牌、原路由导航、当前授权判定和`lifetimeKey`。key取原会话/租户/Core范围及当前业务对象代次，变化时释放旧页面；权限变更仍需原宿主订阅当前事实。不要用自己填写的恒真函数或清单权限数组实现`canAccess`。

`canAccess(coreId, permissions)`必须同时核对租户Core授权、适用成员分配及额外业务权限。当前页无权时只呈现原Result，不渲染业务正文；动作执行前再次读当前判定，确认等待和已离页回调不能沿旧授权继续。这个前端判断不能代替服务端Guard，也不建立新的身份或查询缓存。

现有宿主提供 `WorkspaceHeaderProvider` 的标题/动作目标后，原 `PageHeading`自动把标题和按钮呈现到顶部面包屑行，保留对应Form上下文；独立页面仍沿原PageHeading回退。公共左栏、铃铛、休息和面板收展继续由外壳负责，无需Core声明。

**当前有真实React适配源码，AppRouter/导航及服务端Core授权尚未接线。** 不把该入口称为已运行的无Core后台或可直接安装的业务样例。当前证据为类型/离线映射和原保存组件行为，实际portal/回车/响应式及登录后页面仍待实页验证。包配置的predev/prebuild/prelint会先构建本树core-contracts，避免深层源码别名或依赖另一棵树的dist；这里没有执行应用启动。

源码路线为[路由/动作合同](../../../../packages/core-contracts/src/admin.ts) → [CorePage](CorePage.tsx) → 原[PageHeading](../components/PageHeading.tsx)/[WorkspaceHeader](../components/workspace/WorkspaceHeader.tsx) → 原[ActionButton/SaveButton](../components/ui/ActionButton.tsx)/[ConfirmAction](../components/ui/ConfirmAction.tsx)。列表/详情/查询沿[UI出口](../components/ui/index.ts)、[QueryState](../components/QueryState.tsx)和[界面规范](../../../../docs/公共技术资料/界面规范/管理后台-界面规范.md)，不通过页面JSON建立第二套渲染器。
