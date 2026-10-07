# AIN-13 第二接续批：按问题最少读取与引用校验

接续0c0c3e0f。原orderExplanationPreparation入口新增question有限枚举status/fees/payments/next_steps，默认status（调用方若需资金必须明确payments）。未知值拒绝，不接受任意工具/SQL。默认只读取订单状态/版本，输出不含金额、历史、支付；fees只读原订单金额与历史，payments只读取本地资金事实，next_steps只读最少订单与原目录候选。原reader可选history/payments选择不赋权，仍经过原Guard/ALS；复读订单内容与版本指纹，不以updatedAt单字段掩盖内容变化。

历史沿用同订单的旧quote/rule/price/inspection来源；不查当前价补历史。PaymentRuntime仍区分instrument与原paid/accepted/funding_pending/succeeded等本地记录，未计算完整实收/退款合计，不查渠道。默认不查询的字段不投影；选中finance但无权时统一unavailable，无数量/存在性。当前身份/核心订单权限撤销整体拒绝。

`orderExplanationPreparation(id).validateGenerated({question,text,claims})`在当前授权下重新准备，只验证有限结构、精确值与sourceId：订单状态/版本、Core金额/币种、本地intent/refund的金额和状态。最多20引用、4000文本字符；没有关键词过滤，不声称语义正确。返回文字始终unverified_text_not_execution_evidence，executionAllowed=false；生成文本不能改确定性事实。

变更预览核查：tool-baseline rental.change.preview实际对应RentalCoreController.previewExtension及其private priceExtension；原入口还做assertOrderExtensionAvailable、listOrderExtensions、承运事件、resolveExtensionSettlement，再business.quoteOrderExtension，且去除rule/rate原始快照。当前本线注入的Core/business公开端口不具完整受权组合。未调用私有方法、未抽计价子集冒充预览；此项未接通（unavailable目录候选保持不执行）。主线需要暴露复用原Controller完整流程、当前订单/地点权限与ALS的受控只读端口，输入原RentalOrderExtensionRequest/DTO，输出原preview及副作用声明。不得执行续租申请/确认。

固定无效DATABASE_URL，本树绝对audit=output/lane-a-second-order.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-order-consumption.test.cjs`
3pass/0fail/0skip/0todo、exit0。真实服务/Guard/Core；可选支付缺失spy用于证明未调用，不假装金融源已接通。类型audit=output/lane-a-second-order-types.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`
exit0；diff check exit0。未跑全矩阵、真DB/模型/HTTP/支付/设备。未改Core、鉴权、Gateway、审批或runner；AIN整项未验收。
