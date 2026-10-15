# AIN-10 知识与记忆线交接

负责人转交，Codex接手已中断“知识与记忆长任务 (fork)”。2026-10-03，只在知识专用树 `D:/工作文件/rental-OS/.worktrees/claude-ai-native-knowledge-20261003` / `ai/ai-native-knowledge-20261003` 接续。保留原Claude三片提交及未提交S04，不覆盖主协调者/Gateway的代码或公共文档；不合main、不推送、不直接发送其他会话消息。

## 五片提交

| 切片 | 完整提交SHA | 当前交付范围 |
| --- | --- | --- |
| S01 | e46f9ff039fb4d90a0e2fed25dd11d30d865a272 | 原Claude：版本/文档生命周期及受限ports |
| S02 | 6d6a5d7fac64b555a309660be0a7e2a039b37aa3 | 原Claude：授权检索、来源访问及业务事实引用 |
| S03 | bf7195f8cae346b149fcb9dbcdc90ccc46f53e8b | 原Claude：有界缓存、撤回/删除传播与索引fence |
| S04 | 6bbd4c3a806969980dead4595992e3de332c3122 | 原Claude六文件在途成果；Codex重新自复查/实测，补记录并提交：受限文本/确认偏好 |
| S05 | b19da678e7a74535e538b4826525cb08e60ce583 | Codex：Gateway最少上下文、显式动态模块、真实服务组合与负例 |

以上为派工限定的内部服务/离线交付，不等于AIN-10完整生产结项、主任务进度更新或独立Review。S04/S05详细记录包含失败过程与真实命令。协调者可按顺序消费五提交；本交接文档是单独附加提交，不在公共中央记录写入。

## 本轮实测汇总

- 接手续交S04前：lifecycle/access/cache/parser/memory/C06，64/64，退出0。
- S05及上述组合：88/88，退出0；本轮新增flow 24/24。最后补正正常mock结果schema正例后flow另复跑24/24。
- C03 Gateway公共契约单独回归27/27，退出0；不把mock视为真实模型证据。
- actual strict TypeScript noEmit零诊断；`node tests/fixtures/ai-native/knowledge-service.cjs --build` 真实知识模块隔离emit成功，不是整个API构建。
- 源码及cached diff检查通过。测试导入项目前拦截socket/fetch/DNS/TLS/UDP，组合连接尝试0。Gateway既有契约测试使用其原网络拦截，未更改旧fixture。
- 未运行真库、HTTP/Guard、浏览器、微信宿主/真机、真实模型、支付、生产灰度；没读.env或真实客户资料/密钥、没安装依赖/迁移/启动服务。无人工耗时/修正率统计。

## 精确文件清单

生产内部13文件均在 `apps/api/src/modules/ai-native/knowledge/`：

- knowledge.ports.ts
- knowledge-errors.ts
- knowledge-validation.ts
- knowledge-document.service.ts
- knowledge-publication.service.ts
- knowledge-retrieval.service.ts
- knowledge-source.service.ts
- knowledge-cache.ts
- knowledge-index-coordinator.ts
- knowledge-text-parser.ts
- structured-memory.service.ts
- knowledge-gateway-context.ts
- knowledge.module.ts

测试7文件：

- tests/ai-native-knowledge-lifecycle.test.cjs
- tests/ai-native-knowledge-access.test.cjs
- tests/ai-native-knowledge-cache.test.cjs
- tests/ai-native-knowledge-parser.test.cjs
- tests/ai-native-memory-service.test.cjs
- tests/ai-native-knowledge-flow.test.cjs
- tests/fixtures/ai-native/knowledge-service.cjs

记录6文件在 `docs/开发任务/附件/AI原生系统协作切片/`：AIN-10-S01-20261003-claude-knowledge.md、S02/S03/S04/S05同格式、本交接文件。未改其他专项、shared/OpenAPI、Prisma、依赖、鉴权、AppModule/Controller、网关、前端、中央/主任务文档。

## 主协调者接线清单

| 端口/位置 | 生产需要提供/验证 |
| --- | --- |
| KnowledgeAuthorizationPort / MemoryAuthorizationPort | AIN-04：可信server principal、actor/audience、tenant/workspace、own/字段/地点/current membership，accessKey随缩权修订，每次重授权 |
| KnowledgeRepositoryPort | 真实事务CAS、版本不可复用、operation唯一收据、不可变chunks/版本、tombstone合法留存；不使用测试MemoryRepository作为生产实现 |
| KnowledgeFilePort | 文件归属与正文独立授权、读取中限制字节、UTF8白名单、敏感信息/隐私脱敏政策；不接受任意路径/URL |
| KnowledgeSearchAuthorizationPort / SearchPort | 先限制候选scope/版本/ACL再查全文；最多100个候选约束、source-only结果，不先发送跨租户正文 |
| KnowledgeContentPort | snippet/正文/resolve/download分别重授权；业务fact引用保留snapshot/missing/legacy依据，附件最终下载入口重新核权 |
| KnowledgeIndexPort | 外部upsert/remove幂等与operation/version/ACL/generation提交fence；迟到upsert不能覆盖新版remove，失败重试与人工出口 |
| MemoryRepositoryPort / ConfirmationPort | 真实确认actor/scope/content/revision/ACL/期限，提交时仍确认未撤销；偏好不能授予工具或地点权限 |
| AiGatewayPortDraft | 主协调者对接Codex双轨Gateway真实实现；本片只调用Intent、required text，不直连供应商或读取配置密钥 |
| KnowledgeModule.register | 提供显式端口、sceneCode/输出预算及cache limits后由主协调者决定应用/Controller接线；本片不加入AppModule |

## 保留边界与待评测

无公共契约修改请求：本片当前可消费基线C03/C06；如果合入时公共契约已经演进，先重跑契约/类型测试，不靠复制DTO绕过。

前后重验证不是跨资源原子输出租约；部署需要确认撤权到响应发送窗口的策略和原子提交门控。Prompt分离只证明上下文结构，不证明真实模型能抗全部注入、不幻觉或引用一定准确；真实模型/业务事实输出评测仍未运行。SOP/偏好不替代Rental Core确定性业务接口；本片完全没有写订单/库存/计费/资金工具。

首批不支持PDF/Office/图片解析、向量Embedding/复杂RAG、知识UI、stream工具执行、真实确认UI/持久化、数据迁移与物理删除策略；unsupported/缺端口明确失败，不假成功。需求级范围和留存策略仍由主协调者核验；当前全部五片待非作者独立复核与生产接线。

残留资源仅知识树自有依赖/shared构建与ignored `apps/api/dist/knowledge-isolated` 产物，用于复核；没有DB/进程/端口/网络资源需要清理，未删除他人文件或旧截图。工作树保留用于协调者复核，不做归档/删除。
