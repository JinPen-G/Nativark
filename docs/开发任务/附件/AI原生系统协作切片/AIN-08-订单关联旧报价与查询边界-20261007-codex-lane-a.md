# AIN-08 订单关联旧报价与会员查询边界

起点eb61f327，固定依赖0aeea679已包含。只写A树本线事实reader、tools、直接测试/夹具及本记录。没有修改Core/Membership/Auth/shared/runner/schema或主文档。

## 历史真实来源

AiOrderReadFactsService.readHistoricalBasis从原Guard/ALS/Core getOrder读取quoteId，再调用AiOrderSavedQuoteSource，经同空间既有RentalBusinessService.getQuote读取旧报价。当前Core上下文只用于定位现有报价存储，绝不作为历史价格、规则、日历、模板或时区依据。比对order.quoteId、tenant及订单已保存的rule/pricing/price/calendar版本；错误ID、跨租户、版本冲突拒绝。

规则与模板仍来自订单冻结快照；旧报价仅增加白名单版本、币种、时间、费率id/商品/unit/baseAmount与其保存时区。缺quoteId=missing_link、无adapter=not_loaded、源NotFound=missing、明确源不可用=unavailable；其他异常不伪装成无记录。缺费率/保存上下文明确missing，不读现价补齐。上下文只投影时区，因此contextStatus=partial，日历细节not_projected，complete仍false。付款/退款和历史费用解释仍not_loaded，不据应收或报价金额宣称到账/退款成功。

源读取必须在原订单受权ALS内部；expected scope只是关联检查。读后原订单authority复核当前权限/空间/地点；新增workspace kind运行时拒绝，避免仅依赖TS类型。没有注册工具或改变成熟度；主线仍须接同一计划/输入/result/累计计量链。旧报价存储的NotFound仅说明该既有源没有返回记录，不宣称已完成持久历史全量核验。

## 验证过程

统一环境及网络/env护栏同前片，AI_OFFLINE_AUDIT为本树绝对output/lane-a-saved-order-quote.audit。

```powershell
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-saved-order-quote.test.cjs
```
红测0pass/9fail/0skip/0todo，exit1；实际reader当时无旧报价消费，错误关联亦未被拒绝。实现后关联41/41exit0。加入实际Core报价存储组合与查询缺口后43pass/1fail，exit1：新增组合误用了无种子地点的tenant-a夹具，异常被原authority脱敏；诊断保留底层测试错误，改用显式tenant_001合成种子和同租户订单/身份配置，不放宽权限或产品校验。最终：

```powershell
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=2 tests/ai-native-lane-a-saved-order-quote.test.cjs tests/ai-native-lane-a-order-history.test.cjs tests/ai-native-order-read-facts.test.cjs tests/ai-native-lane-a-membership-query-gap.test.cjs
```
44pass/0fail/0cancelled/0skip/0todo，exit0，其中2例明确KNOWN GAP刻画，不是查询有界安全验收。

旧诊断16例测试也改为直接消费本线正式AiDiagnosticRouteAuthority，而不是保留夹具手写授权流程；最终扩大回归与类型检查在本批统一交接记录补记。记录源测试实际执行原Auth/Guard/ALS/Core/business getQuote，数据库/配置执行替身，非真库/HTTP。

## 主线精确补丁请求：会员底层有界（本片未修）

已运行真实MembershipService，捕获Prisma参数：

1. listPersonalOptions的customerProfile.findMany有tenant/active会员/个人/scope条件和name+id排序，**无take**。
2. personalBookingOptionScope在own/地点受限时的rentalOrder.findMany有tenant/workspace/owner/location及distinct customerId，**同样无take**。distinct不等于有界，不能只给最终客户查询加take后宣称闭环。

建议主线在原会员服务增加AI专用有界读取，保留人工旧入口语义；沿用相同personalBookingOptionScope约束，以customer到订单的受权关系过滤避免先枚举无限customerId。请求limit必须服务端校验1～50，数据库take最多limit+1、稳定name/id排序；超出返回明确截断/需澄清或按当前AI契约拒绝，不静默截断假装全量。若维持中间可见ID查询，必须有独立上限和超限fail closed，不能无界循环分页收集。跨租户/空间/own/组织/selected空集及缩权等价回归由主线补齐。

本线不复制会员scope算法、不修改MembershipService/Core、不扩大当前AI返回契约。上述KNOWN GAP测试只证明问题存在；主线修复时应改为验证有界，不能解释成已通过安全要求。

## 未完成与证据层级

完整历史日历与优惠/资格依据、历史费用/付款/退款专用事实、数据库级会员有界、企业资格、持久运行器工具接线仍待主线。没有真实MySQL/迁移/HTTP/模型/浏览器/微信或生产证据，没有独立Review，不宣布AIN完成。
