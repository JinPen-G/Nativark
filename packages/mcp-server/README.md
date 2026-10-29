# Rental OS MCP transport foundation

此包提供受保护的Web-standard `fetch(Request)`入口及受控只读工具注册，不启动监听器、不读取环境，也未装配进原API。只有真实资源验证、原权限、持久计量、发布和字段释放全部接入后才能发布业务工具；当前没有生产OAuth AS或实际Rental业务注册。

## 当前入口

[createProtectedMcpEndpoint](src/index.ts)接收显式配置和可选`ResourceTokenVerifier`，返回`fetch` / `close`。

- `enabled`必须明确给定；关闭或未提供验证器返回503，不用匿名模式或恒真适配代替。
- `resourceUrl`与`authorizationServerUrl`仅接受无凭据、query或fragment的HTTPS地址。资源不能占用`/.well-known/`路径；存在的Origin必须在显式列表内。
- `maxRequestBytes`限制SDK读取的完整请求；`authorizationTimeoutMs`限制身份核验等待。配置在构造时捕获，不能中途换resource或授权范围。
- 缺少或非法Bearer返回标准401及`WWW-Authenticate`资源发现提示。验证器必须从原可信身份系统核验issuer / 签名、当前client / grant / scope和撤销；这里要求可信`subject`并再次检查resource、到期和clientId，不将验证结果当作原业务Guard已经通过。
- RFC9728资源元数据只指向配置的授权服务器，不伪造RFC8414授权服务器端点；授权服务器必须由实际AS提供。所有响应禁止缓存。
- 官方SDK负责2026-07-28及2025-11-25旧版stateless协议。未注入`readTools`或当前未发布工具时返回空Tools；此处空列表只表示运输接口存在，不是业务成功。目录、报价、建单和模型工具尚无生产注册。
- 取消 / 关闭 / 授权等待超时后不接受迟到核验结果；`close()`重复调用共用同一关闭Promise。验证器收到可选`{signal}`，兼容原单参数实现；新适配必须观察 / 转发。停止接纳仍不证明不合作的依赖已停止，验证器必须是无业务副作用的身份读取。已提交操作不因关闭推定回滚。

### 当前资源token introspection

[createIntrospectionVerifier](src/token-introspection.ts)支持RFC7662：部署明确给出HTTPS issuer / resource / introspection端点、client ID / scope白名单、等待与字节上限，并由Host-only认证适配提供AS客户端Authorization。没有默认AS secret、动态端点、重试或active缓存；MCP调用方的Header不作为AS凭据。

每次认证向固定AS发送一次access-token查询，禁止Cookie与重定向，声明和实际UTF-8字节有界，取消传到适配器。只接受明确active、精确issuer / 单一resource audience、允许client / scope、subject及有限expiry；额外AS字段不输出。active=false等无效身份返回标准401；AS缺证据、坏响应、超限或故障返回安全500，不伪称token已经撤销。元数据 / 日志不包含token、subject、AS原文或客户端秘密。

此实现不是OAuth AS、用户grant或原业务身份：AS必须实际逐次核对grant / client / tenant停用，才能返回active。可信subject只在服务端内部交给原发布 / authority / accounting / release及指引provider，不进入协议结果或元数据；原作者仍须映射到原Auth / Guard / ALS；tenant / workspace / location / dataScope、字段和业务操作仍缺生产者，故没有开放业务Tools。AS客户端认证必须来自正式秘密持有者，不接受模型输入；未装配到真实服务。

### 原授权只读注册

[readTools](src/read-tools.ts)是服务端内部注入，不是客户端配置或权限声明。每项注册必须由原契约作者提供闭合输入 / 输出JSON Schema、无业务副作用的reader，并同时提供当前`publication`、Controller等价`authority`、原服务端持久`accounting`及完整外发`release`。原authority负责Guard / ALS及返回前业务复验；当前资源认证不能代替它，本地计数器也不能代替原目标准入。

