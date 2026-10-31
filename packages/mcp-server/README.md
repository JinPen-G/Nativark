# Rental OS MCP transport foundation

此包提供受保护的Web-standard `fetch(Request)`入口及受控只读工具注册，不启动监听器、不读取环境，也未装配进原API。只有真实资源验证、原权限、持久计量、发布和字段释放全部接入后才能发布业务工具；当前没有生产OAuth AS或实际Rental业务注册。

## 原宿主统一装配入口

子出口`@rental-os/mcp-server/service`提供[createRentalMcpService](src/service.ts)，把已有AS元数据、授权回调、token / 撤销和受保护MCP装配为一个`fetch / close`服务。原宿主必须提供同一serializable仓储、当前登记 / 元数据、可信已完成同意及签发 / 读取权限作者；缺原依赖，控制面及合法MCP请求保持不可用，不补默认grant或内存仓储。所有issuer / resource / token端点及scope ceiling必须一致，各路由须互异；原宿主负责TLS、代理、原登录 / 同意页面和部署。

装配本身不监听、不读取环境、不安装业务Tools。原业务Guard / ALS、计量和字段release仍须在resource.readTools中单独供给，资源token验证不能替代它们。关闭先停止新请求，取消已受理控制面并等待本端handler / MCP关闭；迟到同意不再签发code。依赖若已有unknown commit，关闭仍不证明回滚、撤销或安全重发，原AS负责核对。

[既有测试](../../tests/mcp-foundation.test.cjs)从源码 / 正式ESM统一入口经官方SDK走发现 → 原同意code → token → refresh → MCP → 撤销，验证缺依赖、冲突配置和关闭后迟到同意拒绝。原[Harness Loader组合](../../tests/harness-plugin.test.cjs)的独立主实现路径也消费这个统一服务，旧access在断开撤销后返回401。store / 原身份 / 同意 / grant仍为明确外部事务夹具，无生产API装配、真实数据库、TLS或登录UI证据。

## 单独运输入口

[createProtectedMcpEndpoint](src/index.ts)接收显式配置和可选`ResourceTokenVerifier`，返回`fetch` / `close`。

- `enabled`必须明确给定；关闭或未提供验证器返回503，不用匿名模式或恒真适配代替。
- `resourceUrl`与`authorizationServerUrl`仅接受无凭据、query或fragment的HTTPS地址。资源不能占用`/.well-known/`路径；存在的Origin必须在显式列表内。
- `maxRequestBytes`限制SDK读取的完整请求；`authorizationTimeoutMs`限制身份核验等待。配置在构造时捕获，不能中途换resource或授权范围。
- 缺少或非法Bearer返回标准401及`WWW-Authenticate`资源发现提示。验证器必须从原可信身份系统核验issuer / 签名、当前client / grant / scope和撤销；这里要求可信`subject`并再次检查resource、到期和clientId，不将验证结果当作原业务Guard已经通过。
- RFC9728资源元数据只指向配置的授权服务器，不伪造RFC8414授权服务器端点；授权服务器必须由实际AS提供。所有响应禁止缓存。
- 官方SDK负责2026-07-28及2025-11-25旧版stateless协议；每个服务器实例显式固定这两个版本，不采用SDK含更早代次的默认列表。非初始化请求携未声明版本头时拒绝、不进入reader；旧版initialize可在业务执行前反提议2025-11-25，不选择未声明代次。未注入`readTools`或当前未发布工具时返回空Tools；此处空列表只表示运输接口存在，不是业务成功。目录、报价、建单和模型工具尚无生产注册。
- 取消 / 关闭 / 授权等待超时后不接受迟到核验结果；`close()`重复调用共用同一关闭Promise。验证器收到可选`{signal}`，兼容原单参数实现；新适配必须观察 / 转发。停止接纳仍不证明不合作的依赖已停止，验证器必须是无业务副作用的身份读取。已提交操作不因关闭推定回滚。

### 当前资源token introspection

[createIntrospectionVerifier](src/token-introspection.ts)支持RFC7662：部署明确给出HTTPS issuer / resource / introspection端点、client ID / scope白名单、等待与字节上限，并由Host-only认证适配提供AS客户端Authorization。没有默认AS secret、动态端点、重试或active缓存；MCP调用方的Header不作为AS凭据。

每次认证向固定AS发送一次access-token查询，禁止Cookie与重定向，声明和实际UTF-8字节有界，取消传到适配器。只接受明确active、精确issuer / 单一resource audience、允许client / scope、subject及有限expiry；额外AS字段不输出。active=false等无效身份返回标准401；AS缺证据、坏响应、超限或故障返回安全500，不伪称token已经撤销。元数据 / 日志不包含token、subject、AS原文或客户端秘密。

此实现不是OAuth AS、用户grant或原业务身份：AS必须实际逐次核对grant / client / tenant停用，才能返回active。可信subject只在服务端内部交给原发布 / authority / accounting / release及指引provider，不进入协议结果或元数据；原作者仍须映射到原Auth / Guard / ALS；tenant / workspace / location / dataScope、字段和业务操作仍缺生产者，故没有开放业务Tools。AS客户端认证必须来自正式秘密持有者，不接受模型输入；未装配到真实服务。

### 原AS的当前RFC8414发布

