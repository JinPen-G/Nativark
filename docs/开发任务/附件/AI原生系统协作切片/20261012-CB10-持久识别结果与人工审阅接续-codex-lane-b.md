# CB10 持久识别结果与人工审阅接续

日期：2026-10-12。固定 HEAD `a63954aa48edde098a54188cf78474467f810782`，B 树 `ai/codex-ai-native-lane-b-20261007`。本批没有提交授权，以下为已实现/快检的未提交增量，不是固定 SHA 已交付。

## 现场保全

index 空、无 MERGE_HEAD/CHERRY_PICK_HEAD。继承 knowledge/shared 叶子/隔离生成脚本/知识测试与记录 WIP、未跟踪知识管理入口及全部 output 保留、不暂存、不提交。主线本轮认领知识生产者，本片不触碰它们，不同步主线移动 HEAD 或复制 foundation WIP。

## 实际接通

现有 image/audio 媒体冻结、Gateway 单账、task/后继 clarification 输入、持久结果与候选保存均已存在，本片不重建。

- `composeInspectionAssist(...).readRecognitionReview(reference)` 直接联读原 `recognitionResults.read` 与 `drafts.readReview`；由原 `StaffInspectionRequestFactory.open/withRequest` 继承同一服务图。严格原引用输入，scope/主体/任务/结果/原附件 hash/version/模板与来源复验仍在既有读链执行。
- 在结果和人工材料等待后再次读取，revision、binding 或结果变化拒绝；不把新的人工值与旧识别结果混合。外层原 bind 动作再复核当前身份，close/撤权仍拒绝。
- 现有 `StaffInspectionAssistController` 的 `result-read` 使用上述实际消费方法，再返回原 recognition 投影；没有新 HTTP operation 或 shared 字段，客户端原返回格式不变。内部服务器消费者可同时得到 recognition 与 review 分区。
- 草稿人工值与模型候选分区，`adoption:not_attempted`、`businessActionRequested:false`、`automaticRetry:false`。显式 `result-save`、人工 edit、原 submission 与 receipt 路径保持原样；不自动保存、采用、提交、判责或收费。
- `drafts.readReview` 的字段加入 `candidateEvidence`，说明每个候选来源是否仍匹配当前草稿 evidence；旧来源保留为历史且不匹配时明确 false，`requiresCurrentEvidenceValidation:true`。此说明不是采用权限；实际 edit 继续验证当前证据，不复用移除附件后的旧候选。

增量源码仅三文件：`inspection-assist.composition.ts`、`inspection-draft.service.ts`、`staff-inspection-assist.controller.ts`；仅扩展原 `tests/ai-native-inspection-media-submission.test.cjs`，无新测试脚本。

## 一次定向快检

固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；`AI_OFFLINE_WRITE_ROOT` 本树；audit/TEMP/TMP 在本树 `output/inspection-lb05-tmp`；NODE_OPTIONS 预加载原 `prisma-offline-preload.cjs`。

命令：`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='original inspection frozen|human attachment replacement' tests/ai-native-inspection-media-submission.test.cjs`。

结果：3 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，exit 0。image/audio 两种实际模型 host（模型/DB/传输为离线替身）与后继输入，成功持久结果联读人工草稿、模糊候选不替换人工值、不完整计量 unknown 无候选、不重派、原结果保存后的旧 revision 拒绝、撤权拒绝，以及附件移除后的旧来源 false/人工更正保留。仅此次定向结果，不宣称全文件/全专项回归通过。

API 原严格选项 compiler API noEmit（内存 rootDir/baseUrl 本树，shared 源码与私有 Prisma paths，incremental=false，根 `inspection-assist.composition.ts`）：1084 文件、0 诊断、exit 0；没有生成或修改共享产物。`git diff --check` exit 0（包括继承 WIP 的空白检查，不代表其功能被本轮复验）。

## 精确公共缺口与未验

