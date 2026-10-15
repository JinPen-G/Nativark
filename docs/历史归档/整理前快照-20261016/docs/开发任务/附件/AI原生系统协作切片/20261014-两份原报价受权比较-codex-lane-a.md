# 两份原报价的受权比较消费

接续b9ecf7a2。核实registerHttpQuoteFlow已组合原PersistedModel审阅/确认/收据、ClarifiedQuoteSelection select/readOperation及既有HumanQuoteSelectionModuleTask，未重建该办理/审批链。真实缺口是原compareQuotes只有纯展示比较，缺两个原请求各自受权来源的场景入口。

## 可调用入口

AiOriginalSceneFactsService.compareOriginalQuotes({previous:原requestRef,current:原requestRef})，接回composeAiOriginalScenes及普通/full-model request-bound根同名方法。只接受两份原引用，不接caller显示金额/姓名/quote正文/actor/scope。每份原quote_clarification请求按readHistorical复验当前身份，要求同actor/scope/audience；各自复用readQuoteReceipt按原inputRef+contentHash的业务键只读，二次收据/原输入检查稳定来源。不查latest、不重算当前价格、不写选择/审批，不新建Task/runner/HTTP/DTO。

任一份unknown/not_observed保持其原结果，整体unavailable_original_quote、comparison:null、retryable:false、nextAction:read_original_quote_receipt，不重建报价。两份已保存quoted/expired结果交原compareQuotes；保留旧/新quoteId、Core两份金额/币种/版本/期限与来源，不用浮点新算差额。参数差异和金额变化只是事实比较，不推断优惠原因、库存锁定或审批成功；新报价不可继承旧确认/批准。

本入口覆盖原request确认报价的原键；澄清提交后的scene-answer原键仍由既有readClarifiedQuoteReceipt及其select/readOperation消费，不能混用两个协议或把缺记录改成重报。

## 实际验证

一次inline真实原request root、Auth/Guard、Core候选/正式计价及原报价生产者、原收据和原比较formatter，DB/config执行使用原离线替身：第一份明确confirm后quote1，第二份只create时比较保留unknown且quote仍1；明确confirm第二份后比较成功、数量变化true、quote2且approvalReuse禁止，外加payableAmount字段拒绝，撤销会话拒绝，step0。原业务原键store用受控DB边界保存实际Core生成结果，不预填两份成功报价。exit0。必要Compiler API noEmit0诊断/exit0，git diff --check0，无新增修改tests/fixtures，非TAP断言不虚报测试数。

实际命令：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline真实原请求与Core比较链断言>'；ts-node非transpileOnly。固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT/TEMP/TMP为本树绝对路径，audit=本树output/ca-business-bounded-20261014.audit。只提交本片三个源码/本记录，不附带output。

未验真实HTTP/MySQL/模型/支付/浏览器/设备/生产，双报价并发撤权/COMMIT丢失及全矩阵本轮未跑。原参数/配置变化各自原选择服务仍需新确认；本片读取历史依据不把当前配置补写进旧结果。通知开业分区仍缺合法映射，不借其他键执行，不宣称AIN完成。
