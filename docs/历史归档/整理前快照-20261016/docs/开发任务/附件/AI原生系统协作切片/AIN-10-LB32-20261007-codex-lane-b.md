# LB32 本次收集集合的受控引用消费

入口为现有HumanKnowledgeContextService.beginCitations(query)，自动通过现有module/composition可调用。先实际collect再建立最多10来源的服务器私有KnowledgeCitationSession，内部复制原包，绑定当前身份。它不是HTTP DTO、持久授权/缓存、模型工具或后台队列；重启需重新收集，无全局Map。宿主不可把模型传回的包构造成权威来源集合，模型只传sourceId数组。

manifest仅当前受权的ID/版本/chunk/真实locator/截断/内容指纹，不返回正文、scope封套、附件或下载URL。resolve只接受本集合ID，未知、URL、重复及超量拒绝；只证明来源成员关系，不证明回答语义。openMany最多10来源、2000字符/片段、64KiB总量，Unicode裁剪、每次原Source服务重新鉴权、前后复验原包，任何失败不返回部分正文或不可见对象详情。

recollect在同当前人类下重新实际收集，旧包不被静默改写。collect加入独立observationId，重新收集形成不同包指纹，即使正文未变。旧包revalidate仍兼容没有observationId的早期格式；该ID/hash不授予权限。本线不冻结主线step、不登记invocation、不调用模型。

一次定向冒烟首次因新增递归返回值缺注解发生TS7023，pass0/fail1/skip0/todo0，退出1；补明确Promise类型后仅复验原文件：`node --test tests/ai-native-knowledge-lane-b-citations.test.cjs` pass1/fail0/skip0/todo0，退出0。固定无效DB、本树lb32-audit、双preload。真实服务/仓储替身覆盖创建解析索引发布、本集合解析、未知/URL拒绝、Unicode、重收集新指纹、withdraw和切空间拒绝。

顺序授权/复验不宣称原子跨源快照；主线消费前仍复验。正式Knowledge动作和文件依赖未生产装配，MySQL/HTTP/模型未验。diff --check及本批最终类型结果见LB33。
