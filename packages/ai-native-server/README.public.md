# Zelo 公共 AI 服务端

选装服务包 `0.2.1` 保留公共模型配置、SaaS 设置、会话及 Task 原结果读取，并包含平台 AI 预算、费率和额度管理。业务 Core 的场景、工具、授权、业务执行和外发字段由其所属宿主提供。

使用 `public-package.cjs` 的 `publicAiClientPaths(ts, client, expectedSchema, readFile)` 核宿主已选择的公共 AI Prisma Client，并将返回值传给编译 `tsconfig.public.json` 的 `compilerOptions.paths`。`expectedSchema` 来自同一宿主底座及固定公共 AI 数据贡献。该检查只读已生成声明，不生成 Client。

用 `assemblePublicAiPackage('server', sources, emitted, ts)` 从同一固定源码、包相对材料和本次 `dist-public` 相对输出组装安装文件，可交现有确定性归档入口。服务端构建仅使用公共依赖。`package.public.json` 是该安装包的清单。原混合安装继续使用自己的包和原锁。

- `public-platform-model-settings` 以原 Auth、Guard、主体锁和同一数据库观察安装数据。可读旧操作收据，保存不取得模型调用或业务授权。
- `public-tenant-model-settings` 提供原租户设置读写、旧配置审阅、原键收据、模型目录和协议识别。将 `PublicTenantModelSettingsModule.register` 接到同一公共服务模块及 Client，工厂返回 `{ db, assertDataAvailable }`。用 `withPublicTenantModelSettingsHttpAccess(existingHttpAccess)` 注册原租户权限；在公共 SaaS 模型及财务文档后调用 `createPublicTenantModelSettingsOpenApi(document)`。租户管理员沿已有 `system:params:manage`，保存须带 `operationKey`。目录读取只提供元数据，模型能力与额度继续按原准入检查。
- `public-platform-finance` 在同一宿主上显式登记原八条 SaaS 财务路由。向 `PublicPlatformFinanceModule.register` 提供同一个 `PlatformServerModule` 和数据库模块，工厂返回 `{ db, profileId, assertDataAvailable }`。`profileId` 由服务器固定选择，`assertDataAvailable` 使用同一个所选数据能力的原账与结构观察。用 `withPublicPlatformFinanceHttpAccess(existingHttpAccess)` 登记原 Guard 政策，并用 `createPlatformFinanceOpenApi(existingDocument)` 合并同版文档。
- `model-configuration` 供宿主接原租户和平台配置服务，写入依赖真实的当前事务参加者。
- `task-persistence` 复用原 Task/Run 仓储和结果读取。宿主注入当前动作权限、原输入和独立收据权威，使用与原预算账相同的 `createAiTaskTransactionBoundary()`。新建和领取受当次事务约束；原结果继续由宿主按来源和字段权限投影，读取不会启动任务。
- `task-resource-ledger` 以同一严格事务边界维护 Task 的累计步骤数、调用数、活动耗时和输出字节。注入当前 Scope、已保存的计划上限及原计量证据。宿主须分别核新工作和原结清的权限，并在写入时复用传入事务。此出口可供 Runner 装配；Gateway 继续拥有模型金额账。
- `task-runner-resources` 将原计划、准备、预占和计量接到 `createPersistentAiTaskRunner` 的 `plan` 与 `resources`。使用同一严格事务边界和当前请求的 `resourceScopes`，通过 `bindEffectEvidence` 绑定原计量证据。领取恢复与释放租约也使用当次 Task 事务权威。实际工具、步骤转换与唯一 Gateway 仍由宿主显式登记。
- `task-steps` 将原 Step 登记、转换和回执接到同一 Runner。实例要求宿主的原证据、当前动作与收据权限、明确发布的工具及版本。写入复用原事务和原 CAS，重开只观察已登记 Step；提交后撤权保留原操作待核对。
- `task-measured-effects` 在实际调用前保存原开始标记，测量原注册工具的活动时间与正文 UTF-8 字节，并与同一 Runner 资源账结清。恢复只读原 Artifact。模型步骤须接原 Gateway 调用准备与同一账本的 `readDispatch`，该模块不会选供应商或派发模型。
- `gateway-admission` 提供租户级原调用的 `admission` 和 `dispatch` 参加者。使用同一严格 Task 事务边界和当次 `identities`，新建与领取须先绑定原 Invocation、当前主体、配置及期限；只有原令牌可以记录其终态。实际发送仍需原 Gateway 的路由、单账和末次授权。
- `public-tenant-gateway` 将已发布文本步骤的原输入、当前路由及预算接入 C03 和原单账。向 `createPublicTenantTaskGateway` 提供同一次已绑定的 `public-tenant-task-authority`、同一个 Task 边界、进程共享容量门、当前预算动作／权益判断、正式连接和注册协议适配器。将 `invocations`、`tools` 和 `dispatchEvidence` 交给原 Runner 测量。`recovery` 只按原调用读账，或按原已证明的未发／用量办理释放与结清。
- `model-configuration` 的 `createPublicTenantInvocationConfiguration` 读取原租户模式和加密 BYOK 连接，平台托管连接沿 `PrismaPlatformModelConnection`。两者均需当次执行权。管理设置、正常请求路由、场景输入发布、有效能力证明及正式费率／输入上限由现有授权入口提供。
- `public-tenant-task-authority` 用原签名请求、原主体锁和已保存的 Task action policy 提供当前动作与同事务复核。宿主必须固定实际权限、已发布场景和对象来源，注入真实 `assertTaskAction`、`assertReference` 和数据观察，并在请求结束关闭请求绑定。此入口不登记 HTTP 或任何默认场景。
- `runtime/budget/public-budget-ledger` 供正式 Gateway 接入原预算账本。新预占和派发需要同一个 Task 事务边界；平台预算、费率和额度 HTTP 本身只管理原政策及人工操作收据。
- `runtime/original-result-reads` 和 `runtime/original-task-recovery-read` 只观察真实原结果；租约、审批、原账和发布字段仍由原权威核对。缺当前授权或原证据时不可用。