- 当前公共 `AiTaskResultProjection.status` 在 `runner/ai-task-result.repository.ts` 只有 succeeded/failed/unknown，不能提供独立 partial 终态。已有 completeMeasurement=false 或 unknown 不暴露 payload，本线保留 unknown 无候选，不自行更改公共状态、读取截断 JSON 或保存部分值。需要独立 partial 展示时由主线定义持久结果、完整性与安全可读部分的正式契约。
- staff 的新识别任务未置备正式动作政策时，既有真实创建/读取测试仍拒绝 start；本轮 positive 持久结果联读是在既有受权服务组合（operator 测试身份）驱动，不冒称正式 staff 生产执行已启用。staff controller 已接同一方法，真实 HTTP/原 staff 端到端与正式政策置备未验。
- 原检查办理仍需要合法 originalInspection/controller/receipt、签名与业务条件；manual_review_only 不扩大为 order-wide submit。没有创建审批旁路。
- 没有连接真实 DB/HTTP/DNS/模型/支付/文件存储，未运行迁移、未启动服务/worker、未改 AppModule/UI，没有 push/main/生产启用。离线替身非 MySQL 锁、文件存储、真实识别、微信设备验收；Runtime 与 Provider 两个替换边界独立未安装。

下一接续：主线按上述四个源码/测试增量及此记录核对接回；继承知识 WIP 不包含在本片认领范围。不自动提交、不扩全矩阵、不把历史绿测换算 AIN 完成率。

## 同日续作：显式原检查办理与纯收据读取

主线继续授权本同一功能包后，补齐实际员工 Controller 的办理断点：

- 原 `submission-read` 调用 `submission.reconcile`，成功会进入 finish 回写草稿链接，因此不是纯查询。现改为已有 `submission.readReceipt`，查询原 actionId/requestHash/模板绑定的 Core 收据，零草稿/operation 写入。原 unavailable/not_observed 在此 HTTP 消费映射回既有 submission_unknown，并明确人工核对；不会把收据缺失当未执行或自动重派。已提交与 draftLinked 分开，回写失败后的原业务成功仍如实展示。
- `submission-submit` 保留原显式办理和原 Guard/Core/idempotency 端口。准备材料读取到领取办理权之间还经过 allocation/template 等等待；新增 claim 前再次 `drafts.read`，拒绝 reviewRequired、revision 或人工材料变化。此复验不声称与 Core 提交原子一致，Core 仍是最终业务校验与事实来源。
- 原 submit/reconcile 等服务保留；只有显式调用 reconcile 才可能修复草稿链接。查询入口不调 reconcile、不修复、不改变未知状态、不另造提交器。

实际链：当前 staff request → 原 template/draft 与人工 edit → 原 submission-prepare/prepareReview → 用户明确 submission-submit → 原 Core receipt → submission-read 纯查询。returned 资源后的历史收据仍走原权限入口，不用可编辑模板要求挡住合法历史事实；并不因此恢复旧候选的采用/提交许可。

增量增加 `inspection-submission.service.ts`；现有 test 中仅扩展真实 Controller 提交/读取用例与一个等待中资源切换用例，没有新增测试脚本或公共协议。

定向命令：`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='failed draft back-write|staff submission refuses|absent original receipt|multi-allocation review' tests/ai-native-inspection-media-submission.test.cjs`。4 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，exit 0。真实员工请求 factory/controller、Guard、草稿/原提交/原 receipt 适配，Core controller/DB 为离线替身。正常显式提交与草稿回写失败、纯查询零新增 writes/业务调用、模板资源等待中变化零提交、manual_review_only 禁 order-wide 办理、unknown 按原键不重派均验证。没有把此前 3 项与本次 4 项拼为一次全量回归。

必要源码映射 noEmit 再查同一根：1084 文件、0 诊断、exit 0。未改知识继承 WIP/shared/公共核心、未提交。正式 staff 任务执行政策与 partial 公共契约仍保持前述缺口，未验环境不变。

## 同日续作：员工领取/归还原宿主消费（保持未提交）

HEAD 仍为 `a63954aa48edde098a54188cf78474467f810782`，分支 `ai/codex-ai-native-lane-b-20261007`；index 空，无 MERGE_HEAD。本片无新增提交授权，全部留 WIP；继承 knowledge/shared/script/output 成果未改动、不暂存。

实际接通：

