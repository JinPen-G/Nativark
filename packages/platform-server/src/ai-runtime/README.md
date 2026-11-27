# 公共任务 Runner

从 `@rental-os/platform-server/ai-runtime` 使用原 AI Native 的任务 Runner。这个出口只依赖公共任务状态和宿主端口，支持 Core 自己的工具标识；导入、构造不会加载 Rental、Prisma Client、Provider SDK、HTTP 或后台作业。

```ts
import { createPersistentAiTaskRunner, type AiTaskRunnerDependencies }
  from "@rental-os/platform-server/ai-runtime";
```

宿主提供当前授权、正式计划、原租约、步骤仓储、业务效果及累计资源端口后，调用 `createPersistentAiTaskRunner(dependencies)`，再用原任务和 Run 的领取参数调用 `runner.run(input)`。普通 Core 不需要此出口。无 Core 的公共后台不会因此开放通用 Agent。

## 接入顺序

1. Core 把自己的事实读取、正式动作、必要批准和原结果读取接到 `effects`；只使用受控注册的计划与工具版本，最终业务裁定仍由 Core 完成。
2. 宿主提供 `leases`、`steps`、`plan` 和 `resources` 的真实持久化参加者，并在相应授权和提交点复验租户、成员、对象、Core状态及修订。需要聚合提交、人工输入或确认继续时，再提供对应可选端口。
3. 原 Gateway 负责模型财务预占和结算，任务资源端口维护 steps、calls、active time、output bytes 的累计记录。Runner 只协调已有参加者，不创建第二套账或模型运输。

`createPersistentAiTaskRunner` 缺 `resources` 时明确拒绝。原 `createAiTaskRunner` 保留隔离 Runner 消费者的兼容入口；省略持久化资源端口不能作为生产任务、业务授权或用量依据。

## 源码与实际消费者

| 位置 | 职责 |
| --- | --- |
| [组合入口](ai-task-runner.module.ts) | 构造同一 Runner，核持久化资源端口；不注册路由、计时器或工具 |
| [Runner](ai-task-runner.service.ts) | 根据原受权计划和 fencing 租约推进步骤、暂停、恢复、取消和确认继续；不直接调用业务库或供应商 |
| [业务及存储端口](ai-task-runner.ports.ts) | 由宿主提供实际计划、步骤、效果、原结果与累计资源；工具字符串不能作为动态代码路径 |
| [准备资源端口](task-run-preparation.ports.ts) | 关联原准备、预占和同一租约；原收据不是新的执行时钟或额度 |
| [公共任务状态](../../../platform-contracts/src/ai-task.ts) | 原任务/步骤状态、版本及结果的单源；shared草案继续再导出 |
| [原持久化组合](../../../ai-native-server/src/runtime/runner/persistent-task-runner.composition.ts) | 通过兼容出口使用本 Runner；真实仓储、批准、Gateway及业务适配仍由所选宿主供给 |
| [所选 Rental AI 宿主](https://github.com/JinPen-G/Zelo-rental-core/blob/dfb929a71e9e5802c0077ca8552f38f7b301f604/workspace/apps/rental-api/src/ai-composition.ts) | 复用当前原 Auth/Guard/任务与业务实例，不重建运行器或清空旧任务 |

原 `ai-native-server/runtime/runner` 和 API 路径再导出本包的同一 Runner 与错误类，保持 `instanceof`、held preparation、原租约和结果处理语义。原 SQL 结果中的 Prisma 正文类型留在其私有适配；公共 Runner 合同没有 ORM 或行业实体。

`unknown`、取消和等待超时均不证明回滚或可以重发。恢复仍使用原 task/run/action、当前权限、fencing、工具版本及原收据；累计资源不能清零。`readInterrupted` 只读原持久化收据，`reconcile` 也不能被替换成第二次执行。

人工输入的等待提交失去应答时，`inputs.afterSucceeded` 只能在当前权限下读回原问题摘要、原转换、Task/Run 修订及仍持有的同一 fencing 租约后，返回 `input_wait_commit_observed`。Runner 据此关闭当前仍在运行的原计量段，调用仍返回 `AI_RESULT_UNKNOWN` 并要求核对原收据；不释放租约或重提问题。原证据不可读或已变化时，计量占用保持未知，不生成新的完成事实。相关行为见[输入持久化与恢复用例](../../../../tests/ai-native-task-input-persistence.test.cjs)。

此出口覆盖通用任务推进。现有完整 AI 请求工厂、模型 Gateway、数据与场景适配的装配范围分别见 [AI 服务端](../../../ai-native-server/README.md)；Core 的 AI 贡献仍须受控发布和当前授权，不能通过 Runner 扫描 API 自动补工具。

验证复用 [原七项 Runner 用例](../../../../tests/ai-native-c04-task-runner.test.cjs)及 [所选源码类型入口](../../../../scripts/check-selected-prisma-types.cjs)。公共包按自己的 `tsconfig.json` 构建；持久化、模型和真实业务环境的验证按所选宿主办理。
