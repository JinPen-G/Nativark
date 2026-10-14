# CA04 原澄清报价选择的操作核对

接续f30d8363，只改主线明确授权的composeRequestBoundClarifiedQuoteSelection局部。该既有消费者/token增加readOperation(request,原AiQuoteSelectionCreateDraft,原clarification引用)。和select复用原收据来源检查，绑定原inputRef、task/run及原quoteId，然后调用既有PrismaQuoteSelectionRepository.reconcile按selectionKey和完整载荷核对；未观察到保持not_observed/retryable:false，不select、不创建第二报价、不授审批或执行订单。

select仍仅接当前quoted报价。readOperation允许原已保存的expired报价用于历史核对，仍核对同原引用/当前身份；是否可执行由原选择/审批服务另行决定，不把过期收据激活为新选择。没有新DTO、HTTP、持久表或执行链，registerHttpQuoteFlow已有AI_CLARIFIED_QUOTE_SELECTION_REQUESTS自动导出此方法。

## 快检边界

必要Compiler API noEmit（原场景模块/client-request根）0诊断、exit0；git diff --check0。Node沿用两原preload，DATABASE_URL固定无效、本树绝对audit/write-root/TEMP/TMP，inline ts-node transpileOnly:false；不新增修改测试/fixtures。直接断言不按TAP套数或AIN完成率统计。

正常链冒烟使用实际原请求/澄清、Auth/Guard、Core报价及原操作报价生产者、选择仓储和新consumer；数据库执行是合成离线来源，不是MySQL。命令初轮失败为inline接线问题：pending无taskId、请求根禁止credentials、持久Gateway缺必需适配列表和配置delegate，另有一次inline局部变量重名语法错误。保留真实非零结果，未改生产检查；相关最终复验及其限制在提交前补记。

最终相关复验exit0：实际原请求→模型暂停→明确提交澄清并中止自动继续→实际Core正式报价及同操作持久源→readOperation缺记录返回not_observed/false且selection零条→明确select→readOperation返回同一selectionId。一份原报价、一份选择，错误quoteId/撤销真实会话后读取拒绝，读取无新增模型发送、approval零条。最后一次初轮未观察到的断言失败还定位到inline补配置delegate时覆盖了选择读取delegate；修为只补五个配置表后通过，未改生产实现。无新增/修改tests/fixtures，不用合成选择或审批结果冒充生产者。

本片完整命令形态：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际服务链断言>'；用本树现有runtime，无视图/服务启动。audit沿output/ca-original-booking-flow-positive-20261014.audit追加，属于本树历史输出，不提交。期满历史读取分支本轮仅类型/源码核查，未用新时钟场景验证；选择提交COMMIT应答丢失、全审批/Core建单同样未纳入本轮正常冒烟，不能据此声称通过。

可接续状态：CA08原生产者到原页接收与not_observed读取、CA09原快照/事件重连、CA04原澄清选择核对均已有可调用入口及本轮离线证据；既有订单citation重开/开业单分区/审批与建单结果读取直接复用，未重复计新增。公开HTTP若需承载readTaskReconnect或更强来源绑定的readOperation，必须由主线统一核对现有合同/Controller；本线不另造地址。公共企业付款授权、通用开业分区提案和真实环境验收仍须主线/对应负责线提供，保持原拒绝。后续仅承接主线明确的新功能缺口，不靠重复测试或同义包装扩产出。

未运行真实HTTP/DB/模型/支付，无真实MySQL并发/事务应答丢失、浏览器/设备或生产证据。新consumer仅恢复原选择，不替代原审批/Core事务；报价、选择、批准、建单和付款继续分离。企业付款资格及通用开业分区提案端口未齐时保持unavailable，不扩员工/会员权限白名单。
