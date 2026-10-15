# LB26 索引状态/同代次接续及完整模块（包F/交接）

HumanKnowledgeIndexService.request/status/resume复用原KnowledgeIndexCoordinator、真实PrismaKnowledgeIndexAdapter与同一当前身份/授权链。status对活动job原operationId/generation读持久关系词法receipt，保持元数据状态与receipt分别显示。resume只接受原documentId/operationId/generation：receipt已记录则只补coordinator.complete，不重调apply；未记录且pending则接续同一幂等关系事务。旧upsert代次在新remove后conflict；completed原job直接读回，不新增operation。failed状态保留manual/not_ready，没有自造failed→pending/换operation重试协议。

抽取relationalIndexReceipt仅统一原adapter与读取入口的标识/指纹计算，不修改算法、不替换索引机制。只支持现有关系词法adapter，外部索引unknown不在本服务自动重派；没有队列/Outbox/worker/生产开关。缓存或索引移除未完成时，原Source/Read仍依据当前withdrawn/deleted/head拒绝访问。

新增HumanKnowledgeModule.register({db,auth,credentials,authorization,clock,files?})显式导出HumanKnowledgeService、HumanKnowledgeContextService、HumanKnowledgeIndexService。与原HumanMemoryModule独立可装配，不注册HTTP/AppModule。授权为必需端口；缺文件源保留元数据但parse拒绝。生产者/消费者均复用原Prisma与当前身份服务，正式文档ACL与文件归属/有界bytes适配仍待主线注入，不能把测试政策算正式链。

一次定向冒烟node --test tests/ai-native-knowledge-lane-b-index-resume.test.cjs：1pass/0fail/cancel/skip/todo、exit0（7461ms）。实际模块→创建/解析→request→关系receipt提交丢应答→查询recorded→只补完成收据→发布→撤回→拒绝旧upsert→同remove完成。实际服务/Prisma，DB/Auth/文件/政策是明确执行替身。missing authorization注册拒绝。ts-node真实类型检查，diff --check退出0。固定offline环境与output/lb26-audit。

## 本批接线摘要

1. 管理宿主注入HumanKnowledgeModule，调用create/read/parse/publish/revise/withdraw/delete/operation/reconcileParse/list。状态提示不等于动作许可，每次执行仍授权。
2. 模型步骤在主线冻结输入前调用HumanKnowledgeContextService.collect严格查询/预算；该包仅untrusted_data，不携带执行许可、不调用模型。后续open(source)重授权。
3. 人类宿主注入HumanMemoryModule，调用已有propose/read/change/confirm/revoke，以及新增confirmationStatus/resumeConfirmation/confirmedPreferences。确认未知只能同operationId核对，不能新ID重做；修改需重新明确同意。不要将confirm注册为模型工具。
4. 调度方显式调用HumanKnowledgeIndexService.status/resume，原generation不可省略/改写；不启动后台循环，不将关系receipt当外部提交证明。

## 明确保留的未完成/依赖

- 包B可靠分页未完成：list是最多100候选/50输出的有界窗口，pagination:unavailable，不造cursor、不泄漏未授权总数。需要正式ACL可查询限定/合法可见性枚举及适用tenant/workspace/id索引、快照/窗口修订依据。
- 包E偏好也是当前主体有界窗口，audience在确认读回过滤；不宣称全量枚举或可靠分页。主线如需完整大规模读取应提供受权分页依据/适用audience索引，不能本线改schema。
- 正式KnowledgeAuthorization/MemoryAuthorization动作政策、文档ACL修订来源、知识附件FileAsset业务归属及有界bytes读取必须主线交付；身份解析不等于授权。本批消费者可调用，未称生产全链完成。
- pending解析的只读reconcile已接通，但未执行且结果未知的解析不自动重派；failed索引的安全重试政策仍未新增。外部索引/分布式广播未实现。
- 所有新身份门面目前只支持既有operator/staff workspace用户；未编造client/automation/platform适配。

本批按功能包一次定向冒烟，无扩大矩阵/递归审查。未读.env、启服务、联网/真实DB/模型/支付、迁移/共享生成、push/main/部署；真实MySQL锁/提交/多实例、文件存储、HTTP/模型/设备未验。不更新完成率、不称AIN整项验收。

最终必要API noEmit检查一次：现有TypeScript compiler API读取apps/api/tsconfig.json，保留严格选项，noEmit=true/incremental=false、rootDir/baseUrl为本树，paths显式绑定本树shared源码及隔离Prisma client（参数同LB20）。输出API_ISOLATED_DIAGNOSTICS=0、exit0；双offline preload、output/lb26-types-audit。这不是普通构建/主线全量回归。各定向测试为独立功能冒烟，不累加称全专项通过；没有独立审查结果。
