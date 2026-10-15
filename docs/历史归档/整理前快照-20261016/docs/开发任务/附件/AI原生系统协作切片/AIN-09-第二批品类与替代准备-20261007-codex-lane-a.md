# AIN-09 第二接续批：品类与替代准备

从实际6e9e239f继续，分支正确、无MERGE_HEAD/WIP，历史output保留。仅本线源码/测试/记录；复用原28项需求v1.2/任务v1.5，不接框架。

入口均在composeAiAuthorizedBusinessTools：
- quote.businessPreparation.describeInput()：原Guard/ALS→当前正式品类businessModel与经营设置交集，返回计价单位、履约方式、目的地类型、时区、当前启用capabilities及原候选schema共享限制。未自建品类分支或自动资格。
- candidates.prepare完整修订输入仍重新解析，新增原DTO usageQuantity；usage单位缺量要求澄清。单位/履约须同时在品类与当前配置内。数量/时间/身份等不继承旧确认，准备不是审批。
- businessPreparation.alternatives({candidate,limit:1..5})：单行、受权目录→逐候选真实Core availability，最多5次可用性读取。展示最少字段、实际单位差异、可用性来源；原商品库存模式未投影则不猜。未查询条数与已查不可用分别表示，不自动替换、不组合价格、不保证兼容。最多100目录候选、5个替代结果；底层查询有界性不作虚假声明。
- 正式报价输出新增Core已保存请求的绝对period、lineUnits/usageQuantity、discount/coupon明细中的sourceId/sourceVersion。无优惠完整版本证据和进位快照明确charge_line_references_only/not_projected；不以当前配置回填报价，不浮点重算。

企业源核查：MembershipService已有listCorporateMembers(tenantId)、listCorporateEmployees(tenantId,corporateCustomerId)、resolveBenefits(tenantId,workspaceId,personalCustomerId,corporateCustomerId?)。这些不能直接成为当前调用主体的企业选择/用人/资格授权；本线无已核验复用入口，AiQuoteRouteAuthority仍拒绝corporate，候选qualification_required。主线需提供经原Guard的当前可用企业/员工与资格快照，绑定tenant/workspace/personal/corporate/revision/有效期；不把个人选项包装成企业源。

验证：固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，本树绝对AI_OFFLINE_AUDIT=output/lane-a-second-quote.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-business-second-quote.test.cjs tests/ai-native-lane-a-quote-consumption.test.cjs`
首次目录inventoryMode不存在引发类型失败，烟测文件2fail/exit1，修为原Core可用性返回字段；随后5pass/1fail/exit1，工程样本误用了摄影履约，按当前定义修复样本（未放宽检查）；最终6pass/0fail/0skip/0todo、exit0。四类真实Core/Guard/候选/可用性，DB执行替身；非四类完整商务/真库验收。

API类型（本树绝对audit=output/lane-a-second-order-types.audit，原quote-types失败日志保留）：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`
最终exit0；diff check exit0。未跑全矩阵/真实DB、HTTP、模型、支付、设备。不是AIN09完成或生产启用。