子出口`@rental-os/mcp-server/authorization-server-metadata`提供[createAuthorizationServerMetadata](src/authorization-server-metadata.ts)，只在配置的AS origin与path-aware `/.well-known/oauth-authorization-server[/path]`处理GET，不在资源origin代发AS文档或声明OIDC登录能力。显式启用且原AS当前metadata source提供获准文档才返回200；缺生产者、撤回、故障、取消或两次读取内容变化返回503，非GET返回405，未许可Origin返回403。无监听器、外部请求、client登记、token签发或业务工具。

构造捕获原source方法及HTTPS issuer / 三端点、scope上限和原生客户端Origin规则。文档仅接固定issuer、授权 / token / revoke端点、code / S256 / public client none认证、原AS实际声明的授权码及可选refresh、许可scope；未知扩展、动态登记、私人字段、getter或超限整项拒绝，不删字段后冒充完整合法文档。完整UTF-8响应最多配置的65,536字节，读取与返回共用最长30秒，禁止缓存。官方SDK的资源侧metadata helper还会发布资源说明并按资源origin路由AS文档，不用于这个独立AS入口。

[既有验证](../../tests/mcp-foundation.test.cjs)经两代官方SDK discovery、正式编译子出口及Harness原OAuth检查消费此文档；精确字节边界、错端点 / 协议 / scope、撤回和取消迟到均覆盖。[原Host组合](../../tests/harness-plugin.test.cjs)登录的AS discovery也经过该发布代码，签发 / 登记及AS就绪仍为外部夹具。元数据兼容不证明可信登录、client已登记、持久grant或原业务身份已实现。

### 预登记public client的授权请求校验

子出口`@rental-os/mcp-server/public-client-authorization`提供[createPublicClientAuthorization](src/public-client-authorization.ts)，只校验固定AS授权地址收到的浏览器GET请求及原持久登记的当前public client。严格接收授权码 / S256、单resource、scope、state与精确redirect_uri；拒绝重复或未知参数、客户端自报身份 / 空间 / secret、非标准回调及scope扩张。HTTPS回调完全相等，数字HTTP loopback仅允许临时端口不同，scheme / host / path不变，不支持localhost、通配或自定义scheme。

当前登记reader在构造时绑定、每次重读两次，缺登记、停用 / 到期、回调 / scope不符、读取期间修订或内容变化均拒绝。输入和当前登记在有界等待下形成稳定快照，取消拒绝迟到结果，异常不含原正文 / 凭据。返回仅供AS内部核对的请求与登记修订，不登录、不跳转、不签发code / token、不保存grant或开业务。真正签发仍须由原AS在原登录、同意和当前政策事务中原子复核该修订；此函数不构成可重复使用的签发许可。登记持久化 / 后台管理、AS及原身份适配尚未交付，根运输不自动安装此校验。

[既有测试](../../tests/mcp-foundation.test.cjs)消费官方SDK生成的S256请求及正式编译包子出口，覆盖数字loopback临时端口、HTTPS精确回调、scope/resource、登记修订 / 撤回、异常和取消迟到。登记reader为明确synthetic，未验生产注册、登录 / 同意、一次性码、token轮换或真实AS。

### 原AS授权结果的标准回调

子出口`@rental-os/mcp-server/public-client-authorization-endpoint`提供[createPublicClientAuthorizationEndpoint](src/public-client-authorization-endpoint.ts)，复用预登记 / S256检查，仅在固定授权地址处理浏览器GET。原AS的`authorize`接收已检查请求与原浏览器Request，负责原Web登录、真实同意及原子一次性码签发；transport不读取密码、不渲染或复制同意页、不把Cookie转成业务身份。原AS必须在提交事务复验clientRevision / resource / scopes和当前身份 / 政策，缺生产者返回503。

原AS只交付code或access_denied结果，运输拒绝私人字段、任意URL和getter。返回前再做当前登记校验并核对原请求，只有同一许可回调可收到空303，Location仅包含code或固定error、原state及固定iss；无HTML、token或自动批准凭据。完整回调URL最多16,384字节，整次等待最多30秒，no-store / no-referrer / CSP保护；输入错误不向未验证回调重定向。取消、登记变化或原AS错误不返回Location，也不重发签发。拒绝迟到code不证明原AS未提交或已撤销，原grant核对仍由AS负责。需要等待人类登录 / 同意的交互及恢复由原AS宿主拥有，本handler不建设UI或延长等待。

[既有测试](../../tests/mcp-foundation.test.cjs)从源码与正式ESM子出口消费官方S256请求，覆盖code / denial、错回调 / scope、自授参数、当前登记变化、取消及一次原AS调用；[Harness原登录](../../tests/harness-plugin.test.cjs)实际消费此handler的303回调，不再手工拼成功URL。原身份 / 同意 / 码签发与登记仍为外部夹具，不是持久AS或真实OAuth验收。

### 原授权码的S256绑定

子出口`@rental-os/mcp-server/authorization-code-binding`提供[assertAuthorizationCodeBinding](src/authorization-code-binding.ts)，供原AS在自己的原子消费 / 签发事务内校验原码记录。只捕获原记录的client / resource / 精确redirect_uri与S256 challenge，拒绝缺项 / getter / 非规范challenge或不匹配verifier；摘要恒时比较，所有失败统一invalid_grant，不回显哪一项不符。授权时允许临时loopback端口，不等于交换时可变端口；必须使用该次原码记录的实际回调。