官方SDK沿同一schema校验输入和输出；返回前复用同一输出validator把无效投影转安全错误，不回显私人校验明细。当前发布条件决定列表，旧缓存直接调用仍复验。执行顺序为原权限 → 原计量 → reader → 获准投影，投影只接受普通JSON字段：有限数字、字符串、布尔、null、完整数组及普通对象；循环、稀疏数组、undefined、非有限数、自定义对象、getter / toJSON等整项拒绝，不调用转换或把缺值改成null。字段先形成一份脱离原对象的JSON快照，文本及structuredContent从同一份生成，不把后台原对象交给PTC。每个外发字符串最多2,000字符、每个数组最多50条；超限整项不可用，不裁掉事实。注册最多50个互异名称；这不是业务分页实现，实际reader仍须有界读取并提供正式来源 / 期限，不能全量读取后仅在此过滤。

只读配置的请求从首次认证到执行、最终输出共用最长15秒截止，身份读取另受更短配置限制。一次请求捕获不可变subject / client / resource / scopes供原providers消费，SDK认证对象只由本端私有WeakMap关联该引用，不靠模型actor或客户端上下文。发布 / 调用 / 读后及整份MCP响应发送前复核主体与范围；即使client / scopes相同而subject变化也拒绝。整份MCP响应在发送前缓冲并再次核验当前资源身份，最多65,536 UTF-8字节，包含envelope、文本转义及structuredContent重复；超限返回安全503，不截断成成功。单投影32,000字节预检查仅提前拒绝，不能代替整包上限。内部失败返回安全不可用结果，不能把权限或计量失败冒充空业务结果。

[离线测试](../../tests/mcp-foundation.test.cjs)用真实两代SDK验证发现 / 调用、未知输入、当前发布撤回、原权限 / 计量 / 释放顺序、私有字段不返回、投影与重复包装超限及读后身份失效。所注入业务provider均明确synthetic，仅验证注册编排；没有接原目录Core、真实Guard、持久目标或获准字段生产者。

### 原对话模型结果的只读候选

独立包出口`@rental-os/mcp-server/conversation-result-read`提供[createConversationResultRead](src/conversation-result-read.ts)。根运输出口不自动加载这项适配；该子出口必须具备当前`@rental-os/shared`运行时和生成声明。它读取既有`ain-conversation-draft-2`的`modelResult`契约，只接受conversationId / admissionKey / resultId及版本，不接reader、模型、工具名或身份参数；构造不发布工具、不建Task / Run、不调用模型。

适配复用shared公开输入和完整原结果schema，保留严格限制与所有本地引用；不覆盖shared组件。当前`AiOrderExplainRequestDraft / AiOrderExplainInput`仍由原API组件作者持有，尚未从shared发布；装配必须显式提供这些固定原组件，缺项拒绝，不写私有同名schema补齐。原Web完整结果及其传递schema不能直接作为MCP发现 / 释放：完整发现实际超过64 KiB。装配还必须提供原字段作者的闭合MCP投影schema，并沿原`publication / authority / accounting / release`注册；本适配不自行定义外发字段或生产名称。

原reader的返回先校验完整结构，再核对conversation / admission、原请求、能力版本、task和精确resultId，之后才能进入外发投影。available正文仍是未验证模型文本、候选不是批准；unknown / failed / stale保留原状态、空正文和禁止自动重试。material_erased只允许原erased分支及当前原Task定位，不恢复正文。原Reader负责当前原权限、Run / 来源及读前后关联复验；此适配没有真实Guard / ALS、原持久计量或释放政策，不能把Web Bearer换成MCP token调用原HTTP组合。

[离线测试](../../tests/mcp-foundation.test.cjs)通过两代真实MCP SDK消费该候选；已有结果、错原关联、非法参数、撤回、取消迟到及MCP字符串上限拒绝已验，原业务读取和政策为明确替身。当前shared源码及MCP源码严格编译到独立output，NodeNext消费者从两包正式出口读取声明并运行产物，不覆盖公共shared/dist或安装依赖。原Harness校验器对实际输入schema仍报UNSUPPORTED_SCHEMA；没有削减约束来启用Host，故没有这项真实Harness消费者或生产注册证据。

### 版本化服务器instructions

可选内部`instructions` provider由原发布 / 字段政策作者提供已审查的当前外发指引及版本。未认证不读取，缺许可返回无指引；故障只返回安全不可用结果，不输出provider原错误。完整文字包含版本 / 归属最多2,000字符，并沿完整15秒 / 64 KiB响应限制和返回前资源复验。官方SDK在现代discover和旧版initialize提供同一指引；更新读取当前版本，撤回不保留旧发布。

