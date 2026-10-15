# Claude 临时代班：主线与 Codex A/B 交接（2026-10-08）

> **历史快照，勿按下文旧待接列表重复施工。** 后续Claude已接续并整合至源码基线d0326a813fbdf43a65c7a2b61b9cb63632b660e7，A/B及06/07已另有新派工。当前固定成果、在途范围、真实缺口和Codex启动提示以[统一接续总册第0节](20261007-Codex接管关键长任务总册-A-B-AIN06-AIN07.md)为准；本文件原暂停/待接描述仅保留为历史，不转移当前写入权。接手仍重新核对最新HEAD与负责人授权。

用户准备交回 Claude 半天，之后再由原 Codex 对话接回。三线已通知安全收口、暂停新增写入；A/B 均回报无源码 WIP。不是授权范围重排，也不是 AIN 整项验收。接手重新核对 HEAD/status/MERGE_HEAD/CHERRY_PICK_HEAD 和活跃写入者，不回退本记录观察点。

## 施工现场

| 树 | 分支 | 本次观察 |
|---|---|---|
| D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation | ai/ai-native-contracts-s01-20261002 | 功能交付截至 d59ef3d491d0d9ffc493e90d15bca26b9dd35cf0；本交接文档另提交 |
| D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a | ai/codex-ai-native-lane-a-20261007 | 8de5d833b3385886aff4eb9eb12da2afd9da11d5，源码干净，无合并/cherry-pick 状态 |
| D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-b | ai/codex-ai-native-lane-b-20261007 | bea3d85d8eacf043c6149c6dabc638cb4efdc1ec，无源码WIP、无MERGE_HEAD；仅历史 output/inspection-lb05-tmp/ |

主线保留他人原有修改：docs/开发任务/附件/AI原生系统专项实现与协作记录.md（本轮未编辑、未提交）。全部历史 output/、旧截图、patch 不删除或提交。交接时没有正在运行的测试/生成任务；若后续有调度触发，仍以写入权已移交为准，不自动争写。

## 阅读顺序

1. 当前正式 docs/AI原生系统专项需求说明.md、docs/开发任务/AI原生系统专项开发任务.md，以及中央实现记录。原28项路线有效；暂缓框架迁移，不使用归档的立即转开源路线。
2. docs/开发任务/附件/AI原生系统协作切片/20261007-Codex接管关键长任务总册-A-B-AIN06-AIN07.md。
3. 本交接文档、20261008-主线模型步骤转换证据-codex.md、20261008-主线首次运行状态一致性-codex.md、20261008-主线同租约场景准备-codex.md、20261008-主线B线媒体存储生产者-codex.md。
4. A树自己的 20261007-总册接续与报价选择-codex-lane-a.md；B树自己的 20261007-CB总册接续交付-codex-lane-b.md（均在对应树相同协作切片目录）。

## 主线本轮实际实现/整合

- 81f66af1、64dba2cf、827dc0eb：受权任务结果读取及任务中心 list/events/results 显式组合。核对 owner/scope/task/run/step/action/fingerprint/hash/bytes，unknown 不冒充成功正文。
- 1faf9796：Knowledge/Memory 精确持久动作政策来源与正式人类授权组合，默认无政策拒绝；追加 AiKnowledgeActionPolicy 模型/迁移。政策管理/可信写入入口尚未齐备，不能默认授权。
- e5e760e5、97183343、412bfa49、beac34d0：接回 B 的附件绑定缺失拒绝、预览读后复验、记忆确认撤销复验、有界 chunkId JSON 精确查询；0e7ac34c 仅修正式生命周期测试夹具缺绑定。
- 4e780222、a5a2e4e3、480f722d、848e2dd2、fbeee28e+a38e8a5f、32890396、c841a76d、17f05c0e：接回 B 的持久检查草稿、原上传业务绑定、媒体输入/提交收据、多对象逐项人工审阅、全目标列表隔离、独立员工请求和有界取消清理。历史 WIP 紧随完成片已接回，不把 WIP 单独称完成。迁移只追加，不执行。
- 41381429：TenantInspectionObjectReader 真实配置/资产/上传/订单绑定，S3-compatible SigV4 header-auth GET、有界字节与超时/取消/读后复验；显式 provider factory，不注册根模块。仅支持 s3_compatible，未验证真实 S3；不支持 Knowledge 正文，不把本生产者冒充媒体 Gateway。
- 4e0a5484、af28c7a7：接回原恢复线的显式任务应用与澄清收据/继续执行分离；33db875c：同一已确认租约下准备输入与plan，再进入原runner循环，5秒有界准备，缺依赖拒绝。
- bca4576a：修复首次 createTask 的 task/run 均 QUEUED，而 start 只推进task造成资源门拒绝。原 start 事务在当前授权及lease/fence/revision约束下同时激活run；领取本身仍不是执行许可。
- d59ef3d4：模型专用 PrismaModelStepEvidenceAuthority 与正式命令生产者。`composePersistedTaskModelInput(...).createTransitionAuthority(financialEvidence)`、`.commands` 接原非只读组合。start=running/possible；成功/失败绑定冻结输入、invocation、四项charge、artifact、admission和原单账预算dispatch；unknown只保留，不重派、不假核对为成功。精确处理原started marker的{}零测量，不降低只读校验。

主线没有实现 Knowledge 首建上传意图/附件绑定闭环，也没有完成 A 场景app接模型转换后的整链验收。请勿把它们写成已解除。

## A 树实际成果与整合前置

已有经营工具/报价/订单解释/开业准备基础直接复用。本轮追加：正式原请求→任务创建；显式场景/客户/任务中心装配；人类报价选择收据→原受控建单准备；同租约模型准备；持久模型结果读回及当前事实复验；来源受权重开与原事件页；原输入读取/提交继续、同holder核对、取消请求和注销隔离。客户只读采用原ClientAuthService/ApiAuthGuard/ALS，未把客户改装成员工。