校验无存储、签发或消费效果，不返回可复用许可。原码lookup、grant / 当前政策、到期 / 撤销、一次性消耗和token提交仍由原AS负责，不能把校验成功当作这些条件通过；忽略的私人记录字段不读取。[既有测试](../../tests/mcp-foundation.test.cjs)从正式ESM子出口消费官方S256、43 / 128字符verifier及错client / resource / callback / proof，token handler取得原校验invalid_grant后不重试。[Host组合](../../tests/harness-plugin.test.cjs)也复用该校验，原AS夹具在授权时记录实际回调，host / 临时loopback均通过；仍不是持久码仓储或真实原子消耗证据。

### 原可信同意后的持久一次码签发

子出口`@rental-os/mcp-server/persistent-oauth-authorization`提供[createPersistentOAuthAuthorization](src/persistent-oauth-authorization.ts)，作为标准授权回调的AS authorizer。原authority必须从已认证浏览器定位精确、已经完成的可信同意和当前grant，并在同一事务内锁住原授权 / 登记；函数不创建账号 / grant、不解释模型确认或复制同意页。缺记录不可用，明确原拒绝才返回access_denied。

获准请求须与原同意的client / resource / scope / 回调 / state / S256及修订完全一致。普通JSON对象按字段和值精确比较，不把持久存储的键序变化当授权变化；额外字段、数组顺序或值变化仍拒绝。原事务以授权ID唯一关联一次随机code，仅保存摘要、原授权 / grant修订与最短期限；code寿命最多600秒，不超过原同意或grant期限。插入后再读原当前同意，失效或变化拒绝；commit成功后才交付code。同一原授权再次请求不发新码、不恢复明文、不换family；未知commit和取消不证明未签发，原核对 / 撤销仍由原AS负责。存储adapter须原子保存授权关联、审计 / 收据和唯一约束，不可通过内存计数替代。

[既有验证](../../tests/mcp-foundation.test.cjs)沿源码 / 正式ESM检验一次码签发后真实token消费、并发同意仅一枚码、失权 / 拒绝、unknown commit不重发以及取消后可能已提交但不交付code。[原Harness Loader](../../tests/harness-plugin.test.cjs)已消费随机code / token与原断开撤销链，不再手工保存该组合的code。原Web登录 / 同意 / grant和存储仍为明确外部事务夹具，尚无生产仓储、原身份适配、可信同意页面或真实DB证据。

### 原持久事务内的token生命周期

子出口`@rental-os/mcp-server/persistent-oauth-tokens`提供[createPersistentOAuthTokenService](src/persistent-oauth-tokens.ts)，可作为上述token HTTP的AS实现。显式原存储事务及原当前grant authority缺一不可；不含账号、同意页、grant创建、数据库适配或本地默认仓储。access为32随机字节，存储只写SHA256摘要；access期限由配置（最多900秒）、原grant和refresh family取最短，refresh期限不随轮换延长。code与family保存原subject / client / resource / scope / grant修订，交换必须匹配原S256与精确回调。

原事务锁住code / refresh、family和原授权，完成唯一family、一次码消耗、access / refresh写入后才能交付凭据；refresh消耗旧摘要并生成新token。已用code或refresh再次到达时，原归属核验及固定client / resource通过后先提交对应family撤销，再在事务外返回invalid_grant，不能抛错把撤销一起回滚。复用处置不依赖当前签发许可或旧登记修订；原签发许可失效仍撤销该family，且绝不签发新凭据。原归属不符、外client / resource均不修改他人family；归属证据不可读则不可用。两实例共享原约束，不自行排队 / 重试事务；唯一摘要、一次码 / refresh CAS、锁顺序及串行化提交是存储adapter必须实现的条件。撤销按原归属判断，不依赖当前签发许可，未知 / 外client token接受为空结果且不改变其他family；hint不隐藏另一token类型。

[createPersistentOAuthResourceVerifier](src/persistent-oauth-tokens.ts)从access摘要、family和原当前grant逐次回读，原subject / client / resource / scope / grant修订、最短期限与family撤销必须一致；事务内两次当前读取后才返回内部身份，不缓存、不刷新或执行写入。持久记录在异步复验前按普通JSON取独立快照，getter / 损坏记录拒绝。access存在而关联family缺失返回unavailable，不推定凭据已撤销；原当前grant authority返回undefined须表示已确认无当前授权，证据不可读取须抛错而非返回undefined。该身份仍不是原业务Guard / ALS、字段释放或目标准入。原存储必须保证原授权与family读取锁在提交前有效，读事务未确认、取消或提交不明不能冒充成功。

[既有离线测试](../../tests/mcp-foundation.test.cjs)从源码 / 正式ESM子出口，经官方SDK交换 / refresh与MCP握手，验证随机token仅摘要持久化、两服务并发码消费 / refresh复用、family撤销令原access也失效、原subject / client / scope变更、插入失败、失权、未知commit与取消后仍可能提交。原Harness Loader登录 / disconnect也消费本主实现生成的随机token，断开后family及旧access拒绝已验证。存储与当前grant为显式事务替身，不是MySQL锁 / 真库持久化；真实AS同意 / grant、仓储、原当前权限与审计尚未装配。未知提交不重试、不发新family；已提交但未交付token须由原AS核对 / 撤销，不能靠超时推定回滚。

### 标准token与撤销控制面

