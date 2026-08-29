# OPS-01A：专用环境发布与数据恢复预检

> 本文只覆盖 **OPS-01A**：专用环境的预检、迁移状态、备份、恢复演练与失败处置。
> 它**不等于** `OPS-01` 完成——完整发布编排、生产切流、密钥托管、监控告警、
> 回滚剧本与多环境流水线都不在本阶段范围内，见文末「未完成边界」。

## 1. 适用范围与硬边界

| 允许 | 禁止 |
| --- | --- |
| 在**专用库**上做预检、只读迁移状态检查、备份、恢复演练 | 在共享开发库 `store_rental` 或任何生产库上执行 |
| 连接信息来自 `DATABASE_URL`（进程环境或 `.env`） | 在脚本、文档或仓库里写死库名、账号、口令 |
| 恢复到**新建**的演练库并校验 | 把备份直接恢复回源库（那是事故处置，不是验证） |
| 删除**本次**创建的 `*_drill_<时间戳>` 库 | 删除任何其他库，或按模糊匹配清理 |

目标库必须命中专用库标记之一：`claude` / `e2e` / `drill` / `dedicated` / `sandbox`。
不命中即**默认拒绝**——黑名单永远漏项，`store_rental_backup` 这类名字不在黑名单里，
但同样不该被当作演练目标。

## 2. 准备条件

```bash
docker compose --project-name rental-platform up -d mysql
```

`.env`（或进程环境）需要：

| 变量 | 用途 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 源库连接串 | 必填。应用账号即可，只读源库与导出 |
| `MYSQL_ROOT_PASSWORD` 或 `OPS_ADMIN_PASSWORD` | 演练库 DDL | 仅恢复演练需要。建/删演练库要 DDL 权限，应用账号**不应**持有 |
| `OPS_ADMIN_USER` | 管理账号名 | 可选，默认 `root` |
| `OPS_BACKUP_DIR` | 备份目录 | 可选，默认仓库根 `backups/` |
| `OPS_MYSQL_CONTAINER` | 容器名 | 可选，默认 `store-rental-mysql` |
| `OPS_KEEP_DRILL=1` | 保留演练库 | 可选，排查时用 |

口令一律经 `MYSQL_PWD` 传给客户端，**不用** `-p<password>`（后者会进入容器内进程列表并触发明文告警）。
所有输出都过脱敏：日志、报错与报告里不会出现口令。

> 脱敏是「宁可多掩」：凡是与口令字面相同的片段都会被掩成 `***`。
> 本地夹具里 `DATABASE_URL` 的口令恰好是库名前缀，因此 `migration-status`
> 的输出会显示 `***_claude` —— 这是刻意的保守行为，不是错误。

## 3. 命令

```bash
npm run ops:preflight
```

```bash
npm run ops:migration-status
```

```bash
npm run ops:backup
```

```bash
npm run ops:restore-drill
```

```bash
npm run test:ops-dedicated
```

`restore-drill` 默认取 `backups/` 下该库最新的备份；也可显式指定：

```bash
npm run ops:restore-drill -- --file backups/store_rental_claude-20260829174533.sql
```

顺序固定：**预检 → 状态 → 备份 → 演练**。跳过预检直接备份或恢复没有意义——
预检失败的常见原因正是目标库配错。

## 4. 各步骤的判定口径

### 4.1 preflight（只读）

检查 docker、容器、`DATABASE_URL`、专用库守卫、连通性与目标库存在、`_prisma_migrations` 可读、备份目录可写。
任一项失败即退出非零。最后会打印一条守卫自检，确认共享库确实会被拒绝。

### 4.2 migration-status（只读）

只跑 `prisma validate` 与 `prisma migrate status`，**不会**执行 `migrate dev` / `migrate deploy`。
状态检查的价值就在于「先知道差什么，再决定动不动」；把检查和应用绑在一起，
等于每次想看状态都顺手改了库。

有待应用迁移时脚本退出非零，并列出三种处置方向（见 §5），但不自动选择任何一种。

### 4.3 backup

`mysqldump --single-transaction --quick --routines --events --triggers --databases <db>`。
三项产物判定缺一不可：

- 退出码非零 → 失败；
- 输出为空 → 失败（拒绝写出 0 字节备份）；
- 缺少 `Dump completed` 结束标记 → 失败（拒绝被截断的产物）。

产物：`backups/<db>-<yyyymmddHHMMSS>.sql` 与同名 `.sha256`。

### 4.4 restore-drill

1. 校验备份 sha256（有旁文件就必须匹配）；
2. 生成新库名 `<db>_drill_<14位时间戳>`，若已存在则拒绝复用；
3. 用管理账号建库；
4. 改写备份中的 `CREATE DATABASE` / `USE` / 限定名 `` `src`.`table` `` 指向演练库；
   改写后仍检出指向源库的**可执行**语句即拒绝导入（头部与分节注释里的库名不算，
   它们不会被执行）；
5. 导入；
6. 校验：表数量、已应用迁移条数、抽样表行数（`Tenant`、`business_workspaces`、
   `customer_profiles`、`_prisma_migrations`）与源库一致。抽样表**一张都没比上**时视为失败——
   空抽样下的「行数一致」是空话；
7. 成功则只删除本次创建的演练库；失败则**保留**并打印精确清理语句。

源库在全流程中只被读取。

## 5. 失败处置

| 现象 | 处置 |
| --- | --- |
| 预检失败 | 按提示修环境；不要跳过预检执行备份或恢复 |
| 迁移落后 | 先 `ops:backup` 留一份可恢复备份，再由**人工**执行 `prisma migrate deploy` |
| 迁移中断/失败 | 不要用 schema 回滚冒充数据恢复。先 `ops:restore-drill` 证明备份可用，再决定是修复迁移，还是把已验证备份恢复到新库并人工切换连接 |
| 备份校验和不匹配 | 该备份不可信，重做备份；不要拿它做演练或恢复 |
| 演练失败 | 演练库被保留供排查，脚本已打印 `DROP DATABASE` 语句；确认无需排查后手动执行 |
| 目标库不该被推进 | 换目标。不在这套库上继续 |

脚本不会自动回滚失败的迁移，也不会自动把演练结果切成线上连接——这两件事都需要人判断。

## 6. 残留数据的识别与清理

- 演练库：形如 `<db>_drill_<14位时间戳>`。成功即自动删除；失败按设计保留。
  盘点：`SHOW DATABASES LIKE '%drill%';`
- 备份文件：`backups/` 下 `.sql` 与 `.sha256`，脚本**不自动删除**——备份是恢复的前提，
  过期策略由运维按保留期决定。
- 脚本只删除自己创建且库名匹配 `*_drill_<14位时间戳>` 的库；源库、共享库与任何近似名字都不会被删。

## 7. 未完成边界（`OPS-01` 仍未完成）

本阶段**没有**覆盖：

- 完整发布编排与环境晋级流水线（构建产物、版本固定、灰度、回滚剧本）；
- 生产/预发环境的连接切换与流量切流；
- 密钥与凭据托管（当前依赖本地 env，未接入密钥管理服务）；
- 监控、告警与备份完整性的周期性巡检；
- 定时备份、异地/离线副本与保留期自动执行；
- 跨库/跨实例的一致性恢复（分库、只读副本、binlog 时间点恢复）。

在这些补齐前，不得声称 `OPS-01` 已完成。
