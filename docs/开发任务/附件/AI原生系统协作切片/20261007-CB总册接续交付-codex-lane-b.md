# Codex B 总册接续交付与精确未闭合项

## 单来源正文的数据库侧定向读取

`PrismaKnowledgeReadAdapter.chunk`保留scope/document/version关系限定，按持久JSON中的实际chunkId查询，take=2检测重复逻辑标识；不再为一条来源读回整版正文。数据库随机row.id不是逻辑chunkId，不作混用。读回仍验证JSON、正文列、定位、当前head及当前授权。没有修改schema或公共契约；JSON过滤仍可能扫描该版本，真实MySQL性能和索引优化未验。

复用原persistent-content冒烟和DB替身，无新增测试脚本。先在原正常路径增加查询形状/上限断言，红测0pass/1fail/0skip/0todo，退出1；实现后使用既有local-runtime与offline-preload，定向选择`actual repository|scope, actor|revocation and head|corrupt body|bounded reads|a caller changing`：6pass/0fail/0skip/0todo，退出0，含ts-node实际类型编译。不是全文件或全API类型验收。`git diff --check`退出0。未连接数据库、存储、模型或网络。

依据20261007总册CB-01～12；唯一树codex-ai-native-lane-b，分支ai/codex-ai-native-lane-b-20261007。本记录不更改中央完成率、不宣称任何AIN验收完成。原作者已由负责人确认停写；保留全部继承历史、源码及output。本次未合并移动主线、未改其他树、没有MERGE_HEAD。

## 已提交的接续功能

| 固定提交 | 实际变化 |
| --- | --- |
| 27fe3967 | per-item prepareReview形成manual_review_only材料，多资源订单仍可人工审阅；这种材料不可调用原订单级检查提交 |
| 618b7bcb | 草稿列表在DB查询阶段绑定完整allocation/stage/template目标，而非只按订单查询 |
| ca9c54f5 | 继承的Knowledge module WIP核对后独立提交，显式导出同一Memory consent实例 |
| 1b385339 | 原平台CAT-GOV Guard/preview gate/DTO/service草稿创建、分区CAS修改、校验和影响审阅应用；不发布或采用 |
| 9c61df7c | 员工请求级factory和显式模块，独立凭据、关闭释放、实际草稿读写；不开放HTTP |
| 01686ef5 | 正式Knowledge/Memory政策组合接入opt-in模块；修复持久Memory owner独立对象导致合法操作恒被拒绝 |

本记录所在提交还修复CB-01媒体读取的清理阻塞：取消会拒绝正在等待的read，provider cancel仅尝试一次并观察错误，不再无限等待其清理应答，释放reader锁。取消不代表外部存储已完成清理。没有新增测试脚本，只在原媒体冒烟补不合作cancel场景。

## 按原工作包核对，不缩减任务范围

| 包 | 当前代码事实 | 尚未闭合的原要求 |
| --- | --- | --- |
| CB-01 | 原FileAsset/上传/业务绑定、持久EvidenceBinding、媒体hash/尺寸/时长和有界reader；清理阻塞已修 | INSPECTION_OBJECT_READER仅接口和可选注入，没有正式存储生产者；不能说真实附件读取已装配 |
| CB-02 | 实际当前身份/阶段动作授权、Prisma草稿CAS、精确operation、人工更正/采用/拒绝、目标隔离 | 独立正式草稿/识别动作政策若与原订单动作不同，须公共认领人定映射；不是GET授予写权。真实多人MySQL并发未验 |
| CB-03 | 持久识别输入准备、严格候选与来源校验，明确caller_supplied_not_model_execution_proof | 实际媒体Gateway输入、invocation与结果证据绑定未实现；当前仍CAPABILITY_UNSUPPORTED，不能伪称OCR |
| CB-04 | 原Controller+Guard+独立ALS+DTO+精确Core收据→提交/核对→草稿关联；读回失败不重提 | 真实Core/数据库/设备未验；多资源review材料不能绕过原单资源提交限制 |
| CB-05 | 文档生命周期/当前人类管理/持久检索/来源重授权/索引generation/收据恢复已有 | 正式动作政策与合法文件bytes生产者未齐；单进程缓存不等于分布式失效 |
| CB-06 | propose/change/confirm/read/revoke/delete及确认中断恢复、已确认偏好有界消费；正式模块已接 | FormalMemoryPolicySource仍由公共正式政策源提供；测试政策不是生产许可 |
| CB-07 | HumanKnowledgeInputService.collect/revalidate已有总预算、知识/偏好分区和当前复验 | A/R真实冻结输入消费者尚未在本树接入，不可修改其独占目录或把包生成称已派发 |
| CB-08 | shared AiBusinessEventDraft/AiBusinessDeliveryDraft已存在；原通知有自己的业务outbox | 尚无AI业务事件持久模型/原事务生产hook/有界消费者；不能把旧通知投递表冒充完整事件总线，需要先协调同事务写点和正式资源版本 |
| CB-09 | shared AiAutomationPolicyDraft已有有限主体、scope与模式 | 尚未实现持久影子任务生产/政策消费；依赖CB-08、正式automation授权/政策及R任务入口，不能伪造task或借人类session |
| CB-10 | composeInspectionAssist与StaffInspectionRequestFactory已可消费真实服务，关闭隔离；共享检查叶子已有 | 原员工route白名单、公共输出/错误运输与正式媒体能力仍待主线；没有HTTP可用声明 |
| CB-11 | 原平台治理草稿/校验/差异与影响审阅接通 | 适用P批准与发布/租户资格/空间采用入口未装配；不把原preview环境门切成生产开启，也不用订单审批代替品类批准 |
| CB-12 | 随功能复用原少量越权/回放/unknown/释放等冒烟；旧评测语料保留 | 跨线最终集中验收待正式功能链；未有独立审查、真库、供应商或设备证据 |

