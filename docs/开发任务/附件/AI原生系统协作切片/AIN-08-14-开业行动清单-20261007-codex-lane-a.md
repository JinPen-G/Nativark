# AIN-08/14 开业行动清单（功能片C）

入口composeAiAuthorizedBusinessTools(...).openingActions.read({risks?:{from,to,locationId?}})。原诊断Guard/ALS包围既有opening/risks＋实际Core context；读取后配置指纹复核。分区返回问题/影响/必需性/状态、configVersion、证据引用及受控人工section引用，无猜测URL或写入。

仅有typed现值证明缺少启用商品/地点时标missing_configuration；其他未满足readiness为readiness_unsatisfied，不能从自然语言推断是缺失/冲突/正式检查失败。unavailable为source_unavailable，ready仅readiness_check_passed；外部连接/凭据/负责人决定/未实现等无正式分类源标not_loaded及unresolvedClassification，不伪造成功或强行分类。未知分区不给导航。正式草稿未接，candidate_only列当前版本和待核字段，不生成修改值或写活动配置。风险保持缺成本/缺历史容量的不可用口径，各分区非原子事务。

正常真实开业/报表服务＋组合和核心撤权2/2 exit0；自查收紧缺配置及未知分区后同组2/2 exit0，0skip/todo。API tsc exit0，diff check exit0；未扩大深矩阵。

A树环境DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_AUDIT=本树绝对output/lane-a-pack-c.audit（类型lane-a-pack-c-types.audit）。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-business-tools-smoke.test.cjs`

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`

正式验证状态来源/配置草稿端口/审批持久化属主线缺口，不替代它们。DB执行为替身；真库/HTTP/模型/支付/浏览器设备、独立审计及全量未验，不改专项完成率。
