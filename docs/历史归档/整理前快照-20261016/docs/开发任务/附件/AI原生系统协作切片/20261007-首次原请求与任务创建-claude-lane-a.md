# 首次原请求、创建收据与三场景入口（Claude A，第一片）

## 起点与归属

A树 `codex-ai-native-lane-a` / `ai/codex-ai-native-lane-a-20261007`，起点 `c72256e5`；开工工作区干净、无 MERGE_HEAD。未合其他活动HEAD。既有Codex源码、测试、开发建议和记录保留。新增仅本树 task-request、scenes 新组合、A共享叶子契约/测试及schema最小追加。

## 实际生产者与消费者

- `composeAiOriginalScenes`：服务端注入真实 Auth、Guard、Subscription、Core及已发布的 `creationRules`；构造时不读、不保存、不启用任何政策。订单解释、开业诊断、报价澄清复用原受权准备服务。
- `AiCurrentOriginalRequestAuthority`：当前会话/成员/空间来自原 `AiTaskCurrentIdentityAuthority`、`AiScopeRepository`；资源检查通过原Guard/ALS和事实读取。独立创建准入是**显式服务端场景创建规则 + 同scene/version启用的现有plan policy + 当前原权限 + 原ai.native.use订阅权益**的交集。plan policy本身不是创建授权；没有创建规则或订阅目录仍不可用。测试中的场景规则、plan policy、AI权益发布数据均是明确合成夹具，不是生产启用证据。
- `PrismaOriginalRequestRepository.save/read/reconcile/createTask/readTaskReceipt`：真实Prisma delegate；读取按当前scope、owner、audience过滤并精确比对，不接受外部身份/hash/creationAllowed。保存前同步校验、规范化、深冻结；保存后再次受权核对。
- 创建 authority 实现原 `AiTaskCreationAuthority.resolve(sceneCode,inputRef)`，交给原 `AiTaskCreationRepository`。该仓储仍独占task/run原子创建。固定 `creationKey=scene-request:<inputRef>`；原任务inputRef/inputRevision/inputHash即正式创建收据，不新增第二创建器或任务状态机。
- `create`首次保存后只尝试一次metadata创建。重复原请求只读取既有任务收据，不自动补建；保存成功创建失败可显式 `createTask`，应答不明先 `reconcile`。queued不等于计划、runner或模型已启动。
- `reissue`要求新requestKey、同主体/空间/场景及受权的previousInputRef，生成新id和revision，保留原内容，不沿用批准。多个显式重发允许成为同一父请求的不同子版本，不假装一个全局顺序revision。
- `prepareTaskMaterial`重新读取受权事实，不将首次材料当永久业务快照；实际plan启动/模型调用仍未接通。本片三场景到task/run metadata通过，不是三场景真实模型端到端通过。

## 持久化追加块

`schema.prisma`只新增 `AiTaskOriginalRequestStatus`、`AiTaskOriginalRequest` 和 `AiScope.originalRequests` 反向关系；唯一追加迁移 `20261007190000_ai_native_scene_requests/migration.sql` 未执行。

原请求包含scope/owner/audience、契约及scene版本、requestKey、revision、有限payload、contentHash、当前身份绑定Hash、policyRevision/Hash、previousRequestId、状态和期限。唯一键(scopeId,audience,ownerKind,ownerId,requestKey)跨场景限制同键，避免同主体同键换场景。复合父关系保证同scope。文本排序规则的近似匹配不能授予权限：应用仍精确核对key、scope、owner及hash。

payload仅保存有限问题枚举、选定分区、报价候选字段，32KiB上限；报价最多50行，不存事实全量、凭据、context权限成功标记或模型全文。人名和用户候选可能属于个人信息，应按原输入保留策略处理，生产保留周期仍由宿主政策决定（规则中的maxInputAgeMs只管执行有效期，不是自动删除周期）。

未知提交应答返回 `AI_RESULT_UNKNOWN` 或metadata创建的 `requires_reconciliation`，不换键自动再写；只读核对未找到记录返回 `not_observed, retryable:false`，不声称确定未提交。历史收据读取独立于新执行资格，AI停用和输入过期不删除原task/run，但当前身份、资源权限、scene读取版本仍须通过。撤权不返回旧原文。存储异常不映射为不存在。

