# CA03/04/05/06 经营原请求事实消费接续

基线 b0c36a920f44bb5bab67afc2389c6bf14caa01a0；仅 codex-ai-native-lane-a / ai/codex-ai-native-lane-a-20261007。五树固定整合已包含，不重新导入旧WIP或stash；全部历史output保留。

## 第一片：正式请求应用接通原来源与分区差异

认领 request-bound-scenes.application.ts、original-scene-facts.service.ts、原 ai-native-lane-a-original-scene-host.test.cjs。本片不改主文档、UI、client-task/client-request、runner、公共授权、Gateway/预算、shared/Prisma或审批内核。

- composeRequestBoundOriginalScenes 和 composeRequestBoundOriginalSceneModel 均提供 reopenOrderCitation(request, originalRef+version+field)、prepareOpeningSections(request, originalRef+有限sections)。复用原 Guard/ALS/credentials、原受权 order reader 和 openingSectionDifferences；调用者不能提供身份/scope/messages/lease。后者不创建 modelApplication/runServices、不调模型。
- 来源重开在完成原订单读取后复核原收据 contentHash 与当前身份；来源过期走原reader stale，不用当前价格补历史。
- 分区结果冻结后复读原请求及当前授权身份/contentHash；只处理原请求已点选分区。不保存提案、不发布配置；返回原不可用字段结果，不假保存。
- 已有 start/readInput/readAnswer/readModelResult/reopenModelSource、原报价确认/收据以及原settings执行宿主直接复用，不计新增。Runtime/Provider耦合仍局限原模型host/Gateway适配；本片仅事实消费，不新增checkpoint、模型传输或账本。

定向命令（本树）：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='request-bound business consumers' tests/ai-native-lane-a-original-scene-host.test.cjs`。

环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT为本树绝对路径；TEMP/TMP为本树output；AI_OFFLINE_AUDIT=本树output/ca-business-consumers-20261012.audit。未忽略类型诊断，ts-node transpileOnly:false 实际编译依赖源码。结果pass1/fail0/skip0/todo0/cancelled0，exit0；覆盖实际request-bound应用、当前Guard和原repository，来源成功/非法scope拒绝/撤权拒绝、选定分区准备与越界拒绝，model step保持0。运行约69秒（主要模块类型加载）；不扩大矩阵。git diff --check exit0。

未验：全API noEmit/build、真实HTTP/MySQL/模型/支付及生产。数据库执行边界用原离线事务替身；不冒称原AIN整项通过。HTTP路由如需发布reopenOrderCitation/prepareOpeningSections，须主线在shared正式HTTP草案及原controller/OpenAPI同步提供，本片仅可调用后端应用，不自造URL。通用开业字段草稿/提案端口缺失仍 unavailable_no_formal_section_proposal_port，原通知settings宿主不是任意配置写权限。

第一片固定提交 c651b30f。独立提交仅明确四文件，hooks用命令级 `-c core.hooksPath=output/ai-native-no-hooks` 指向本树不存在的hook目录，以免未知hook读env/启服务；未修改项目hook、质量门槛或Git全局配置，不宣称常规hooks通过。

## 第二片：单分区当前事实与lazy模型宿主业务读回

- 新增 facts.readOpeningSection(originalRef+key)，只读取原开业请求已点选的单分区；复用正式 openingSection 返回当前配置、安全字段、证据、材料/人工出口和缺草稿状态，返回前复核原收据和当前身份，不从用户声称已修复推断成功。
- original-scenes.composition挂接该实际服务，request-bound业务/模型应用均可调用；模型应用同时接回已有 readRecovery、reviewQuote、readQuoteReceipt。纯业务读取直接走 app.model.scenes，不构造 app.application/runServices，不领取租约或发模型/业务写动作。
- 原报价查不到同操作记录仍 quotePersistence=unknown、reconcile，不查最新报价、不重报价、不换键。真实 RentalBusinessService.readQuoteForOriginalReference 调原 factStore.findQuoteForOriginalReference；生产仓储实现已在 rental-business-fact.repository.ts，未修改Core。

定向命令沿同一双preload，pattern=`request-bound business consumers|request-bound model runs original scenes`，仍只运行原单文件。本片首轮pass1/fail1/skip0/todo0，exit1：模型用例的旧absorbing业务仓储没有 findQuoteForOriginalReference，原业务拒绝被既有路由映射FORBIDDEN。未放宽生产拒绝；保留缺依赖断言，再仅给数据库执行替身补同tenant+精确64位原操作key查询，返回null而非伪造报价成功。最终pass2/fail0/skip0/todo0/cancelled0，exit0，约63秒（模块类型加载及三场景原流程）；audit=output/ca-lazy-business-final-20261012.audit。本文件ts-node transpileOnly:false无忽略诊断，覆盖依赖源码编译，不等同全API noEmit/build。diffcheck exit0。未新增测试脚本。

原模型三场景用例同时验证调用实际共享host的启动/原结果及来源读回、原Guard/身份等待隔离；新增读取前后 factoryCalls=0、model sent=0。数据库、财务和transport仍为该既有离线夹具替身，不能说真实预算/供应商验收。

## 本包四项对照与剩余硬依赖

1. 原经营请求→模型host：固定基线已有 composeRequestBoundOriginalSceneModel/start、createApplication、prepareHeldRun，原请求产生受权材料，服务器选场景，调用唯一runner/Gateway；本包补的是其纯业务来源/恢复消费。缺plan/run/current授权仍拒绝。
2. 订单解释：原 prepareTaskMaterial→最少question reader，original-scene-result.service.read 比较当前订单/金额/历史/资金/coverage与冻结事实；原reopenModelSource按result+sourceIndex复验；本包补直接原citation应用接点。生成文本仍unverified_model_text_not_execution_evidence，不覆盖Core facts。
3. 报价连续消费：基线已有readQuotePreparation/confirmClarifiedQuote/readClarifiedQuoteReceipt及人类选择、地址/配置复验、原quote审批/order host。本包只把reviewQuote/readQuoteReceipt接回lazy模型应用，不发审批或order.commit。原quote查询未装配即拒绝，未知只核对原key。
4. 开业分区：本包补单分区当前事实/有限差异准备；原通知settingsTask、settings-business-consumer已读取真实准备/审批/操作收据，task-center settings分支复验原task/run，未复制状态机。不把通知配置端口泛化成开业任意分区写入。

待主线固定契约：直接经营引用重开、单分区读/差异应用如需HTTP发布，应同步原controller/shared/OpenAPI（总线已认领，不由A扩协议）；通用分区普通字段draft/proposal producer与合法执行端口未提供，保持不可用。所有新增可调用应用入口已接回显式组合；不注册AppModule/HTTP新路由/worker，不安装Runtime/Provider SDK，不修改UI。Runtime迁移可复用facts/request-bound接口并替换原host内部，旧unknown仍只能原证据核对；Provider替换仅原Gateway适配，不涉及本片事实读回。
