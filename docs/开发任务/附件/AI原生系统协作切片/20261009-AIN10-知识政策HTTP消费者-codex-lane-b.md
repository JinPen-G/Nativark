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
