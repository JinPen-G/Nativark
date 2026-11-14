# AI Native：当前协作接续

更新：2026-11-15。继续原AIN-01～28及全部AIN-ENTRY核心范围，以[需求v1.15](<AI Native-需求.md>)、[任务v1.19](<AI Native-开发任务.md>)为正式依据。负责人已批准必要模拟冒烟、类型及独立复核作为本轮研发验收，真实数据库／浏览器／微信／供应商由负责人后续测试；实现、生产装配、业务确认和权限门槛不变。任务百分比只维护任务册。

## 当前目标与工作现场

施工树为D:/工作文件/rental-OS/worktree/ai-native、codex/ai-native。当天首次修改前本地／GitHub均核为3401e8be77693f85a1dc0e66778896708ceecb69，索引空、无merge／cherry-pick；main远端为62ca183f10b7c316ab63c28ef6d04ee88d06488b，后继集成由PM核定。旧接续完整字节保存在上述AI固定前像的同路径，关闭阶段与历史前像从原[开发记录](<AI Native-开发记录.md>)导航，不另复制附件。

1. **AIN-24正文加密与安全全文。** 原hold／知识／记忆同事务保护10e1c81、[正文传播／会员收据／HTTP审计](<AI Native-开发记录.md#ain24-original-body-propagation-audit-20261114>)e346a2417及[原场景／bytes审计](<AI Native-开发记录.md#ain24-original-scene-bytes-read-audit-20261114>)3401e8be7已上传并核接必要模拟／类型。当前缺原敏感正文加密存储、独立语言质量和展示攻击类别证据。Root补AI私有存储适配及实际provider，不改通用PrismaService／SecretBox，不新增schema／DDL；覆盖模型输入输出、原请求、人类回答／问题副本、知识／记忆／确认副本、员工草稿和客户端材料。知识检索须沿当前受权版本有界解密匹配；两条客户端材料raw SQL显式编解码，嵌套chunk写读及原JSON_PATH元数据不能漏。原hash／预算／批准／业务收据、空正文／tombstone／DbNull及unknown保持。当前AiConversation无title或正文列，不为名单造schema。dev1补固定结果的独立语言与实际模拟沙箱攻击证据；不因默认关闭或缺实测而跳过实际实现，也不把已装配operator审计外推成旧staff／未注册Gateway接口开放。
2. **AIN-15企业正向与选单建单接管。** 原目标受理、参数／日期地点重答、Core候选、选单／新提案／新批准及[原订单办理消费者](<AI Native-开发记录.md#ain15-original-order-link-consumers-20261114>)已固定。Core明确拒绝operator代本人声明企业告知／付款；企业选择／准备不能当企业正向报价，跨专项授权依赖留原记录供PM读取，不改本人／经营权限或自造告知。dev2接selectedOrderSource → composeSelectedQuoteTaskHost → rental.order.commit的原接管／收据；TaskCenter目前对该Run返回specialized_host_required，Root接最小公共恢复装配。保留原selection／Task／Run／planHash／inputHash／fencing、独立takeover和claim_recovery权限；旧worker迟到拒绝，丢ACK只读原收据，不换键或新增模型／Core动作。
3. **AIN-26～28和ENTRY。** dev2的[固定四品类8例](<AI Native-开发记录.md#ain26-four-category-fixed-evidence-style-20261115>)已交回，Root核原证据与限制；同Core路径、正常批准／单次订单／丢ACK恢复和锁内缺货通过，只补对应矩阵切片，不替代全部并发／取消／接管／多端全文。15／24前置齐备后继续26，随后27／28原部署／灰度／停用／升级回退准备、独立复核和可操作交付；真实生产开放仍独立授权。全部18项ENTRY保持原范围，跨audience／surface、匿名／企业、媒体弱网及隐私等按原条款逐项核定，不因原28项完成而遗忘。

## 写入归属与协作

| 负责人 | 当前独占范围与下一入口 |
| --- | --- |
| AI-RD／01a1be68-da55-7f13-9536-79be07cb2093 | AI索引／四册／提交推送、shared总出口／Guard／AppModule／OpenAPI及公共provider；AIN-24完整正文加密和原检索／SQL／删除／hold适配，AIN-15选单TaskCenter公共恢复reader／application／provider／shared。仅暂存已核成果。 |
| AI-dev1／01a1bf34-f061-74c2-b588-3e21385c4b49 | 已交回原报价及全部审计源，当前只读固定原结果的独立语言质量与展示攻击模拟；确定性业务断言另列，不自评分，不新增测试脚本，不改Root加密／公共源。实际回合已核有工具进展。 |
| AI-dev2／01a1bf35-1ee5-7400-a97d-c0ebf5f9482c | 独占runner/order-task-host.composition.ts、scenes/human-quote-order.composition.ts和scenes/request-bound-scenes.application.ts中的选单恢复／接管hunk，其余场景不改。四品类固定证据和287字节员工原WXSS已冻结交权，Root补交；公共恢复与客户端改动先给必要接点建议，不抢shared／四册／索引。 |
| 内部/root/opening_core_closeout | 已交回原阶段独立复核及正文加密静态接点清单，无产品／四册／索引写权；没有运行测试或核定尚未落盘codec。 |
| 内部日历／对话助手 | 原报价待确认reader、确定性摘要、历史及计时修复均已交权；无活动源码写权，不重复绿色模拟。 |
| main／PM | main串行集成、真实数据库／迁移／Client／服务恢复的唯一负责人。每两项原任务新达100%形成main节点；AI不争main索引或夹其他专项WIP，助手不等待集成。 |

按当前消息纪律，助手不主动报一般进度，结果和实际阻塞留原对话，AI-RD主动读取并具体派工；Root不主动向PM／QA广播阶段。只有PM对当前具体事项先发消息并明确要求回复时，向PM回复一次必要结论。每次接续先核两助手实际工具进展，失效时恢复原任务，不把消息已送达当已启动；不改模型设置或虚标Goal完成。两助手目标卡状态仅沿各原会话核实，不用实际active回合推定旧blocked目标已被工具恢复。

## 已关闭范围及main边界

- AIN-12／13的[原全文](<AI Native-开发记录.md#ain12-13-simulated-whole-closeout-20261113>)，14的[开业品类／能力](<AI Native-开发记录.md#ain14-category-capability-whole-closeout-20261113>)，16的[原姓名／通知／规则／日历](<AI Native-开发记录.md#ain16-simulated-whole-closeout-20261114>)及17／18的[Outbox](<AI Native-开发记录.md#ain17-simulated-whole-closeout-20261114>)／[限定经营](<AI Native-开发记录.md#ain18-simulated-whole-closeout-20261114>)已按本轮研发口径核闭，后继复用实际原接点。事件解释／保存／关闭不等于业务已处理；生产自动业务白名单未批准保持关闭。
- [19原识别](<AI Native-开发记录.md#ain19-source-text-simulated-whole-closeout-20261114>)／[20员工](<AI Native-开发记录.md#ain20-signature-reopen-simulated-whole-closeout-20261114>)、[21客户后端](<AI Native-开发记录.md#ain21-simulated-whole-closeout-20261114>)／[22Web与小程序](<AI Native-开发记录.md#ain22-goal-booking-original-consumers-20261114>)、[23品类消费者](<AI Native-开发记录.md#ain23-category-human-model-consumers-20261114>)／[25指标成本故障回退](<AI Native-开发记录.md#ain25-measurement-cost-rollback-whole-20261114>)的完整研发证据已固定，原两项main节点保留，PM按必要前置串行整合。首字／首卡、50样本与成本包络是明确模拟，AIN-D05生产参数采用及真实供应商成本未验证。
- PM本机MySQL8.4.11的[原Outbox恢复](<AI Native-开发记录.md#ain-main-mysql-boolean-check-recovery-20261114>)及[CHECK包装兼容](<AI Native-开发记录.md#ain-main-mysql-check-metadata-quotes-20261114>)固定补片已交原记录；最后实际assertStorage／resolve／迁移／服务恢复由PM核，不沿旧接续宣称现已恢复。原main两个P1及后继固定整合分别见[contract／calendar修复](<AI Native-开发记录.md#ain-main-contract-calendar-p1-fixed-20261114>)、[12／13固定闭包](<AI Native-开发记录.md#ain12-13-current-main-fixed-closure-20261114>)及[五公共组合](<AI Native-开发记录.md#ain-main-20e33-five-public-integration-20261114>)，历史来源不代表当前main已全收。
- Core订单／资金／品类／配置仍由原专项负责。ClientApiService.readOrderSubmission、企业reader／Controller／GET、openapi-document.ts企业登记、enterprise-workflows.ts的payment_proof／消息、file-storage.runtime.service.ts企业付款证明区域为PM已给企业RD的窗口，AI不覆盖；真实冲突登记原记录供PM单点协调。

## 保留问题与验证边界

- 原[首次窗口耗尽](<AI Native-开发记录.md#ain12-original-time-limit-cause-20261113>)及慢读timeDebt／UNKNOWN具体历史证据缺失败当次采样；已修同租约收尾遮蔽首因，正常重跑不核销旧账或证明旧unknown解决。原worker取消／释放／核对收据及Task累计资源复用，TTL／租约／客户端断线不证明未派发或可重做。
- 旧order-history的reads.length===1与当前前后双读不符，原失败保留，不压平一致性补绿。客户小程序[107入口类型对照](<AI Native-开发记录.md#ain-client-mini-type-evidence-20261112>)的main两处consumed标签由PM企业后继核；不凭不完整虚拟声明批量改源码。
- 本树稀疏检出；必要验证只读复用主仓库受管依赖，TypeScript5.9.3从ts-node解析，Prisma读取主仓库apps/api/node_modules/@prisma/client已生成入口。加载当前TS须preferTsExts:true，未核旧.js不删除。没有安装、复制环境或生成共享Client／dist授权。
- 必要模拟沿本树原prisma-offline-preload.cjs和不可达DATABASE_URL，audit／写根／TEMP统一指本树任务目录，纯内存时不创建；谁创建谁finally清理。禁止.env、真实业务HTTP／DB／DNS／模型／资金／存储、迁移、启停服务或部署；不新增／扩写测试脚本、不删断言或skip补绿。
- docs:check仍四处既有缺链：导航历史三处、稀疏示例一处；原链接和任务算术无新增错误，不伪造附件。原未知output／唯一原稿／他人成果按规则只读核，不默认清理。
- 本次四品类固定补交的验证进程均退出、重复内存快照已释放、任务临时目录未创建，无新增临时残留。关闭任务和阶段立即中文提交／普通推送AI分支并回读GitHub；main按PM固定来源整合，提交不代替业务验收。
