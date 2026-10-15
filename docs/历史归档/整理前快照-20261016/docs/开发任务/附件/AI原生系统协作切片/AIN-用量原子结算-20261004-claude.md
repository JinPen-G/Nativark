# AIN-11 用量原子结算切片（2026-10-04）

## 边界与基线

施工树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线 `8a346aa`。本片只修改主线用量服务、内部仓储端口、测试和本记录，不同步main，不修改schema/迁移、公共需求或开发任务。

之前精确reservation ID查询的修复不等于原子结算完成：旧服务仍分开appendLedger和transition。本片修复这个剩余缺口。

## 实现

- 新增必需原子端口 `UsageSettlementPort.commitUsage`。服务的settle/reconcile统一调用；没有原子端口返回ACCOUNTING_PENDING，禁止回退到分开两次写入。
- 旧仓储transition接口只保留reserved→released/unknown，不再允许用该接口写settled或计量。移除单独appendLedger入口。
- `PrismaUsageSettlementRepository`使用真实Prisma生成类型、一个有界Serializable事务，精确校验实际AiScope与reservation的tenant/workspace/id。
- 服务端必需授权端口在读取前及获得记录锁后重新授权，绑定C01主体/权限/范围与authorizationKey；不存在allow-all默认实现。模型不能生成该授权。
- CAS锁定原status、updatedAt、callId/idempotencyKey与预留值；更新实际用量及状态，然后在同事务内追加唯一账本事件。任何失败不会向调用方返回成功；模糊提交确认不自动重试。
- 同eventKey重放必须同时匹配reservation、tenant、kind、输入/输出用量与settled状态。不同内容、不同事件key再次结算、账本与状态不一致都拒绝；UNKNOWN只能经reconcile入口核对。
- 原始预留不因结算被清零，实际用量超过预留也如实保存，不截断、不补零。没有发明单价、币种或预算额度。
- 现有W07与精确ID回归改为调用实际事务适配器；数据库执行层为显式测试替身，不用fixture代替生产结算判断。

## 验证与失败修复

- 新增事务、重放、冲突、撤权、越范围、模糊提交等33项测试通过。
- 完整AI回归1153/1153，0 fail/skip/todo；API和Admin TypeScript检查通过。
- 收口后再跑46项定向测试，通过；包括禁止空/模糊查找键、禁止普通transition绕过账本的负编译检查。
- 测试前加载prisma-offline-preload，固定无效DATABASE_URL；没有.env或网络访问。未启动服务。
- 初次复用fixture重复安装ts-node，使新源码被编译两次并报隐式any；改为仅在进程尚无注册实例时安装，保留transpileOnly:false后复跑通过。
- 超长Bash测试文件写入命令发生引号截断、未写成功；改用专用Write完成，没有执行不完整脚本。
- 这是主Claude自查与自动化证据，没有独立review报告，不冒称独立验收。

## 未完成与后续

本适配器只处理workspace表中的结算，不负责预算上限的并发预留/释放余额，不代表完整用量仓储已完成。平台/tenant-wide账本模型、实际授权/计量证据适配、Gateway接线与dispatch单赢家仍需主Claude继续。现有schema不支持的scope明确拒绝，不伪造workspace。

真MySQL事务/锁/并发、真实模型用量、HTTP/设备/生产均未验；测试的串行事务替身不证明MySQL并发隔离。未注册Controller/AppModule/worker，AI工具仍不可据本片自动启用。当前迁移部署链还需专项核验，不以已通过离线测试宣称可直接部署。

## 辅助交接

负责人通知Codex B07完成；只读核对HEAD `1e0565fdf6d4194f2408ac9fbd5b518d1c3f04d0`，仅两张既有截图未跟踪。本片未合入B06/B07；已在对话派B08两端小程序独立组件/轮询配套16里程碑，主Claude继续核心所有权。B08不改全局路由、认证、上传、支付或服务端代码，作者完成后由负责人转交再核验。
