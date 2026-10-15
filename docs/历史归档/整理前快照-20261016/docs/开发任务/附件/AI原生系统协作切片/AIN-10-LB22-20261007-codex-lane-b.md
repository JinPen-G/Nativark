# LB22 当前身份知识门面及有界管理读取（包A/B）

实际HEAD8446b529（比负责人观察af7c4614更新，撤销及模块交付保留），正确lane-b分支、工作区干净、无MERGE_HEAD；未同步移动主线，未写其他树或历史output。

HumanKnowledgeService({db,auth,credentials,authorization,clock,files?})复用实际AuthService身份resolver、原文档服务/Prisma仓储/文本parser/publication。create/read/parse/publish/revise/withdraw/delete/reconcileParse/operation不接受caller context/actor/scope。KnowledgeCurrentSession在每次动作授权前后复核当前会话/空间/权限数据，正式KnowledgeAuthorization仍必需，无猜测ACL。缺files只禁parse且不创建pending收据，元数据合法功能保留；不fetch URL、不提供假bytes。

输出管理投影分开publication/parsing/indexing/parseOperation/indexJob/version/revision/failure与nextStep，nextStep只是提示，明确actionAuthorization:required。operation只读原收据，recorded不等于解析/索引已完成；解析结果仍走reconcileParse。

list支持正式状态字段过滤及ID稳定排序，DB每次只取当前workspace最多100条最少元数据，再逐文档授权及head复读，输出最多50，不返正文/attachment/总数或未授权资源。truncated只根据已授权结果。可靠分页尚未交付：显式pagination:unavailable、coverage:bounded_window，不编造cursor、不把100条窗口称全量。主线需提供可查询的正式ACL/主体可见性限定或合法有界枚举端口，再结合tenant/workspace/id复合索引与窗口修订提供可靠分页；现有自由字符串ACL不能本线解释。后续范围内有授权对象也不能据此声称已完整枚举。

一次定向冒烟node --test tests/ai-native-knowledge-lane-b-management.test.cjs：2pass/0fail/cancel/skip/todo，exit0。实际门面→真实身份resolver→原服务→Prisma仓储，DB/Auth执行、文件与动作政策为显式替身；覆盖create/parse/未索引禁止publish/revise/delete/list隔离/收据读取/撤销会话/缺files元数据独立。ts-node transpileOnly:false为必要类型检查；最终自查补空列表也复验全局授权，未扩大测试矩阵。diff --check退出0。

固定无效DATABASE_URL、本树prisma-offline-preload.cjs与lane-b-local-runtime.cjs，绝对output/lb22-audit。未读.env、启服务、联网/真实DB/模型/支付、迁移/共享生成、push/main/部署。正式ACL/文件来源仍必需，未称生产全链或AIN整项完成。
