# AIN-05 真实路由所有者接线（2026-10-04）

## 基线与归属

施工树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线 `1ddb7513`。恢复时四处未提交路由改动均为主 Claude 本片。无其他可达 Claude 写入会话；未将此视为全机进程排他锁。历史保全 patch 未改、不提交。Codex 只读核对 `97709257` 及 B10 交接，按用户明确请求在对话给出 B11 原生宿主装配长任务；未向该树写入、未跨会话发消息、未合入其新提交。

## 实现与实际接线

- `AiScopeRepository.resolveRoutingScopes(mode)` 根据当前 C01 身份计算消费者和配置所有者的 canonical scopeKey，并查询真实 AiScope 行；平台统一模式查询平台所有者，租户 BYOK 查询消费者所属租户的所有者。workspace 不是 BYOK 配置所有者。缺行、字段不符、大小写错误或前后身份变更均拒绝，不补造 ID、默认行或跨模式回退。
- ProviderRouter 内部请求改为显式 `configurationScope`，替代与消费者混淆的 `platformScope`。租户模式只允许同租户 TENANT owner，平台模式只允许 PLATFORM owner；保留 Profile 声明与有效能力证据的交集。
- 新 `AiGatewayRoutingService` 组合真实 scope 解析、现有租户配置兼容选择与 ProviderRouter。它是 operator/staff + user + workspace 的桥接；平台、客户、automation 不伪装成 workspace。scene 在服务端构造时绑定，不由模型选择供应商或模型。
- 配置服务提供独立 `selectionForInvocation`，读前后均调用 invoke 权限端口；只具备 selection/read 的依赖不能构造路由服务。PlatformModelConfigService 显式转发此专用入口。原 selection 保持只读语义，不能替代调用权限。
- 路由等待后重读当前身份、模式 revision 和 owner；`assertCurrent` 完整重新解析并比对绑定，忽略纯 requestId/authorizedAt 更新，不忽略权限、身份、Profile、配置或能力变更。
- UnifiedAiGatewayService 的 invoke/stream 已消费上述路由端口，不再拼 scope ID，不再写死 platform-default、tenant_managed 或 chat。计量使用真实消费者 scope，传输使用 server-selected Profile 的 model，caller 不能覆盖实际模型。幂等指纹包含路由和当前身份绑定，不含临时请求时间。
- 预算等待之后、实际传输之前重新检查路由；每个缓冲文本片段及最终输出前再次检查。传给传输端口的 context/request/route 都是副本。已完成计量和完成记录后若权限失效，只拒绝输出，不把已提交完成记录倒退成 unknown。
- 每个新增异步路由检查都在现有 GatewayDeadline 内；没有新增无界等待。原迟到补偿、未知计量、源 EOF 后终态发布等回归保持。

## 验证

1. 路由与既有生命周期九套离线回归：106/106，通过。
2. 首批真实 Guard/Auth + Scope + 配置服务 + 能力服务 + Router + Gateway 组合：36/36，通过。随后增加所有 scope/audience 的 owner 矩阵、非法 owner、最终流式撤权及外层配置转发回归，新的组合文件最终53项。
3. 自查发现外层封装可能保留旧 selection 签名，退回 read 权限。主动停止第一次尚未完成的全量测试，改成独立 selectionForInvocation，增加专用回归；被停止的测试不作为通过证据。
4. 最终组合和 deadline 定向：76/76，退出0。
5. 最终完整 AI Native 回归：1392/1392，退出0，fail/cancelled/skipped/todo 均0。
6. `npm run lint -w @rental-os/api`、`npm run lint -w @rental-os/admin`、`git diff --check` 均退出0。

节点测试均使用 `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=1 --test-reporter=tap`。全量参数为 `tests/ai-native-*.test.cjs tests/ai-native-*.test.mjs`；DATABASE_URL 是固定端口1的不可用离线地址。对应 AI_OFFLINE_AUDIT 文件均不存在，未记录被拦外联或 .env 读取。

新增统一生命周期测试 fixture 明确只提供合成路由和无动作重检，不当作授权证明。新组合测试调用真实 AuthService、ApiAuthGuard、订单上下文 authority 和路由/配置/能力服务；会话库、AiScope、Profile、计量、调用权限策略和供应商端口是内存替身。mock 能力仅由显式测试策略准入；没有真实探测或真实供应商调用。证据不是 MySQL 并发、生产授权 wiring、浏览器或端到端验收。主 Claude 自查，未运行独立 Review。

## 未完成与下一步

- 新桥接不等于整个 C03 AiGatewayPortDraft 已实现。公共 Intent/result/stream 映射、客户/平台/automation 调用、附件及可选能力选择仍需后续接线。
- 真实数据库中的配置/凭据/Profile 一致来源及部署迁移链未验，仍须补齐应用组合根和实际持久化适配。Profile 尚不携带 Base URL；地址/密钥轮换与 revision 必须统一绑定，不能仅依赖本片比较。
- 路由重检不是原子 dispatch permit；调用权限策略仍由可信服务端端口提供。现有 admission 仍缺单赢家领取，预算 reserve 也不等于完整并发限额。每个片段重复解析的生产性能尚未验，不能用跳过授权检查优化。
- 下一核心切片：在预留预算前通过 admission status + dispatchId 原子领取唯一派发权，按完整调用指纹/token 收尾；输家不能取消赢家或污染其计量。明确 ack 不明不得自动重派，之后接公共 Gateway 与预算/审批消费。
- 未修改公共需求/任务文档、shared、schema/历史迁移或 Core；未启服务、访问真实DB/模型/支付、推送、合main或生产启用。AIN-01～AIN-28 不因本片回归计数被宣布整体完成。
