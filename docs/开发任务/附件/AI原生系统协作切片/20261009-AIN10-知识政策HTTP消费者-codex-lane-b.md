# AIN-10 知识政策 HTTP 消费者

固定依赖 `ae16281d1b7d41fe452356f712f4731f454a1878`，本树 ff-only 同步后施工。仅新增 knowledge 控制器/显式 HTTP 模块，复用原工厂八方法，不修改公共 Auth、schema、shared、AppModule 或管理根记录。

入口：`KnowledgePolicyManagementHttpModule.registerHttp({ enabled: true, application })`；application 必须由原 `createKnowledgePolicyManagementFactory` 和真实 Auth/Guard/仓储组合提供。默认导入或 enabled 非 true 无控制器；显式启用缺方法拒绝。路由逐一使用 `AI_KNOWLEDGE_POLICY_HTTP_DRAFT` 的 basePath 与八个冻结 POST 子路径。

Controller 从 Authorization 读取凭据并生成服务器 requestId，固定 operator 只声明此运输入口，实际身份、当前空间、成员及动作仍由原 Auth/Guard 校验。每个调用建立独立空 ALS；正文克隆后经原服务严格校验，不接收 caller actor/scope/root 授权。原操作 unknown 返回保持原样，不替换 operationKey 或重试。异常仅按 `AI_KNOWLEDGE_POLICY_HTTP_ERRORS` 返回 code/retryable:false；普通异常及缺根都映射安全 unavailable，不回显异常、标题或资源存在性。

验证采用原正式授权测试中的真实工厂/Auth/Guard/服务与事务替身，直接调用实际 Controller。新增一次功能冒烟覆盖 prepareTarget、target、read、缺根、正文自授字段拒绝、当前会话撤销、模块默认关闭/缺依赖。

- 红测：只运行新增用例，0 pass / 1 fail / 0 skip / 0 todo，exit 1（Controller 尚不存在）。
- 实现后同文件 7 pass / 0 fail / 0 skip / 0 todo，exit 0；补充 read 和缺 application 两个断言后定向复验 1 pass / 0 fail / 0 skip / 0 todo，exit 0。
- 首次 API noEmit 因同步后旧本树 client 缺 AiRun.inputReceiptId/resourceOriginRunId 等字段，28 diagnostics、exit 1；未改跨线源码。沿既有隔离生成方案更新后 noEmit 0 diagnostics、exit 0。
- 隔离 client generate exit 0，guardViolations 0，sharedArtifactsUnchanged true；schemaHash `48660d96cdee65a423afc0b016c46fc260d3e9aef4a94c02490c53f8b461b39f`。保留 helper 留下的 previous/temp，未手工清理历史 output/锁。
- `git diff --check` exit 0。