- `inspection-transport.ts` 的 `createStaffInspectionTransportHost(reference, signature?, recognitionReference?)`：可选引用必须完整绑定原 order/allocation/template/stage/draft/input/task/result/expectedRevision，拒绝 URL/额外字段；只消费现有 result-read/result-save/result-save-receipt。原引用私有快照，写调用不自动 refresh replay。没有任务创建、模型派发或新 HTTP 路径。
- `inspection-host.ts` 的 `readRecognition/saveRecognition/reconcile`：读取原持久结果并复验当前草稿版本/附件；unknown/failed 不保存候选，不自动识别。显式保存仅保存候选证据，人工值不被覆盖，后续沿原 edit/decideCandidate 逐项人工采用或更正。双击 single-flight；COMMIT 应答丢失保留原 operationId，收据和实际新草稿均核对后才解除待核对，不能换键重做。
- `ai-inspection-assist` 实际组件通过实例私有 host 方法调用；候选预览、人工草稿、原检查已提交与 draftLinked 分开。`submission-read` 只消费原收据，未回写关联不是业务回滚。隐藏/解绑/卸载清展示，迟到 show 不再启动子 Workbench，dispose 与子草稿 detached 不再 setData。
- 原 `pickup/index.ts`、`return/index.ts` 只改 type import 与既有 `attachRemoteInspectionHost` 参数转交；`inspection-page-binding.ts` 加可选原结果引用和同 templateId 下 version 隔离。没有改页面业务写入/路由/注册/上传/签名/支付，原人工填单路径保留。默认无 host 不读取；显式创建 transport 才读 host-read，服务器仍独立鉴权。
- 原 `ai-inspection-draft` 增有限字段错误与输入标签反馈、长度/触控/长词布局约束；Infinity/非法整数不发 edit。没有新增 VIN/车牌/读数猜测或费用/责任/资格规则。静态样式不算真机可访问性验收。

文件增量：`apps/staff-miniprogram/src/components/ai-native/inspection-host.ts`、`inspection-transport.ts`、`inspection-page-binding.ts`、`ai-inspection-assist/index.ts/index.wxml`、`ai-inspection-draft/index.ts/index.wxml/index.wxss`、原 `pages/pickup/index.ts`、`pages/return/index.ts`；仅扩展现有 `tests/ai-native-b11-workbench.test.cjs`，未新建测试脚本。

定向命令（原 preload、固定无效 DATABASE_URL 与本树 audit/TEMP/TMP/write-root）：

`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='staff original receipt|staff inspection host|pickup and return actual pages|staff preparation' tests/ai-native-b11-workbench.test.cjs`

最终 4 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，exit 0。驱动实际原生 Component、StaffInspectionHostBinding、transport、两端实际页面代码；替身仅替换微信/会话/网络/宿主数据。不冒称真实 HTTP/服务器授权组合或微信宿主已验。过程中保留实际失败：第一次两个失败为测试 setData this 绑定及旧 receipt stub 缺 inspectionId；随后受控拒绝在 read 真正进入前触发造成 unhandled rejection，已用显式 readStarted Promise 修正；非法输入测试最初缺 edit handler，补真实能力替身后通过。未删除断言/skip/todo，也未扩大全矩阵。

员工全源码 compiler API noEmit：沿 `apps/staff-miniprogram/tsconfig.json` 严格选项，内存 rootDir/baseUrl 为本树、paths `@rental-os/shared → packages/shared/src/index.ts`，incremental=false，无输出；223 文件、0 诊断、exit 0。不是普通旧 dist 类型检查或构建。`git diff --check` exit 0（仅 CRLF 提示）。本片未跑 dist build，不覆盖既有产物；没跑真微信、设备、屏幕阅读器、MySQL、真实模型/文件存储或生产链。

正式依赖仍缺：staff 新任务 start/read-step-terminal 等政策未置备时明确拒绝；result-read/save 能力以正式服务器逐动作授权为准，前端 edit 标志不等于结果权限。公共 partial-safe 结果契约未提供，不展示截断内容或伪造 partial。多 allocation 保持原 manual_review_only；没有新增订单级提交捷径或预算/审批/身份旁路。主线应复核本片 WIP 后统一接入，原 AIN 完成率不变。

## 20261012 收口停写：原 CB10 冻结与宿主直接缺陷修复

主线转达最新指令为手头收口后全部停下、取消心跳；不再承接下一包。本次只修已经定位且已动的 `inspection-host.ts`，扩原 `tests/ai-native-b11-workbench.test.cjs` 的既有单例并更新本记录，没有新增页面、路由、服务端协议、调度或测试脚本。

