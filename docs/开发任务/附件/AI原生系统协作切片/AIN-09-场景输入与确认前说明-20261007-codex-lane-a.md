# AIN-09 场景输入与确认前说明

接续10e0ed5f。复用原候选和R1报价，不接模型/任务运行器或新审批路径。

- `quote.businessPreparation.prepareInput(candidate, modelAvailability?)`：在当前Guard/ALS下读取候选/config/可用性、复验，形成有scope/audience/观察时点的有界深冻结内容与指纹；partial输入仍有当前受权scope和具体澄清。模型不可用只保留事实及缺口，无假答案/执行成功。
- `quote.previewBusinessSelection(selected)`：业务准备→原previewSelection→Core正式报价结果。无库存/旧选择/缺项不会进入createQuote；原Core为唯一计价，不能把模型提取的ID视作人类确认。主线宿主必须证明人类选择，此方法不生产审批或建单。
- 成功结果增加confirmationReview：当前正式输入指纹、选择/config版本、报价id及Core规则/价格版本、Core有效期、可用性观察时点。有效只针对报价观察时刻；建单前仍需原Core重新检查。库存未预占、旧确认不可复用；缺可信旧报价/旧可用性，价差及变化原因明确unknown，不自行推算、不覆盖旧报价。
- quotePersistence未知路径沿用原previewSelection的unknown/reconcile/retryable:false；未重试/换ID，不用查最新冒充核对。精确原操作查询仍缺Core端口。

本树绝对audit=output/lane-a-quote-consumption.audit，固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-quote-consumption.test.cjs`
2pass/0fail/0skip/0todo、exit0。正常链用实际Core可用性/计价、Membership/Guard与组合服务；DB执行替身提供合成资产/库存，未替换计价或权限；拒绝链无库存零createQuote及撤权拒绝。类型audit=output/lane-a-quote-consumption-types.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`
exit0；diff check exit0。未跑全矩阵、真库/HTTP/模型/支付/浏览器设备，未启生产。原四品类计价路径复用，不将本次单品类定向烟测冒称四品类重新验收。

## 本批12项对应与主线接入

| 项 | 本批真实状态 |
| --- | --- |
| 1 候选与选择 | 复用已提交6c470eef；客户/商品/地点/归还地点/时间澄清，当前候选/config版本；人类选择证据由原主线任务链提供 |
| 2 业务准备 | ce7e609b：原配置/目录/会员/可用性准备及复读，准备不锁库存 |
| 3 正式报价 | 复用原R1入口，本片增加previewBusinessSelection真实组合与结果来源 |
| 4 保存不明核对 | Core无原操作键查询，明确unavailable，未实现实际核对；精确缺口见业务准备记录 |
| 5 变化说明 | 已输出有效期/config/选择/正式输入指纹/可用性观察；缺可信前后历史价差不做推断，该部分未接通 |
| 6 解释消费 | fd17b9b6：orderExplanationPreparation(orderId).prepare() |
| 7 人工交接 | 消费原nextSteps，受控订单资源及实际APP_ROUTES.orderDetail符号，动作候选全部非自动执行；正式allowed-actions仍缺 |
| 8 开业分区 | 10e0ed5f：受权配置白名单投影及明确库存/外部验真缺口 |
| 9 解决后复查 | openingActions.recheck({key})重读原readiness，检查消失不能判解决 |
| 10 输入包 | 订单/开业/报价三种实际消费入口共用payload快照/131072字节上限/原指纹算法，无Gateway或计划登记 |
| 11 降级 | 模型不可用仍facts_only，非必需来源按原coverage；撤权/身份变化/版本变化拒绝，不回放旧事实 |
| 12 装配 | 全部接回composeAiAuthorizedBusinessTools，无新HTTP/worker/AppModule |

依赖顺序：ce7e609b→fd17b9b6→10e0ed5f→本片。各片分别一次定向烟测2/2及API tsc exit0；不相加冒称最新全量结果。本片无全专项/全矩阵或独立审计。

主线仍须接：正式输入冻结/人类选择证据→现有政策/步骤→同一payload发送/预算单账/Gateway；原操作精确报价查询；完整资金/检查来源；Core当前允许动作；开业typed分区权限/外部验证/正式草稿；企业资格、员工原settings/member合法上下文；Membership/Payment底层带scope/owner/location的limit+1稳定排序读（原缺口未改）。本线不扩大白名单、不复制Core/权限服务。不计AIN整项完成。

本批只写Lane A；没有同步固定04eac695，因为无依赖。保留全部历史/output；不读.env、不安装/启服务/连真实服务/修改共享产物/push/main/部署。
