# CB05 历史版本管理定向读取

接续 `213d26ce`，只写 B 树 Knowledge、原测试/fixture 和本记录，不改 schema/shared/公共授权或其他树。

`HumanKnowledgeService.versions` 原先为元数据列表加载每个版本的全部 chunks。本片接入 `PrismaKnowledgeRepository.versionMetadata`：范围关系限定、稳定版本顺序、最多20+1、显式 select 版本字段与 `_count.chunks`，不选择正文/state；列表仍按每个版本当前 `read_metadata` 授权，返回前复读 head。没有新增公开 DTO 或分页协议。

`compareVersions` 复用此元数据入口，对两版本分别核查 metadata/body 动作。缺历史正文权限只返回获准元数据，不读取 chunks；缺历史元数据权限整体拒绝。正文通过 `versionContent` 定向到同 document/contentHash/scope，take2 检测重复版本，chunks take201 检测超量；每版最多200块/200000字符。读回版本、状态和块数须与已观察元数据对应，返回前复读 head 并复核两份正文 grant。旧引用不跳转当前正文。保留原仓储 versions 方法以兼容已有内部调用，管理门面不再使用它。

验证只扩原 `tests/ai-native-knowledge-lane-b-versions.test.cjs`，没有新增脚本。原fixture增加 Prisma select/_count、contentHash/关系过滤与实际 take 语义，不替换服务决策。

- 红测：1 pass / 1 fail / 0 skip / 0 todo，退出1，证实元数据列表加载正文。
- 实现后同文件2 pass / 0 fail / 0 skip / 0 todo，退出0；补读等待期间修订变化后复验仍2 pass，退出0。
- 原 API tsconfig 以 noEmit、禁 incremental、本树 shared/隔离 Prisma paths 执行 TypeScript program：0 diagnostics，退出0；没有跳过错误或改strict。
- `git diff --check` 退出0。

Node命令使用原 `prisma-offline-preload.cjs` 与 `lane-b-local-runtime.cjs`，固定 DATABASE_URL `mysql://offline:offline@127.0.0.1:1/rental_os_offline`；AI_OFFLINE_AUDIT/TEMP/TMP为本树 `output/inspection-lb05-tmp` 下绝对路径。

只验证实际服务/仓储查询与受控DB/Auth替身。真实 MySQL查询性能/并发、历史版本正式政策置备及存储未验。版本模型没有完整历史附件元数据快照，不能由本片推断旧附件下载权限；本片只比较原持久 chunks，不生成历史下载URL。当前政策置备仍由主线认领，缺政策拒绝。不声明AIN-10完成。