子出口`@rental-os/mcp-server/oauth-token-endpoint`提供[createOAuthTokenEndpoint](src/oauth-token-endpoint.ts)，只处理固定HTTPS token / revocation地址的POST表单，不启动服务或另建业务API。构造捕获原登记reader和AS方法；授权码交换只接登记client、code / S256 verifier、精确回调及单resource，refresh只接原token与相同resource。拒绝重复 / 未知参数、client secret、Web cookie / Bearer、DPoP、非表单及未许可Origin；非法UTF-8以400 invalid_request在登记读取 / AS调用前拒绝，不当服务故障。完整请求最多配置的65,536字节，整请求等待最多30秒。

原持久AS负责原子核对clientRevision、原登录 / 同意 / grant、码一次性及PKCE、refresh轮换 / reuse和token归属撤销。运输不签发或保存token、不建立账号 / grant、不重试AS；缺AS或关闭返回安全503。交换 / refresh仅释放标准token字段、有限短期Bearer及当前许可scope，refresh必须返回不同的新refresh token。输出脱离原对象，私有字段 / getter / 坏token拒绝，完整响应最多65,536字节、禁止缓存；返回前再次读取当前登记，停用、到期、修订或内容变化拒绝迟到token。该复验不代替原AS的提交事务，也不证明已经签发的token被回滚或撤销。

停用或过期但仍有登记的client可以请求原AS撤销已知token，归属与未知token接受仍由AS判断；成功仅返回RFC7009空200，不声明整个grant已核实撤销。取消 / 超时 / provider故障返回安全503，不含凭据 / 私人异常，迟到完成不释放token、不自动重发。原AS明确的invalid_grant / invalid_client / invalid_scope返回400。生产登记 / AS、可信登录、持久grant和原身份适配仍缺，根运输不自动装配此控制面。

[既有测试](../../tests/mcp-foundation.test.cjs)经官方SDK实际交换 / refresh及编译包子出口验证严格表单、轮换、取消迟到、当前登记失效和停用后撤销；[Harness组合](../../tests/harness-plugin.test.cjs)的原登录 / disconnect已经过此运输代码。登记和AS签发 / 撤销仍是外部夹具，Host后续并发refresh另用原专门夹具，不将运输通过当持久AS、真实OAuth或全部grant验收。

### 原授权只读注册

[readTools](src/read-tools.ts)是服务端内部注入，不是客户端配置或权限声明。每项注册必须由原契约作者提供闭合输入 / 输出JSON Schema、无业务副作用的reader，并同时提供当前`publication`、Controller等价`authority`、原服务端持久`accounting`及完整外发`release`。原authority负责Guard / ALS及返回前业务复验；当前资源认证不能代替它，本地计数器也不能代替原目标准入。

原只读候选构造时绑定原reader方法，后续修改binding.read不会更换执行者；替换reader须重新构造候选及端点。端点构造时捕获工具名称、说明、输入 / 输出schema及reader和原provider方法；schema副本冻结，定义替换须重新装配端点，不能在等待发布时插入工具或改reader。方法绑定不冻结原政策状态，当前grant / 撤回仍逐次读取。官方SDK沿同一schema校验输入和输出；输入适配保留原validator及完整JSON Schema转换，只将失败issues换成固定安全说明，避免SDK在本端handler之前回显调用方字段路径。非法参数仍在原权限 / 计量 / reader之前拒绝，不削约束或伪装通过；返回前复用同一输出validator把无效投影转安全错误，不回显私人校验明细。当前发布条件决定列表，旧缓存直接调用仍复验。执行顺序为原权限 → 原计量 → reader → 获准投影，投影只接受普通JSON字段：有限数字、字符串、布尔、null、完整数组及普通对象；循环、稀疏数组、undefined、非有限数、自定义对象、getter / toJSON等整项拒绝，不调用转换或把缺值改成null。字段先形成一份脱离原对象的JSON快照，文本及structuredContent从同一份生成，不把后台原对象交给PTC。每个外发字符串最多2,000字符、每个数组最多50条；超限整项不可用，不裁掉事实。注册最多50个互异名称；这不是业务分页实现，实际reader仍须有界读取并提供正式来源 / 期限，不能全量读取后仅在此过滤。

只读配置的请求从首次认证到执行、最终输出共用最长15秒截止，身份读取另受更短配置限制。一次请求捕获不可变subject / client / resource / scopes供原providers消费，SDK认证对象只由本端私有WeakMap关联该引用，不靠模型actor或客户端上下文。发布 / 调用 / 读后及整份MCP响应发送前复核主体与范围；即使client / scopes相同而subject变化也拒绝。整份MCP响应在发送前缓冲并再次核验当前资源身份，最多65,536 UTF-8字节，包含envelope、文本转义及structuredContent重复；超限返回安全503，不截断成成功。单投影32,000字节预检查仅提前拒绝，不能代替整包上限。内部失败返回安全不可用结果，不能把权限或计量失败冒充空业务结果。

[离线测试](../../tests/mcp-foundation.test.cjs)用真实两代SDK验证发现 / 调用、未知输入、当前发布撤回、原权限 / 计量 / 释放顺序、私有字段不返回、投影与重复包装超限及读后身份失效。所注入业务provider均明确synthetic，仅验证注册编排；没有接原目录Core、真实Guard、持久目标或获准字段生产者。

### 固定业务能力运输映射

