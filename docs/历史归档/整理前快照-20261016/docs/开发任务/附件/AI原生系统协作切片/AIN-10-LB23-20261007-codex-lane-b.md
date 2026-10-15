# LB23 受权知识上下文收集（包C）

HumanKnowledgeContextService({原HumanKnowledgeDependencies}).collect({requestId,query,maxSources,maxSnippetChars,maxTotalBytes})：真实当前身份→Prisma持久候选→原Retrieval→原Source正文ACL→最终逐来源重读/版本和内容指纹复验。open(source)再次走同一当前授权，返回片段而非bearer URL。不注册HTTP/模型工具，不调用Gateway或自行冻结step。

严格输入拒绝scope/URL/额外字段。maxSources<=10、maxSnippetChars<=2000、完整返回JSON<=maxTotalBytes（1024～65536），单片段UTF16安全截取，超预算项不纳入；有预算截断标partial，原no_results/not_ready/failed/unavailable原因与nextAction保持。输出sourceId、版本/ACL/段落引用、时点、完整块内容指纹与片段指纹。trust始终untrusted_data/purpose:context_only，不从文档解析工具、收件人或权限。

真实源读适配仍是现有有界关系词法机制：最多200块/200000字符的受权文档块查询，原recall最多12000字符；不是无界全文加载，但也不是按每个输出预算精确裁剪SQL取数，更不是向量检索。输出边界由本收集器额外限制。源数量上限可能使其他尚未命中的可用文档不在返回内，不称全量知识证明。

一次定向冒烟node --test tests/ai-native-knowledge-lane-b-context-package.test.cjs：1pass/0fail/cancel/skip/todo、exit0（17431ms），启用真实类型检查。实际创建→解析→原Prisma索引receipt→发布→词法召回→正文/指纹→预算partial→撤回拒绝原source→无结果；注入工具诱导文字仅作为数据，不产生调用。DB/Auth/文件/动作政策执行为明确替身，不代表正式依赖已交付。固定无效DATABASE_URL、绝对双preload、output/lb23-audit；diff --check退出0。

未读.env/联网/启服务/迁移/修改共享生成物/推送/部署。正式ACL/文件依赖仍须注入；真实DB/文件/模型/HTTP/多实例未验，不称AIN整项完成。
