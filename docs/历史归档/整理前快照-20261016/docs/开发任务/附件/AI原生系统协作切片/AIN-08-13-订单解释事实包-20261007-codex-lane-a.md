# AIN-08/13 订单解释事实包（功能片A）

基线c86705d4，A树原分支，干净、无合并状态；不需04eac695依赖。入口：composeAiAuthorizedBusinessTools(...).orderExplanation(serverOrderId).read()。

实际AiOrderExplanationFactsService在原order authority下调用已有order/history/payment reader，再解析当前身份并重读原订单版本/最少字段。返回订单、费用、租期、历史关联报价、支付退款各自coverage/source；引用只含scope/resourceId/version/field/time，不造URL。资金无权/缺失依赖/失败均统一unavailable，不透露存在性/数量/原因；核心订单无权整体拒绝。实收总额/完整资金账本not_loaded，不求和支付或冲减申请退款。历史不回退当前配置；履约检查执行证据未加载。多读复验不是原子快照。

定向烟测正常事实/缺历史关联/资金拒绝脱敏，及读取期间订单变更/核心撤权；首次2pass/0fail；补每阶段主体复验后原2项复验同样2pass/0fail/0skip/0todo exit0。API tsc exit0，diff check exit0。不扩大矩阵。

命令均A树：DATABASE_URL固定mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_AUDIT=本树绝对output/lane-a-pack-a.audit（类型lane-a-pack-a-types.audit）。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-explanation-pack-smoke.test.cjs`

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`

数据库执行替身/合成数据，非真库/HTTP/支付/模型。完整实收、履约事实、历史日历及底层有界查询仍缺；主线负责输入冻结/步骤/答案，本片不碰运行器或共享契约。深测/独立审计后补，不称AIN完成。
