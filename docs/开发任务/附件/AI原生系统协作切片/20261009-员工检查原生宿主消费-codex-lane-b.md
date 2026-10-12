# 员工检查原生宿主消费

基线 `f5290e1cb18b042cd5c9df6fb344dd8a18ea6788`，B 原树/分支。主线明确认领 pickup/return；未同步后续媒体提交，未改 recognition、Auth/Core/schema/shared/Gateway/上传链或原人工 onSubmit。

实际入口：领取/归还页面实例 `attachInspectionHost(host)`；页面必须已加载当前订单与模板。复用当前员工会话、contextVersion 和 sessionEvents 校验 tenant/workspace/user/order/stage/template；不从 query/storage 读启用开关。正式 HTTP 和可信服务能力尚缺，默认无 host，组件隐藏、零辅助请求。serverEnabled 是未来受控宿主注入，不是客户端授权依据。

新增 ai-inspection-assist 原生 Component，usingComponents 复用原 Workbench 和检查草稿具名 slot。回调与原操作仅在实例私有内存，未放入 properties/data/setData/event detail 或持久缓存。hostHide 保留待核对原操作但清显示/隔离迟到结果；detach/logout 清本地绑定和会话订阅，不宣称远端取消。确认弹窗锁避免重复弹窗，捕获 generation+revision，切换/修改后旧确认无效。

`StaffInspectionHost` 注入原服务签名：templates.read、drafts.read/edit/replaceEvidence/reconcileOperation、evidence.fingerprint、submission.prepareReview/prepare/submit/reconcile。客户端只消费合法投影，执行仍由原受权服务决定。operationId(kind,revision)、actionId 和正式签名附件由宿主提供，必须沿用原操作稳定键，禁止重开页面换键掩盖 unknown。宿主不得注入内部媒体 resolver/令牌/供应商消息。

正常消费：读模板与原稿→当前附件证据核对→逐字段人工更正/移除草稿附件→原 prepareReview→人类明确确认→原 prepare 重新检查单资源条件→原 submit；manual_review_only 材料不能直接提交，多资源继续原人工办理。读回失败/写响应不明保留原操作 unknown；编辑/附件用原 reconcileOperation，正式提交用原 reconcile，不自动重派。不计算费用、不判责、不改原检查业务事实。当前识别不可用，不将候选或文本替身称视觉结果。

一个明确公共缺口已报告主线：prepare/prepareReview 的原命令结果核对未暴露独立入口；现有 drafts.receipt 要求服务端指纹，客户端不能推造。此类 unknown 保持锁定并明确待核对，不以新 operationId 绕过。正式员工 AI HTTP/server gate 尚未装配；未来模块必须消费现有正式服务，不猜 URL。

验证：原 `tests/ai-native-b11-workbench.test.cjs` 增两项功能冒烟，无新测试脚本；实际 Page 生命周期+实际 feature-local session绑定、实际组件与消费控制器由显式宿主替身驱动，覆盖默认关闭、正常读取/更正/移除/审阅/提交未知/核对、重复提交阻止、切上下文迟到结果和解绑。最终 6 pass / 0 fail / 0 skip / 0 todo，exit 0。未使用源码字符串匹配冒充交互。

类型：最初两次命令路径/argv错误分别 exit1/exit2，实际 tsc 曾报本片类型错误 exit2，修复后 `tsc -p apps/staff-miniprogram/tsconfig.json --noEmit` exit0。执行使用已有 TypeScript runtime（`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e 'process.argv=[process.argv[0],require.resolve("typescript/bin/tsc"),"-p","apps/staff-miniprogram/tsconfig.json","--noEmit"];require(require.resolve("typescript/bin/tsc"));'`）。

员工端完整构建：`node apps/staff-miniprogram/scripts/build.cjs` exit0，28 页面，包含新组件和两页面声明。构建前验证 dist 归属本树非外链；既有脚本仅重建本树构建输出，不清历史 output/previous/temp。最后 `git diff --check` exit0。

