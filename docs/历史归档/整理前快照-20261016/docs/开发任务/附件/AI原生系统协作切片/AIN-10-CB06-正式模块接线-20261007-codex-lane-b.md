# CB-05/06 正式政策组合模块接线

接续9c61df7c，复用现有全部知识/记忆服务。新增 HumanKnowledgeModule.registerFormal：接现有 composeFormalPersistedHumanKnowledge，统一导出管理、上下文、索引、输入准备及可选 PersistentMemoryConsentService。AuthService、credentials、KnowledgePolicy、可选MemoryPolicy和文件Runtime仍由宿主显式注入，不自动注册HTTP/AppModule，不生产默认政策。

实际功能阻断修复：FormalMemoryAuthorizationAdapter 原来对 policy.resource.owner 用对象引用相等比较。持久政策读回/structuredClone后的同一owner必然是新对象，导致合法已有Memory读取、确认、修改都被拒绝。改为沿用已有内容指纹比较所有资源绑定，仍严格拒绝不同owner、revision、ACL与缺失绑定。Knowledge标量绑定同步使用同一比较方式，未放宽授权。

复用 tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs，没有新增脚本：先复现同owner独立对象被拒绝，0pass/1fail，退出码1。修复后1pass/0fail/0skip/0todo，退出码0。随后在同一冒烟接实际registerFormal→正式授权adapter→PersistentMemoryConsentService→真实Prisma仓储adapter→propose/confirm/read/revoke，仍1/0/0/0，退出码0；不同owner拒绝保持。政策源/当前会话与DB为离线替身，并非正式动作政策生产者或真MySQL证据。

命令 node --test tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs；prisma-offline-preload + lane-b-local-runtime；固定无效DATABASE_URL；AI_OFFLINE_AUDIT=本树output/cb06-owner-audit；TEMP/TMP=本树output/inspection-lb05-tmp。ts-node非transpileOnly检查加载源码；非全API tsc。git diff --check退出码0。

首片历史未验/依赖：当时正式Knowledge/Memory动作政策源仍须主线提供，不猜ACL/owner全权；知识附件业务归属和非签名URL有界内容读取仍须合法生产者；本片仅拒绝文件桩，不把它称为真实文件能力。A/R冻结输入消费不属于本线写入范围。该历史首片没有改shared/schema、原文件设施、Gateway、runner或主线文档；当前状态以下方接续记录为准。

## 2026-10-09 精确策略管理生产与原消费者接通

固定开工基线 `f10e80daa65315487ff18a9770889903f7929c49`，只在 codex-ai-native-lane-b 施工。主线已有 `PrismaKnowledgeActionPolicySource`，不再列为“政策源待主线”；本次补的是实际管理生产者。原 action policy 复合主键、resourceKey/fingerprint/grantKey 算法与 isDeepStrictEqual 保持，未复制知识/记忆服务、Auth/Guard、自动化授权、Gateway、预算或运行器。

### 入口、可信依据和生命周期

