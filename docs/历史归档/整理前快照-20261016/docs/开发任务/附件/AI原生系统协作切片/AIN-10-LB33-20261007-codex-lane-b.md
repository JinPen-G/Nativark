# LB33 偏好差异与完整消费／第二接续批交接

本批范围049a2ce1之后，唯一B线树/分支。固定顺序：9d8c8f83版本/解析，6d1142bb引用消费，本文件所在提交为偏好差异与组合消费。未合并移动主线，不覆盖WIP/output，不更新中央文档或AIN完成率。

## 新入口及真实接线

- 原HumanKnowledgeService：parserCapabilities、versionStatus；detail增加nextStepAuthorization，正式动作结果与原状态建议分别表达。建议不是执行许可，仍需原操作/当前revision与真实动作复验。
- 原HumanKnowledgeContextService：beginCitations(query)直接实际收集，返回服务器内存handle（不是可序列化公共DTO）。manifest/resolve(sourceIds)/openMany({sourceIds,maxSnippetChars,maxTotalBytes})/recollect(query)保持本次集合和当前身份。模型只交ID，不能添加来源；只有成员关系保证，不保证回答正确。调用主线既有context服务入口即可，无新根注册。
- 原PersistentMemoryConsentService：previewChange({memoryId,expectedRevision,preference})在read+modify正式动作下返回现值/候选/修订/期限，不写入、不确认。宿主接着调用原change、明确人类confirm，再read/confirmedPreferences；删除/revoke继续原流程，不混淆。
- confirmedPreferences增加returned_items_only的ambiguities：同kind存在不同结构化值时列出原memoryIds，请求人类选择，不采用latest-wins，不推断地点/币种/业务兼容性；businessCompatibility明确unavailable。HumanKnowledgeInputService.collect/revalidate已接收并复验此区，歧义与正文分区，不能覆盖Core/授权/审批。

## 20项范围对齐

1～4：原revise/CAS/不可变版本复用；增加实际格式与版本状态、失败新版本修正；unknown parse禁止被新修订覆盖，只核对原receipt。文件归属正式动作缺失仍拒绝。

5～10：来源保留真实section/paragraph、chunk/version与内容指纹，无页码虚构；新服务器收集handle提供最小清单、本集合ID解析、有界多来源打开及新observation重收集；每次走原授权与正文服务，旧来源不静默替换。

11～12：原recall的no_results/not_ready/failed/unavailable仍保持，不把无结果等于政策不存在。引用handle仅接受ready/partial，不改原细分查询结果。内容始终untrusted_data，无关键词清洗充分性声明，无工具/收件人/执行参数生成。

13～17：原严格shared结构化偏好值及人类确认复用，额外键拒绝；增加只读差异预览、多个有效候选歧义；列表/详情/上下文读取原状态及实际确认。过期不续期、删除保留审计事实，确认撤销不等于删除。

18～20：detail状态建议与正式政策结果可供宿主装配；新增方法均在已导出类与原persistent human组合可调用，非孤立接口。生产公共依赖不齐保持unavailable；本记录仅本线交付。

## 验证及真实失败

环境均为本树双preload（prisma-offline-preload.cjs、lane-b-local-runtime.cjs），固定mysql://offline:offline@127.0.0.1:1/rental_os_offline、绝对output/lb31-audit/lb32-audit/lb33-final-audit目录。

- LB31 `node --test tests/ai-native-knowledge-lane-b-version-lifecycle.test.cjs`：2pass/0fail/0skip/0todo，退出0。
- LB32 citations文件首次TS7023失败（0pass/1fail，退出1），补明确返回类型后同文件1pass/0fail/0skip/0todo，退出0。
- LB33初次preview+input-composition两文件：2pass/0fail/0skip/0todo，退出0。
- 加入过期冒烟后，preview+composition+version三文件：3pass/1fail，退出1，原因是旧测试政策只接受固定authorizedAt，不是产品放行过期。仅给本线测试补明确晚时点政策替身，不改公共fixture/生产授权。
- 最后仅复验失败相关preview与修改的version文件：3pass/0fail/0cancel/0skip/0todo，退出0。过期列表为空/usable=false/预览拒绝，确认数不增长；还验证未知字段拒绝、modify撤销旧有效偏好、正式index拒绝时下一步不可用。composition在上一命令已通过，未无故扩大回归。
- API隔离noEmit compiler API：读取apps/api/tsconfig.json，保留严格选项，noEmit=true/incremental=false，rootDir/baseUrl本树；paths指向本树shared/src/index.ts与apps/api/node_modules/@prisma/client/index.d.ts。API_ISOLATED_DIAGNOSTICS=0，退出0。未执行普通构建、未写共享生成。
- git diff --check退出0。计数是阶段性冒烟，不相加冒称主线全量通过。

## 剩余精确依赖／未实现

- 正式KnowledgeAuthorization/MemoryAuthorization的动作政策、附件业务归属、KnowledgeFilePort读取中有界bytes、最终逐次文档ACL授权下载仍须主线提供。AuthService只解析身份，不能据owner或自由ACL字符串默认授权；测试grant不算生产装配。
- 历史版本受权列表与完整授权分页没有实现，仍显式unavailable。虽然已有不可变版本表，未有按历史版本授权/枚举合同，不以当前head权限推断全部历史可读，不新增影子表。
- 同memoryId变更期限/重新提议的正式修改契约未提供：既有change不含expiresAt、旧propose receipt绑定原期限，过期不自动续期。宿主可走原明确新memoryId的人类提议+确认流程；本线不自动生成新ID或迁移旧同意。若需同ID续期，主线应定义修改动作、expectedRevision、期限、旧确认失效与幂等载荷绑定。
- 业务能力与偏好的冲突需要Core正式校验；本线只报告已返回集合中可确定的多值歧义，无优先级定义、不替用户选定业务结果。
- failed索引重试、unknown解析重派、历史保留/清理政策、多实例失效机制和后台执行主体仍无新正式依据，沿原manual/reconcile，不无限重试、不建队列/调度器。
- 引用handle只是有界同进程服务器对象，进程重建必须重收集；不是持久授权或可恢复token。顺序复验不等于跨资源原子快照，主线冻结/派发仍复验。

未读取.env、启服务、联网/真实DB/文件存储/模型/支付、安装/迁移/共享生成、push/main/部署。真实MySQL锁/宕机、文件宿主、模型回答质量、生产均未验；不宣布AIN-10/24完成。可合法功能已接通，剩余上述正式依赖不通过越界实现绕过。