测试命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-b11-workbench.test.cjs`。固定无效 DATABASE_URL；本树绝对 AI_OFFLINE_AUDIT/TEMP/TMP；完整构建 NODE_OPTIONS 预载护栏传播子进程、AI_OFFLINE_WRITE_ROOT 限本树。没有 .env/网络/数据库/真实文件/模型/支付/微信宿主或设备验收。类型/构建不等于上线，HTTP 未接通。

Runtime/Provider 替换独立：本宿主只依赖既有业务端口和 shared 类型，不依赖 checkpoint/节点/SDK、不另建 Gateway/预算账本。后续可信服务接入须逐次原授权并使用唯一 Gateway。

## 接续：原候选的明确采用／拒绝

基线 `c1ee113d28a3552aa48cb9906587dc5449713f8c`。原服务器 `InspectionDraftService.edit` 已支持 accepted/rejected，本片只接员工消费：`ai-inspection-draft` 的 `candidatedecision` → `ai-inspection-assist.onCandidate` → `StaffInspectionHostBinding.decideCandidate` → 原 `host.drafts.edit`。不增加服务器协议或识别调用。

按钮绑定原 fieldCode/candidateId/当前 revision；同字段多候选无法唯一确定时禁用。采用不传客户端最终值，由原服务器读取自己的候选并重新验证证据；拒绝不传伪造值。只读／pending／原操作 unknown／旧修订／未知候选不发写；附件已移除的旧来源不允许采用。人工选择结果单独展示“人工采用／人工拒绝”，不等于正式检查事实、判责、收费或提交成功。原 edit 响应不明沿现有 reconcileOperation 核对，未新增自动重试或新操作键。操作键回调发生上下文更换时不进入写路径。函数仍只实例内存；候选选择新增属性默认关闭，不给普通 Workbench 自动开放写入口。

沿原 B11 一个已有用例补真实 Component 事件及实际绑定控制器路径，没有新增测试脚本。初次红测 5 pass / 1 fail / 0 skip / 0 todo、exit1（缺 onCandidateDecision）；实现后 6 pass / 0 fail / 0 skip / 0 todo、exit0。覆盖采用／拒绝／旧修订／未知候选／只读与原卸载隔离；服务端调用是明确端口替身，不冒称真实 HTTP 或模型候选生产。命令仍为 `node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-b11-workbench.test.cjs`。

员工 TypeScript noEmit exit0；既有完整 `node apps/staff-miniprogram/scripts/build.cjs` exit0、28页，并在最新源码上复验同一6项 exit0。构建前 realpath 验证 dist 在本树，preload 由 NODE_OPTIONS 传播，固定无效 DB、本树 audit/TEMP/writeRoot。未启服务/访问localhost，构建地址仅静态公开配置；未读.env或写共享生成物。`git diff --check` exit0。正式 HTTP/server gate、prepare原操作核对和主线视觉输入依赖仍未完成，本片没有绕过；未验真实微信宿主、设备、文件、数据库或生产。

## 接续：准备操作原键核对的宿主消费

固定依赖 `77c78a466ccaafdca2b3736b793d0645467cc3fb` 已在B树无冲突FF接入，保留c1ee/1fb1两笔成果和全部旧output。主线新增的服务器 `InspectionSubmissionService.reconcilePreparation` 由宿主显式注入；本片仅改原inspection-host、assist组件、原B11测试及本记录，不改服务器/HTTP/Core/Gateway/shared/上传。上一节“prepare原操作核对缺口”由这个固定服务器入口和本次消费推进，不代表正式HTTP已接通。

新增可选宿主方法 `submission.reconcilePreparation({kind:'prepare'|'prepareReview',request:原完整AiInspectionPrepareSubmissionRequest})`。原kind、operationId、expectedRevision、actionId、签名附件及目标均留在实例私有命令副本，回调修改入参不会改写这份核对材料；不算客户端fingerprint、不放data/properties/detail/storage、不调用prepare或Core。收据表达 `execution:not_attested`，found仅证明原prepared事实，不是审批/检查已执行。缺处理器禁用，absent/unavailable继续unknown并禁止盲重试。found后重新读取当前受权草稿与模板/证据，核对draftId、原准备修订、mode与当前版本；读失败或不一致保留unknown，再核对同一原键。解除unknown不自动submit，后续仍需人类明确动作。

普通hide仅清展示、活动代次和detail/template引用，同实例同host的原unknown命令私有保留；show验证上下文并重新读取，只能显式核对，无自动重派。正式当前上下文无效／查询不出当前身份时直接解绑本地host及内部Workbench，清原命令和敏感显示；恢复旧标识也不会复活旧宿主。detach/logout/换host同样全清，不宣称取消远端写入；若需重入处理未知操作，正式宿主必须持有原命令，不得重新造操作键。

一次新增原B11用例驱动实际控制器和原生Component，端口/数据库/微信为明确替身。初始红测6 pass / 1 fail / 0 skip / 0 todo、exit1；实现后7 pass / 0 fail / 0 skip / 0 todo、exit0，最后自查改动后同范围7/7 exit0。覆盖prepare与prepareReview丢应答、完整命令只读核对、回调篡改参数隔离、absent/unavailable、found后读失败、成功重读后不自动提交、hide/show、迟到核对、缺处理器、上下文失效与内部Workbench解绑。未扩矩阵、未新增测试脚本。

实际命令 `node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-b11-workbench.test.cjs`。`node apps/staff-miniprogram/scripts/build.cjs --check` exit0；最终同原命令完整build exit0，28页。采用主线77c78的本树output私有shared声明方案，不写共享dist或node_modules；固定无效DATABASE_URL、本树AI_OFFLINE_AUDIT/TEMP/TMP/writeRoot，NODE_OPTIONS传播离线preload，dist已realpath归属检查。`git diff --check` exit0。正式员工HTTP/server gate仍缺、真实存储/MySQL/模型/微信/设备未验；主线视觉输入新增不代表本组件已有识别入口，本片未接识别调用或调整AIN完成率。
