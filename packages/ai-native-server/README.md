# AI Native 服务端

本包承接原 AI Native 的请求工厂、Runtime、任务仓储、唯一 Gateway、模型财务账、知识与正文保留实现，以及 Rental 的业务失败出箱参加者。原入口再导出同一实现；拆分不更换状态机、工具、批准、金额规则或未知结果语义。导入和构造不会启动 Worker、清理任务、模型请求或数据库连接。

完整原组合宿主从 [服务装配](../../apps/api/src/application-services.module.ts) 使用这些工厂。[独立 AI 宿主](../../apps/rental-api/src/ai-app.module.ts) 则显式选择 AI 数据贡献，由 [同实例装配](../../apps/rental-api/src/ai-composition.ts) 提供原 Auth、Guard、Core、数据库和文件权限。只有该宿主 [实际登记并审核的处理器](../../apps/rental-api/src/ai-http-policy.ts) 才发布为可调用能力；工厂、类型或合同存在不等于该宿主已开放全部 AI 路由。

## 入口与调用方

| 入口 | 职责与边界 |
| --- | --- |
| [runtime/ai-native-application.providers](src/runtime/ai-native-application.providers.ts) | 原请求与服务工厂的装配入口。公共包、Rental 以及宿主提供原实例；配置、当前权限及真实依赖决定每项能力是否可用。 |
| [runtime/rental-adapters](src/runtime/rental-adapters/prisma.service.ts) | 旧类令牌与窄类型接点。适配器不构造第二个数据库、Auth、Core 或业务状态。 |
| [runtime/task-transaction-authority](src/runtime/task-transaction-authority.ts) | 所选宿主的任务新写在原事务内核 Tenant / Core / 原来源；嵌套调用必须沿同一事务和任务。旧已派发结果继续按原 lease、dispatch token、收据和 CAS 收口。 |
| [runtime/task-start-admission.composition](src/runtime/task-start-admission.composition.ts)、[原场景事务](src/runtime/scenes/original-scene-transactions.ts) | 报价澄清、开业诊断和订单解释沿原请求工厂启动；保留 Guard 形成的身份，在原 Scope/Task/Plan 写入前进入同一 Auth/Core/业务来源参加者。 |
| [runtime/task-input/prisma-task-input.repository](src/runtime/task-input/prisma-task-input.repository.ts) | 保存原回答与原输入收据，显式续程才产生下一 Run。嵌套原收据观察使用只读 RR 快照；写入与取消见证仍由原 Serializable 事务及 CAS 裁定。 |
| [runtime/client-scene.composition](src/runtime/client-scene.composition.ts)、[客户资料与任务事务](src/runtime/scenes/client-selected-transactions.ts) | 所选客户入口保留原 ClientAuth 对象与请求 ALS；同一事务先核会话/Tenant/Core，再核本人订单、发布资料与 Task。参加者仅支持明确登记的场景，不创建营运权限或第二个任务。 |
| [runtime/task-provider-dispatch](src/runtime/task-provider-dispatch.ts) | 在 Vault 等待之后、唯一模型运输之前复核当前任务权威；短事务结束后才执行原外部调用。 |
| [runtime/privacy/prisma-ai-body-storage](src/runtime/privacy/prisma-ai-body-storage.ts) | AI 专属正文视图保留原事务和原密文规则；只按真实所选 Client 的模型关系编解码，不能借默认 Client 的其他 schema。 |
| [runtime/contracts/http-openapi](src/runtime/contracts/http-openapi.ts) | 原 AI 操作及其 schema 的单源合同。独立宿主只发布实际挂载范围，并保留未完善的原合同缺口。 |
| [business-events/prisma-business-failure-outbox](src/business-events/prisma-business-failure-outbox.ts) | `PrismaBusinessFailureOutbox` 参加原检查、退款、通知事实事务。真实失败才写出箱，存储失败继续使业务事务失败；沿用原去重与历史事件失效规则。 |
| [business-events/return-exception-source](src/business-events/return-exception-source.ts) | `returnExceptionSource` 核对原检查版本、唯一异常 ID、原审核状态和来源指纹。缺历史依据不补造失败事件。 |
| [privacy/notification-draft-reader](src/privacy/notification-draft-reader.ts) | 校验原草稿、不可变元数据和 `AiDataErasure` 收据。`createNotificationDraftBodyRetentionReader` 仅使用 `aiDataErasure.findUnique`，不写入正文或删除账。 |
| [privacy/retention-policy](src/privacy/retention-policy.ts) | 原 `AI_RETENTION_POLICY` 与 `retentionDeadline`。策略版本、期限和未决效果约束保持原值。 |
| [task-errors](src/task-errors.ts) | `AiTaskRepositoryError` 的唯一类身份，供旧仓储与独立读取器共同抛出和识别。 |
| [knowledge-fingerprint](src/knowledge-fingerprint.ts) | 原 `fingerprint`：对 `JSON.stringify` 的结果取 SHA-256，保留属性顺序。它与正式 `requestFingerprint` 的排序语义不同。 |

完整 Rental 宿主把同一个 `PrismaBusinessFailureOutbox` 实例交给事实仓储，事务参加者直接使用收到的 transaction。检查、退款和通知链需要真实 AI 表及该实例；不能用空函数、内存替身或缺省成功填补。原 `fulfillment` / `opening` 扩展仍由 `BusinessFailureResourcePorts` 提供真实业务观察和存储能力，提取并不替宿主补齐这些端口。