子出口`@rental-os/mcp-server/capability-mapping`提供[映射表与只读构造器](src/capability-mapping.ts)，根运输不自动导入shared或注册业务。`rental-mcp-capability-map-1`只版本化运输映射，不代替原schema、能力、字段政策或grant版本。七项原码从shared公开出口核对，目录 / 可用性 / 已选客户结果 / 原订单事实对应固定下划线名称及原R0；报价`preview`映射为quote_save，报价 / 提案保存为原R1，批准后建单为原R2，三者不能经只读构造器发布。风险类型复用shared的AiRisk，等级依据原AI Native R04 / R05及MCP R04 / R07，测试与原baseline核对；标签不代替当前权限或就绪状态。原工具版本不能用映射版本或历史baseline版本填造，仍由实际生产者供给。选择结果读取不包含个人候选查询；映射不扩大原首批清单。

`createMappedBusinessRead`只接受四项原只读码，由原作者显式给出闭合schema、说明与无副作用reader，再交原注册器处理权限 / 持久计量 / release。构造捕获schema副本和原reader方法，不运行reader、不安装HTTP或发模型；未知码、原写入码和直接运输名都拒绝。映射存在不等于生产者ready；当前目录公共运行时schema / 正式字段与生产身份、持久目标仍缺，不能用测试schema或旧human_preview / not_sent填空开放。

[既有验证](../../tests/mcp-foundation.test.cjs)沿源码及严格编译的正式ESM子出口，经两代SDK发现 / 调用固定只读运输名，拒绝未发布、副作用和原点号名直接调用，当前撤回仍拒绝。验证用synthetic reader / schema / 权限 / 计量 / 字段，不是生产业务。原Harness工具桥和AgentLoop已消费目录运输名的夹具，原实际目录schema未交付，不能将该名称兼容当成目录验收。

### 原对话模型结果的只读候选

独立包出口`@rental-os/mcp-server/conversation-result-read`提供[createConversationResultRead](src/conversation-result-read.ts)。根运输出口不自动加载这项适配；该子出口必须具备当前`@rental-os/shared`运行时和生成声明。它读取既有`ain-conversation-draft-2`的`modelResult`契约，只接受conversationId / admissionKey / resultId及版本，不接reader、模型、工具名或身份参数；构造不发布工具、不建Task / Run、不调用模型。

适配复用shared公开输入和完整原结果schema，保留严格限制与所有本地引用；不覆盖shared组件。当前`AiOrderExplainRequestDraft / AiOrderExplainInput`仍由原API组件作者持有，尚未从shared发布；装配必须显式提供这些固定原组件，缺项拒绝，不写私有同名schema补齐。原Web完整结果及其传递schema不能直接作为MCP发现 / 释放：完整发现实际超过64 KiB。装配还必须提供原字段作者的闭合MCP投影schema，并沿原`publication / authority / accounting / release`注册；本适配不自行定义外发字段或生产名称。

输入与原reader返回都先按普通JSON数据描述符取得独立快照，不执行getter / toJSON；快照经过完整序列化字节限制后才进入公共schema校验，避免等待校验时原对象被改成另一请求或事实。原私有请求最多32,768 UTF-8字节，原Web完整结果最多131,072字节；这两项不是外发许可，之后仍须满足原release及2,000字符 / 50条 / 32,000投影字节 / 65,536完整MCP响应字节的独立限制。超限或非普通JSON整项拒绝，不截断、不把缺值补成null。

完整原结果校验后，适配核对conversation / admission、原请求、能力版本、task和精确resultId，之后才能进入外发投影。available正文仍是未验证模型文本、候选不是批准；unknown / failed / stale保留原状态、空正文和禁止自动重试。material_erased只允许原erased分支及当前原Task定位，不恢复正文。原Reader负责当前原权限、Run / 来源及读前后关联复验；合法后继Run由原来源链校验，不用与初始turn.runId简单相等替代。生产MCP到原Guard / ALS的固定身份适配、原持久计量和释放政策仍未接通，不能把MCP token伪装Web Bearer调用原HTTP组合。

[离线测试](../../tests/mcp-foundation.test.cjs)通过两代真实MCP SDK消费源码与编译包候选，验证原关联、非法参数、撤回、取消迟到、稳定快照及独立大小限制。编译包还调用原对话应用、原AiOriginalSceneResultService及artifact仓储，验证既有unknown空正文、artifact哈希 / Run错配、换用户 / 空间和读后失权拒绝；读取前后持久状态相同，不启动模型或追加Task / Run / Step。原Web身份、数据库和MCP发布 / 权限 / 计量 / 释放provider是明确夹具，不是生产MCP身份映射或真实MySQL证据。

当前shared源码及MCP源码严格编译到独立output，NodeNext消费者从两包正式出口读取声明并运行产物，不覆盖公共shared/dist或安装依赖。测试中的原API源码以既有ts-node执行，不代表API严格类型检查通过。原Harness校验器对实际输入schema仍报UNSUPPORTED_SCHEMA；没有削减约束来启用Host，故没有这项真实Harness消费者或生产注册证据。

### 原Task／步骤恢复状态的只读候选

独立子出口`@rental-os/mcp-server/original-task-recovery-read`提供[createOriginalTaskRecoveryRead](src/original-task-recovery-read.ts)，复用shared的`AI_SCENE_REQUEST_HTTP_CONTRACTS.recovery`、原请求引用及完整恢复观察schema。仅接原版本 / inputRef，不接调用方选择的Task、Run、身份、reader或动作；构造不发布，也不调用取消、接管、恢复执行或模型。根运输出口不自动加载该候选，所需shared运行时和声明仍由装配提供。

