# AIN-09 报价持久化声明与本轮功能交接

本轮按功能优先推进：不扩大全矩阵、不递归Review。固定依赖f647199c合并点d816f82b；功能片e9c1709e为正式业务装配，4bf783a3为支付退款正式只读源。当前片为报价副作用声明；仅写A树原分支，没有改主线/公共Auth/shared/schema/runner/审批/Gateway或预算。

## 接通与副作用

正式生产服务装配入口：`apps/api/src/modules/ai-native/tools/business-tools.composition.ts` 的 `composeAiAuthorizedBusinessTools`。宿主提供现有Guard、实时credentials及Core/Membership/Business/Reports实例；可选已有PaymentRuntimeService。公开返回catalog、availability、membershipCandidates、opening、risks、quote.candidates/preview、order(serverOrderId)、orderPayments(serverOrderId)。这里是显式服务器工厂，不是模型可调用的任意构造器；服务端资源ID仍须经原Guard验证。每次调用走当前身份，原数据/地点/角色限制和读后复验保留。无网络/自动执行/生产注册。

order实例已带原订单关联旧报价读取。orderPayments实例在缺正式PaymentRuntimeService时拒绝，正常读取需要原订单及finance权限，不因普通订单可见而开放资金。完整资金账本仍未加载，局部支付/退款记录不等同全部实收。

报价结果新增本地副作用证据 `quotePersistence`（未改shared公共DTO）：

- 有效且验证通过的Core返回：saved，同时原reservation仍not_reserved。
- Core已返回的报价在返回时过期：expired＋saved，不回传可用报价，也不暗示未写入。
- Core调用异常：unknown；哪怕业务分类为缺货/不可用，没有可靠未写证据就不宣称没保存，不能自动重发。
- 验证/授权异常仍拒绝；错误没有此字段不能被解释成not_saved。保存后撤权不等于回滚。

现有商品/客户/时间/时区/地点/枚举解析及原Core计价链复用，未另造算法。新字段不是派发权、审批或资源锁。

## 本片一次定向检查

```powershell
$env:DATABASE_URL='mysql://offline:offline@127.0.0.1:1/rental_os_offline'
$env:AI_OFFLINE_AUDIT=(Join-Path (Get-Location) 'output/lane-a-quote-effect-smoke.audit')
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-business-tools-smoke.test.cjs tests/ai-native-ain09-quote-preview.test.cjs
exit $LASTEXITCODE
```

结果10pass/0fail/0cancelled/0skip/0todo，exit0。类型另设本树绝对output/lane-a-quote-effect-types.audit，同DATABASE_URL：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`，exit0；git diff --check exit0。只增强原断言，未skip/todo或删断言。前片2/2、4/4与本片10/10为分阶段冒烟，不相加称为最新全量。

## 下一步需要主线提供的最小依赖

1. 主线将显式工厂接入原任务政策/不可变输入/预算/审批/计量执行链；R1正式报价不能注册成R0，不绕现有确认、幂等和恢复。当前本地工厂未注册HTTP/步骤或生产模块。
2. MembershipService.listPersonalOptions和personalBookingOptionScope的DB有界入口：保留tenant/workspace/owner/location，优先关系过滤避免无界枚举customerId；limit1–50、take=limit+1、稳定排序、显式超量。精确请求沿用上一批订单关联旧报价记录。本线不能重写Membership/Core。
3. PaymentRuntimeService.listPaymentIntents/listPaymentRefunds有界入口：参数仍tenant/workspace/order/intent，保留requirePaymentIntent关联，take=limit+1和createdAt/id稳定排序。本线目前限制20 intent、每单50 refund、合计100，超量拒绝；不声称底层查询有界。详见本轮支付记录。
4. 企业资格正式只读生产源；员工可用的settings/member正式受控上下文。缺少时仍拒绝，不放宽原白名单或默认个人身份。历史日历与完整定价上下文/资金账本未加载仍显式缺失；不能用当前配置补历史。
5. Core稳定结构化失败码及R1未写入/提交不明证据，目前只保守本地分类，不擅改Core或公共契约。

本轮可写范围内的服务装配和两条真实读/报价路径已交付，以上跨范围依赖不伪造补齐。未运行全量/深度矩阵、独立审计、真实HTTP/DB/模型/支付/浏览器设备或生产验收，后续按负责人安排集中补。原AIN整项状态与完成率不改。没有安装、读取.env、启动服务、共享生成、推送或合main；历史output保留不提交。
