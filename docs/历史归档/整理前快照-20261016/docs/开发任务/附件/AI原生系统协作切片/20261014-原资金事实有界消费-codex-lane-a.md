# 原资金事实的有界局部消费

接续cafee382，仅tools/order-payment-facts.service.ts和business-tools.composition.ts。原PaymentRuntime的listPaymentIntentsPage/listPaymentRefundsPage已是实际tenant/workspace/order/intent限定的take+1，直接复用；不改Payment/Core。原reader允许20个intent各取50条、累计超过100就整包INVALID_RESPONSE。现把剩余退款输出配额下推原分页limit=min(50,100-已返回数)，达到100后不再读其他intent，truncated=true（含未查询而非证明有更多）。重复ID/错关联/币种等仍拒绝。最大20个intent与100条refund；不求和、不把accepted当succeeded，不声称完整实收。现有组合payments类型显式保留两个Page端口，缺端口仍fail closed，不回退legacy全量。

一次定向inline正常+关键拒绝：真实AuthService/Guard/业务组合与PaymentRuntimeService原listPage/requirePaymentIntent/toResponse方法；仅DB delegate返回合成记录。3个intent各60条退款，实际返回100、truncated、只发2次退款findMany(take51，第三intent不查)，全部带tenant/workspace/order；移除finance:view后拒绝且无新资金查询。exit0；必要Compiler API noEmit0诊断/exit0，git diff --check0，tests/fixtures零改动。非TAP断言不虚报测试计数。

实际命令：固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline、绝对AI_OFFLINE_WRITE_ROOT/AI_OFFLINE_AUDIT=本树output/ca-business-bounded-20261014.audit及TEMP/TMP；node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际服务断言>'，ts-node transpileOnly:false。首命令因恢复后内联prefix存储缺失被PowerShell拒绝(exit1)，Node未运行；恢复显式离线prefix后上述真实结果exit0，无绕预加载/改产品检查。

没有连接真实支付/DB/HTTP/模型，不验证MySQL锁或全量资金账；保留partial/local-records，未生产启用。原订单问题最少facts→prepareTaskMaterial→模型prepareHeldRun已有真实供应，未重写；原客户accept/submit/read分别存在，未知按原操作读取不自动建单，不能把本片称整场景完成。商品分页仍待主线固定端口；普通开业分区缺正式Core提案参加者继续prepared_not_submitted，不借通知或订单审批。
