# AIN-19 LB07：有界媒体、不可变识别输入与原检查收据交接

## 起点和固定依赖

B树/分支不变，接续5bbc4a00（LB06）→99438903（LB05）→a85b145f（LB04）。旧Knowledge module WIP和output原样保留。当前不安装、不执行迁移、不启服务、不连HTTP/DB/存储/模型/支付；不写A、runner、审批、Gateway、Auth/Guard、Core算法或全局AppModule。

## 本片代码

### 媒体

- `FileStorageRuntimeService.readInspectionBytes` 重用原FileAsset业务归属和经营空间校验，要求当前actor、对应订单/阶段scene、active+completed上传；不走knowledge-only权限，不返回签名URL、不fetch URL。
- 新 `INSPECTION_OBJECT_READER` 是服务端受控存储对象流依赖。参数是已验证持久对象引用，不能传任意URL/路径；当前没有生产实现或默认成功桩。未装配或真实配置缺失明确unavailable。生产接入仍须控制出网、凭据、不可变对象版本和读取期间对象变化，不可用任意fetch实现它。
- `readInspectionMedia` 读取过程中限制20MiB，识别批最多8附件且总计20MiB，后续文件以剩余额度限流；流读完才构造有界Buffer，不先下载再slice。超限/取消均cancel并释放reader；打开存储时取消也立即拒绝，迟到流随后关闭。8秒超时覆盖打开和流读取。
- PNG/JPEG头部尺寸、PCM WAV时长从有界bytes解析；支持范围明确，不靠扩展名/客户端checksum/自由metadata。不是恶意媒体完整解码器或病毒扫描器；无SDK媒体解码或宿主设备验证。
- `PrismaInspectionEvidenceAuthority.readMedia` 对读取前后的当前模板/附件身份再验，将实际hash/媒体信息通过条件更新登记。旧contentHash不一致拒绝；原candidate.verify在缺内容/尺寸证明时仍拒绝。

### 识别输入

`InspectionRecognitionService.prepare` 从正式冻结模板、原question和权威媒体生成不可变inputId/inputFingerprint，最多保留8份输入快照；只存字段投影和媒体hash/定位元信息，不存bytes/base64/URL/密钥。原operation同载荷重放，不重新读取/生成另一份输入；新输入不能冒认旧inputId。CAS写入前重验身份，取消不删除原收据。

当前实际 `model-gateway.ports.ts` 的ModelRequest仅string消息，ModelFeature仅tools/structuredOutput/streaming，不支持image/audio。prepare返回明确dispatch=unavailable、CAPABILITY_UNSUPPORTED；**没有发起识别、没有invocation执行证明、没有新SDK或第二账本**。主线正式媒体intent/登记端口接通前，候选仍是caller_supplied_not_model_execution_proof。

### 人工提交和恢复

- `InspectionSubmissionService.prepare` 复验当前scope/owner/阶段模板、人工必填/字段/证据，生成原Controller DTO材料，映射单附件photo为原检查要求的数组；prepared只表示材料就绪，原业务验证仍必须执行。当前只交接单个活动allocation、非承运寄送的整单检查；多资源聚合/分批/承运字段不猜测，返回CAPABILITY_UNSUPPORTED并保留人工出口。
- `OriginalInspectionApplication` 使用真实CreateRentalInspectionDto+class-transformer/class-validator；从当前server credential执行原POST检查route Guard和独立ALS，核对租户/空间/actor/audience和具体阶段动作权。查原收据后再次过原Guard，才调用原Controller.createInspection完整证据/幂等/Core事务逻辑。不是把Controller调用本身当Guard；没有直调Core替代原边界。
- submit先持久CAS占位submission_unknown。只有事务提交应答确认属于本调用，才调用原检查一次；同键重放或占位应答丢失不会再次dispatch。scope+submissionActionId新增唯一约束防止跨草稿同时认领同一原action。
- 原结果使用真正RentalIdempotencyRepository.find，在验证ALS空间下按order.inspection/原actionId读取，校验order/requestHash和response.inspection的tenant/order/stage/template/version；不读latest检查，不自动重提。
- 原检查已提交但草稿回写失败返回observed submitted+inspectionId+draftLinked=false；reconcile只修合法关联，不重做Core检查、不回滚费用。原收据absent/unavailable分别列出并保持unknown，附原actionId/requestHash人工核对材料。
- 原业务收据目前有14天保留策略；超过保留窗口查不到仍unknown，绝不据此判定未提交。AI收据不清理未知提交。本片没有运行清理器。
- `drafts.reconcileOperation({kind,request})` 接收原严格请求，服务端用当前scope重新计算原指纹，解决首次应答丢失时客户端尚不知道服务端fingerprint的问题，不要求换operation键。

## schema最小补充

