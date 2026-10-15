# CA08 客户取消预览只读消费

接续9cfcdd79，将既有客户取消费预览接到AI客户受权应用；不新增取消、退款或支付执行链。

`composeRequestBoundClientApplication.readOrderCancellationPreview(request,{orderId})`使用已有客户session、Guard/ALS、本人订单归属和`ClientApiService.previewCancellation`。结果仅保留订单、估算取消费、币种、计算时间和`estimated:true`；给出已有取消POST的人工出口，`execution:not_attempted`且`businessResult:not_inferred`。金额来自既有业务计价结果，AI层不重算；异常订单状态由既有服务拒绝，缺方法时返回不可用。

没有新增测试脚本，扩既有`client scene authenticates`实际组合。定向1pass/0fail/0skip/0todo，退出0，覆盖本人订单、既有取消费预览、人工确认出口与不执行声明；API源码noEmit=0诊断/退出0（`output/ca08-client-cancel-types.audit`），`git diff --check`退出0。固定无效DATABASE_URL和本树TEMP/TMP、AI_OFFLINE_AUDIT。

未验证真实HTTP/MySQL/支付/模型/浏览器/微信/设备/生产。POST取消仍不是AI应用职责，需现有客户页面和服务端幂等/权限；本片不把预览变成业务取消成功。