## 需主线协调的精确接入点

1. 文件生产者：`inspection-assist/inspection-media.reader.ts`的`INSPECTION_OBJECT_READER`：`open({tenantId,workspaceId,fileAssetId,provider,storageKey},signal):Promise<ReadableStream<Uint8Array>>`。应来自已验证配置和真实对象读取，支持关闭与取消；不得把模型URL或签名下载URL喂给fetch。本树`FileStorageRuntimeService.readInspectionBytes`已有业务/上传/对象及读后版本复核，生产者到位后原注入点直接消费。现有`readKnowledgeBytes`内部仍走presign GET+fetchWithTimeout，不能将此路径宣称为本批要求的非URL正文生产者。知识需要当前业务附件绑定与有界bytes，不新增另一存储平台。
2. 动作政策：`knowledge/formal-knowledge-authorization.adapter.ts`的`FormalKnowledgePolicySource.resolve`与`FormalMemoryPolicySource.resolve`。必须返回当前actor/audience/scope、action、revision/expiry、requiredPermissions/grantKey及具体资源绑定；本线adapter重验真实Auth。没有正式政策不能用owner、任意ACL字符串或测试grant补齐。
3. 媒体模型：本树`model-gateway.ports.ts`的真实ModelRequest.messages.content仍是string、features仅tools/structuredOutput/streaming。需要主线提供实际媒体intent、可信内容/version/hash绑定、唯一invocation/dispatch/usage证明及结果恢复合同。识别服务prepare中的unavailable保留，不能自改Gateway或用文本图片描述替代。
4. 输入消费：A/R在实际冻结材料前调用现有`HumanKnowledgeInputService.collect`，在真正消费点调用`revalidate`。返回包仍不是派发授权或原子快照；变化要求重收集，不静默替换。主线指定固定消费提交再整合，本线不写A/R。
5. 可靠事件：原通知事实入口在`rental-core/rental-business.service.ts:sendNotification`和`rental-business-fact.repository.ts:insertNotificationLog/updateNotificationDelivery`，已有通知投递租约/幂等不等同AI事件。交付风险、归还异常、退款失败和开业缺项需各自原事实事务的唯一作者提供eventId、scope、resource.version、trace/causation与dedup键的生产点。总册要求先报精确文件由主线协调；本线没有改上述Core文件，没有用事务后append冒充原子Outbox。AI事件模型/消费者仍属于未实现代码，不能仅写“环境未验”。
6. 影子链：在事件提交点明确后，需正式automation身份/动作政策与R受权任务创建/去重端口；模式仅disabled/shadow/manual_confirmation。没有这些依赖不创建影子假任务，不做通知或退款副作用。
7. 员工宿主：`InspectionAssistModule.registerStaffRequests`导出factory，服务器绑定header和requestId后`open`，handler的finally调用close。原员工白名单/正式运输和动作政策由公共认领人装配；不从业务body接scope/actor。close不证明已提交操作被撤销，继续按原operation核对。
8. 品类：`category-assist/category-draft.application.ts`复用原`rental-core/category-governance.controller.ts`及service。发布/采用必须由主线/P给适用品类的明确人类确认/批准接线；原订单批准与租户operator均不能授予平台治理权。本树不改原CAT-GOV内核。