原reader必须按当前原身份 / ALS核对请求、Task及步骤关联和读前后权限；原返回不包含inputRef，候选不能仅凭schema证明关联。`not_observed`不证明没有执行或消耗，unknown步骤保留原actionId与核对指引；Task取消 / 终态不抹去原结果，也不授权重发。输入与完整返回沿普通JSON稳定快照及32 KiB / 128 KiB私有字节限制，原步骤schema最多50条，超限拒绝。原字段作者必须提供闭合外发schema，并由原发布 / 权限 / 持久计量 / release决定是否可交外部Host；私有校验不等于释放许可。

[既有离线测试](../../tests/mcp-foundation.test.cjs)从源码和正式编译包子出口经两代SDK消费，覆盖缺Task、取消Task中的unknown步骤、非法参数、损坏结果、撤回与取消迟到；编译包实际调用原请求绑定readRecovery、原请求 / Task仓储与AiOriginalSceneRecoveryService。原Task输入哈希错误、换用户 / 空间及步骤读后失权均拒绝，正常 / 拒绝读取前后存储状态不变。身份 / DB及MCP政策仍为明确夹具，不是生产grant或真实MySQL证据。原Harness对实际输入schema仍拒绝UNSUPPORTED_SCHEMA，没有删约束或注册到Host；本片不接主线新releaseUnstarted操作。

### 精确原对话操作收据

子出口`@rental-os/mcp-server/conversation-operation-read`提供[createConversationOperationRead](src/conversation-operation-read.ts)，只按原operationKey读取shared对话operation契约；不接受操作名、会话选择、身份或重发参数。输入 / 完整返回沿稳定普通JSON快照、原schema和私有字节上限，返回operationKey必须与捕获请求相同。observed仅说明原操作收据存在，not_observed保留原absence / retryable:false，不生成新键、取消Task或重做操作。生产发布仍需原身份 / 持久计量 / 字段与release，根运输不自动加载。

[既有离线测试](../../tests/mcp-foundation.test.cjs)覆盖两代SDK的原create / archive / delete / release_turn收据及not_observed、错键、非法输入 / 结果、快照、撤回、取消迟到；编译包实际调用原对话应用和operation仓储，正常、缺收据、跨用户 / 空间及读后失权路径不修改存储。原Web身份 / DB及MCP政策为夹具，非生产身份或真实数据库验收。原Harness仍拒绝该实际输入schema，不削约束或注册工具。

### 原可信选择收据的只读回读

子出口`@rental-os/mcp-server/quote-selection-read`提供[createQuoteSelectionRead](src/quote-selection-read.ts)，复用shared正式`AI_QUOTE_SELECTION_HTTP_CONTRACTS.read`及原输入 / 收据schema。仅接受原版本、originalInputRef及selectionId，返回前核对三者相同；不接客户候选、订单内容、确认或身份自授。原reader须经当前Guard / ALS复验选择、报价依据 / 输入哈希及Task祖先关系，不能替换成select、保存或执行入口。

构造固定原reader并保留完整约束，私有请求32 KiB / 原结果128 KiB经普通JSON快照及原schema验证后仍须原字段release。selected_not_approved、expired、superseded保持原状态及not_granted / not_created_by_selection，不因过期或缺收据允许模型重新选择。当前身份 / 发布、持久计量与闭合外发字段缺一不可，根服务不自动注册本候选。

[既有验证](../../tests/mcp-foundation.test.cjs)经源码 / 正式ESM及两代SDK覆盖状态、原引用、非法确认 / 身份 / 订单参数、坏记录 / getter、撤回和取消迟到。编译包实际调用原请求绑定选择reader与仓储，验证报价 / 输入哈希、错selection / inputRef、跨用户 / 空间及收据读取后失权拒绝，读取前后记录不变；Web身份 / DB / MCP政策为外部夹具，API为transpileOnly。原Harness仍拒绝实际输入schema的UNSUPPORTED_SCHEMA，不删约束或发布，不宣称真实选择 / 审批 / 建单或生产MCP身份已接通。

### 原选单提案的只读核对

子出口`@rental-os/mcp-server/selected-proposal-read`提供[createSelectedProposalRead](src/selected-proposal-read.ts)，消费shared原`AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS.readSelectedProposal`、提案及审查schema。只接原选择证明和精确proposal / 修订 / reviewedPayloadHash；不接decision、lease或模型确认。原reader须复验当前Guard / ALS、原选择与Task、提案哈希和Core输入 / 预览事实，不能换成准备、决定或执行方法。

适配固定原reader并校验完整普通JSON私有结果、32 KiB请求 / 128 KiB结果，核对原Task / proposal / 修订 / hash、单原建单动作及其inputHash、deterministic target一致；不重算金额。原pending_confirmation / confirmed / cancelled / expired / superseded只是提案状态，不证明批准被消费或Core已执行。原审查中的scope / snapshot等私人定位不自动外发，必须由原字段作者的闭合输出schema及release决定；构造不注册、不发模型或创建提案 / 批准 / 订单。

[既有验证](../../tests/mcp-foundation.test.cjs)经源码 / 正式ESM及两代SDK覆盖五状态、内容错配、非法决定 / 自授参数、getter、撤回及取消迟到，synthetic projection不包含scope或快照定位。编译包实际消费原请求绑定readSelectedProposal，核对原Core金额 / 币种、旧修订 / hash、跨用户 / 空间及查后失权拒绝，读取前后原记录不变。Web身份 / DB / 外发政策为外部夹具、API执行transpileOnly，非生产MCP身份或字段审批；Harness仍拒绝实际输入schema、不删约束或发布业务，正式人类决定和执行仍归原Web / Core。

