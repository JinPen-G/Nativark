# CA08 客户费用能力缺失降级

接续0ae92f17，修复客户费用检查端口缺失时的真实装配边界。此前`composeAiClientScenes`无论底层ClientApiService是否提供`feeItems`都暴露方法，费用解释会在缺能力时直接抛错；现仅在正式端口存在时装配`member.feeItems`，缺失时由`readOrderExplanation(fees)`返回`inspectionFees.coverage=unavailable`，订单金额事实仍可读取。

费用响应改为已知字段解析并剥离未知字段，同时绑定响应`orderId`；不会把服务端新增内部字段、内部备注或其他客户资料透传到AI材料。原费用检查金额仅表示已批准检查项，不转成支付/退款/责任事实。

没有新增测试脚本，扩既有`client scene authenticates`真实组合：正式feeItems结果、未知字段剥离、底层能力缺失仍可返回订单金额、错订单绑定拒绝；定向1pass/0fail/0skip/0todo，退出0。API源码noEmit=0诊断/退出0（`output/ca08-client-capability-types.audit`），diff check待提交前运行。固定无效DATABASE_URL和本树TEMP/TMP/AI_OFFLINE_AUDIT。

未验真实HTTP/MySQL/支付/模型/浏览器/微信/设备/生产；客户任务事件和终态读取继续等待正式客户专用端口，不复制运营任务中心。
