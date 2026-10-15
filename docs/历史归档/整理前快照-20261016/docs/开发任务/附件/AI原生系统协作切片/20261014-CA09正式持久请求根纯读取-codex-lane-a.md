# CA09 正式持久请求根的纯读取接线

基线caaa9a42后安全同步主线指定1542f004，合并点aef24afe，无冲突，保留本树后续成果和output。主线明确授权仅request-bound-scenes.application.ts的composeRequestBoundOriginalTaskRecoveryReaders/composeRequestBoundPersistedOriginalSceneModel区域；不改settings专用文件/创建函数/公共runner或协议。

## 实际断点与实现

旧full-model及selected-quote根已有readReconnect，但正式持久模型请求根未暴露对应纯读取。现由原RecoveryReaders组合既有composePersistedTaskCenter和composeAiTaskCenterScene，公开readTaskPage/readTaskEvents/readTaskReconnect/readTaskUsage，正式持久模型请求根直接映射同一reader。不另造快照、事件页或任务状态机，不经模型执行call构造Gateway。原结果/来源/澄清收据/审批及业务unknown读取继续各自正式reader，不从事件正文推断业务成功，不因reset创建run/重派。

原Bearer、Auth/Guard/ALS、owner/scope/action-policy和读后当前身份复验保留。重连接收原inputRef+原字符串after/limit，返回原snapshot与page/reset水位；不转换number、不发明“可安全继续”的cursor，不把任务metadata当审批或支付结果。没有新HTTP/shared/定时器/AppModule注册。

## 实际快检

一次inline actual composeRequestBoundPersistedOriginalSceneModel→原RecoveryReaders→实际task/event Prisma仓储；DB执行使用原离线事务替身。刻意注入空Gateway适配列表及会抛错的audit/secrets（这不是有效执行配置）：普通重连成功且这些依赖调用0，证明未构造/调用Gateway。把原任务eventCursor设为9007199254740993字符串精度对应的BigInt、保留缺失事件历史，读取返回原reset_required且不附造nextCursor；按快照水位再次读得到同字符串cursor。numeric cursor拒绝，撤销真实会话拒绝，run/actionInput/模型发送数量不变。实际exit0，非TAP断言不虚报测试数。

命令沿本树原双preload：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际持久请求根断言>'，ts-node transpileOnly:false。固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT/TEMP/TMP为本树绝对路径，AI_OFFLINE_AUDIT=本树output/ca-business-bounded-20261014.audit。必要Compiler API noEmit原场景模块/client-request根0诊断/exit0；git diff --check0；tests/fixtures无新增修改。

## 未验与边界

未跑真实HTTP、MySQL锁/宕机、模型、支付、浏览器或设备，不称原AIN通过。公开路由需主线正式合同承载；本片只显式服务器入口。待澄清仍由原当前输入reader核对动态问题，待审批及unknown仍由原receipt/result reader核对，不打包成新DTO或隐式恢复执行。主线独立settings-task-read读取端口已固定b9cddca2，本片不重复其原creationKey/changeKey协议，也不把开业九分区借作通知写入。
