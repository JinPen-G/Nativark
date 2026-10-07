# AIN-09 报价澄清与选择（功能片D）

沿既有AiQuoteCandidatePreparationService新增有限澄清项：field/reason/action/最多10个授权候选/截断标识。允许不完整抽取，缺客户/商品/地点/履约/时间可实际继续选择，不只有字段名。客户即使唯一仍需ID；商品与地点支持显式ID，重新读原目录/会员/服务器地点，ID不匹配不能用有效名称补救。无新金额输入/算法。

服务端返回selectionRevision（当前受控候选与完整Core context指纹）；显式商品/地点ID无revision或旧revision要求重读重确认，不自动应用新配置。此revision不是授权或审批。日期仍有限语法、服务器时区、DST不猜；不支持表达要求绝对时间。企业仍qualification_required；员工原白名单不改。

实际组合入口quote.previewSelection(value)：必须回传当前revision，重新prepare并按当前正式参数进入已有Core报价Guard/ALS；传入的configurationFingerprint在Core读取配置时再次比较，配置变化拒绝。旧低层preview仍保留供主线受控正式输入使用，宿主应使用新选择入口或由主线冻结正式配置依据，不能把低层入口当略过确认的捷径。此处只声明R1报价，不批准R2建单。

quotePersistence=unknown明确nextAction=reconcile、retryable=false，不自动再次createQuote/换ID，没有编造同操作查询。保存与not_reserved声明保留。

初次候选/既有preview定向23/23 exit0；接通实际previewSelection后最终同组＋真实组合冒烟25pass/0fail/0cancelled/0skip/0todo exit0；API tsc exit0；diff check exit0。没有扩大全专项矩阵。实际Core/Auth/Guard/Membership，数据库执行替身。

命令A树，DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_AUDIT=本树绝对output/lane-a-pack-d.audit（类型lane-a-pack-d-types.audit）。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-quote-candidates.test.cjs tests/ai-native-ain09-quote-preview.test.cjs tests/ai-native-lane-a-business-tools-smoke.test.cjs`

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`

Membership/Payment底层有界查询、企业资格、员工上下文、正式同操作报价核对及主线审批/输入冻结仍是明确依赖；主线最小补丁请求见前批记录，未越界修改。真库/HTTP/模型/支付/设备、深度矩阵及独立审计未验。A～D为实际业务服务功能片，不计任何AIN整项完成。
