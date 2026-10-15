# CA09 原任务重连事实消费

接续2a9ca639。composeAiTaskCenterScene.readReconnect({original,after,limit})先读取当前受权原任务，调用既有AiTaskEventRepository.readSnapshot/readPage，再复读快照与原任务身份/修订。返回原快照、水位、事件页或reset_required，不转换cursor为number、不发明安全继续游标、不读取事件正文冒充业务事实。快照变化拒绝；多次读取只标revalidated_reads_not_atomic_business_snapshot，不声称业务原子快照。

经主线明确授权，request-bound-scenes.application.ts只增加readTaskReconnect映射：既有full-model及selected-quote服务根，沿各自bindRequests的当前Guard/ALS。没有新HTTP/shared/worker/Gateway依赖；只读不调用runServices，不启动新run。原输入/模型结果/审批及订单收据仍由已有readScene和独立结果reader读取，本方法不创造授权或重派许可。

验证：node两原preload+inline ts-node非transpileOnly，固定无效DATABASE_URL，audit/TEMP/TMP/write-root全部本树绝对路径。实际task-center+event Prisma仓储正常读取、非法number cursor拒绝、撤权拒绝，exit0。必要Compiler API noEmit（原场景模块+client-request根）0诊断/exit0。直接断言非TAP，不报告虚构测试数；tests/fixtures无新增修改。请求根映射冒烟结果以本片提交前记录为准。

边界：存储为离线事务模拟，不等于MySQL行锁/保留策略验收；客户端如何丢弃旧视图及应用reset仍属宿主职责。无真实HTTP/浏览器/设备/DB/模型，未生产启用，不宣布CA09或AIN完成。

请求根inline已实际调用requestBoundOriginalModelHarness提供的动态模块provider→readTaskReconnect→现有快照/事件仓储。正常返回taskId/字符串cursor；numeric cursor拒绝；读取前后run、actionInput、模型发送和runServices工厂调用次数不变。第一次撤权断言exit1：inline误设无作用的control.revoked，并非产品忽略撤权。改为既有AuthService存储的identity.session=false后相关复验exit0，真实撤销会话拒绝。没有修改夹具或放宽生产校验。git diff --check退出0；命令级hooks禁用只用于防未知hook副作用，不宣称常规hook验收。
