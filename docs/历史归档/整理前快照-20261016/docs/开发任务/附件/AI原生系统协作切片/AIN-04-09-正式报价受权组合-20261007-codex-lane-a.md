# AIN-04/09 正式报价受权组合

基线95eb90e4；只写A树既有business-read bridge、quote-preview及tools专用组合和直接测试。固定依赖0aeea679已在历史，不重复合并。

## 实现与权限边界

AiQuoteRouteAuthority通过原ApiAuthGuard/AuthService/ALS调用固定POST quotes，R1单独withQuote，不纳入withRead。输入先经原严格schema；映射fulfillmentLocationId→原Guard的locationId，另核对return及service地点。原Guard、own客户校验、员工白名单和原权限保持不变。企业正式资格源未接，返回CAPABILITY_UNSUPPORTED，候选仍qualification_required，不偷换个人身份。

AiGuardedQuoteCoreContextSource从原GET business-settings Guard认证的空间加载与人工controller相同的Core profile/category/settings/groups/pricingGroups/coupons/locations/operators；期望scope仅与真实session比对，地点由Core当前ALS过滤。返回深拷贝，调用方不能改Core缓存。缺权限/来源拒绝。

composeAiGuardedQuoteTools显式组合原候选准备和正式报价；准备不自动调用报价，仍needs_confirmation。正式报价使用原resolvePricingGroupQuoteRequest再createQuote，不复制库存或计价算法，允许Core添加既有承接型号元数据但禁止改变原输入。正式输出仍not_reserved，不建单/付款/交付。没有注册执行器、持久输入/审批/dispatch或生产开关。主线必须仍经既有任务政策/权益和对应审批边界消费，不能凭此factory绕开；Guard的AI权益不是本片交付。

报价等待后再次解析当前身份和完整配置；配置读完再复核报价权限后才进入R1副作用。顺序复验不是原子授权/配置CAS。Core保存后若读后撤权，结果拒绝不等于报价回滚，也不能盲重试。本片不新增幂等许可。

## 红绿过程与命令

统一环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT为A树绝对output/lane-a-quote-authority.audit。预加载本树prisma-offline-preload.cjs。

新增测试初次加载缺模块：0pass/1fail/0skip/0todo，exit1。补adapter后7例4pass/3fail：一例同步异常Promise语义不一致；两例真正复现context等待后撤权仍调用Core一次、配置变化未拒绝。修复后保留零Core调用的失败断言。联合类型收窄编译错误已修；未删除任何用例或降预期。

```powershell
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=2 tests/ai-native-lane-a-quote-authority.test.cjs tests/ai-native-ain09-quote-preview.test.cjs tests/ai-native-lane-a-quote-boundaries.test.cjs tests/ai-native-lane-a-quote-candidates.test.cjs
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"
git diff --check
```

结果：49pass/0fail/0cancelled/0skip/0todo，exit0；API tsc exit0；diff exit0。四品类新增实际候选→显式确认参数→原Core resolver/createQuote与人工同链金额/明细等价，不是四套价格算法；Auth/Guard/Core/Membership实际实现，数据库配置执行是替身。原测试只把context对象引用相等改为值相等，配合快照隔离，并未降低业务结果断言。

上片诊断26项的正确API检查亦exit0（同上tsc命令）；之前命令路径/参数失败保留记录。

## 准确剩余

企业身份/预约资格生产源缺失；会员原查询仍无take；持久计划/输入/结果/累计计量由主线接入；报价R1写入的恢复/幂等与批准来源不在本线写权。原Core很多失败仍为中文异常而非稳定结构码，本片沿用已有映射，不冒充所有结构化错误已冻结；需主线给稳定业务错误契约。配置在最后复验之后的并发变化仍靠Core提交点约束，不宣称原子。

待独立复核；真库/真实HTTP/模型/设备/生产未验，不称AIN-04/08/09完成。
