# CB-05/06 正式政策组合模块接线

接续9c61df7c，复用现有全部知识/记忆服务。新增 HumanKnowledgeModule.registerFormal：接现有 composeFormalPersistedHumanKnowledge，统一导出管理、上下文、索引、输入准备及可选 PersistentMemoryConsentService。AuthService、credentials、KnowledgePolicy、可选MemoryPolicy和文件Runtime仍由宿主显式注入，不自动注册HTTP/AppModule，不生产默认政策。

实际功能阻断修复：FormalMemoryAuthorizationAdapter 原来对 policy.resource.owner 用对象引用相等比较。持久政策读回/structuredClone后的同一owner必然是新对象，导致合法已有Memory读取、确认、修改都被拒绝。改为沿用已有内容指纹比较所有资源绑定，仍严格拒绝不同owner、revision、ACL与缺失绑定。Knowledge标量绑定同步使用同一比较方式，未放宽授权。

复用 tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs，没有新增脚本：先复现同owner独立对象被拒绝，0pass/1fail，退出码1。修复后1pass/0fail/0skip/0todo，退出码0。随后在同一冒烟接实际registerFormal→正式授权adapter→PersistentMemoryConsentService→真实Prisma仓储adapter→propose/confirm/read/revoke，仍1/0/0/0，退出码0；不同owner拒绝保持。政策源/当前会话与DB为离线替身，并非正式动作政策生产者或真MySQL证据。

命令 node --test tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs；prisma-offline-preload + lane-b-local-runtime；固定无效DATABASE_URL；AI_OFFLINE_AUDIT=本树output/cb06-owner-audit；TEMP/TMP=本树output/inspection-lb05-tmp。ts-node非transpileOnly检查加载源码；非全API tsc。git diff --check退出码0。

未验/依赖：正式Knowledge/Memory动作政策源仍须主线提供，不猜ACL/owner全权；知识附件业务归属和非签名URL有界内容读取仍须合法生产者；本片仅拒绝文件桩，不把它称为真实文件能力。A/R冻结输入消费不属于本线写入范围。没有改shared/schema、原文件设施、Gateway、runner或主线文档。
