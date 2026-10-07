# AIN-10 LB15 下载附件绑定与固定基线同步

本树从6a4d8acc无WIP接续，固定依赖0aeea67970c67a9362906e234ef52ae5cc0640a8经无冲突merge形成42e18ec5。此前47c53ee6、79ed6cc8、13c42cf3、35bc84ad、6a4d8acc全部保留；对应76、71、128、52、71项为各片历史回归，不相加、不冒称主线统一验收。需求v1.2、任务v1.5和中央记录恢复为原28项，框架接入暂缓。

## 红测与实现

实际KnowledgeSourceService.download调用内容适配器时，旧实现传递before.document原对象。适配器改写attachmentId并返回它，比较依据也被改写，导致错误附件被接受。红测1项pass0/fail1/skip0/todo0，退出1（Missing expected rejection）。修复采用文档/context/source副本、返回引用立即快照、全head复读比较及调用方身份变化复验；仍仅返回attachmentId+documentVersion，不生成URL。

## 验证

固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；NODE_OPTIONS加载本树绝对prisma-offline-preload.cjs和lane-b-local-runtime.cjs；AI_OFFLINE_AUDIT为本树output/lb15-audit绝对路径。

命令：node --test --test-concurrency=2 tests/ai-native-knowledge-lane-b-download-binding.test.cjs tests/ai-native-knowledge-lane-b-authority.test.cjs tests/ai-native-knowledge-access.test.cjs tests/ai-native-knowledge-persistent-content.test.cjs tests/ai-native-knowledge-lifecycle.test.cjs。

结果40 pass/0 fail/0 cancelled/0 skip/0 todo，退出0；其中三项新测试验证别名替换、返回对象迟到修改和调用方身份等待中变化。生命周期测试包含知识目录strict noEmit。diff --check退出0。实际服务与Prisma仓储适配参与，DB/授权/文件执行为受控替身；无网络尝试。全API类型结果另记最终交接。

## 正式接入阻塞（不假称已装配）

1. persistent-knowledge.composition.ts仍必需authorization、memoryAuthorization、files。现有AiTaskCurrentIdentityAuthority可复用当前AuthService会话/空间身份，但它只证明身份，不授予文档动作；AiKnowledgeAcl.subjectType/permission为自由字符串，尚无正式动作映射、audience/权限修订依据。主线需确定各KnowledgeAction/MemoryAction对应的既有合法权限及资源政策、ACL修订来源；本线不猜read字符串或owner即全权。
2. FileStorageRuntimeService.assertBusinessReference未登记知识文档类型；公开downloadUrl可签名但无有界正文读取方法。需要主线提供知识document/version/attachment与FileAsset业务归属绑定，以及在现有文件服务内的有界bytes读取和每次下载重授权入口。不能在本线fetch签名URL或用通用租户下载绕过文档ACL。
3. AiHumanConfirmation已有读回和事务绑定，但本树源码未发现正式create/upsert生产者。需要主线提供当前人类会话授权动作、确认/撤销生产入口及其幂等绑定；subjectId/confirmedBy/proposalHash/proposalRevision/expiry/state需与现有memoryConfirmationHash一致，模型/automation不可生产。

以上为具体代码依赖，非仅环境未验。未运行真实MySQL/文件存储/HTTP/模型/支付/浏览器/设备；缓存仅单进程失效，多实例依靠每次读取当前授权/head拒绝，非分布式清除已实现。待主线独立复核，不改完成率。
