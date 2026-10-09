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