## 共享总出口精确整合补丁

未修改跨作者的 `packages/shared/src/index.ts`。主线整合这两行后按原shared构建方式生成本树制品：

```ts
export * from './ai-scene-request-draft';
export * from './ai-scene-request-draft-schemas';
```

随后将A新增4个API文件对 `../../../../../../packages/shared/src/ai-scene-request-draft` 的直接叶子引用改为 `@rental-os/shared`（original-scenes.composition、original-request.authority、original-request.validation、prisma-original-request.repository）。本片暂直接消费正式shared源码，不复制DTO。默认API `rootDir=src` 在未完成总出口整合时会报告跨rootDir；本片临时使用 `--rootDir . --noEmit` 验证同一真实源码和隔离Prisma类型，**不是默认API构建已通过**。后片按总控确认收敛该公共整合点。

## 离线验证

既有 `scripts/ai-native-generate-local-prisma.cjs` 在本树临时目录运行，输出 `generated:true / guardViolations:0 / sharedArtifactsUnchanged:true`，schemaHash `2541cb61bfae64293e3bc57416dbcdf5340fb0213299a433bf4e0d4d5a9f7314`。未安装依赖、未手改生成物，未执行迁移或访问DB/HTTP/模型。

每条Node命令均使用 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`、本树绝对 `AI_OFFLINE_AUDIT=.../output/lane-a-original-request-audit.log` 和 `--require ./tests/fixtures/ai-native/prisma-offline-preload.cjs`。

- `node ... --test tests/ai-native-lane-a-original-request.test.cjs`：首次4/9，失败为替身task/run关系投影和SQL断言误匹配ON DELETE；修正自有夹具后9/9，fail/skip/todo为0。
- `node ... -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--rootDir','.','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`：退出0。初次默认配置发现上述共享总出口rootDir问题及本片局部类型错误，局部错误已修。
- 真Auth/Guard/Subscription及真实仓储/composition运行；DB、Core事实源、政策/权益目录为离线替身。覆盖三场景首次创建、同键冲突、前await快照、重发、撤权、scope变化、过期、旧政策及两类COMMIT应答丢失。不宣称MySQL唯一索引/行锁/隔离或真实宿主验证完成。

## Runtime、Provider独立替换与后续

Runtime消费者只取得原请求引用/版本/hash、task/run和有限受权材料；不依赖图节点、checkpoint或引擎对象。运行器接管和计划/步骤恢复归AIN06，metadata创建不代管。未知业务结果仍归原AIN07/Core收据，不能凭原请求再执行。迁移需保持原请求→task/run→action/proposal/approval链；旧引擎排空或经验证迁移，不能默认跨引擎读checkpoint。回退停新入口而保留表、输入、任务和已提交业务事实；不能删除新增表导致在途引用丢失。

本层不含Provider SDK、模型选型、传输、自动重试或计费；Provider替换只在原唯一Gateway/受控传输/单账边界，不影响本层输入/收据语义。两种替换独立，当前均不安装、不迁移。

## 第二片：opt-in宿主、只读恢复与受控批准消费

第一片固定 `f9bab6207b9e27128f3b06dccf76d1ed86aa5dea`。按主线已核验依赖，原样cherry-pick `944bb6a3` 为本树 `0637b923d507a574fdb208298fd99650a9719075`，零冲突；AIN07目录没有本线编辑。

- `AiOriginalScenesModule.register`只装配服务；`registerHttp`显式提供 `AiOriginalScenesController`，没有AppModule接入、HTTP启动、worker或政策种子。服务端credentials来源必须为宿主当前请求，不得绑定跨用户静态token。所有方法仍走真实当前身份与资源授权。
- 严格POST契约路径集中在 `AI_SCENE_REQUEST_HTTP_DRAFT`：`ai-native/scene-requests` 下create/read/reissue/reconcile/reconcile-reissue/create-task/material/recovery。未知字段拒绝；错误映射到有限code、HTTP状态和retryable:false，不返回原异常文本。HTTP运行尚未授权/验证，只测试直接Controller与真实服务组合。
- `prepareTaskMaterial`把ref同步快照并在事实前后复核原creation authority，返回原请求收据、有限facts、materialHash与同task/run引用；移除旧准备层“未持久化/未有task”的包装，不把完成的首次创建链误报缺失。仍明确 `requires_host_plan_start / not_called`。
- `AiOriginalSceneRecoveryService`复用原task read_metadata动作政策、当前资源权与原请求收据，仅从真实AiStep读取最多50项并报告hasMore；携带原run/action/step/status/effect和结果存在性，不输出任意artifact全文、不建立第二恢复循环。UNKNOWN指出reconcile_original_action；取消或AI关闭不抹除已观测结果。顺序读取不能称原子全量快照。
- 原 `composeAiPersistedOrderScene`改为消费固定 `composeControlledApprovedOrder`，保留既有publish/savePlan/register/prepare/submit/reconcile接口及inputSource读取；执行端同时必须有正式executionInput证明。拒绝外部替换inputSource/executionInput，不把报价选择当批准，未知只核对原action。旧business-order-application源码仍保留。
- 新 `AiSceneTaskReceiptDraft`、恢复JSON Schema和HTTP目录均在A共享叶子文件；总出口仍交主线单一整合，现在直接叶子引用API文件增为5个（含Controller）。

第二片一次定向验证（同离线前缀，audit为本树output/lane-a-original-scene-host-audit.log）：`node ... --test tests/ai-native-lane-a-original-scene-host.test.cjs tests/ai-native-lane-a-persisted-order-scene.test.cjs tests/ai-native-approved-order-controlled-composition.test.cjs` **11/11、fail/skip/todo为0**。包含真实Auth/Guard/Subscription/批准/Core服务组合；DB、事实、政策和人类批准夹具明确合成，非MySQL或HTTP/模型验证。`tsc --rootDir . --noEmit --incremental false`和`git diff --check`退出0。

Runtime仅消费这些稳定引用和受权材料；原RUNNING/租约/plan启动及恢复归AIN06，提案/批准/提交点归AIN07。Provider仍没有新接点，保留唯一Gateway/预算。主线已给模型输入固定 `81db55a77f6c6119b6bce19280d1b02a9437e5d9`，但其publish依赖RUNNING和租约；AIN06正在解决首次queued启动宿主，本线等待其正式入口而不改状态绕过。报价候选尚无独立人类选定报价持久收据接点；已给主线精确依赖，不从候选ID推出人类选择。开业差异仍只到合法候选准备，未有正式发布端口不写配置。

## 第三片：原请求绑定的事实消费

在第二片 `b8f1890a` 后新增 `AiOriginalSceneFactsService`，由原composition提供三个显式内部应用方法（本片不追加HTTP路由）：`reopenOrderCitation`从原请求派生orderId/scope/question，不接外部scope/orderId，复用原版本化citation重开；`prepareOpeningSections`只消费原请求已选分区，复用原prepareSections/版本差异候选，仍不保存或发布配置；`reviewQuote`从原不可变候选重做受权澄清与来源说明，不报价、不保留库存、不把candidate当人类选择。历史来源允许AI停用但仍重验当前会话/资源权限；新候选消费前后复核creation authority。新增 `requests.readHistorical`仅供内部受权来源消费者，未暴露HTTP原context。

一次定向 `node ... --test tests/ai-native-lane-a-original-scene-facts.test.cjs` 3/3、fail/skip/todo为0；同离线前缀/audit本树output/lane-a-original-facts-audit.log；`tsc --rootDir . --noEmit --incremental false`退出0。无真实DB/HTTP/模型。Runtime只看到本系统原引用及有界facts，Provider没有新依赖；旧引用版本不因换引擎而改写，失效引用重新受权读取，不能触发业务重做。

主线随后明确将人类报价选择完整核心包交A继续，不再等AIN07：新增独立AiTaskQuoteSelection与20261007210000_ai_native_quote_selection迁移，真实Core规范化/原报价校验、选择收据和正式publishOrderInput消费；选择仍不等于批准。下一片立即实现，AIN06首次queued宿主仍等待固定交付。

后续继续：opt-in公共模块/严格入口、task material与主线正式模型计划端口、报价的人类选择→既有persisted order消费、开业差异端口、受权结果/恢复映射。主线提供的受控批准执行固定依赖为944bb6a3（主线a8d8492e），本片未合入也未声称已接入；审批目录不归A修改。
