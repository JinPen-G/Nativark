# AIN-10/S02 授权检索与来源访问

2026-10-03；实际树 `.worktrees/claude-ai-native-knowledge-20261003`，分支 `ai/ai-native-knowledge-20261003`；起始 HEAD `e46f9ff039fb4d90a0e2fed25dd11d30d865a272`。只改本线白名单，不接线公共模块。

## 实现

- 必需select授权端口给出最多100个已授权文档版本/ACL约束，和当前主体/audience/accessKey绑定；repository搜索前接收这些约束，只返source引用，不先拿跨租户全文再过滤。没有默认scope扩展或默认workspace。
- 服务再次检查每个候选scope、版本、ACL、生效期、publication/parse/index状态；越界候选直接unavailable，不暴露隐藏数量/标题/片段。
- snippet、正文、resolve、下载引用分别授权。来源ID不是访问令牌；下载只返attachmentId+documentVersion，真正下载HTTP入口仍必须重新授权，不返回签名URL。
- 来源读回前后比较文档revision；撤权/撤回/删除/过期/旧ACL或版本拒绝。business_fact走独立可信引用端口，保留snapshot/missing/legacy_current_fallback，禁止换为current，也不进入SOP索引。
- recall有ready/no_results/not_ready/failed/unavailable。只对授权范围显示解析/索引状态；结果最多20条、单条2000字符、总计12000字符，输入query最多1000字符。
- 本地严格source/fact输入校验只承担应用边界验证，不复制公共DTO或更改C06。更严格的100条select、ID字符集是本轮内部限制，不能当公共契约已冻结。

## 实测与边界

- `node --test <本树>/tests/ai-native-knowledge-{lifecycle,access,contracts}.test.cjs`（实际逐一列出路径）：39/39，0失败/跳过；其中生命周期测试编译真实全部knowledge模块noEmit零诊断。
- 作者复查补上空结果返回前再授权和严格source/fact校验后重跑同组；最终结果以本片提交前运行输出为准。
- 用例验证候选跨租户变异、同ID不同空间、无workspace、SaaS对租户、员工/客户策略拒绝、单独下载/snippet拒绝、读取中撤权、旧引用、不存在和不可访问一致、历史basis不变、超限。
- fixture的角色规则是合成授权端口，**不证明平台/员工地点/客户本人真实Guard通过**。真实AIN-04需实现select与authorize，accessKey必须随身份、权限、地点与字段可见性改变；最多100条，不截断为“全系统无记录”，超范围应明确拒绝/后续分页。
- 只有静态、自复查、真正noEmit、服务/内存依赖与原C06契约证据；未进行独立review、真实DB、HTTP/Guard、附件下载、模型/浏览器/设备验收。网络预拦截，0尝试；未读.env、启服务、安装依赖、迁移、推送或合main。

文件：新增knowledge-retrieval.service.ts、knowledge-source.service.ts、access测试及本记录；更新本线ports/validation/fixture。依赖和产物只保持S01自身shared构建与第三方只读解析，下一片补有界缓存与索引传播。
