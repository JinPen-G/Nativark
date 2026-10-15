# AI Native 三线整合基线与后续所有权（2026-10-03）

## 实际接收

主开发树 `D:\工作文件\rental-OS\.claude\worktrees\claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`。

- 主线任务创建切片已提交 `616ff608323e11bb46da292a0c09a47b1d3ead7d`，234条回归通过，迁移未执行。
- 网关接收 `ceb0e650405758883439f4f2725d3df298af7cfa` 及其全部前序提交，形成真正双父合并 `941ddb7552c6f83403b90c1514a8bfc6723372b4`，而不是继续复制相同文件制造下一轮add/add冲突。
- 知识接收 `5bf5bef`（包含原Claude S01～S03及Codex接续S04/S05和交接）；原知识树只读，不覆盖其文件。知识/Gateway仍是未注册内部服务，不代表AppModule/HTTP或真实供应商已启用。

## 七处公共冲突的明确决议

Codex从f9b6630到ceb0e65未修改这七个文件，已用git diff --exit-code核实；再比较双方完整已提交diff。主线保留的版本包含Codex双轨内容及随后新增的能力型Intent/Port、显式SaaS consumerScope、平台用量scope、OpenAPI保义发布和消费者测试纠正，故仅对以下已核实文件恢复主线HEAD版本：

1. apps/api/src/contracts/openapi-document.ts
2. packages/shared/src/ai-gateway-draft-schemas.ts
3. packages/shared/src/ai-gateway-draft.ts
4. packages/shared/src/ai-usage-draft-schemas.ts
5. packages/shared/src/ai-usage-draft.ts
6. packages/shared/src/index.ts
7. tests/ai-native-contract-consumer.test.cjs

没有对整树使用ours/theirs，也没有删除Codex新网关/协议/测试文件。合并保留原提交祖先关系；接收方以当前Codex HEAD为祖先可快进，不应再合并旧de6快照。受权的需求/开发文档保持Codex版本，主线未改写。

## 整合修复与验证

- 任务创建迁移重现测试改为读取其固定目标提交616ff60的schema，新增独立“当前schema校验”测试；后续加迁移不会误报历史SQL被改写。
- 知识fixture原硬编码本树root/node_modules/@rental-os/shared，在主线依赖布局中不存在。改为从apps/api/package.json创建require，再验证真实shared entry属于本树；没有放松隔离断言或换成根目录构建。
- 底座与网关组合先379/379；新增当前schema校验定向14/14；知识/共享契约/发布组合121/121。均为本主线实际运行，不是复述作者报告。
- 最后以显式Node预加载护栏复跑所有42个AI测试文件：**671/671通过，0 fail/skip/todo**。读环境文件/Node出网审计为空；同时传固定无效本机测试DATABASE_URL，不使用真实共享库。测试数量包括历史KNOWN GAP/descriptor刻画，不能称为671个真实攻击或生产场景全部通过。
- shared build、全量API lint、490 controller operations、490 route permissions通过。Prisma迁移没有执行；HTTP/微信/真机/真实模型/支付/TLS实网/真库并发未验收。
- 非作者源码核对覆盖网关出网策略/传输/限额、Gateway组合fixture及知识Gateway上下文/动态模块，不宣称全模块独立安全审计。尝试独立代理仍被API400拒绝，没有有效报告，未计独立证据，也未继续递归派审查。

## 本轮后续分工

负责人明确要求下一批更长，并确认知识线交Codex继续。已给出12里程碑包（Profile、双轨配置、能力证据、Router、调用准入、预算、统一Gateway、协议流、连接测试、知识存储、记忆确认、组合故障验收）。

- 收到本轮整合SHA后，该长包期间Codex独占AI Profile/用量/知识新模型的Prisma schema/迁移整合；主Claude暂停schema/迁移写入，不与其双写。
- 现有task/run/step/事件/审批表不得擅自改义；Codex只加新模型及必要反向关系，使用包内明确新迁移目录，已提交迁移不可重写。
- 主Claude继续公共契约/OpenAPI、现有任务/审批仓储、运行器和统一授权；Codex需要公共变更给最小补丁建议，不新建重复DTO。
- 长包文件：`20261003-codex-网关知识持久化-12里程碑.md`。最终明确基线SHA在包首部及负责人转交消息中提供；此记录不伪造自引用提交号。
- 原中央记录/旧六切片派工/保全patch仍未提交，含已被覆盖假设，不作为当前产品依据。只读历史，不顺手纳入本次合并。

整合后的原能力仍默认关闭；后续真实授权/仓储/预算/输入和结果核验/设备/供应商放行须逐层兑现，不因基线可快进就视为已上线。