**主线尚缺A的更早前置，不仅最近6片。** 只读git历史与文件核对确认主线缺 original-scene-model.composition.ts/task-center-scene.composition.ts。按依赖检查以下固定链，不能只摘最后三片：

1. f9bab620：原请求仓储、模型/追加迁移及shared leaf契约。
2. 0637b923：受控审批正式输入授权绑定（先核对是否主线等价实现，不覆盖已有修复）。
3. b8f1890a → c5974faf：原请求显式模块、只读恢复与场景事实消费。
4. 69c75308 → bdfe989c：前者是未完成报价选择持久化骨架，必须连后者完整选择/受控准备一起审阅整合，不能只接WIP。
5. 5a78f97b → 035dffe3 → f0f207b5 → 95f5216f → 1b8fff82 → e06fc864：模型输入、隔离客户读边界、订单不可用语义、任务中心与显式客户模块/缺依赖拒绝。
6. a6fc320e → b419cdb4 → ba5d56e1 → 8cca6d39 → b20b7bd0 → 8de5d833：三场景持久结果、当前客户身份、来源/事件页、开业事实复验、同租约应用、输入恢复与取消。

这些A功能片尚未由本轮主线整合复验；`git cherry`为+是核查线索，不等于可盲批合。原merge提交不重放。

主线已有的等价依赖不要重摘：A a8341795/c4003053/732ab29b = 主线81f66af1/64dba2cf/827dc0eb；A855f694a/e2b6db78 = 主线4e0a5484/af28c7a7；A7ba250a9 = 主线33db875c除主线B媒体独立type import；A141c2156 = 主线bca4576a。

A最后已验：既有host应用烟测1 pass/0 fail/0 skip/0 todo，实际QUEUED task/run→同lease真实input/plan准备→缺转换authority正确拒绝、零invocation/释放；另三场景读回循环1pass。API tsc/diff0。**不是模型成功整链证据**。正常澄清resume继续、模型调用成功/未知与主线新适配器组合尚待验证。

## B 树实际成果与未整合片

知识/记忆读写撤权与附件校验、检查草稿/媒体输入/员工请求等前置已按上方主线映射接回。不要因cherry-pick SHA不同或文档冲突把所有历史重复合并。

唯一确定的新待接片：bea3d85d（依赖主线41381429，本树等价4c2916ce不要重放）。入口 `InspectionObjectReaderModule.register(db,integrations)`，显式Nest模块导出原 INSPECTION_OBJECT_READER；缺db/配置方法即拒绝。由宿主注入原FileStorageRuntimeService第四参数，再给原 InspectionAssistModule.registerStaffRequests。未注册生产根模块/HTTP。

B最后已验：既有媒体测试9 pass/0 fail/0 skip/0 todo，包含实际Nest application context获取token/close、挂载零配置读取、实际producer→FileStorage→媒体（DB/transport/egress显式替身）。交接仅重新diff check0，未重复全套。真实微信/S3/数据库/媒体模型未验。

## Claude 建议接续顺序（原任务依赖，不另排计划）

1. 核对三树写入权、保全主线中央记录WIP/output；收取A完整前置链与B bea3d85d，追加迁移只做原离线隔离validate/generate，不执行真库。
2. 在A实际场景组合里接主线 d59ef3d4 的 `model.commands`、`model.createTransitionAuthority(原持久financialEvidence)`，经原runner/Gateway验证首次启动、成功、unknown、不重派、取消及澄清恢复。缺正式inputSource仍拒绝，不用测试authority作为默认装配。
3. CB05：Knowledge create强制附件已完成且业务绑定；FileStorage upload又要求业务对象已存在，形成首建循环。需要正式受权首建上传/绑定生产者，并提供非URL有界正文源；当前readKnowledgeBytes仍走旧presign读取，不能声称已有安全新源。不能把rental_order S3 reader伪装为Knowledge。
4. CA05：核查审批线 df86b688/c255c4c4及944bb6a3等正式前置，接原人类review/decide/readReceipt与受控Core事务，禁止假APPROVED。CA06/07配置/资料动作正式prepare/read/submit/reconcile及原输入/target/scope/revision/白名单合同仍缺，不能借order.commit办理。
5. CB03媒体intent/inputHash/version/invocation/dispatch/usage/recovery合同；CB08原Core事务Outbox，CB09 automation/shadow任务正式政策与幂等创建；员工HTTP/品类适用P入口。依赖缺失保持 unavailable，不另造Gateway/事件内核。
6. 客户任务owner/policy/模型身份生产者、shared leaf正式总出口、公共运输DTO/错误映射/快照cursor仍须主线协调，不能把本人只读误称客户任务执行已接通。

## 本轮证据与边界

- 首次run红18pass/17fail→绿35/35；模型转换相关初验28pass/2fail→最终30/30。各自独立命令，**不能相加为主线全量65/65**。
- API源码路径noEmit、diff check均0；普通陈旧shared dist路径并未据此修复。
- 测试命令和替身范围见各切片。所有Node测试固定无效DATABASE_URL、prisma-offline-preload，本树绝对audit。未安装/启服务/读取.env/访问真实DB/HTTP/DNS/模型/支付；未push/合main/生产启用。
- 此前隔离Prisma生成已确认共享产物未改；本最后两个修复无schema变更、未重新生成。A新模型尚未整合，不能套用先前生成证据。
- 作者离线通过不等于独立审查、真MySQL锁、真实服务、浏览器/微信/设备或原28项专项完成。临时代班结束请留下固定HEAD、WIP归属和剩余项，再由用户明确移交回原Codex对话，避免心跳或旧对话竞争写入。
