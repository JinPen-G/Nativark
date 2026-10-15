# AIN-13 解释消费与人工交接

接续ce7e609b。入口`composeAiAuthorizedBusinessTools(...).orderExplanationPreparation(serverOrderId).prepare({modelAvailability?:'not_requested'|'unavailable'})`。复用已交付facts/nextSteps，不另建订单/财务服务。外层原订单Guard，所有子reader传同服务端context绑定；多次读取后复核订单updatedAt，原Guard复核当前主体。只产事实与缺口，不造自然语言原因，不将缺支付记录解释为零。可选finance仍统一unavailable，不暴露数量或存在性。

人工交接复用nextSteps受控订单引用，运营端附已核实`APP_ROUTES.orderDetail`符号及AppRouter.tsx来源（源码111行已实际注册）；不复制路由地址、不为员工猜地址、不发动作。候选与当前允许动作分开，后者仍unavailable，目标页面必须复核权限。信息缺口列history/payments/actualReceivedTotal/fundingLedger/inspectionExecution；不自动取消/退款/履约。

业务输入包`sealBusinessScenario`：JSON内容快照最大131072 UTF8字节，超限拒绝，不截断事实；payload深冻结，payloadFingerprint使用原requestFingerprint对同一payload计算。此内部内容不是公共DTO或授权凭证，不登记计划/派发/计费；主线必须冻结并发送同一payload。来源文字均为数据，不视为指令。模型不可用时仍交facts_only，无伪造回答；当前权限撤销或版本变化整体拒绝，不降级旧敏感事实。

本树绝对audit=output/lane-a-order-consumption.audit，DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-order-consumption.test.cjs`
实际服务组合2pass/0fail/0skip/0todo、exit0；验证真实Guard/Core/事实聚合/nextSteps/消费入口，DB执行替身。类型audit=output/lane-a-order-consumption-types.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`
exit0；diff check exit0。未跑全矩阵/真实HTTP/DB/模型/支付/设备。主线负责不可变输入登记、当前执行授权、模型答案/预算/审批；完整资金与allowed-actions依赖仍缺。作者交付不是AIN13验收。
