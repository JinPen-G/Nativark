# Lane B 01：授权等待与来源下载修订

负责人授权：AIN-10 / AIN-24 辅助实现；施工分支 `ai/codex-ai-native-lane-b-20261007`。固定基线 `06c5cd1a` 已快进到 `da6fb9ae`，没有重复合并其他活动 HEAD。

## 实际实现

- knowledge authorize 隔离上下文、请求及返回 grant；等待前后检查指纹，禁止 caller/dependency 改写主体、audience、范围或请求后继续通过。
- source download 在引用读取前后核查当前下载授权 grant；权限修订变化拒绝返回附件引用。仅返回 attachmentId/version，不创建下载 URL。
- 两个测试适配文件使 runtime 和严格 TS 解析当前树 shared 源码及当前树 Prisma client，而非根仓库旧产物。不生成假契约，不放宽 realpath 校验。

## 命令与实际结果

全部 Node 命令均设置 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，`AI_OFFLINE_AUDIT` 为本树 `output/` 下绝对路径；NODE_OPTIONS 预加载 prisma-offline-preload.cjs，以及 lane-b-local-runtime.cjs（生成命令仅第一个 preload）。没有读取 .env。

1. 首次 knowledge/memory 回归退出 1：根仓库 shared/Prisma 类型解析不匹配，环境阻塞，未计为业务失败；不虚报完整计数。
2. `node scripts/ai-native-generate-local-prisma.cjs`：退出 0，隔离生成成功，guardViolations=0，sharedArtifactsUnchanged=true；不执行迁移、不连接数据库。
3. 使用两个 preload，`node --test` 加所有 `tests/ai-native-knowledge-*.test.cjs` 和 `tests/ai-native-memory-*.test.cjs`：修正类型路径后，基线 pass182/fail0/skip0，退出0。
4. `node --test tests/ai-native-knowledge-lane-b-authority.test.cjs`：红测 pass0/fail3/skip0，退出1，分别为身份被替换仍通过、返回 grant 共享引用、下载期间权限修订变化仍返回附件。
5. `node --test --test-concurrency=2` 加所有 knowledge/memory 测试（当时不含后续 LB02 文件）：pass185/fail0/skip0/todo0，退出0。其中实际 knowledge strict TS noEmit 与 imported contracts 检查通过；不是全 API 类型检查，也不冒称执行了普通 API build。
6. `git diff --check`：退出0，仅 CRLF 转换提示。

## 归属与边界

本片五个源码/测试文件及本记录：knowledge-validation.ts、knowledge-source.service.ts、knowledge-service.cjs、lane-b-local-runtime.cjs、ai-native-knowledge-lane-b-authority.test.cjs。后续记忆红测不纳入本片提交。

证据：真实知识服务与授权边界、显式合成依赖、已有 Prisma 仓储事务替身回归。没有真实 Auth/HTTP/数据库锁/下载执行/模型/浏览器/设备验证。当前修订复验不是原子服务端准入；实际 ACL grant 生产者、分布式缓存通知和真实下载入口仍须主线装配。未发现需跨边界修复的生产缺陷；未做独立 Review，待主线复核。不宣称 AIN-10 或 AIN-24 完成。