### 固定包区分

- 固定 HEAD `a63954aa48edde098a54188cf78474467f810782`、分支 `ai/codex-ai-native-lane-b-20261007` 不变，index 空，无 MERGE_HEAD/CHERRY_PICK_HEAD。只写本树，无第二个运行中的本树会话；未暂存/提交/推送/合并。
- 目录 `output/cb15-staff-consumer-kx3_2lyk/before/` 冻结原 CB10 四个服务端文件、十个员工宿主/页面文件、两个原测试和本记录，共17文件；`before-sha256.txt` 为原WIP字节哈希。`cb10-wip.patch` 仅是相对上述固定HEAD的原CB10差异（SHA256 `df1d5c809376253c8c33a251ead60cb35e0fc9b9f3664c4f4782df430419ad38`），不是本轮新增，也不声称主线全未接收。
- `after/` 与 `after-sha256.txt` 固定收口后17文件；`cb15-closeout.patch` 只含相对 before 的宿主、原测试、本记录三文件变化。消费者应先核对前像哈希，再逐项合入，不能整包覆盖主线已有内容。主线集成/验收由主线判断，本树作者收口不等于上线。
- 知识 CB14 已被主线确认存在等价公开契约/只读target实现；本树仅修复旧联合类型窄化，独立冻结在 `output/cb14-knowledge-contract-PoMirTwT`，不作为本员工包或新增知识功能回灌。其后主线修订上传/memory/中央契约不属于本树交付。

### 已收口的直接缺陷

1. 识别、草稿和收据重新读取前清除旧展示材料；复核失败不会继续展示之前的人工值/候选/收据ID。一次当前授权的原收据查询成功仍可独立展示已提交事实，即使随后草稿回写状态不可读；不将关联失败解释为业务回滚。这里是收到服务器拒绝后的失效，不声称无请求时能自动感知远端撤权。
2. 隐藏后恢复、保存未知且草稿读取失败时，保留同一私有原操作命令，不再以缺少 detail 阻断已有核对端口。识别保存必须是原 operationId 的匹配 draftId/revision 收据，并读回当前草稿，才退出 unknown；错草稿收据和读取拒绝保持 unknown，不换ID重发。准备/提交/编辑的原核对端口也不会因展示材料已清空而无法进入。
3. 当前草稿 revision 已变化时，在调用 result-read 前拒绝旧识别引用；换附件恢复页面后仍保留从当前草稿重新读到的人工更正，旧候选来源不匹配不能采用。等待中的旧epoch不得清理新宿主的未决命令。

### 本次唯一小验证与未验项

固定双 preload 经 NODE_OPTIONS 加载 `prisma-offline-preload.cjs` 与 `lane-b-local-runtime.cjs`；DATABASE_URL 固定 `mysql://offline:offline@127.0.0.1:1/rental_os_offline`，audit/writeRoot/TEMP/TMP/TMPDIR/XDG_CACHE_HOME/npm_config_cache 均为本树绝对路径；禁 Node/V8/ts-node compile cache。

原测试文件单轮定向：`node --test --test-reporter=tap --test-name-pattern='staff original receipt|staff inspection host|pickup and return actual pages|staff preparation' tests/ai-native-b11-workbench.test.cjs`。4 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0；`smoke.tap` 保留，offline-audit.log 0字节。扩原单例覆盖服务器结果/草稿/收据拒绝清空旧展示、保存应答丢失后hide/show、无detail仍查询原键、错草稿收据不解锁、匹配后恢复人工值、换附件不采用旧候选且不再读旧revision；另三项既有宿主/两页面/准备收据行为同轮通过。

本轮没有追加全量 noEmit、全量回归、真实服务端集成或微信设备测试；测试加载实际组件/页面/transport源码但会话、网络及宿主数据是替身。页面WIP未真实验收，未启用生产；未读.env、安装依赖、启服务、连接真实HTTP/DB/DNS/存储/模型/支付、迁移或改共享生成物。全部源码WIP、旧失败、output与锁保留。CronList及Desktop scheduled-tasks均为空，未创建心跳/后台agent/新会话；本固定交付完成后停止写入，不自动继续。