- `HumanKnowledgeModule.registerFormal` 支持原自备 policy 组合及 Prisma policyDb 组合；`registerFiles`/`composeKnowledgeFileApplication` 沿原路径带入可选 `policyManagement:{enabled,guard}`。启用此管理接点要求 policyDb 与业务 db 为同一原事务对象，未传选项不导出管理入口。
- `KNOWLEDGE_POLICY_MANAGEMENT` 导出请求级应用：`read(request,{authorityId})`、`prepare(request,change)`、`preparation(request,{operationKey,changeHash?})`、`commit(request,{preparationId,changeHash,confirm:'apply_knowledge_policy_change'})`、`operation(request,{operationKey,changeHash})`。request 只收当前 operator 凭据/requestId；每次调用新建服务，跨请求 factory 不保存凭据。enabled:false 在读取任何 AI 数据前拒绝。未注册 HTTP/UI/AppModule/worker。
- 原 `AuthService` 及 `TenantModelConfigurationAuthority`/`ApiAuthGuard` 的配置管理检查仍必需，路径权限实际是 `system:params:manage`；本接点还限当前 workspace、operator、all dataScope/all locationScope。它不是对知识资源的完整授权。
- 新 `AiKnowledgePolicyManagementAuthority` 是独立的服务端可信委派记录，不借用 automation grant。它绑定 tenant/workspace、managerId、精确 targetActorId/targetAudience/domain/action/resourceKey/resource、revision、requiredPermissions、allowedPermissions、allowedOperations、maxPolicySeconds、expiresAt、basisRef/basisVersion。enabled 默认 false；basisVersion 仅接受 `knowledge-policy-management-1`，期限上界最多90天。没有 seed、通配目标或默认全权。根记录由宿主受审计的可信治理提供，本管理应用不能创建/修改该根；缺记录返回 trusted_authority_missing，非法/停用/过期根拒绝。
- change 只选 authorityId、原 operationKey、expectedRevision、明确 action、权限与期限，不接受客户端 actor/scope/resource/enabled。新增只能 create_disabled；update_disabled 也只能改已禁用策略；enable 必须另行准备/确认且与原 disabled 权限/期限完全一致；disable 保留原权限/期限，以 expectedRevision CAS 收口。过期目标可显式 disable，但管理根与当前管理权限仍须有效；过期根已使受管策略在消费时拒绝，不借清理扩大权限。
- 新 `AiKnowledgePolicyPreparation` 冻结原策略快照、命令、sourceHash、authorityRevision/authorizationHash、期限和人工展示的 changeHash；该 hash 同时绑定 before、目标键、委派修订与期限，不只绑定请求正文。`AiKnowledgePolicyManagementOperation` 与原 `AiKnowledgeActionPolicy` 在同一 Serializable 事务保存，保留结果 hash、revision 和原键收据。新策略 disabled 的生成是真实管理服务写入，不是测试直接布置 enabled 行。
- commit 前另以唯一 commitSlot 占住同一精确策略/expectedRevision。此持久边界避免提交应答丢失后从同键或新键重发；占位或提交不明返回 unknown/retryable:false/read_operation。确认写入前崩溃也可能留下占位，必须人工核对，不自动清除/重开。收据未观测不是未执行证明。准备应答完全丢失可凭同一当前主体的原 operationKey 读回 hash；操作收据仍要求原 key/hash。接口不返回业务执行权。

### 资源约束与真实消费

- 管理器从可信根取目标，从当前 user/workspaceMember/workspace 验证合法主体/空间。文档资源读取原 document state 并核对当前 documentVersion/attachmentId/aclRevision/owner；非 owner 的目标必须有原 AiKnowledgeAcl 的精确 action 行，非 owner 的管理员须另有 `manage_policy` 行。此为版本1的受限规则，不把任意 ACL 的 read/write 文本泛化为全部动作，不代写 ACL。owner 只满足资源归属检查，不能取代独立委派或配置管理权。
- 空知识资源仅作为既有动作的 workspace 前置检查，原服务还会要求精确文档策略；不把它当所有文档通配。当前管理器的知识白名单为已存在文档的 read_metadata/parse/publish/withdraw/delete/revise/search/read_body/snippet/resolve_source/download/index/change_acl，不生成 upload/create 的未来附件/文档政策。相关正式上传业务链保留，但未来上传/新文档可信预备目标的治理规则仍待宿主提供，不能用本片宣称首上传政策全链完成。
- 记忆绑定目标 user owner；已有记录核对 scope、owner、revision、ACL 和状态。为原服务写后立即读取的约束，可由精确可信根预备首版 propose/read，以及从当前版本向下一版本的 read；不预造记忆、确认记录、确认成功或任意未来版本。当前内容和确认有效性仍由原 PrismaStructuredMemoryRepository/PersistentMemoryConsentService 再验证。
- 原 `PrismaKnowledgeActionPolicySource` 对受管键回查最新管理收据、冻结准备与当前根，以及资源身份/ACL。根停用、修订/权限边界变化、主体失效、策略禁用/过期均不复用旧许可。原手工服务端置备且从未管理过的 policy 行保留原语义；新的 Prisma source 需要能读管理收据表，缺表不伪装旧模式。`FormalKnowledgeAuthorizationAdapter`/`FormalMemoryAuthorizationAdapter` 继续 Auth 双复验。
- 实际冒烟由管理入口创建 disabled→显式 enable，驱动原 HumanKnowledgeService publish/read/preview、HumanKnowledgeInputService collect/revalidate、PersistentMemoryConsentService propose/confirm/read/revoke。知识测试的既有已解析文档、索引就绪状态是明确业务夹具；新策略生产、管理校验/Guard、source/adapter、人工确认与仓储服务均实际执行。所有根记录、Auth 平台数据、数据库事务/锁均为显式离线数据替身，不是真实 MySQL 并发证据。