## 这次媒体片的实际验证

`node --test tests/ai-native-inspection-media-submission.test.cjs`：8pass/0fail/0skip/0todo，退出码0。没有新增脚本、全仓回归或测试框架。原用例驱动真实FileStorage runtime/检查服务/仓储适配；Auth、数据库、对象流与原Core外部边界按现有fixture显式替代。追加cancel不合作场景用受控Promise与setImmediate事件循环边界，没有sleep。没有单独运行旧实现红测，不伪报红测数量。

Node preload为本树`prisma-offline-preload.cjs`和`lane-b-local-runtime.cjs`；DATABASE_URL固定mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT为本树output/cb01-cleanup-audit；TEMP/TMP为本树output/inspection-lb05-tmp。非transpileOnly加载源码检查通过，非全API tsc；git diff --check退出码0。各提交此前命令与分阶段计数见自己的切片，不将它们相加伪装最新全量结果。

## 替换与回退

业务授权、Prisma草稿/确认/原operation和来源引用不依赖LangGraph checkpoint或Provider消息类型；将来Runtime仅替换驱动，Provider仅在唯一Gateway适配。不得替换账本/确认/业务幂等。回退新宿主装配不撤销已提交检查或确认；仍凭原Core/Memory收据读回。不安装框架/SDK、不改线上开关。

剩余均需上述正式跨线政策/存储/媒体/原事务或消费合同，不以继续新增孤立wrapper、影子表或报告当作闭环。移交时请提供固定依赖提交与唯一写入者范围；不追活动HEAD。本线合法功能交付不是整个CB队列或AIN验收完成。
# 接续：底层预览及来源枚举撤权竞态

## Memory 确认详情迟到读取

实际复现 `PersistentMemoryConsentService.confirmationDetail` 最后一次 Memory 读等待期间撤销身份或正式同意，仍返回旧 confirmed 证明。修复为复读确认记录并比较原证明，最后再次执行现有当前身份/Memory read 动作授权；不改变撤销与删除语义，不创建新确认。

原 preferences 测试内增加一项两分支负例，无新脚本。红测 1 pass / 1 fail、退出 1；修复后 preferences + consent 两文件 4 pass / 0 fail / 0 skip / 0 todo、退出 0。使用既有本树 runtime/preload/固定离线数据库地址及本树临时路径，ts-node 类型检查启用。仅数据库/Auth替身，未验 MySQL 或真实权限政策配置；读后复核不宣称原子跨资源快照。

## 固定主线依赖接入

接入主线固定 `1faf979674efefb028b108ad045d5bd125796135`，本树对应 `84966d0c`。仅同步该七文件切片，未合并活动主线；两处 formal adapter 冲突逐块采用主线完整资源指纹比较，保留本线所有其他功能和失败断言。schema/追加迁移均来自主线原切片，本线未扩展模型。显式入口 `composePrismaFormalHumanKnowledge` 已可消费持久精确政策，缺行/停用/过期仍拒绝，未提供政策管理生产入口。

隔离 Prisma 生成退出 0，`guardViolations=0`、`sharedArtifactsUnchanged=true`。原 formal-authorization + input-composition 两文件 5 pass / 0 fail / 0 skip / 0 todo，退出 0（实际政策源、实际身份 adapter 与旧知识/记忆组合，外部数据库/Auth为离线替身）。未执行迁移/播种/服务启动，未验 MySQL/正式政策配置/文件存储。主线仍在补首次文档附件业务生命周期，未要求本线自行造正式授权。

实际复现 `PrismaKnowledgeReadAdapter.previewChunks/listSources` 等待 chunk 查询期间发生撤权/撤回仍返回旧结果。现已在底层返回前复读持久 head，并比较当前授权 grant；预览初始状态已 withdrawn 时也拒绝，合法 parsed draft 预览仍保留。未修改主线政策/组合/Gateway/结果读端。

在原 `ai-native-knowledge-persistent-content.test.cjs` 增加一项含四种组合的受控回调负例，无新测试脚本。红测 0 pass / 1 fail、退出 1；修复后用 `--test-name-pattern` 定向运行本项和原来源读取、scope绑定、撤权场景，4 pass / 0 fail / 0 skip / 0 todo，退出 0。名称过滤为限定验证范围，不是全文件或全量验收。使用既有本树 local runtime + offline preload、固定无效 DATABASE_URL、本树 audit/TEMP；ts-node 类型检查启用。真实 MySQL/FileStorage/多实例仍未验。读后复核不是跨资源原子授权，正式动作政策仍需主线提供。
