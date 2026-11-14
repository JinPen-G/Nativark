# Core 页面适配

这个入口把 `@rental-os/core-contracts` 的页面与操作声明接到当前 React 后台的原组件。Core作者提供正文、路由信息和业务方法，框架呈现标题、按钮、加载及确认反馈。正式源码入口为[本目录index](index.ts)，当前工程内从 `@/core` 导入；以后独立前端包沿此边界抽取。

## 页面只声明当前操作

下面是页面代码的最小形态。`openEditor`由业务打开自己的编辑器，不会在打开时创建记录。

```tsx
import { CorePage } from "@/core";

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

## 保存保留原 Form

将 `CorePage`放在表单内部，让原页头portal能关联实际Form和回车提交。业务只保留一个保存方法，按钮和Form沿同一值转换/请求。

```tsx
import { CorePage } from "@/core";
import { Form, Input } from "@/components/ui";

type Values = { subject: string };

export function TicketEditor() {
  const [form] = Form.useForm<Values>();
  return <Form form={form} layout="vertical" onFinish={saveTicket}>
    <CorePage<Values> actions={[{
      id: "save", label: "保存", kind: "save", emphasis: "primary",
      form, onSave: saveTicket
    }]}>
      <Form.Item name="subject" label="标题" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
    </CorePage>
  </Form>;
}
```

以上`saveTicket`/`openEditor`需要本Core自己的实现，例子不是已接通的工单业务。SaveButton复用原同步防重复、校验、原Form关联和保存快照，异步失败不标为已保存；等待中的新输入不被旧保存回执抹除。

## 宿主只装配一次

`CorePageHostProvider`接收[CorePageHost](CorePage.tsx)并包裹对应业务路由。`page`须直接来自`registerCoreAdminPages`返回的`pages`；宿主提供平台品牌、原路由导航、当前授权判定和`lifetimeKey`。key取原会话/租户/Core范围及当前业务对象代次，变化时释放旧页面；权限变更仍需原宿主订阅当前事实。不要用自己填写的恒真函数或清单权限数组实现`canAccess`。

`canAccess(coreId, permissions)`必须同时核对租户Core授权、适用成员分配及额外业务权限。当前页无权时只呈现原Result，不渲染业务正文；动作执行前再次读当前判定，确认等待和已离页回调不能沿旧授权继续。这个前端判断不能代替服务端Guard，也不建立新的身份或查询缓存。

现有宿主提供 `WorkspaceHeaderProvider` 的标题/动作目标后，原 `PageHeading`自动把标题和按钮呈现到顶部面包屑行，保留对应Form上下文；独立页面仍沿原PageHeading回退。公共左栏、铃铛、休息和面板收展继续由外壳负责，无需Core声明。

**当前有真实React适配源码，AppRouter/导航及服务端Core授权尚未接线。** 不把该入口称为已运行的无Core后台或可直接安装的业务样例。当前证据为类型/离线映射和原保存组件行为，实际portal/回车/响应式及登录后页面仍待实页验证。包配置的predev/prebuild/prelint会先构建本树core-contracts，避免深层源码别名或依赖另一棵树的dist；这里没有执行应用启动。

源码路线为[路由/动作合同](../../../../packages/core-contracts/src/admin.ts) → [CorePage](CorePage.tsx) → 原[PageHeading](../components/PageHeading.tsx)/[WorkspaceHeader](../components/workspace/WorkspaceHeader.tsx) → 原[ActionButton/SaveButton](../components/ui/ActionButton.tsx)/[ConfirmAction](../components/ui/ConfirmAction.tsx)。列表/详情/查询沿[UI出口](../components/ui/index.ts)、[QueryState](../components/QueryState.tsx)和[界面规范](../../../../docs/公共技术资料/界面规范/管理后台-界面规范.md)，不通过页面JSON建立第二套渲染器。