### 原选单执行结果的只读回读

子出口`@rental-os/mcp-server/selected-order-result-read`提供[createSelectedOrderResultRead](src/selected-order-result-read.ts)，复用shared正式`AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS.readResult`及原选择证明 / 结果schema。只接受原selection / inputRef / Task / Run / inputHash引用，不接lease、批准、订单内容或执行动作。原reader必须使用请求绑定的readResult并复验原选择、Task、phase / 批准消费及Core收据关联；不能换成可能接管执行的reconcile。构造不发布，仍须原身份 / 持久计量 / 字段 / release。

私有请求32 KiB、完整原结果128 KiB及普通JSON独立快照不构成外发许可。原committed结果的source与order必须同一引用；unknown / not_observed保留原retryable:false、sideEffect及核对入口，不推定支付、履约或Task成功。原结果没有selection / inputHash，关联由原reader负责，不能仅靠结果schema证明。本适配固定原reader方法，不发模型、不恢复、取消、批准或创建订单。

[既有验证](../../tests/mcp-foundation.test.cjs)沿源码 / 正式ESM及两代SDK读取三类结果，拒绝自授执行参数、getter、坏结果、撤回和取消迟到。编译包实际调用原请求绑定选单Task服务、原批准消费 / Core收据读取，原Web / DB为外部夹具；首应答丢失后读原committed、缺收据保留unknown，跨用户 / 空间、选择 / Run / 哈希错配与读后失权拒绝，读取前后存储不变。API源码执行为transpileOnly，非生产MCP身份或真库证明。Harness当前仍拒绝实际输入schema的UNSUPPORTED_SCHEMA，不削约束或注册；生产固定身份 / 字段 / 持久计量缺口保持。

### 原对话元数据分页

子出口`@rental-os/mcp-server/conversation-list-read`提供[createConversationListRead](src/conversation-list-read.ts)，仅消费原list版本、active / archived、1～20条上限和可选原beforeId；不接owner / tenant或任意URL。一次调用只读一页，不自动跟游标、不计算总数。返回沿完整原schema / 稳定快照校验，条数不能超过请求、状态必须相同、ID不能重复；续页游标必须为原满页末项且不能重复输入游标。原`page_not_total`和游标保持原值，不截断事实来补一页成功。

原reader仍负责真实owner / 空间过滤及读后权限，原字段schema / release和持久计量是发布前置。输入 / 私有结果及完整MCP外发限制不变。[离线测试](../../tests/mcp-foundation.test.cjs)经两代SDK覆盖空页、精确20条、21条参数、错状态 / 重复或错游标 / 私有字段、撤回及取消迟到；编译包实际调用原对话list，读后失权拒绝且存储不变。当前身份 / DB / MCP政策是夹具，原Host仍拒绝实际schema，未发布此工具或声明全量业务索引完成。

### 版本化服务器instructions

可选内部`instructions` provider由原发布 / 字段政策作者提供已审查的当前外发指引及版本。端点构造时绑定该provider的原方法，替换方法须重新装配；原方法仍读取当前政策与版本。未认证不读取，缺许可返回无指引；故障只返回安全不可用结果，不输出provider原错误。仅捕获version / text的自有可枚举数据字段，不执行getter、继承字段或对象字符串转换，忽略的私有字段也不读取。完整文字包含版本 / 归属最多2,000字符，并沿完整15秒 / 64 KiB响应限制和返回前资源复验。官方SDK在现代discover和旧版initialize提供同一指引；更新读取当前版本，撤回不保留旧发布。

没有自行编写或生产批准一份业务提示词；instructions不注册Prompts / Resources、不发云模型或建立任务。可选Prompts由下述独立provider启用。客户端是否采用指引须独立验证，旧缓存文字不维持授权。Harness原AgentLoop以脚本模型验证指引及释放事实进入原日志 / 下一模型请求，中立材料256 KiB和同一Session / 原工具记录重用亦有离线证据；实际模型、最终目的地 / 线包及全部留存仍未验。

### 可选版本化Prompts

[Prompts注册](src/prompts.ts)仅在内部`prompts` provider明确提供时声明能力，list / read方法在端点构造时固定，当前政策不冻结。`list`按当前可信主体及原发布政策返回最多50个版本化描述符，`read`读取该名称当前审查后的指引正文；两者不接受业务查询条件、不调用reader / Core、不新建Task或云模型。列表必须是完整原生数组，按数据描述符取得每项name / version / description快照；正文仅捕获version / text，getter、稀疏数组、继承字段、自定义对象或非字符串名称 / 版本拒绝，忽略私有字段不执行其转换。快照在异步复验前完成，不能在等待期间替换已检查的说明。缺provider不声明Prompts；缺某名称许可从列表移除，缓存名称再次获取仍拒绝。

标准`prompts/list`返回名称与包含版本的说明，`prompts/get`返回一条user角色文本及相同版本说明；空参数允许，非空arguments及非空cursor拒绝，不提供任意提示词代理、敏感输入或分页聚合。正文和说明复用instructions格式及完整2,000字符限制，整包沿15秒 / 64 KiB缓冲和主体返回前复验。获取时重读当前目录，正文版本不一致、读取期间撤回 / 版本变化、缺正文或provider失败整项不可用，不回显私人错误或返回空成功。

