# 经营查询有界性与开业风险消费

基线834a669e。核查实际代码：会员listPersonalOptionsPage/listBookingOptionsPage已有库侧take+1；本线membership reader已调用、不回退全量。PaymentRuntimeService.listPaymentIntentsPage/listPaymentRefundsPage已有tenant/workspace/order/intent限定和take+1，本线资金reader已使用；结果仍partial/local records、不能称完整实收或渠道确认。订单按精确id读取。风险报表原仓储按500行分页扫描（总扫描仍受实际数据量影响），不是固定总工作量。以上已有功能直接复用，不重复计新增。

商品仍走RentalCoreService.listItemGroups（配置内存全量map），AI层超量拒绝不等于源查询有界。已给主线具体补丁请求：沿现有配置/ALS提供listItemGroupsPage(tenantId,{limit<=100,cursor?,itemGroupId?,name?})→{rows,nextCursor?,truncated}，带当前space/配置版本，不改业务算法；取得固定接口后本线再接。未自行改Core、schema或公共权限，未谎称当前全量问题解决。固定449caae3仅staff政策，与本片无依赖，不追活动HEAD同步。

实际修复tools/opening-action-list.service.ts：显式请求risk的错误原先被catch-all吞掉；现只对声明的CAPABILITY_UNSUPPORTED/PROVIDER_UNAVAILABLE/TIMEOUT隐藏细节并标不可用，权限/上下文/配置/响应等错误继续抛出。没有风险权限不能得到看似正常的混合清单。订单可选资金无权不暴露存在性/条数的既有合同未改。

一次定向inline，实际composeAiAuthorizedBusinessTools→openingActions→真实AuthService/Guard/ALS；合成配置/报表DB来源。先正常opening成功，再移除report:view后请求risk：修前断言missing expected rejection、exit1；修后正常及关键拒绝exit0。必要Compiler API noEmit0诊断/exit0，git diff --check0。命令沿本树两原preload、ts-node transpileOnly:false、固定无效DATABASE_URL、本树绝对write-root/audit/TEMP/TMP。无新改tests/fixtures；直接断言无TAP计数。真实MySQL/HTTP/模型/生产未验，不宣布AIN完成。
