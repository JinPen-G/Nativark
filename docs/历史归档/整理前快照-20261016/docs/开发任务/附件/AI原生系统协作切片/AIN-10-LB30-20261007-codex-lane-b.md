# LB30 可选偏好输入准备、显式装配与本批交接

施工树 codex-ai-native-lane-b，分支 ai/codex-ai-native-lane-b-20261007。本批起点270c29d8，非旧观察点3087d921；起始工作区干净，无MERGE_HEAD，未覆盖后续成果。本批仅knowledge、本线测试和新切片记录；未同步移动主线、修改公共契约/数据库模型/其他工作树。

## 可调用装配

新增 `composePersistedHumanKnowledge(deps)` 返回 management/context/index/preparation，接回原persistent composition文件。原内部context式composePersistedKnowledge签名及职责不变。

`HumanKnowledgeModule.register(deps)` 显式导出原三服务及 HumanKnowledgeInputService。必要deps为本树Prisma client、真实AuthService、服务器credentials来源、正式KnowledgeAuthorization、clock；files可缺，此时parse拒绝。可选memory={db,authorization}必须提供正式Memory动作政策，复用同一Auth/credentials；请求偏好但缺该依赖时unavailable，未请求时明确not_requested。没有HTTP/AppModule/worker/定时器注册。

主线宿主最小调用路径：

```ts
const services = composePersistedHumanKnowledge(deps);
const prepared = await services.preparation.collect({
  requestId, query, maxSources: 5, maxSnippetChars: 1000, maxTotalBytes: 16384,
}, { includePreferences: true, maxPreferences: 5 });
// ready/partial包才能复验；no_results/not_ready/failed等保持原状态，必要时重收集。
const checked = await services.preparation.revalidate(prepared);
// 主线随后将材料与业务事实一起冻结到其真实步骤输入；本线不冻结/派发。
// 原来源后续访问仍逐次鉴权：
await services.context.open(source);
await services.context.downloadReference(source); // 仅引用，真正下载入口须重新授权
```

preparation保留原collect包，附加独立preferences区（原confirmedPreferences投影），按整个结果校验调用方显式总字节预算。准备与复验均逐项读取真实确认；撤销后旧包拒绝。偏好不是规则、权限、业务事实或审批，不覆盖Core。sourceId/contentFingerprint/查询hash都是不可信材料的完整性信息，不是服务器签名，不证明召回完整度或永久授权。复验是顺序检查，不是多文档/记忆原子快照，主线实际冻结和派发仍须当前授权。

## 本批14项核对

| 项 | 交付及边界 |
|---|---|
| 1 | 原Memory WIP已在后续历史提交，本批未重复实现 |
| 2 | 复用5050ab1c confirmedPreferences：查询阶段100候选/最多50输出、逐项确认与动作检查；非完整分页 |
| 3 | LB28 state/changeStatus，撤销与删除分离，原操作收据核对 |
| 4 | 复用3087d921，LB28 confirmationRecovery映射原五态下一步，resume仍existing-only |
| 5 | 复用f62fdf8e有界筛选列表；可靠授权分页仍未实现，pagination=unavailable |
| 6 | LB29 detail，原当前版本/解析/发布/索引状态与正式逐动作政策；不返回正文 |
| 7 | 复用原parse/reconcileParse/operation，未知查原receipt；不能证明未执行时不自动重解析 |
| 8 | 复用270c29d8 index.status，发布/索引receipt分离，来源按当前head即时拒绝withdraw |
| 9 | LB29 resumeBatch最多10原job，同代次、当前人类、失败即停；非原子批次，无自动调度 |
| 10 | LB27 open/downloadReference复用原SourceService逐次鉴权，返回引用而非URL；实际文件读取/下载尚待正式公共生产者 |
| 11 | LB27 context.revalidate，原包受界限与当前来源指纹约束；无长期授权 |
| 12 | LB30 preparation.collect/revalidate，显式可选偏好与原知识分区；无Memory政策拒绝 |
| 13 | LB30 persistent factory及原opt-in模块导出全部新增服务；不注册生产根 |
| 14 | 下列定向实际服务/Prisma执行替身冒烟，未作全矩阵/真库验收 |

## 固定提交顺序

- 899345c8：LB27 来源引用与消费前复验。
- 9837f8b3：LB28 记忆状态、操作与恢复消费。
- 2c63e253：LB29 详情与有界索引接续。
- 本文件所在提交：LB30 组合准备及模块接线，同时收紧LB28中不合法确认期限的可用性判断。

## 实际验证

统一环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=本树output/lb27-audit、lb28-audit、lb29-audit、lb30-final-audit等绝对路径；NODE_OPTIONS双require本树prisma-offline-preload.cjs和lane-b-local-runtime.cjs。

- LB27：`node --test tests/ai-native-knowledge-lane-b-context-package.test.cjs`，pass1/fail0/cancel0/skip0/todo0，退出0。
- LB28：`node --test tests/ai-native-memory-lane-b-preferences.test.cjs tests/ai-native-memory-lane-b-resume.test.cjs`，pass2/fail0/cancel0/skip0/todo0，退出0。
- LB29：`node --test tests/ai-native-knowledge-lane-b-index-resume.test.cjs`，pass1/fail0/cancel0/skip0/todo0，退出0。
- LB30最终相关复验：`node --test tests/ai-native-knowledge-lane-b-input-composition.test.cjs tests/ai-native-memory-lane-b-preferences.test.cjs`，pass2/fail0/cancel0/skip0/todo0，退出0。包含实际create→parse→index→publish→知识及已确认偏好收集→复验→撤销后拒绝旧包，缺正式政策拒绝，无模型调用。
- API隔离noEmit：TypeScript compiler API读取apps/api/tsconfig.json、保留严格选项，noEmit=true/incremental=false，rootDir/baseUrl本树，paths绑定本树shared/src/index.ts和apps/api/node_modules/@prisma/client/index.d.ts。API_ISOLATED_DIAGNOSTICS=0，退出0。未跑普通构建、未修改共享生成物。
- git diff --check：退出0。各阶段数不相加声称主线全量验收。

## 精确剩余依赖/未实现

1. `knowledge.ports.ts` KnowledgeAuthorizationPort.authorize / MemoryAuthorizationPort.authorize仍需主线正式动作政策生产者。AuthService仅解析身份，测试政策不算正式授权装配。本线不猜AiKnowledgeAcl自由字符串含义。
2. KnowledgeFilePort.read(context,document,maxBytes)缺正式附件业务归属及读取中有界bytes适配。缺文件不能解析；downloadReference仅attachmentId/documentVersion，缺少最终逐次文档ACL授权的下载宿主时不能下载，不fetch签名URL。
3. 管理知识和偏好只提供有界窗口，不完整遍历。可靠分页需要正式授权可枚举限定/可见性窗口或分页依据及必要索引，由主线定义；不能泄漏被拒绝ID/总数，也不能自行修改schema。
4. failed index重试及未知parse重派没有新增安全政策；保持manual/not_ready/reconcile原操作。批次接续仅既有pending关系词法幂等任务。后台主体授权、队列/多实例失效机制未交付，本线没有Outbox/后台循环。
5. 来源检索继续是关系词法，单进程缓存拒绝/失效不代表分布式清除。真实MySQL锁/宕机/迁移、真实文件存储/下载、HTTP/模型/设备均未验。

全部可合法接通的本批入口已接回组合；上述依赖保持不可用，不等待重复派工、不无限扩回归、不更新AIN完成率、不宣称AIN-10/24结项。
