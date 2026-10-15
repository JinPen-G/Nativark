# AIN-05 能力证据准入边界（2026-10-04）

## 基线与所有权

唯一施工树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线 `4a16b713`。恢复时六个源码/测试改动均属本片；历史保全 patch 不纳入提交。未发现其他可达 Claude 写入会话；这不等于对机器全部进程的排他锁证明。Codex 只读核对至 `cb02eb32`，B09 交接仍有未完项，未合入；按用户上一请求在对话交付 B10 管理端宿主装配辅助包，无跨会话消息或跨树写入。公共需求、开发任务、main、schema 与迁移均未修改。

## 实现

- 文本连接探测只能产出 unverified，不能用文本回复推定 tools/vision/streaming 等能力或真实供应商验证；明确的 CAPABILITY_UNSUPPORTED 仍记录 unsupported。
- 能力证据严格绑定 Profile、scope、配置 revision、能力名与配置指纹；指纹包含 profileKey、协议、供应商、模型、credentialRef、角色、服务模式和声明能力集合。配置指纹不是签名或授权。
- mock 默认为不可准入，只有显式构造测试策略才允许。`live` 标签加配置指纹同样不足：必须有可信服务端 AiLiveCapabilityEvidenceVerifier 对完整证据进行验真，且返回严格 boolean true；没有适配器时拒绝。
- 验真端口接收副本，包含 Profile、能力、状态、来源、证据 hash、检查时间、失效时间和 metadata；本地策略与验真函数绑定在构造时，不因调用方替换 options 而改变。
- 声明/manual、缺证明、无失效时间、不在 Profile 声明集合内的 supported 写入降为 unverified。证据在异步验真期间过期时同样不能保持 supported；预检返回前重新检查全部通过候选，后一个验真等待不能使前一个过期证据仍获准入。
- 拒绝外 Profile/scope 记录及相同能力/revision 的重复记录，不采用 last-row-wins。旧 revision 历史不单独污染合法当前证据的 stale 标志。
- 严格验证 Profile、record 输入与日期；不可克隆数据、无效依赖、仓储/验真异常返回固定 CONFIG_INVALID，不泄露原错误，也不重试不明写入。SQL JSON null 作为缺少证明处理，不当作损坏记录。

## 自动化证据

新增 `tests/ai-native-capability-evidence-boundaries.test.cjs` 共40项。恢复后的新增失败基线为24通过/16失败，包含伪live准入、异常泄露、null JSON、过期等待及缺少严格输入校验。保留失败断言，未使用 skip/todo。首次修复后的类型检查发现 readonly 能力数组与 Zod 可变数组赋值不兼容，改为使用已验证的 RecordCapabilityEvidenceInput 类型，未使用 any 或 transpileOnly 绕过。

实际命令（均在本树运行，未启动服务）：

1. `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=1 --test-reporter=tap tests/ai-native-capability-evidence-boundaries.test.cjs tests/ai-native-provider-capability.test.cjs tests/ai-native-connection-test.test.cjs tests/ai-native-b03-capability-probe-regression.test.cjs`：49/49，退出0。
2. 同一 preload，全量 `tests/ai-native-*.test.cjs tests/ai-native-*.test.mjs`，`--test-concurrency=1 --test-reporter=tap`：1337/1337，退出0，fail/cancelled/skipped/todo均0。DATABASE_URL仅为固定不可用的本地端口1离线地址。
3. `npm run lint -w @rental-os/api`、`npm run lint -w @rental-os/admin`：均退出0。
4. `git diff --check`：退出0。相应 AI_OFFLINE_AUDIT 文件均不存在，即未记录被拦外联/.env读取；不是实际网络环境验收。

证据使用真实服务函数、内存仓储和注入验真替身；合成 live 标签只用于离线分支测试，没有生成真实供应商探测证书。主 Claude 自查，未运行独立 Review，不宣称独立审查通过。

## 明确未完成

- 尚无真实 capability-specific live verifier、可信证据发行与写授权适配；不能接一个只校验 metadata 的实现冒充验真。
- Profile 结构尚无 Base URL；实际地址/密钥变更必须使配置 revision 失效，完整地址配置来源仍待接通。
- 旧 capability 仓储仍有手写 Delegate 类型，数据库唯一键为 profileId+capability，只存当前头，不是不可变探测历史；本片未改变该表或迁移。
- 配置/授权必须在实际 dispatch 前复核，本片不是 dispatch permit，也不授予 record 写权限。
- 未验真实DB/迁移链、模型、设备、HTTP、浏览器或生产。不以1337项离线回归宣布任何 AIN 整项完成。

## 下一依赖与恢复点

继续公共 Gateway 接线。已读到 `unified-ai-gateway.service.ts` 仍拼接 workspace scope ID、写死 platform-default/tenant_managed/chat；`TenantModelConfigService.selection` 已有双轨兼容选择，但只有仓储/授权端口，尚未接实际配置存储。ProviderRouter 在 tenant_managed 下目前把 consumerScope 当作配置所有者，workspace 消费租户级配置需要明确真实 tenant owner，不能把二者混为一谈。下一片应组合实际 AiScope 查询、服务端模式/场景选择与 Profile owner 解析，保留当前授权复查，不伪造不存在的配置行或新增一层默认成功 stub。

另一个尚未完成的关键门：InvocationAdmission 仍没有 dispatching 单赢家与完整 actorKind/audience 持久化，不可让相同 admitted 重放直接成为第二次派发许可。主 Claude 保留实现权。

用户本轮要求5分钟心跳：已新建持久循环 `0f6f70c1`（`*/5 * * * *`），删除旧 `01cc7af2`，避免重复调度；7天自动到期，应用退出/机器休眠时不保证唤醒。
