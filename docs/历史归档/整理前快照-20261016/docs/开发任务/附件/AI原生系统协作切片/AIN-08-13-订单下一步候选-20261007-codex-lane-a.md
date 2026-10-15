# AIN-08/13 下一步候选（功能片B）

入口composeAiAuthorizedBusinessTools(...).orderNextSteps(serverOrderId).read()。实际订单事实包/Guard后读取AI_TOOL_BASELINE已有代码/风险/成熟度/原权限；不重新计算Core状态机。不提供执行回调，不把权限数组/目录成熟度当当前动作批准。

区分readonly/preview/confirmation_required_write；缺正式allowed-actions源及目录仍unavailable时全部executable:false，列明依赖。只返回已有order资源导航引用，由宿主原订单路由解析并再授权，不拼URL，不提供退款/资金/例外自动动作。非公开无权限工具不返回；核心订单撤权整体拒绝。

定向正常候选/关键撤权2pass/0fail/0skip/0todo exit0，API tsc exit0，diff check exit0。实际事实reader/Guard及目录，不是夹具自证；DB为替身。命令A树，DATABASE_URL固定无效mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_AUDIT=绝对output/lane-a-pack-b.audit（类型为lane-a-pack-b-types.audit）。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-next-steps-smoke.test.cjs`

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`

未运行真库/HTTP/模型/支付/浏览器、深矩阵或独立审计。正式当前allowed-actions缺口需主线/Core协调，只读结果不成为审批或执行许可，不计AIN完成。
