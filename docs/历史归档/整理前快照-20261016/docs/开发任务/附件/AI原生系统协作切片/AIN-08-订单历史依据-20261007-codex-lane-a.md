# AIN-08 订单历史依据：lane A 第二切片

基线 e6c3c606（已包含固定 da6fb9ae）。仅现有只读事实服务、新测试与本记录，未修改公共契约或执行链。

## 实际实现

AiOrderReadFactsService.readHistoricalBasis 复用现有订单 Guard/ALS 和真实 RentalCoreService.getOrder。由服务端绑定 orderId，不接受模型传入 tenant/workspace/规则；输入依据为订单原有字段，输出是内部 provenance 投影，不是新 HTTP DTO。

严格读取原订单 ruleVersion、ruleSnapshot.fulfillment 的取还检查要求、价格/日历版本引用以及 inspectionTemplateSnapshots 的 id/code/stage/version。模板最多50条，重复引用、跨租户、异常字段/版本绑定拒绝。不透传原始规则、模板正文、联系方式、附件或内部注记。

未保存规则/模板分别标 missing；已保存空模板标 available 空列表，两者不混。价格只能 references_only：原 getOrder 返回值没有原报价费率快照，本片不查询当前价格、也不伪造历史费率，rateEvidence=not_loaded、complete=false。这只证明部分保存依据可读，不证明历史计价可完整重算或检查结果已加载。

## 红绿验证

红测 node --test tests/ai-native-lane-a-order-history.test.cjs：0 pass / 13 fail / 0 skip，退出1，真实服务尚无该读取能力。

绿测 node --test --test-concurrency=2 tests/ai-native-lane-a-order-history.test.cjs tests/ai-native-order-read-facts.test.cjs：32 pass / 0 fail / 0 skip，退出0。实际 Guard、ALS、Core getOrder（配置/事实存储替身）；缺失、异常模板、租户不符、晚到撤权/缩地点/换空间/无结果均拒绝或明确缺失。不复制 Core 算法。

API node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit'];require('typescript/lib/tsc')" 退出0。git diff --check 退出0。

所有 Node 预加载本树 prisma-offline-preload.cjs、固定无效 DATABASE_URL，AI_OFFLINE_AUDIT=本树绝对 output/lane-a-history-*.audit。没有 .env/网络/真库执行；日志不提交。

## 权限、成熟度与剩余接入

原权限 rental-os:order:view，原 GET /rental/v1/orders/:id；operator/staff 当前 workspace 隔离，读取后复核。查询时点 observedAt 与来源 sourceOrderUpdatedAt 单列；最大模板50项。当前内部只读服务可用，持久工具执行仍待主线按既有政策/不可变输入/result/resource 链装配，默认不得启用。

主线最小补丁：沿既有 order 服务端引用，登记 explain 对应不可变输入/计划选择，组合同一次受权订单事实与历史投影，定义正式结果字段后再启用；禁止由 AI 使用当前配置回补。若需完整历史计价，应从受权、绑定同 order.quoteId 的原报价快照取 rateSnapshot/pricingContext，并维持原权限及地点缩权；没有该来源保持 not_loaded。此片未修改 shared 或 runner。

测试是离线函数级行为和类型证据；MySQL、HTTP、真实模型、设备、生产未验，待独立复核。不宣布 AIN-08 完成。