人工回答保存与执行续程分开处理。Core 撤权后可按原收据权限核对已保存回答，恢复当前授权后才可显式续程；重复续程不追加模型调用。每次派发复用唯一 Gateway 预占和结算，任务累计用量不重置。只读观察不取得对原提交事务的隐式共享锁，也不授权写入或重发。[原事务用例](test/original-scene-transactions.test.cjs) · [原执行与续程用例](test/original-scene-execution.test.cjs)

Rental 的通知缓存和草稿仓储通过 `@rental-os/rental-core/notification-draft` 消费以下组合：

```ts
const retention = {
  state: notificationDraftRetentionState,
  receiptId: notificationDraftRetentionReceiptId,
  createReader: createNotificationDraftBodyRetentionReader,
} satisfies RentalNotificationDraftRetention;
```

读取正常未删除草稿时允许返回 `null`；已删除草稿必须能核对真实删除收据。缺表、缺收据、跨空间、错误来源哈希、超前删除时间，以及已记录删除但恢复了旧密文的行都保持不可用。读取不会重放删除或修改恢复结果。

## 数据与兼容归属

宿主选择 [公共数据](../../apps/platform-api/prisma/schema.prisma)、[Rental 数据](../rental-core/prisma/schema.prisma)及 [AI Native 数据贡献](../ai-native-data/README.md)，使用其组合生成的唯一 Prisma Client。生成和数据准备属于宿主，版本、锁和物理观察仍按正式数据部署流程裁定；本包不执行迁移、不声明数据库已就绪。

首次源码构建先由[纯schema准备入口](../../scripts/prepare-selected-prisma-schema.cjs)选择 `--mode rental-ai --output <apps/rental-api下尚不存在的直接子目录绝对路径>`。宿主独立生成该247模型schema的 `generated/client` 后，再从仓库根设置绝对路径并构建；准备schema不依赖业务 `dist`，也不等于已生成Client。

```powershell
$env:RENTAL_PRISMA_CLIENT = (Resolve-Path 'apps/rental-api/generated/client/index.d.ts').Path
npm run build -w @rental-os/ai-native-server
npm run lint -w @rental-os/ai-native-server
```

build/lint 使用[显式所选Client编译器](../../scripts/build-selected-prisma.cjs)的 `--mode rental-ai`；同一绝对变量传递给 Rental 前置构建。CLI也可传 `--project tsconfig.json --client <index.d.ts>`，lint 增加 `--noEmit`。它读取既有真实声明及同目录schema，核原Task、请求和Invocation等模型，不生成默认Client、不读 `.env`、不加载Client运行值或连接数据库。缺生成物、默认模板和选择冲突均明确失败；包原rootDir及出口保持，输出声明仍由消费者同一所选Client解析 `@prisma/client`。

旧组合 `apps/api` 的241模型具有原AI模型，可在明确设置 `RENTAL_PRISMA_LEGACY=1` 并指定本仓库原默认生成声明时构建兼容包；另核其schema与原源码一致。独立宿主拒绝该兼容模式。[所选编译回归](../../tests/selected-prisma-build.test.cjs)仅在测试进程内生成官方声明验证161/247/241边界，不是生产生成入口，也不替代真实磁盘构建或部署验收。

独立镜像沿[Rental构建说明](../rental-core/README.md#使用与构建)的[宿主打包入口](../../scripts/package-rental-host.cjs)，显式选择 `--ai enabled` 并追加 `--ai-data-package <完整固定AI数据包绝对目录>`；同时提供原含AI的prepared目录、完整Rental包、公共40与所选247声明。打包消费已经构建的本包 `dist` 与宿主 `dist-ai/ai-main.js`，核完整AI数据包摘要及原58份迁移；缺包、错模式、缺实际运行出口或不同schema均拒绝。Linux镜像内按原锁生成两个专属Client，当前打包不安装、不执行Docker、不迁移，结果始终区分 `imageBuild=not-run` 与 `deployment=pending`。

旧 [出箱入口](../../apps/api/src/modules/ai-native/business-events/prisma-business-failure-outbox.ts)、[归还异常入口](../../apps/api/src/modules/ai-native/business-events/return-exception-source.ts)、[Task 仓储错误](../../apps/api/src/modules/ai-native/ai-task.repository.ts)和[保留策略](../../apps/api/src/modules/ai-native/privacy/retention-policy.ts)再导出同一对象，保留错误 `instanceof` 和出箱 Symbol 身份。

原 [通知正文维护者](src/runtime/privacy/retention-notification-draft.ts)继续拥有授权重查、scope 锁、未决效果核对、原密文校验、正文 CAS、快照清理和删除账写入。它复用本包的 reader、`metadataSchema`、`sameReceipt` 及原 ID / scope / hash 校验；这些纯函数不授予清理权限。维护服务、知识服务、任务执行器和模型财务账使用迁入的原实现，旧路径不保留第二份逻辑。

Prisma 的类型由宿主所选 schema 生成。SQL、Decimal、空值单例和错误类使用 [公共 Prisma 运行值](../platform-server/src/prisma-runtime.ts)；本包不要求生成 `node_modules/.prisma/client`，也不在运行时重定向 `require`。

原 [业务事件合同验证](../../tests/ai-native-events-contracts.test.cjs)仍经兼容入口消费唯一实现。[独立宿主权限回归](../../apps/rental-api/test/ai-composition.test.cjs)检查真实 Auth、Guard、所选数据准入与知识文件 ACL。离线核验使用本仓库原守卫、当前所选 schema 的官方 DMMF / 类型及事务 fixture；真实数据库约束、迁移、外部投递和正式宿主运行分别验收。
