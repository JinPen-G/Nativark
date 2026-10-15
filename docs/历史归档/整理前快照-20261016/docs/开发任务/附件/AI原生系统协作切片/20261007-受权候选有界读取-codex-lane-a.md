# Codex A 接续：受权候选实际查询与选择

接续观察点 e1341725；负责人确认临时作者停写，开工工作区干净，无合并状态。没有回退历史或修改主线树。

## 本片实际变化

- MembershipService.listPersonalOptionsPage 的本人/地点可见客户扩展最多取 201 项；超过 200 明确拒绝，不将部分集合当完整授权范围。原 listPersonalOptions 行为保留。
- 精确 customerId 查询同时约束订单可见性查询和客户查询；AI reader 支持受控 name/customerId/cursor，缺分页能力不悄悄回退无条件全量查询。
- 报价候选准备及复验使用同一受权客户查询，不依赖首 50 个客户中的本地筛选。
- truncated 不再允许超量结果；nextCursor 显式保留。此上限限制返回/应用内展开，并不证明数据库执行计划扫描行数或性能。

## 验证

全部 Node 命令使用 --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs；DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/lane-a-resume-audit.jsonl。

- 初始定向红测：新测试 3 项，pass 1 / fail 2 / skip 0 / todo 0，退出 1（之后补强参数验证测试以避免“缺 delegate 导致拒绝”的假证据）。
- 冒烟：node --test tests/ai-native-lane-a-bounded-member-page.test.cjs tests/ai-native-ain08-membership-candidate-read.test.cjs tests/ai-native-lane-a-quote-candidates.test.cjs；最终 pass 24 / fail 0 / skip 0 / todo 0，退出 0。第一次扩大到报价候选时旧数据库替身忽略新增 ID 条件，出现 7 失败；修替身执行查询条件，没有放松生产校验或删除断言。精确查询收窄候选集合后 selectionRevision 随之变化，交互测试补了重新确认步骤，旧配置仍拒绝。
- git diff --check：退出 0。
- API tsc --noEmit --incremental false：通过，退出 0（预加载后调用 typescript/lib/tsc，-p apps/api/tsconfig.json）。

## 下一依赖与未验

主线现有 composePersistedOrderTaskInput 需要已有 task/run/action，不能替代创建前原请求生产。两树 schema 目前仅有 AiTaskActionInput、澄清 AiTaskInputRequest/Receipt，创建前请求持久表缺失。将具体补丁需求另片交付；不往无关 JSON 或 Map 填充假生产者。没有运行真实数据库、HTTP、模型或微信/浏览器，不声明 AIN 完成。
