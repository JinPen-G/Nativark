# LB27 来源消费与冻结前复验

入口：HumanKnowledgeContextService.downloadReference / revalidate，随已有 HumanKnowledgeModule 导出服务可调用。沿原文档来源服务检查当前人类、scope、动作、版本、ACL、附件绑定；只交附件引用，不生成URL。revalidate 使用原 collect 格式，限制10来源/2000字符片段/64KiB，逐项验证当前正文指纹、片段指纹和定位；输入仍是不可信数据，不是授权凭证。

冒烟：固定无效DATABASE_URL、本树绝对AI_OFFLINE_AUDIT，Node双预加载 prisma-offline-preload.cjs、lane-b-local-runtime.cjs，执行 `node --test tests/ai-native-knowledge-lane-b-context-package.test.cjs`：pass1/fail0/skip0/todo0，退出0。实际服务及Prisma adapter，事务执行替身；包含合法下载引用、篡改片段及撤回后复验/下载拒绝。

未验：真实DB/HTTP/文件宿主。多来源顺序复验不是跨资源原子快照，不能取代主线冻结/派发时授权。公开动作政策和文件业务归属仍由宿主正式注入；没有生产根注册。必要类型检查统一在本批后执行。
