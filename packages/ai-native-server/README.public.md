# Zelo 公共 AI 服务端

选装服务包 `0.2.0` 保留已经拆出的公共模型配置、SaaS 设置 HTTP、会话及 Task 原结果读取，以及同事务参加者的原导入路径。业务 Core 的场景、工具、授权、业务执行和外发字段由其所属宿主提供。

使用 `public-package.cjs` 的 `publicAiClientPaths(ts, client, expectedSchema, readFile)` 核宿主已选择的公共 AI Prisma Client，并将返回值传给编译 `tsconfig.public.json` 的 `compilerOptions.paths`。`expectedSchema` 来自同一宿主底座及固定公共 AI 数据贡献。该检查只读已生成声明，不生成 Client。

用 `assemblePublicAiPackage('server', sources, emitted, ts)` 从同一固定源码、包相对材料和本次 `dist-public` 相对输出组装安装文件，可交现有确定性归档入口。服务端构建仅使用公共依赖。`package.public.json` 是该安装包的清单。原混合安装继续使用自己的包和原锁。

- `public-platform-model-settings` 以原 Auth、Guard、主体锁和同一数据库观察安装数据。可读旧操作收据，保存不取得模型调用或业务授权。
- `model-configuration` 供宿主接原租户和平台配置服务，写入依赖真实的当前事务参加者。
- `runtime/original-result-reads` 和 `runtime/original-task-recovery-read` 只观察真实原结果；租约、审批、原账和发布字段仍由原权威核对。缺当前授权或原证据时不可用。
