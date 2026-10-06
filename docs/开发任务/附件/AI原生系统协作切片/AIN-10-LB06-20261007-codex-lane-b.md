# Lane B 06：知识来源快照与依赖别名隔离

前置 `09d252f7`。本片仅修改 knowledge source、离线真实服务行为测试和本 lane 记录；未改 shared/schema/鉴权入口/预算生产实现。

## 红测与修复

新增 `ai-native-knowledge-lane-b-source-snapshot.test.cjs` 驱动真实 `KnowledgeSourceService`：

- business fact 读取等待时权限修订变化原先仍可返回；
- fact provider 可通过输入别名改写历史 snapshot 为 current；
- content port 返回的 chunk 对象由调用者后改写可污染服务返回值。

修复 `knowledge-source.service.ts`：对 fact/source 入口做结构化快照；对 fact grant 在返回前复验；严格保持来源 fingerprint/version/locator；对 chunk/content 返回深复制，缓存与调用者不能共享正文/定位对象。没有把权限版本计数器当作授权来源。

## 验证

固定无效 `DATABASE_URL`、本树绝对 `AI_OFFLINE_AUDIT`、两个离线 preload；不读 env、不启服务、不联网。

- 红测：`node --test tests/ai-native-knowledge-lane-b-source-snapshot.test.cjs` pass0/fail3/skip0，退出1。
- 修复回归：`node --test --test-concurrency=2 tests/ai-native-knowledge-lane-b-source-snapshot.test.cjs tests/ai-native-knowledge-access.test.cjs tests/ai-native-knowledge-flow.test.cjs tests/ai-native-knowledge-cache.test.cjs tests/ai-native-knowledge-persistent-content.test.cjs`：pass59/fail0/skip0/todo0，退出0。
- `git diff --check`：待提交前运行；没有真实数据库/索引/下载/模型/HTTP。

证据层级：实际 knowledge service + persisted content/transaction substitutes；非实际 ACL生产者、真实分布式缓存、外部索引、HTTP 下载或 MySQL。主线仍需独立复核，不宣称 AIN-10 完成。与此前 LB01/LB02 的授权/确认竞态修复互补，历史记录不覆盖。
