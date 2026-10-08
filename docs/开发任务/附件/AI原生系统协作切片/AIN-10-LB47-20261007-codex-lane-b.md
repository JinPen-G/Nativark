# AIN-10-LB47：显式暴露已装配的人类 Memory 门面

## 实现

- 复用 `PersistentMemoryConsentService` 的既有提议、读取、修改、确认、恢复、撤销与删除语义。
- `HumanKnowledgeInputService` 将已注入正式 Memory policy 的服务作为只读组合成员暴露；`composePersistedHumanKnowledge` 返回 `memory`，主线宿主可显式调用，不需要从内部对象或测试构造器取出。
- 未提供 Memory 依赖时仍返回 `undefined`；不创建默认授权、不注册路由、不将模型或 automation 变成人类确认主体。

## 验证

- `node --test tests/ai-native-knowledge-lane-b-formal-composition.test.cjs`：1 pass，0 fail，0 skip，0 todo，退出码 0。
- Knowledge 目录隔离类型检查：退出码 0。
- 使用本树离线 preload/runtime 与固定无效 `DATABASE_URL`，未连接真实数据库、文件服务或模型。

## 未验与依赖

- Formal Memory policy source 仍需主线接入真实动作政策；缺失时 `memory` 不可用或构造失败，不能默认放行。
- 真实确认记录、文件存储、MySQL 事务与跨实例撤回传播未验。
