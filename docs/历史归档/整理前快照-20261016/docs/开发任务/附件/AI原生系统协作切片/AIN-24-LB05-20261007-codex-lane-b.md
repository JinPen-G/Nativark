# Lane B 05：财务预算实际仓储竞争负例

前置 `718297c6`。仅新增测试/数据库执行替身、更新自己的威胁模型及自己的冻结评测清单；没有修改budget、Gateway、权限、schema或其他作者代码。

## 实际调用链与证据

`BudgetService.reserve` → `PrismaBudgetRepository.reserve` → 实际策略锁定/读取、scope归属检查、已占用聚合、数量上限检查、reservation.create、allocation.createMany。

`lane-b-financial-db.cjs` 只模拟Prisma读写、FOR UPDATE锁队列、事务提交/回滚和数据列默认值；没有复制预算额度/计价/授权算法。额度是否耗尽由实际仓储计算。授权与报价为明确合成依赖，证据端口未配置而拒绝（本测试不派发/结算）；并非正式权益授权验收，也不是预算新实现。

- 两个不同call/run请求争抢同一策略最后1 token，只有一个reservation/allocation提交，另一方EXHAUSTED；两次真实adapter锁查询。
- allocation写失败后，先前reservation写入回滚，实际服务返回PENDING_RECONCILIATION，不据此重发或退额。
- quote关联策略scope由数据库返回另一tenant，即使合成caller grant可用，真实仓储FORBIDDEN且零写入。

单策略锁执行为数据库替身，不能证明MySQL死锁/隔离/跨进程；没有把资源预算竞争当作财务预算竞争。三层最后额度交集竞争仍需进一步验收。

## 命令与结果

使用LB01两preload、固定无效DATABASE_URL和本树绝对 output/lane-b-financial-*.audit。

1. `node --test tests/ai-native-lane-b-financial-race.test.cjs`：尚无DB执行fixture时pass0/fail3/skip0，退出1。明确是新增验收设施未实现，不是已有生产缺陷。
2. 实际fixture完成后同命令：pass3/fail0/skip0/todo0，退出0。
3. `runThreatSuite(['financial-last-unit-race'])`：真实子进程同3项通过，退出0；冻结入口现在18套。本轮没有重跑其余17套，不把历史240和本轮3相加为一次最新全量。
4. `node --test tests/ai-native-lane-b-threat-runner.test.cjs`：pass3/fail0/skip0/todo0，退出0。
5. `git diff --check`：退出0。无TS源码修改；沿用LB04全API diagnostics0结果，未声称重新跑tsc。

文件：ai-native-lane-b-financial-race.test.cjs、fixtures/ai-native/lane-b-financial-db.cjs、evaluation/offline-threat-suite.cjs、自己威胁模型与本记录。

LB04记录中的“未覆盖财务最后额度”是当时真实状态，本片补上单层离线组合；历史记录不删除。三层/真库、正式授权/ACL/确认生产者、真实下载HTTP、生产审计持久化、模型语言评测和真实环境仍未交付/未验。没有跨模块已确认缺陷，本片只读运行既有预算，不越界修复。待主线独立复核，不宣称AIN-24完成。
