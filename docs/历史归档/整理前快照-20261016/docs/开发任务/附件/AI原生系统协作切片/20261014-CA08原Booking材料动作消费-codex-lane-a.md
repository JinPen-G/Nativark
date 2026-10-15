# CA08 原Booking材料与原页动作消费（离线正常链已补验）

基线aee56f8f固定同步之后。新增scenes/client-original-booking-flow.ts，修改client-entry.module.ts，只本树写入，不改request-bound/settings/政策/公共契约/核心，tests/fixtures零变。

实际服务器入口composeClientOriginalBookingFlow，原ClientEntry模块注入同一个AI_CLIENT_ENTRY_APPLICATION实例并导出AI_CLIENT_ORIGINAL_BOOKING_FLOW，不新建身份或业务服务。无新HTTP路由；普通模块仍需原显式依赖和当前政策，构造不执行。

prepare(request,{original,selection,operationKey})串实际root的readPreparedQuoteBookingMaterial→原prepare(booking_quote)→原issueAction(CREATE_BOOKING_DRAFT)。原引用、已有AiBookingSelection和操作键严格快照；未知原报价不保存材料/创建第二报价。材料持久后复验原来源与材料；变更抛原AiClientMaterialError/unknown/readOperation，不称未写、不授重试。

readOperation使用同一参数还原精确原操作，仅readOperation，不落prepare/create。现有create/choose/handoffBookingDraft与原HTTP继续单独接收明确人类动作；本方法不auto选中或handoff。原page preparation/acceptance/submission与draft-operation读直接绑定既有独立受权方法，不混同接收材料、正式建单或付款。

验证：固定无效DATABASE_URL+原prisma-offline-preload/lane-b-local-runtime，本树绝对audit/TEMP/TMP/write-root。必要Compiler API noEmit根original-scenes.module.ts+client-entry.module.ts，0诊断/exit0。一次inline实际request-root+新consumer：缺capability的prepare/readOperation拒绝、额外approve字段拒绝，依赖调用0，exit0；没有假成功adapter或预填订单。git diff --check0、tests/fixtures无改动。命令为node两preload -e加ts-node非transpileOnly，audit output/ca-original-booking-flow-smoke-20261014.audit。

**未完成：** 当前实际正常原报价→保存材料/动作→明确选择/页面接收/原提交核对整链尚未复验。缺capability拒绝与类型检查不能算正常链验收。本包代码消费可调用，不声称第一整包完成。已向主线请求其现有客户prequote正常冒烟factory入口供一次复用，未要求新增测试或fixture；公共正式HTTP承载仍由主线决定，不私造协议。真实DB/HTTP/供应商/支付/生产未验。

下一项按授权继续CA09原持久事实/事件水位消费；已有readSnapshot/readEvents/readScene/原审批收据不重写，核实具体未接入口后才改。任何读不启动run，unknown不改成功。

## 2026-10-14 后续正常链证据（替代上文当时的未验状态）

在2a9ca639之后一次inline扩展到真实ClientAuthService、ApiAuthGuard、ClientApiService原报价生产者、request-bound root、新flow、PrismaClientBookingRepository及原预约页接收/原结果读取。正常顺序：prepareQuoteParameters（零报价）→明确confirmQuoteParameters（一份原报价）→flow.prepare（保存材料并颁发原草稿动作）→readOperation→明确createBookingDraft→chooseBookingDraft→handoffBookingDraft→readPagePreparation→acceptPage→readSubmission。最后通过实际RentalOrderConfirmationService.readOrderCreation得到not_observed、retryable:false，不是建单成功；重复读没有第二份报价，共一份草稿。错误quoteId和会话撤销后读取均拒绝。

命令：固定无效DATABASE_URL、绝对AI_OFFLINE_AUDIT/output、write-root和TEMP/TMP，node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际实现断言>'；内含ts-node transpileOnly:false。audit为output/ca-original-booking-flow-positive-20261014.audit。实际退出码0；不是TAP套件，无pass/fail/skip/todo统计，不新增测试文件。扩展命令末尾沿用旧console中的“no draft”字样不准确：此扩展实际创建并选择了一份草稿，未执行正式订单/支付；以上以真实断言和调用链为准。

数据库/原操作存储、Core计价及库存、发布配置和权益记录为合成离线来源；授权、Guard、业务消费者、原页接收和结果读取未替换为成功函数。未连接DB/HTTP/模型/支付，无真实MySQL锁/事务失败或生产证据。正式提交订单正向与应答丢失、微信/浏览器宿主仍未验，不宣布CA08整链或AIN完成。

另核查packages/shared/src/core.ts的RentalAvailabilityResult及RentalCoreService.computeAvailability：现有返回仅available/locationId/startAt/endAt/lines，无独立observedAt等观察字段。保留完整availabilityVersion指纹，不为通过合成冒烟排除真实库存或配置变化；将来正式返回新增纯观察字段时再按契约处理。