### 精确公共补丁与验证

本树只新增 public leaf `packages/shared/src/ai-knowledge-policy-management-draft.ts`。主线整合时按公共发布规则添加 `export * from './ai-knowledge-policy-management-draft';` 并决定已有 OpenAPI 发布组件；本线没有修改 shared 总出口/OpenAPI/生成物。leaf 包含版本、动作、change/commit、准备及收据选择、策略快照、observed/unknown 类型。无 HTTP 路由，不能虚构请求路径。

schema 只增加上述管理根/准备/收据三表与 BusinessWorkspace 最小反向关系，原 AiKnowledgeActionPolicy 不改。唯一追加迁移为 `20261009131000_ai_knowledge_policy_management/migration.sql`：默认 disabled、复合 scope 外键、原操作键和策略修订收据唯一键、commitSlot 唯一键；没有更新旧迁移、播种或执行 SQL。

验证使用原 prisma-offline-preload 与 lane-b-local-runtime，固定 `mysql://offline:offline@127.0.0.1:1/rental_os_offline`，AI_OFFLINE_WRITE_ROOT/AI_OFFLINE_AUDIT/TEMP/TMP/cache 均为本树绝对路径。复用现有生成隔离脚本；该脚本内部仍沿其既有离线 DB 名 rental_os_e2e_offline_schema，不进行连接。首次生成 P1012 指出复合一对一关系缺完整唯一键；修正后 exit0，guardViolations:0/sharedArtifactsUnchanged:true，只生成本树 client，保留脚本报告的旧临时目录。

仅复用 formal-authorization、versions、file-runtime 三个测试文件/原 fixtures，没有新增测试脚本或扩大矩阵。首轮 2pass/2fail（TS2367 比较及测试括号）；随后同组 2pass/2fail（nullable 类型缩窄）；定向管理检查先 3pass/2fail（夹具拿了 integration 权限，真实 Guard 拒绝），再 4pass/1fail（记忆缺精确写后读策略）。均在关联处修复，没有弱化 Guard 或原断言。最终同组三文件 **13pass/0fail/0cancelled/0skip/0todo，exit0**；原 ts-node `transpileOnly:false` 检查加载源码，非全 API build。新增用例涵盖禁用及失权召回材料复验、根缩权、人工撤回、缺根/越界/过期/旧修订/假字段/禁用入口拒绝、diff 篡改与应答丢失原键零重写、跨新键占位拒绝。

实际命令尾：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-concurrency=1 tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs tests/ai-native-knowledge-lane-b-versions.test.cjs tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`。git diff --check 通过。未验真实 MySQL FK/隔离/并发、真实会话宿主、HTTP/存储/模型/浏览器/设备；未安装、启服务、连真实网络、执行迁移、push 或合 main，不改28项状态。

### 停用、状态保留和未来替换

当前继续自研，Runtime 与 Provider SDK 两个边界独立且均未安装。稳定接点是上述请求应用、原策略源/正式授权适配器及知识/记忆业务服务；prepared、commitSlot、operation receipt、policy revision 是本系统持久事实，不绑定框架 checkpoint。Provider/Gateway/预算单账和审批/Core没有新执行路径。未来换 Runtime 只消费这些端口，换 Provider 不触及此域；unknown 必须读原键，不能换引擎重发。回退可以停止管理 factory，受管策略需显式 disable/撤根或按期失效，关闭管理入口本身不谎称已撤销既有消费授权。保留全部既有源码/测试/收据；真实迁移、根置备、保留/删除政策、生产 HTTP/UI 装配以及上传/create 的可信目标管理仍需各自授权与验收。