实际命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs`；红测及最后定向复验加 `--test-name-pattern='HTTP policy consumer'`。生成使用 `node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs scripts/ai-native-generate-local-prisma.cjs`。类型检查使用 TypeScript API 的 API tsconfig/noEmit/incremental:false、工作树 Prisma 及 shared paths，不生成业务产物。

以上 Node 均 preload、固定无效 DATABASE_URL；AI_OFFLINE_AUDIT/TEMP/TMP 在本树 output/inspection-lb05-tmp。未启动 HTTP 服务、未连接真实 DB/文件/模型/支付。证据是实际 Controller 方法调用，不是 Nest HTTP/socket 或部署验收。

待主线：可信治理根置备、公共 OpenAPI、生产依赖及显式 AppModule 决定；本片不 seed 根，不以 system:params:manage 自动授资源。不声称 AIN-10 完成。Controller 只依赖稳定应用合同，Runtime/checkpoint 与 Provider/SDK 替换相互独立，本片没有引入模型调用或第二账本。

## 20261012 CB12：管理生命周期请求宿主 WIP（验证阻塞）

固定 base `a63954aa48edde098a54188cf78474467f810782`；唯一工作树 `codex-ai-native-lane-b`、分支 `ai/codex-ai-native-lane-b-20261007`。本节是作者未提交交付，不是主线验收；上文历史通过数不能算作本次验证。无心跳、无提交/推送/合并，旧 output 和锁保留。

- 新增 `human-knowledge-management.composition.ts`、`human-knowledge-management.controller.ts`、独立 shared 叶子 `ai-knowledge-management-http-draft.ts`；修改 `human-knowledge.module.ts` 与原 `ai-native-knowledge-lane-b-formal-authorization.test.cjs`，本交付记录为第六个文件。
- `HumanKnowledgeModule.registerManagementHttp({ enabled: true, dependencies })` 显式注册九个 POST：prepareCreate/create/parse/reconcileParse/revise/publish/withdraw/delete/operationStatus。默认无控制器；未接 AppModule、shared index 或中央 OpenAPI 聚合。
- 依赖为原 `KnowledgeFileApplicationDependencies` 去除 credentials/policyManagement/memory：db/auth/clock/integrations，可选原 objectIO 边界。工厂只提取这些基础设施；每次 open 从 Bearer 建立独立固定 operator 凭据，在独立 ALS 内调用，finally close 清除凭据。`composeKnowledgeFileApplication` 在本请求内构建原文件 runtime/access/session，避免复用其他请求凭据。
- 写操作严格要求相应动作 confirmation 字面量和 command；revise 另收 expectedRevision。confirmation 仅声明人工意图，不是授权。只读 prepare/reconcile/receipt 不转发写命令，不重试、不生成替代 operationId、不自动派索引。result_unknown 独立映射 AI_RESULT_UNKNOWN，所有错误 retryable:false，指引查原操作。
- 响应显式字段投影，无正文、owner、文件地址、授权快照或内部 fingerprint。操作收据与当前头分开；indexJob 保留原 kind/status/generation，physicalIndexDeletion 固定 not_verified，不把逻辑删除或待执行 remove 说成物理清除。

### 本次实际验证

仅执行原文件 `--test-name-pattern='prepared first document'`，未新增测试工程。父测试与测试子进程由命令行双 `-r` 加载原 prisma-offline-preload.cjs / lane-b-local-runtime.cjs；DATABASE_URL 固定离线值，audit/write/TEMP/TMP/TMPDIR/XDG_CACHE_HOME/npm_config_cache 均本树绝对路径，Node compile cache 禁用。

结果：exit1，pass0/fail1/cancelled0/skip0/todo0；在 fixture 装载时被 `rental-core-fact.repository.ts:2396-2397` 的 TS2353/TS2339 阻断，本树私有 Prisma client 缺 RentalInspectionRecord.revision。**尚未执行新增业务断言，不能称管理生命周期、JSON Schema 或新类型检查通过。** 原始输出 `output/cb12-knowledge-management-5Svy3y6s/smoke.tap`，`offline-audit.log` 0字节；`git diff --check` exit0。

原 schema:4782 确有 revision；私有 client owner 归本树，原 marker schemaHash `d3ab0bc57f02f4e59d13e8c8f924d3be035f12a9a6acd07d65fefa1bc053b032`，生成锁不存在。未执行生成：原 `scripts/ai-native-generate-local-prisma.cjs:105-111` 子进程只带一个 preload，未传全 cache/TMPDIR/compile-cache 限制；:135/:143 会清理旧 client 内容和临时 output，不符合本次保留要求。未改脚本、marker、owner 校验或 Core，也未忽略类型。

### 精确余项与下一包边界

1. 主线维护合规私有 client 生成入口：保留旧 client/output；子进程双 preload、完整隔离 env 和禁 compile cache。满足后只重跑上述同一小冒烟，首轮失败证据保留。
2. `knowledgePolicyResourceBasis:65-72` 将治理生产的政策锁在当前头 documentVersion/attachmentId/aclRevision，且拒绝 deleted。当前治理 HTTP 不能预置 revise 的旧头+新附件及新版本回读槽，delete 后原 load(action=delete)/operationStatus(read_metadata) 也会被该根规则阻止。下包须以原头版本/ACL/批准目标精确绑定补生产者，不能简单去掉 deleted/version 检查。
3. 本用例前半段计划使用原真实 Auth/Guard/治理政策/文件应用组合走首文档 create/parse/reconcile/publish/withdraw；后半段 revise/delete 的政策行及新附件绑定来自显式**原服务器预置 exact 政策与持久存储边界替身**，不是治理 HTTP 已能生产。全部仍未执行到，不虚报闭环。
4. 可信根置备、生产依赖、中央 shared/OpenAPI 聚合及最终启用继续归主线；本片不做索引 runner、文件/数据直接删除或 Runtime/Provider SDK 安装。