此片不声明listChanged通知、Resources、completion或批准能力。SDK请求取消信号传给provider；现代请求取消可中止其请求，旧版stateless取消通知不证明另一请求已中止，端点关闭 / 截止仍拒绝迟到正文。Provider须落实真实取消和原发布政策，不能把客户端停止等待当服务端已停止。

Prompts只是用户或支持的Host可选的起步模板，不保证自动进入模型提示词。当前Rental工具桥不自动获取Prompts，已有Tools及instructions继续独立消费；Harness另有默认关闭的显式列表 / 选择命令，已沿原Loop验证用户消息与日志重建。实际GUI、真实模型采用及生产审查文字仍未验，不能以模板返回证明业务或自主呈现已开放。

### 可选精确Resources

[Resources注册](src/resources.ts)由内部`resources: McpResources`显式启用，缺配置不声明能力；配置不完整在构造时拒绝。它只提供当前获准的说明文本或原结果的文字引用，不把资源入口当Tools、字段政策或持久计量的旁路。原`list / read / authority.withRead / accounting.withRead / release.project`方法在构造时固定，方法内当前政策仍每次读取；没有默认reader、授权、计量或release。业务Resources必须沿原Controller等价Guard / ALS和所属原目标 / 原收据读取计量，不能把任意读取归类为免费协议发现。

`resources/list`仅取最多50个已批准描述符，不读取正文。名称互异，URI必须是本MCP资源origin的规范化HTTPS地址，无凭据 / query / fragment，并在本次当前目录精确存在；URI只是定位，不执行HTTP / 文件请求或模板展开。仅捕获name / uri / version / description普通数据字段，getter / 稀疏 / 非原生数组或坏地址拒绝，私有字段不读取。名称 / URI与版本由原发布者提供，不凭客户端或模型自报。`resources/read`先读当前目录，依次经原权限 → 原持久计量 → 原reader → 获准文本投影，返回前再查同一描述符的名称 / 版本 / 说明及当前资源身份；撤回、修订 / 主体变化、缺release或故障拒绝，不返空正文或私人错误。

说明和正文固定`text/plain`，包含`Rental OS resource (版本)`归属后整体最多2,000字符；不是HTML、二进制、任意文件或模型批准。完整响应仍受15秒 / 65,536 UTF-8字节限制，50项分别合规也不能超整包。现代协议通过官方SDK输出`ttlMs: 0 / cacheScope: private`，连续默认read仍重查当前权限；旧代次不混入现代字段。空 / 省略cursor只读完整有界目录，非空cursor拒绝；`resources/templates/list`为空，不声明订阅 / listChanged / 通知，不产生新的执行或刷新许可。

[两代SDK验证](../../tests/mcp-foundation.test.cjs)覆盖源码及正式编译包 / 公共类型，匿名零目录读取、精确URI、原权限 / 计量顺序、拒权零reader、撤回 / 版本 / 主体变化、零TTL、缺投影 / getter、50与51项、2,000字符及整包超限、取消 / 关闭后的迟到拒绝。原providers仍为外部夹具，不是生产字段、Guard / ALS或持久计量验收。原Harness插件已通过同一私有连接显式列目录 / 按名称选择资源，沿原maintenance / inbox / Loop提交有来源文本；精确Agent / Session、取消 / 断开 / 重载 / 模型服务移除及来源重建后的材料检查见[既有组合](../../tests/harness-plugin.test.cjs)。未注册原`mcpResources.register`继承式provider或第二份Tools；模型自主资源访问、最终Provider线包 / 目的地及全部重放仍未验，不用Resources包装规避已有Tools schema拒绝。

## 依赖和消费边界

声明`@modelcontextprotocol/server` 2.2.0、TypeScript 6.0.3及Node类型22.20.1，来源是本树已安装版本的实际声明与行为。**本包尚未安装依赖或更新根锁文件**，不声称当前根`npm ci` / 工作区构建就绪。源码只按包出口导入，不依赖Harness私有目录。原对话结果子出口另声明`@rental-os/shared`0.1.0可选peer；使用该子出口时必需，根运输不依赖它加载。版本号相同不证明schema产物已同步，实际组合须核对源码 / 声明和运行时。

测试仅用本树Harness已有SDK安装进行进程内装配，没有复制依赖、改锁、打开端口或发HTTP。当前源码还严格编译到独立output，NodeNext消费者从实际包manifest出口读取声明并加载编译产物，真实两代SDK完成认证 / 发现 / synthetic只读调用及释放投影；这是隔离产物消费，不是root安装、tarball分发或生产业务验收。生产接线须先在获准依赖工作中建立本包正式依赖 / 产物，并由原身份作者补全当前OAuth / grant及Guard / ALS，不把测试synthetic verifier放入生产。

## 下一接点

1. MCP-02：原身份OAuth / grant、后台准入和当前权限生产者；不能使用Web token替代MCP资源身份。
2. MCP-04 / 05：持久目标准入、原计量 / 收据和明确字段释放政策。
3. MCP-06：经过上述门槛再消费原有界目录reader、注册工具；未齐不注册，不提供假数据。

正式范围见[需求](../../docs/MCP服务/MCP服务-需求.md)，阶段命令与证据见[开发记录](../../docs/MCP服务/MCP服务-开发记录.md)。当前离线入口是`tests/mcp-foundation.test.cjs`，须按根AGENTS的offline preload、固定无效DATABASE_URL及绝对audit / TEMP运行；不是无条件可执行的安装或启动说明。
