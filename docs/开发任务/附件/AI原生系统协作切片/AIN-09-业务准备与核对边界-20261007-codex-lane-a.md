# AIN-09 业务准备与核对边界

从实际95f049c9继续，不回退负责人旧观察点27257bc9；HEAD/status/MERGE_HEAD核对正常，无未提交源码。同机Claude进程不等于本树写入者，未发现本树并行变更。复用6c470eef候选/正式报价；不合移动主线、不改公共/Core。

入口：`composeAiAuthorizedBusinessTools(...).quote.businessPreparation.prepare(candidate)`。当前Guard/ALS下读取候选、配置及原Core availability，再复读候选/config；输出ready/missing_input/ambiguous/unavailable（企业仍qualification_required）。同一服务端主体绑定进入目录、会员、可用性原reader，未修改Guard。ready只表示准备齐备，不证明人类选择/审批，不存报价、不预占。review给出选择/config指纹、查询时间；无可信旧报价，价差unknown；尚未生成报价时有效期not_quoted。

已有`quote.previewSelection`仍是明确R1保存入口，原Core计价/结果校验保留；不将模型ID视作人类确认。调用方需在原任务输入链证明人类选择，本线不复制该链。

核对Core源码：RentalBusinessService.createQuote(tenantId,context,input,preResolvedDeliveryAddress?)无原操作键；getQuote(tenantId,context,quoteId)仅按已有ID查找。`businessPreparation.reconciliationAvailability()`在原Guard下明确unavailable/reconcile/retryable:false，不查最新、不再次create。主线所需最小能力：原操作键+原请求fingerprint+owner/tenant/workspace的持久收据与精确查询，返回saved/unknown/可靠未写入；本线不修改Core/schema。

验证（固定无效DATABASE_URL，AI_OFFLINE_AUDIT为本树output/lane-a-business-preparation.audit绝对路径）：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-business-preparation.test.cjs`

首次夹具相对路径错误导致加载失败1/1、exit1，修正为本树路径后2pass/0fail/0skip/0todo、exit0。不是业务红测或通过数累加。实际组合/Guard/Core服务，DB执行为替身。类型audit为output/lane-a-business-preparation-types.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`
exit0。diff check exit0。未运行全矩阵、真DB/HTTP/模型/支付/宿主；不代表AIN整项完成。Membership/Payment底层有界读、企业资格/员工上下文缺口原样保留。
