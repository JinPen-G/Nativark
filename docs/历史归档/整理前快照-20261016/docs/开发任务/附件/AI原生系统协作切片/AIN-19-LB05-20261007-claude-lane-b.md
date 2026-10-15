# AIN-19 LB05：草稿与操作收据持久层

## 固定起点与文件归属

B树 ai/codex-ai-native-lane-b-20261007，从 a85b145f 接续；6285c678→f58888db→27c729a1→a85b145f ancestry 已核实，无 MERGE_HEAD。旧 knowledge/human-knowledge.module.ts WIP 原样保留，未清理 output。

本片只追加 schema 的 AiInspectionDraft / AiInspectionOperation / AiInspectionEvidenceBinding、BusinessWorkspace 两项反向关系及 FileAsset 一项反向关系。迁移独占 20261007191000_ai_native_inspection_drafts，仅 CREATE 新表及新表约束，不变更 Core 数据。主线整合应取本提交差异，不能整份覆盖 schema。

## 已交付

- 正式 shared 独占文件 ai-inspection-persistence.ts；未碰 shared 总出口，内部使用源码 type-only 引用，主线可统一导出。
- 草稿列保存 scope/owner/audience、订单/allocation/asset/stage/冻结模板、绑定/证据/输入指纹、revision、提交 action 与检查引用。有限 JSON state 保存人工值和候选对应，不写检查事实/Knowledge/Memory。
- 真实 PrismaInspectionDraftRepository 使用本树实际生成 delegate，事务内 updateMany 带 scope/owner/audience/revision/bindingFingerprint，草稿更新和 receipt 一起提交。
- scope+operation 唯一键；同键原指纹返回不变结果引用，异载荷冲突。事务错误后仅按原键原指纹查收据；absence 与 unavailable 分开，未证实结果返回 RECONCILIATION_REQUIRED，不换键重试。
- 列表数据库端条件和 take≤50；不先全表读再过滤。持久 receipt 只保存稳定结果摘要，不返回草稿旧正文。
- state 写入上限 240000 UTF-8 bytes（SQL JSON上限262144留格式余量），最多1000个revision；每成功revision一个receipt。expiresAt列供后续人工草稿服务限制保留期；本片不启动清理任务，不自动删未知提交收据。

## 快检与限制

命令：node --test tests/ai-native-inspection-draft-persistence.test.cjs。
环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；NODE_OPTIONS 使用本树绝对 prisma-offline-preload.cjs 与 lane-b-local-runtime.cjs；AI_OFFLINE_AUDIT=本树 output/inspection-lb05-audit.log；TEMP/TMP=本树 output/inspection-lb05-tmp。

一次定向冒烟 5 pass / 0 fail / 0 skip / 0 todo，exit 0。ts-node transpileOnly:false 编译实际仓储及其依赖，非全 API tsc。覆盖同键并发创建、异指纹/owner冲突、两个编辑争同一revision、提交应答丢失、收据失败回滚、有限受权仓储查询。DB为串行事务替身，不是MySQL锁/隔离验证。

既有 scripts/ai-native-generate-local-prisma.cjs 在本树临时目录运行成功，guardViolations=0、sharedArtifactsUnchanged=true。没有执行迁移，没有真实DB/存储/模型/设备/微信宿主验证。

## Runtime / Provider SDK 独立替换

业务持久状态与收据只依赖本系统合同和Prisma，不依赖节点、checkpoint或SDK消息。Runtime可调用同一应用/仓储，operationId、指纹、expectedRevision和结果引用必须原样携带；重启/换Runtime不能更换键或把absence当重做许可。Provider SDK只可在主线唯一Gateway内替换，不改本片数据、授权、预算单账或人工最终值。回退保留草稿、候选、receipt和已提交检查引用，禁止回滚Core事实。

本片是工作包1/6的存储部分，不声称完整人工应用已接通。下一片接现有模板、真实业务动作授权、上传完成证据绑定、人工创建与逐字段持久化。媒体读取和正式提交仍按真实端口能力报告，不用空接口冒充闭环。