仅在本批尚未执行的独占迁移20261007191000_ai_native_inspection_drafts及schema的AiInspectionDraft追加 `@@unique([tenantId, workspaceId, submissionActionId])`（ai_inspection_draft_action_key）。三个表定义与全部关系仍由LB05→本片差异整合；没有执行迁移，不整体替换schema。若任何接收环境已经执行过该迁移，必须另行准备新增索引迁移，不能重跑已执行脚本。

## 实际快检

主命令：`node --test tests/ai-native-inspection-media-submission.test.cjs`。

- 首次4 pass/2 fail：离线DB替身把Date等值条件误当gt，真实updatedAt复验因此拒绝。修复仅在本片测试替身，未放宽生产查询。
- 相关文件复验6 pass/0 fail/0 skip/0 todo，exit0；覆盖实际流限额/取消、文件runtime+证据+输入持久链、候选采用/拒绝/晚到保护、同键并发提交只dispatch一次、原答复丢失、草稿回写失败、absence保持unknown不重提。
- 补齐打开存储期间取消关闭窗口后，`node --test --test-name-pattern='storage opening cancellation' tests/ai-native-inspection-media-submission.test.cjs` 单项1 pass/0 fail，exit0；不声称这与6项是同一次7/7运行。
- 原AuthService/ApiAuthGuard、DTO校验、Prisma仓储、文件runtime及RentalIdempotencyRepository是实际实现。Controller业务执行、Core/DB和ObjectReader为受控离线替身；并非原Core金额算法验收、MySQL锁/隔离、真实存储、模型、设备或微信验证。ts-node transpileOnly:false，不是全API tsc。
- 本树既有隔离Prisma生成再次成功，guardViolations=0、sharedArtifactsUnchanged=true；schemaHash=31b391e1e4cb2b0ef565d2654aa2fe04b5f63110cf1afd8a1d3aac175cba3995。

所有Node运行：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；NODE_OPTIONS绝对本树prisma-offline-preload.cjs与lane-b-local-runtime.cjs；AI_OFFLINE_AUDIT=本树output/inspection-lb07-audit.log；TEMP/TMP=本树output/inspection-lb05-tmp。

## Runtime / Provider SDK 独立替换映射

| 边界 | 本系统稳定入口/状态 | 替换要求 |
| --- | --- | --- |
| Runtime | drafts.create/edit/read/list/reconcileOperation，recognition.prepare，submission.prepare/submit/reconcile | 携带原operation/expectedRevision/target，不把checkpoint当业务收据；占位未知不重新dispatch |
| 输入 | inputId/inputFingerprint、冻结模板id/version、原question、媒体revision/hash、有限历史 | 新引擎只读旧输入身份；在途输入保留原版本，不跨资产/附件版本复用 |
| 人工 | candidateId、decision、actorId、最终值、prepared/unknown/submitted | 编辑不等于AIN07批准；晚到候选只待复查，不能盖写人类最终值 |
| Provider SDK | 仍由主线唯一Gateway处理媒体intent、能力证据和invocation | 本线不依赖SDK消息，不安装SDK；usage缺失/取消/重试和预算单账语义不能转移给草稿服务 |
| Core收据 | 原order.inspection actionId/requestHash/持久inspectionId | SDK或Runtime回退均不可回滚已提交事实、再交检查或重新扣费 |
| 文件 | 原权限+受控ObjectReader，无URL/凭据进state | 新读取器需满足受控出网与不可变内容版本；未验证前保持unavailable |

## 14包当前接续点（非全项验收）

1/4/5/6/7/8：模型/仓储、人工草稿、逐字段决定、CAS/原operation核对、有限受权读取、失效复查已交付离线实现。
2：权威绑定生产者已实现；新上传后绑定路由仍缺原员工白名单/显式模块安装，不启用HTTP。
3：受权文件runtime、有界流与权威内容消费已实现；生产非URL ObjectReader仍缺，不声称已接真实存储。
9：不可变输入已落本系统持久模型；实际主线Gateway媒体intent/调用登记缺口阻塞dispatch。
10：严格候选复用/持久决定/晚到保护已实现；原invocation+执行输入hash的正式结果生产者尚缺，不能升级执行证明。
11/12：单活动资源的原Controller/Guard/DTO/原receipt适配和未知恢复已实现；多资源、承运、分批聚合交接保留原人工页面，尚需正式聚合材料契约。
13：shared独占文件列出绑定/草稿/候选/识别/提交/原操作合同；实际opt-in组合提供全部服务。shared总出口、HTTP白名单及全局安装由主线/原入口归属方接线，不在B越权改Guard/AppModule。
14：本片定向快检已完成，深组合与真实环境验收未做。

未解决依赖均保持不可用，不把本地功能片冒充AIN-19正式验收。下一步只接收主线固定媒体/入口合同或明确补充聚合材料要求，再推进对应缺口；保留原Codex开发建议、源码及测试，不重复已完工作。
