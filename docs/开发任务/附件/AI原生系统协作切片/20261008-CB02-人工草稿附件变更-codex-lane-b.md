# CB02/CB10 人工草稿附件变更与原操作恢复

施工树 `codex-ai-native-lane-b`，分支 `ai/codex-ai-native-lane-b-20261007`；前置 `b2a27dad`。本轮总线明确恢复原28项自研，暂缓LangGraph/Provider迁移；不沿旧暂停队列自动启用任何功能。

## 实际补齐

- 已有权威附件绑定、有界媒体读取、草稿create/edit、人工prepare/submit及原key核对全部复用，不重写。
- `InspectionDraftService.replaceEvidence`：当前订单动作授权→当前模板/资源绑定→合法附件版本复验→现有人类字段校验→末次身份/附件复验→Prisma revision CAS及同事务操作收据。输入是现有target、draftId、expectedRevision、bindingFingerprint、operationId与evidence引用，不新增shared契约或表。
- 增加/替换/移除草稿附件后回到draft_saved，清除旧submission、recognitionInputs、inputFingerprint、submissionActionId；保留人工值和原候选历史。依赖被移除附件的已采用/更正值，必须人先显式edit为人工值或清空，不能静默重写；保留照片字段同样必须显式处理。
- 历史候选缺少当前附件绑定时，不能再accepted/modified。迟到候选仍受原revision CAS保护。
- `reconcileOperation({kind:'evidence',request:原请求})`按原键/完整指纹读回；同键异载荷冲突，提交ACK丢失由原仓储查收据，不新建操作。
- 已接实际入口：`composeInspectionAssist(...).drafts.replaceEvidence`、`StaffInspectionRequestFactory.open(...).drafts.replaceEvidence`及原opt-in模块导出的同一服务。没有新HTTP、worker或AppModule注册。

## 宿主调用

1. 原上传链完成后，`evidence.bind({...target,attachmentId})`取得权威attachmentRevision。
2. `drafts.create`或本次`replaceEvidence`保存明确附件集合；发生更正先调用原`edit`，不把候选当事实。
3. `submission.prepare`准备单allocation原检查材料；多allocation只能`prepareReview`，不冒充可提交。人明确提交才`submission.submit`；unknown只`reconcile`原actionId/requestHash，不重派。
4. 回应不明时读取原草稿operation收据或原业务action收据；会话结束调用request factory的`close()`，不宣称已取消远端事务。

## 定向验证（不扩脚本）

沿用 `tests/ai-native-inspection-media-submission.test.cjs`，只追加一个附件办理流程，驱动真实服务与Prisma仓储，数据库和存储为显式离线替身。

环境：DATABASE_URL=`mysql://offline:offline@127.0.0.1:1/rental_os_offline`；AI_OFFLINE_AUDIT、TEMP、TMP均在本树`output/inspection-lb05-tmp`。

命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-inspection-media-submission.test.cjs`。

- 先单项红测：pass0/fail1/skip0/todo0，exit1，真实缺少replaceEvidence方法。
- 实现后原文件：pass10/fail0/skip0/todo0，exit0，含原提交并发、提交ACK丢失、回写失败、原收据缺失等既有路径。
- 自查补同键异载荷、附件办理COMMIT丢ACK、旧候选modified拒绝后，仅复验上述新单项：pass1/fail0/skip0/todo0，exit0。不是第二次全文件结果。
- API原tsconfig noEmit TypeScript程序检查，采用本树私有Prisma类型与shared源码路径：DIAGNOSTICS=0，exit0；未生成共享产物。git diff --check exit0。未跑全仓矩阵。

## 未交付与硬边界

- 媒体公共Gateway intent/invocation、能力和单账消费依赖仍由主线提供；`recognition.prepare`仍明确CAPABILITY_UNSUPPORTED，保存的受控输入不等于真实识别。
- 原检查Controller/收据及文件服务由服务器显式注入；本线未接真实HTTP/微信页面，未实际访问S3、MySQL、模型或设备，事务替身不证明真库锁行为。
- 未新增多人共享草稿权限。owner/audience、订单动作政策沿原实现，不把订单GET权解释为写权限。
- Runtime/Provider均未安装替换；附件、草稿及原业务提交/收据不依赖节点/checkpoint/SDK消息。旧提交/源码/output保留，未修改公共Auth、Core、Gateway、schema或其他树。