没有自行编写或生产批准一份业务提示词；instructions不注册Prompts / Resources、不发云模型或建立任务。可选Prompts由下述独立provider启用。客户端是否采用指引须独立验证，旧缓存文字不维持授权。Harness原AgentLoop以脚本模型验证指引及释放事实进入原日志 / 下一模型请求，中立材料256 KiB和同一Session / 原工具记录重用亦有离线证据；实际模型、最终目的地 / 线包及全部留存仍未验。

### 可选版本化Prompts

[Prompts注册](src/prompts.ts)仅在内部`prompts` provider明确提供时声明能力。`list`按当前可信主体及原发布政策返回最多50个版本化描述符，`read`读取该名称当前审查后的指引正文；两者不接受业务查询条件、不调用reader / Core、不新建Task或云模型。缺provider不声明Prompts；缺某名称许可从列表移除，缓存名称再次获取仍拒绝。

标准`prompts/list`返回名称与包含版本的说明，`prompts/get`返回一条user角色文本及相同版本说明；空参数允许，非空arguments及非空cursor拒绝，不提供任意提示词代理、敏感输入或分页聚合。正文和说明复用instructions格式及完整2,000字符限制，整包沿15秒 / 64 KiB缓冲和主体返回前复验。获取时重读当前目录，正文版本不一致、读取期间撤回 / 版本变化、缺正文或provider失败整项不可用，不回显私人错误或返回空成功。

此片不声明listChanged通知、Resources、completion或批准能力。SDK请求取消信号传给provider；现代请求取消可中止其请求，旧版stateless取消通知不证明另一请求已中止，端点关闭 / 截止仍拒绝迟到正文。Provider须落实真实取消和原发布政策，不能把客户端停止等待当服务端已停止。

Prompts只是用户或支持的Host可选的起步模板，不保证自动进入模型提示词。当前Rental工具桥不自动获取Prompts，已有Tools及instructions继续独立消费；Harness另有默认关闭的显式列表 / 选择命令，已沿原Loop验证用户消息与日志重建。实际GUI、真实模型采用及生产审查文字仍未验，不能以模板返回证明业务或自主呈现已开放。

## 依赖和消费边界

声明`@modelcontextprotocol/server` 2.2.0、TypeScript 6.0.3及Node类型22.20.1，来源是本树已安装版本的实际声明与行为。**本包尚未安装依赖或更新根锁文件**，不声称当前根`npm ci` / 工作区构建就绪。源码只按包出口导入，不依赖Harness私有目录。原对话结果子出口另声明`@rental-os/shared`0.1.0可选peer；使用该子出口时必需，根运输不依赖它加载。版本号相同不证明schema产物已同步，实际组合须核对源码 / 声明和运行时。

测试仅用本树Harness已有SDK安装进行进程内装配，没有复制依赖、改锁、打开端口或发HTTP。当前源码还严格编译到独立output，NodeNext消费者从实际包manifest出口读取声明并加载编译产物，真实两代SDK完成认证 / 发现 / synthetic只读调用及释放投影；这是隔离产物消费，不是root安装、tarball分发或生产业务验收。生产接线须先在获准依赖工作中建立本包正式依赖 / 产物，并由原身份作者补全当前OAuth / grant及Guard / ALS，不把测试synthetic verifier放入生产。

## 下一接点

1. MCP-02：原身份OAuth / grant、后台准入和当前权限生产者；不能使用Web token替代MCP资源身份。
2. MCP-04 / 05：持久目标准入、原计量 / 收据和明确字段释放政策。
3. MCP-06：经过上述门槛再消费原有界目录reader、注册工具；未齐不注册，不提供假数据。

正式范围见[需求](../../docs/MCP服务/MCP服务-需求.md)，阶段命令与证据见[开发记录](../../docs/MCP服务/MCP服务-开发记录.md)。当前离线入口是`tests/mcp-foundation.test.cjs`，须按根AGENTS的offline preload、固定无效DATABASE_URL及绝对audit / TEMP运行；不是无条件可执行的安装或启动说明。
