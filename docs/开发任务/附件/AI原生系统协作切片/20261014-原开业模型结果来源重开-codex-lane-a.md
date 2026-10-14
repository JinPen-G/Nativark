# 原开业模型结果的来源重开

接续4c7cff18。核查正式persisted readModelResult/reopenModelSource已映射RecoveryReaders，原订单/知识来源完整，不再包装。真实缺口：opening_diagnosis可读artifact/facts，但原reopenSource只接order/knowledge，未消费开业已选分区的来源。

实际新增AiOriginalSceneResultService.reopenOpeningSection({original,resultId,key})，由RecoveryReaders、正式persisted及既有full-model根reopenOpeningModelSource接回。主线明确授权这两源码区域。先原read同artifact available，要求opening及原明确sections包含key，再用原readOpeningSection复验当前Guard。材料对应section的受控evidence(scope/resourceType/resourceId/version)必须与读出的当前来源一致，之后再原read同结果/materialHash/原收据。未知、stale、非原selected key不打开旧信息；模型正文/URL不能作为授权。订单/knowledge既有协议完全不改。

返回当前来源reference/source及frozenBasis.materialHash/reference，明确observation:current_authorized_reobservation、historicalConfiguration:not_loaded；当前源与冻结依据匹配才读，但不把它声称为历史配置查询。execution/proposalPersistence均not_attempted。没有新公共sourceKind/DTO/HTTP/提案或任务存储，缺公共承载交主线，不猜路由。

一次inline：实际原请求、当前Auth/Guard/ALS、持久runner模型artifact及其源绑定/Prisma结果仓储、正式RecoveryReaders和原readiness来源；数据库及模型transport为既有离线替身，不是真实供应商。正常artifact available后重开item_groups成功，原未选workspace_profile拒绝；改变Core原group状态后原结果stale、来源拒绝；撤销会话拒绝，模型发送数不增、无配置动作。exit0。必要Compiler API noEmit原场景模块/client-request根0诊断/exit0，diffcheck0，tests/fixtures无新增修改，非TAP断言不虚报套数。

实际命令：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline真实持久artifact与来源重开断言>'；ts-node非transpileOnly。固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT/TEMP/TMP与AI_OFFLINE_AUDIT=output/ca-business-bounded-20261014.audit均本树绝对路径。只提交这两源码和此记录，output保留不提交。

未验真实HTTP/MySQL/模型/浏览器/设备/生产，完整多分区/并发版本变化矩阵本轮未跑。开业通知没有正式readiness key，继续独立settings场景，不借其他分区执行。四品类企业资格缺真实来源保持原qualification_required；本片不宣称原AIN完成。
