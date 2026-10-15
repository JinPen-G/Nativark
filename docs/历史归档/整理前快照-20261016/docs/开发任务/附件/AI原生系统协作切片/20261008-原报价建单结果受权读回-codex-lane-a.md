# CA05 原报价建单结果受权读回

接续 a049db1d；只写 codex-ai-native-lane-a / ai/codex-ai-native-lane-a-20261007。未同步活动主线、未改公共审批实现。settings固定依赖的冲突仍由总线处理，按总线续作指令先补CA05实际消费缺口。

## 实际接通

`composeHumanQuoteOrder.readSelectedOrderResult({selection,command})` 接回 `composeRequestBoundHumanQuoteOrder.readSelectedOrderResult(request,value)`，现有 AiHumanQuoteSelectionModule.registerRequestBoundApplication 自动暴露该应用方法；不新增HTTP路由或生产注册。

输入沿用完整quote selection proof与原approvedOrderCommandSchema，不新造DTO。command中的原run/lease标识只用于已有动作关联，不领取租约、不授予派发权。只有现有controlled.reconcile被调用，绝不submit：先核对原请求/选择/task/run/inputHash/原提案与action，再由AIN07复核批准、原consumption和当前订单读取权限。未提交动作拒绝，不能触发建单。原提交应答丢失后按同动作核对；到期和停用不抹掉已提交事实。

返回仅白名单order.id/status/quoteId与受控order来源引用。payment/fulfillment不推断、taskOutcome仍归runner；不是完整Core聚合透传。真实依赖报告结果不明时返回unknown、retryable:false、read_selected_order_result，不换键/不重试写入。权限异常仍抛出，不作为可选降级吞掉。

## 本片快检

沿用 `tests/ai-native-lane-a-human-quote-selection.test.cjs` 的原人类审阅/决定/Core提交/历史核对单例，没有新增测试脚本。实际场景应用、正式当前权限、选择/提案/批准及原Core确认服务参与；数据库事务、租户业务事实为既有离线替身。

首尝将读回接在重新准备后的新quote上：0pass/1fail，原Core替身只支持固定body/quote0，尚未实际提交新quote。保留失败记录，不改Core、不放宽校验；改在已有原quote实际提交单例验证，不宣称新quote提交已验。该替身的四品类/新quote扩大组合由后续集中验收覆盖。

最终定向1pass/0fail/0skip/0todo，退出0：提交前读取无订单；提交ACK丢失后仅一张原单/一次commit；两小时后且plan policy关闭仍读原单；跨任务选择、缺Bearer、注销拒绝；已提交结果暂不可确定返回unknown无order字段，未重新提交。

命令前置：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/ca05-result.audit；TEMP/TMP为本树output/lane-a-original-request-tmp。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='selected order goes through human review' tests/ai-native-lane-a-human-quote-selection.test.cjs`

API源码noEmit沿用上一记录的typescript程序：读取原apps/api/tsconfig.json保留strict，rootDir/baseUrl为本树，paths仅指本树shared/src/index.ts及私有Prisma/index.d.ts，noEmit:true/incremental:false；getPreEmitDiagnostics=0，退出0。审计为本树output/ca05-source-types.audit。不改共享dist或生成物，不声称普通dist构建通过。git diff --check退出0。

## 剩余与可替换性

主线消费方法时继续使用原固定selection与approved command，不查最新订单；原runner仍负责submit/任务终态。此方法没有创建新执行链，Runtime未来替换继续保留原引用和收据，Provider仍只归唯一Gateway；当前不安装或迁移。

本片没有把报价自然语言到四品类建单全部标验收，未验证真实MySQL、HTTP、模型、支付、浏览器/微信/设备或生产。通知设置CA06/07等待可安全同步的固定依赖；不借order接口执行通知设置。

## 接回任务中心消费（接续9218de15）

`composeAiTaskCenterScene({...,orders:humanQuoteOrder}).readOrderResult({original,taskId?,reference:{selection,command}})` 接通同一原业务核对结果。外层原请求/task/run与内层选择完整绑定，读前后比较当前身份、原输入指纹及task/run/revision；缺orders端口明确不可用。不把批准receipt当订单、不从事件正文推导业务结果。

扩的是同一原单实际组合用例：真实任务中心→实际human quote app→原AIN07 reconcile→原Core订单读回；只替代未调用的list/recovery边界，不新建假工作台。正常读回原订单、缺能力拒绝、嵌套另一任务拒绝；另在请求绑定应用验证不可确定结果保留unknown且不回order。最终同项1pass/0fail/0skip/0todo，退出0，不与上次相加宣称2项全量；命令与上一节相同，audit改为本树output/ca05-center.audit。API源码noEmit0诊断退出0（output/ca05-center-types.audit），diff check退出0。源码只改本线task-center composition及既有测试，未改公共运输协议或注册HTTP。
