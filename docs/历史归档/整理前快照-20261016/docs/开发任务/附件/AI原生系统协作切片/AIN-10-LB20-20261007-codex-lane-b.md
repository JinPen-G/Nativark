# LB20 解析提交未知的受权核对

KnowledgeDocumentService.reconcileParse(context,原mutationInput)接通原解析操作的只读核对：当前parse动作授权→原准入收据主体/载荷fingerprint→parse-result持久收据→当前授权及head复读。不读取文件、不重新解析、不写库或创建新operation。

最终结果已落库而COMMIT应答丢失时，读取同一收据确认parsed/failed/rejected；只有准入收据则result_unknown/reconcile，不能变成成功。文档在之后修订、发布或head变化时返回conflict，调用方另行受权读取当前文档，不把新head冒充旧解析结果。没有实现pending解析自动恢复，仍须主线提供合法恢复处置；不会因超时自动重派。

实际KnowledgeDocumentService+PrismaKnowledgeRepository、现有dbFactory事务替身。红测0pass/2fail（入口不存在）、exit1；实现后一次定向冒烟2pass/0fail/cancel/skip/todo、exit0。覆盖结果提交应答丢失→同操作读取成功且无额外读文件/写入、当前撤权拒绝、只有pending收据保持unknown。

命令node --test tests/ai-native-knowledge-lane-b-parse-reconcile.test.cjs；固定无效DATABASE_URL、本树双offline preload、绝对output/lb20-audit，transpileOnly:false使用实际类型。diff --check退出0。没有全矩阵扩大回归。

正式文档动作ACL、知识文件归属及有界bytes读取仍未交付；不以此受权端口消费者声称正式授权生产者已接通。真实MySQL/HTTP/模型未验，未读.env、启服务、迁移、生成共享产物、推送或部署。

本批必要API类型检查一次：现有TypeScript compiler API读取apps/api/tsconfig.json，保留严格选项、noEmit=true/incremental=false，rootDir/baseUrl为本树；paths固定@rental-os/shared到本树packages/shared/src/index.ts、@prisma/client到本树apps/api/node_modules/@prisma/client/index.d.ts。createProgram/getPreEmitDiagnostics输出API_ISOLATED_DIAGNOSTICS=0、exit0；使用同样双preload和output/lb20-types-audit。是源代码noEmit，不是普通构建或部署验收。

历史核对：git merge-base --is-ancestor分别检查47c53ee6、79ed6cc8、13c42cf3、35bc84ad、6a4d8acc对固定主线f647199c，均exit1（非祖先）；本树全部保留。此结果只表明固定历史未包含这些提交，不推断其他主线移动HEAD或等价补丁状态。主线接入需统一保留本树交付，不因框架暂缓丢弃。
