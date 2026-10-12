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
