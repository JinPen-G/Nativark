# CA08 原Booking材料与原页动作消费（正向仍未验）

基线aee56f8f固定同步之后。新增scenes/client-original-booking-flow.ts，修改client-entry.module.ts，只本树写入，不改request-bound/settings/政策/公共契约/核心，tests/fixtures零变。

实际服务器入口composeClientOriginalBookingFlow，原ClientEntry模块注入同一个AI_CLIENT_ENTRY_APPLICATION实例并导出AI_CLIENT_ORIGINAL_BOOKING_FLOW，不新建身份或业务服务。无新HTTP路由；普通模块仍需原显式依赖和当前政策，构造不执行。

prepare(request,{original,selection,operationKey})串实际root的readPreparedQuoteBookingMaterial→原prepare(booking_quote)→原issueAction(CREATE_BOOKING_DRAFT)。原引用、已有AiBookingSelection和操作键严格快照；未知原报价不保存材料/创建第二报价。材料持久后复验原来源与材料；变更抛原AiClientMaterialError/unknown/readOperation，不称未写、不授重试。

readOperation使用同一参数还原精确原操作，仅readOperation，不落prepare/create。现有create/choose/handoffBookingDraft与原HTTP继续单独接收明确人类动作；本方法不auto选中或handoff。原page preparation/acceptance/submission与draft-operation读直接绑定既有独立受权方法，不混同接收材料、正式建单或付款。

验证：固定无效DATABASE_URL+原prisma-offline-preload/lane-b-local-runtime，本树绝对audit/TEMP/TMP/write-root。必要Compiler API noEmit根original-scenes.module.ts+client-entry.module.ts，0诊断/exit0。一次inline实际request-root+新consumer：缺capability的prepare/readOperation拒绝、额外approve字段拒绝，依赖调用0，exit0；没有假成功adapter或预填订单。git diff --check0、tests/fixtures无改动。命令为node两preload -e加ts-node非transpileOnly，audit output/ca-original-booking-flow-smoke-20261014.audit。

**未完成：** 当前实际正常原报价→保存材料/动作→明确选择/页面接收/原提交核对整链尚未复验。缺capability拒绝与类型检查不能算正常链验收。本包代码消费可调用，不声称第一整包完成。已向主线请求其现有客户prequote正常冒烟factory入口供一次复用，未要求新增测试或fixture；公共正式HTTP承载仍由主线决定，不私造协议。真实DB/HTTP/供应商/支付/生产未验。

下一项按授权继续CA09原持久事实/事件水位消费；已有readSnapshot/readEvents/readScene/原审批收据不重写，核实具体未接入口后才改。任何读不启动run，unknown不改成功。
