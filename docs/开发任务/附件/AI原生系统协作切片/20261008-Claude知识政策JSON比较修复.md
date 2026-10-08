# Claude 主线：知识政策 JSON 内容比较（2026-10-08）

对齐AIN-04/10，基线2754cac0。PrismaKnowledgeActionPolicySource原先用JSON.stringify指纹比较数据库resource与请求resource；MySQL JSON重排键名会把相同资源误判为无授权。只改内容比较为Node原生isDeepStrictEqual，嵌套对象键序不影响相等，值、类型和数组顺序仍严格；不另造规范化算法。

查询resourceKey、grantKey及返回resource保持原算法/顺序，既有policy行、receipt、全局fingerprint均不变，不双查、不降级、不迁移。新置备仍须遵守原resourceKey合同，本片不承诺任意键算法互通。回退仅恢复旧的严格拒绝，不撤销已提交事实。

复用原formal-authorization测试文件，在现有首项补嵌套upload键序变化、原key/授权结果不变以及值/类型篡改拒绝。一次小冒烟3pass/0fail/0skip/0todo，output/claude-main-receive-20261008/policy-json-order.tap；没有新建测试脚本、红测矩阵或重复全API。数据库是替身，不声称真实MySQL验证。

Node沿原preload与lane-b-local-runtime、固定无效DATABASE_URL、本树绝对audit/write root/TEMP/TMP及禁compile cache；无.env、安装、外联、服务、共享生成物或schema修改。Runtime/Provider两条替换边界均不变，权限比较继续位于独立正式业务服务，不引入引擎/SDK类型。保留全部源码建议、中央WIP及output；未push/合main/生产启用。
