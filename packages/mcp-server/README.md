# Rental OS MCP transport foundation

此包提供受保护的Web-standard `fetch(Request)`入口及受控只读工具注册，不启动监听器、不读取环境，尚未注册到原API HTTP / Nest入口。只有真实资源验证、原权限、持久计量、发布和字段释放全部接入后才能发布业务工具；当前没有生产OAuth AS或实际Rental业务注册。

## 原宿主统一装配入口

子出口`@rental-os/mcp-server/service`提供[createRentalMcpService](src/service.ts)，把已有AS元数据、授权回调、token / 撤销和受保护MCP装配为一个`fetch / close`服务。原宿主必须提供同一serializable仓储、当前登记 / 元数据、可信已完成同意及签发 / 读取权限作者；缺原依赖，控制面及合法MCP请求保持不可用，不补默认grant或内存仓储。所有issuer / resource / token端点及scope ceiling必须一致，各路由须互异；原宿主负责TLS、代理、原登录 / 同意页面和部署。

装配本身不监听、不读取环境、不安装业务Tools。原业务Guard / ALS、计量和字段release仍须在resource.readTools中单独供给，资源token验证不能替代它们。关闭先停止新请求，取消已受理控制面并等待本端handler / MCP关闭；迟到同意不再签发code。依赖若已有unknown commit，关闭仍不证明回滚、撤销或安全重发，原AS负责核对。

[既有测试](../../tests/mcp-foundation.test.cjs)从源码 / 正式ESM统一入口经官方SDK走发现 → 原同意code → token → refresh → MCP → 撤销，验证缺依赖、冲突配置和关闭后迟到同意拒绝。原[Harness Loader组合](../../tests/harness-plugin.test.cjs)的独立主实现路径也消费这个统一服务，旧access在断开撤销后返回401。store / 原身份 / 同意 / grant仍为明确外部事务夹具，无生产API装配、真实数据库、TLS或登录UI证据。

### 原 API host 与固定总路由

子出口`@rental-os/mcp-server/host-router`提供[createMcpHostRouter](src/host-router.ts)，只捕获已有组件的fetch / close并分派固定HTTPS origin / pathname，不监听或重包原Response。标准资源 / AS六路与管理路必须互异；query / method / body由原组件校验。统一关闭停止新请求、取消并等待已启动原处理及所有组件close，同一组件别名不重复关闭、失败不伪成功；关闭不证明业务回滚、grant撤销或历史清除。

[createOriginalMcpHost](../../apps/api/src/modules/auth/original-mcp-host.ts)用唯一原OAuth Core / Native数据库装配五组后台控制面，固定6条标准及22条管理路，核对enabled / resource / scopes一致；缺原审查验证source时已知review路503，不造默认豁免，治理仍仅允许原精确停用。`createPrismaOAuthConsentPolicyReader`正式复用原native只读投影，管理store的权限 / CAS / 审计不变。用户同意prepare / decide / 原键恢复现由下节同一原producer的Web控制面挂入总路由；Core现为已有业务readTools绑定唯一完成观察，并将同一来源交host的grant管理读端；缺readTools不补业务adapter，已有usage拒绝覆盖 / 双写。内部source不能当公开工具或因关闭被视为撤权。

[既有Web同意测试](../../tests/mcp-web-consent.test.cjs)首组消费实际API host及正式NodeNext出口，直接覆盖路由 / 配置拒绝、原Response、等待在途处理和关闭失败；同[原policy测试](../../tests/mcp-consent-policy.test.cjs)一次定向验证，见[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原宿主总路由与统一关闭2026-11-05)。API为transpileOnly，SQL / session / 原验证 / commit及AS元数据为明确替身；尚无生产Nest / Guard注册、真实UI / MFA / DB或完整API-Prisma类型证据，不据host构造开放业务。

### 原用户同意 Web 控制面

子出口`@rental-os/mcp-server/consent-control-plane`提供[createMcpConsentControlPlane](src/consent-control-plane.ts)，原host供给同一Core.webConsent与登记reader。固定AS同源路由包括准备POST、原决定POST、原authorizationId收据GET及可选`referenceEndpoint` GET；host校验授权 / 决定端点、resource / scopes / enabled与Core一致，不替换标准AS authorize或token入口。

准备只接有界标准OAuth表单，由原校验器取得当前登记修订；通过外层原Web凭据 / 来源检查后才转为固定AS GET交原prepare，不接受caller修订、主体或URL。配置`referenceEndpoint`后，先用相同标准OAuth请求获取`referenced / authorizationId / retryable:false`，保留该键，再在prepare表单携带authorizationId。原producer的`reference`只复验当前Web本人及已有行归属，不生成nonce、保存、审计或签发；引用不证明已准备或授权。prepare与历史行复用同一原规范化请求键；原请求 / client修订变化则写入前拒绝，不替换原键。未配置新路由保留原运输行为。原通知 / 适用验证、nonce / CAS与同Native审计不变，pending不批准，决定不直接签发code；无模型管理工具、HTML UI或MFA实现。

原producer的receipt与source.read_receipt共用当前Web本人 / 固定tenant-space原关联的历史读权，不要求新签发 / 通知 / MFA，旧session失效仍须新当前原会话。只返回原键 / 修订 / pending-approved-denied或not_observed，retryable:false，不返回nonce / subject / token，不重新准备 / 决定 / 签发。准备失应答不能重新获取nonce；沿同一原请求观察，不承诺可信UI完整恢复已交付。超时 / unknown及关闭等待沿原Web运输，关闭不是撤权 / 回滚证明。

[既有Web同意冒烟](../../tests/mcp-web-consent.test.cjs)实际消费host路由、原Auth / producer / 审计及标准AS code，准备首应答与决定丢应答后均按原键只读观察，不重复审计；[提交前原键阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段同意准备前原键与首应答核对2026-11-05)区分每次结果及SQL / 原验证 / commit替身。生产Nest / Guard注册、可信人类UI / MFA / 真DB和完整API类型仍未验；未保存预提交键的旧客户端不获得恢复保证，丢nonce不重发 / 重取，业务不开放。

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

当前登记reader在构造时绑定、每次重读两次，缺登记、停用 / 到期、回调 / scope不符、读取期间修订或内容变化均拒绝。输入和当前登记在有界等待下形成稳定快照，取消拒绝迟到结果，异常不含原正文 / 凭据。返回仅供AS内部核对的请求与登记修订，不登录、不跳转、不签发code / token、不保存grant或开业务。真正签发仍须由原AS在原登录、同意和当前政策事务中原子复核该修订；此函数不构成可重复使用的签发许可。具体登记投影仓储见下节；完整后台管理 / 当前政策、AS及grant生产装配尚未交付，根运输不自动安装此校验。

[既有测试](../../tests/mcp-foundation.test.cjs)消费官方SDK生成的S256请求及正式编译包子出口，覆盖数字loopback临时端口、HTTPS精确回调、scope/resource、登记修订 / 撤回、异常和取消迟到。登记reader为明确synthetic，未验生产注册、登录 / 同意、一次性码、token轮换或真实AS。

### 当前 public-client 登记生产者

子出口`@rental-os/mcp-server/prisma-public-client-registry`提供[createPrismaPublicClientRegistry](src/prisma-public-client-registry.ts)，具体读取当前public client的既有AS投影合同`RegisteredPublicClient`；原预检查及token控制面可直接消费其`read`。`readIn`供原AS / grant作者在同一native事务内核对，固定参数化SQL、Serializable与行锁，无默认登记、active缓存或网络发现。缺表 / 坏记录 / getter及索引与JSON修订错配拒绝；停用 / 已过期的合法metadata仍保留读取，让原token handler按既有规则撤销已知凭据，授权检查本身继续拒绝。

`save / operation`是原可信后台的内部接点，不是MCP Tools或匿名动态注册。保存及原键收据读取须显式提供原当前平台管理授权和同事务审计；管理依赖缺失不保存。首次 / 修改按expectedRevision CAS，固定operationKey、actor / client绑定、规范化payload hash及原保存收据原子提交；同键不同内容 / 主体 / client拒绝，同键原收据不冒充当前登记。未知commit / commit后取消不重试、不换键；not_observed保持retryable:false，不证明未保存。原管理作者必须核对候选scope / 回调符合当前政策，不能借租户管理员身份或callback函数常量放行。

[SQL结构源码](mysql-oauth-schema.sql)增加AS投影与管理原收据表，未写 / 执行原API迁移。完整接入应用负责人 / confidential client、平台 / 租户政策、grant / 可信同意、真实后台权限和UI仍不在此投影内；本片没有生产API装配、安装或业务开放。[定向测试](../../tests/mcp-public-client-registry.test.cjs)经正式ESM / NodeNext与原官方SDK S256消费此SQL生产者，数据库 / 原管理授权 / 审计仍为明确外部替身，不是真MySQL或后台验收。

### 原 public-client 管理与原事务审计

原API的[createOriginalMcpPublicClientManagement](../../apps/api/src/modules/auth/original-mcp-public-client-management.ts)复用[原平台Web身份reader](../../apps/api/src/modules/auth/original-mcp-platform-management.ts)，为上述registry供给同native的authorize / audit。当前原SaaS身份、账号 / session / 改密前置保持，租户 / 空间管理员和自报actor不放行。新增或变更须原当前已批准review source，精确匹配该registration及原引用 / 修订 / 有效期；缺source或证据不可用不批准。仅停用已有client且回调 / scopes / 期限完全不变时允许独立收紧；当前已保存的disabled修订可通过原CAS提交点复验，不因此批准其旧字段。原键收据读取按当前原SaaS及原actor关联，不依赖新审查许可、不重做save。

原audit锁住精确public-client operation，核对原actor / client / payload hash / saved收据 / 修订，再写原OperationLog的`mcp.oauth.client.registration.saved`；日志后再次查当前权 / 原review。平台账号tenant作来源，workspace必须null，只记client引用 / 原键 / 修订，不记回调、scope正文或凭据；缺原关联、坏hash、原日志失败 / 缺ID、失权和取消均拒绝，未知提交只按原键核对。此source不创建审查记录、MFA或公开Controller / Guard / CSRF，没有真实review producer仍不开放新增 / 扩权。

registry和management保留默认兼容的Native泛型，四个同事务grant / consent / admission / Web消费者亦沿此Native接点，不把SQL子集强转Prisma。原包子出口公开同一`captureRegisteredPublicClient / capturePublicClientRegistrationReceipt`，原host将这些实际函数交给API adapter，不复制私有validator / hash；原函数正文和默认SQL运行时不变。[新定向测试](../../tests/mcp-client-management.test.cjs)从正式NodeNext消费这些函数及rich native声明，实际执行原Auth / registry / audit和官方S256 precheck；SQL / 原review / native日志与commit仍为明确替身，API运行transpileOnly，不是完整API / 实际Prisma类型、真库、真实批准或UI装配证明。

### 原登记审查的持久准备、决定与 current source

子出口`@rental-os/mcp-server/prisma-public-client-review`提供[createPrismaPublicClientReview](src/prisma-public-client-review.ts)。固定HTTPS同源JSON POST准备原登记快照 / 操作键 / 预期审查修订；原[平台review管理适配](../../apps/api/src/modules/auth/original-mcp-client-review-management.ts)复用当前SaaS身份和原适用验证依据，缺真实证据不默认豁免。首个准备仅持久pending与nonce摘要，不发布审查；重复原键只给旧收据，不给新nonce / 延期限。原登记schema仍从同一capture函数复用，配置的scope ceiling / policy修订 / action TTL / review lifetime固定，不读取环境或监听。

决定仅固定同源表单POST，operationKey / clientId / expectedRevision / decision / nonce五个唯一字段；原账号 / session、nonce、准备快照和当前原验证 / policy再次核对，原client → 审查pointer → draft同事务锁定，pending一次CAS。批准原子发布client的current review pointer，拒绝不覆盖已有批准；原OperationLog与决定 / pointer同commit，日志失败 / 失权整体拒绝。正式source只从该已批准pointer及原draft核对原键 / client / 修订 / 期限 / 当前policy，pending或缺pointer不产生许可，损坏关联为unavailable。历史GET收据按当前原SaaS本人读权独立核对，不因新policy / 验证缺失抹去历史，不批准、签发或重做。unknown只读原键，取消 / 失应答不证明回滚。

[结构源码](mysql-oauth-schema.sql)仅追加review drafts / approved pointer两表，原十五表保持，未应用迁移。适用verification source仍须原真实已完成或明确not_required政策依据，精确绑定账号 / session / registration hash；本适配不执行MFA，不由模型 / nonce默认批准。准备、决定、批准pointer及登记CAS仍是独立职责，不替换用户OAuth同意 / grant。公开Controller / Guard / 原可信UI、真实验证 / DB / 完整API类型仍未验或未齐。[新定向测试](../../tests/mcp-client-review.test.cjs)已用实际原Web / 持久review source到registry / 原日志，无预种已批准审查；SQL / 原验证及native commit为明确外部替身，API为transpileOnly。

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

### 原 Prisma / MySQL 事务仓储

同意、客户端审查及通知审查的`decidedAt`仍存于原`BIGINT UNSIGNED`列；三处SELECT显式`CAST(decidedAt AS DOUBLE) AS decidedAt`，避免Prisma的bigint进入普通JSON快照。NULL保留，安全整数范围内不丢精度，超范围仍由原Number.isSafeInteger / 正数 / 状态检查拒绝；不在全局JSON捕获里自动转bigint，不改nonce / CAS、批准来源、公共字段或DDL。这是SQL返回类型兼容，不是人类同意 / MFA或生产身份补齐。源码3/3与独立MySQL实际类型1/1为分次证据，见[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段决定时间sql安全整数投影2026-11-06)及[原生类型收据](../../output/mcp-isolated-mysql-ypJWY6/receipt.json)；尚未验证PrismaClient / TS store实库事务。

子出口`@rental-os/mcp-server/prisma-oauth-store`提供[createPrismaOAuthStore](src/prisma-oauth-store.ts)，以原Prisma `$transaction / $queryRaw / $executeRaw`的结构化接点实现已有一次码、family、access和refresh仓储，不新增连接、依赖、账号 / 角色或默认grant。自行开事务模式固定Serializable，参数化SQL保留`FOR UPDATE`、一次码 / refresh CAS及数据库唯一关联；驱动、CAS、原审计或commit失败不重试。取消可发生在commit之后，只拒绝交付，不证明回滚。已用摘要和撤销family保留，不提供清理入口。

原授权 / grant作者通过`store.native(transaction)`取得当前同一原事务，必须在此锁住并复验原登记 / 同意 / grant与权限，不能另开事务。该接点仅接受本store的存活事务；同一事务的原授权审计 / 收据是必需注入，没有默认日志或第二账本。`mysql-oauth-schema.sql`是[存储结构源码](mysql-oauth-schema.sql)，含摘要主键、原authorization唯一关联、family唯一关联及外键；尚未集成到原API增量迁移、未执行DDL。缺表、原authority或原审计保持不可用，仓储构造不代表生产服务已接通。

`store.withNative(originalNative, consume, signal)`反向借用原已打开的Native事务，与自行开事务共用同一SQL / CAS / code审计实现。借用入口不连接、begin、commit或重试；外层原owner必须保持Serializable、当前授权锁及原提交 / 回滚，接口不能自行证明这些条件，也不是业务授权。作用域内`native(view)`仍得到同一原client；返回 / 抛错 / 取消后 façade方法及映射不可再用，不能把回调返回当外层提交收据。原Core grant / Auth已在同一外部Native中消费，外层失败仍回滚原审计，见[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原-native-事务借用与同仓储消费2026-11-05)。该复用接点不提供持久目标、业务calls或另一账本。

验证入口为[独立仓储测试](../../tests/mcp-mysql-store.test.cjs)，使用明确SQL事务替身检查具体仓储 / 原token生命周期和正式ESM声明消费；不证明MySQL锁、事务隔离、原身份或真实审计通过。原MCP测试的其他作者WIP不在本片修改范围。

### 当前准入 / grant 与原身份

子出口`@rental-os/mcp-server/prisma-oauth-grant-authority`提供[createPrismaOAuthGrantAuthority](src/prisma-oauth-grant-authority.ts)，具体读取原可信同意后持久grant及最少平台 / 固定空间准入投影。显式resource / scopes ceiling、当前public登记、平台 / 空间client及scope白名单、修订、enabled和最短期限全部相交；关联记录缺失 / 坏JSON / getter / 索引错配为unavailable，不冒充撤销。明确停用、期限或修订 / 白名单失配返回无当前许可。配置 / 原依赖缺失没有默认grant；读取不创建授权、改政策、计量或发布Tools。

`issuance / access`可供已有token生命周期 / 资源验证及统一service的原authority参数消费；`principal`仅供服务端按原token / code中的grant关联定位固定user / tenant / workspace / operator，不能接模型自报grantId或作为协议结果。身份读取前后再次取得整份当前grant / 政策快照，同修订内容变化也拒绝；credential期限取grant / client / 平台 / 空间的最短值。原`revocationOwner`只核对原client / resource归属，不依赖新签发许可、旧scope或到期，使已知凭据仍可撤销；缺归属证据不确认成功。

原API的[createOriginalMcpGrantIdentity](../../apps/api/src/modules/auth/original-mcp-grant-identity.ts)适配已有AuthService，使用同一native Prisma事务和动态grant绑定callback解析当前账号 / 空间；SaaS主体、失效成员及改密义务不能取得许可，不签发或透传Web token、不另算角色。原Guard仍须逐次验证业务路由、数据 / 地点范围；准入 / grant读取不能替代字段释放和持久目标计量。`createPrismaOAuthStore<Native>`现保留原native事务类型，默认SQL调用方式及运行时代码不变，实际Prisma安装 / API全量类型组合仍未验。

[SQL结构源码](mysql-oauth-schema.sql)仅追加平台 / 空间准入和grant三表及关联约束，原token / public-client六表保持。grant的subject / user / tenant / workspace为原不可变主体元组，JSON须与索引字段一致；改变主体 / 空间须原新grant，不原地映射旧凭据。consentRef只是原来源引用，不证明本模块验证了人类同意。准入CAS及同意后的grant存储接点见后续章节；原可信Web登录 / 持久同意source、真实管理授权 / 审计及后台装配、迁移和生产开放仍未完成或执行，不由模型参数或测试种子补齐。

[grant定向验证](../../tests/mcp-grant-authority.test.cjs)通过实际ESM / NodeNext、原token服务 / 资源验证和原Auth / Guard消费本接点，原[身份夹具](../../tests/fixtures/mcp/original-identity.cjs)仅复用外部SQL / Nest环境，不替换原角色方法。真实MySQL / Nest DI / 原同意和发布不在离线证据内。

### 原 grant 当前 OAuth 准入观察

子出口`@rental-os/mcp-server/prisma-oauth-grant-admission`提供[createPrismaOAuthGrantAdmissionSource](src/prisma-oauth-grant-admission.ts)。原Core用同一store / grant authority构造，经原host供给grant管理store的可选第五参数；readIn借用已有Native事务，复用原access.current核对client / 平台 / 空间 / 账号及grant，不开嵌套事务、不签发或记录使用。

摘要和本人列表的oauthAdmission只返回current、not_current或unavailable。明确不满足原准入才not_current；缺源、缺关联或坏证据保持unavailable，不推定token已撤销。原not_revoked只描述grant记录，两者不混同；current也不表示业务Guard、地点 / dataScope、原目标额度或字段释放已通过。原Web owner / 租户管理读权与读后复验仍必需，旧历史收据 / 撤销CAS不变，不输出token / subject或来源错误正文。

[既有Web / grant冒烟](../../tests/mcp-web-consent.test.cjs)验证同管理Native事务、政策关闭 / 缺证据及摘要和列表，状态核对不造使用；正式出口和替身边界见[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段授权摘要当前-oauth-准入核对2026-11-05)。API为transpileOnly，SQL / session / 原验证 / commit是明确替身，不是生产业务权限或真实数据库证明。

### 原 grant 安全摘要与撤销管理

子出口`@rental-os/mcp-server/prisma-oauth-grant-management`提供[createPrismaOAuthGrantManagementStore](src/prisma-oauth-grant-management.ts)，沿[原Web / 租户管理适配](../../apps/api/src/modules/auth/original-mcp-grant-management.ts)核对本人或完整租户集成管理权及固定tenant / workspace。摘要无subject / token / code，原not_revoked不表示有效业务授权，缺最近使用证据明确unavailable。当前读取 / 撤销复用同一capturePersistedOAuthGrant，不复制角色或把已停用许可当历史记录丢失。

撤销只enabled:false / 修订CAS，主体、client、原同意及scope不可改；原grant / operation / hash / 审计同native提交。原键重复读同收据、不重复事件；unknown只核对原键，不重发 / 换键、复活或清理。旧access / refresh经原当前grant读取拒绝，但不表示业务回滚、凭据副本删除或每个family已单独撤销。[现有冒烟](../../tests/mcp-grant-authority.test.cjs)已实际消费原身份 / 权限 / CAS / 审计和token拒绝；SQL / native commit仍为替身，尚未公开管理Controller / UI或应用新增收据表迁移。最近使用由下述服务端观察接点供给，未接业务生产装配不假称已有真实使用。

同store的`list`现提供原Web本人固定空间单页授权摘要：原owner方法缺失拒绝，只接limit / cursor，不接用户或scope。直接按本人复合索引取最多21条，释放最多20条；原JSON / 索引 / 顺序和当前owner读权复验，返回nextCursor而无total / latest。游标只是原范围内的位置，不是签发或读权；列表不写使用记录，不显示token / subject，缺最近使用仍unavailable。实际生产索引 / UI与真库未验；结构源码只追加索引，未执行迁移。

### 原 Web 授权管理控制面

子出口`@rental-os/mcp-server/grant-control-plane`提供[createMcpGrantControlPlane](src/grant-control-plane.ts)，由[原API工厂](../../apps/api/src/modules/auth/original-mcp-grant-control-plane.ts)供给同一Native数据库、每次请求独立捕获的原Web身份 / 租户管理与原OperationLog，实际capture函数仍从正式包出口传入。固定HTTPS同源四路由：GET本人页（limit默认20，可选cursor）、GET摘要（grantId）、POST撤销（operationKey / grantId / expectedRevision）和GET原键收据（grantId / operationKey）。grant定位不是权限；当前原owner / 管理范围仍由原store逐次检查，不允许请求指定user / tenant / workspace或actor。缺依赖 / 关闭拒绝，usage只消费readIn，不暴露写入者或把Web流量计为使用。

撤销仅接受最多4 KiB的UTF-8表单，单一字段、严格正整数和原revision CAS；禁止GET撤销、Cookie混用、额外身份字段及跨Origin / Fetch Metadata。POST必须同Origin，GET缺Origin可供正常同源浏览器fetch，但提供时必须一致；仍需原Web Bearer，不用来源头、MCP token或SaaS身份代替。原grant / 收据 / 审计同native提交，冲突409，提交不明503 / grant_unknown且retryable:false；随后按原键读取，不重做或伪称回滚。

[共用Web运输](src/web-control-plane.ts)复用原审查的no-store / no-referrer / nosniff、UTF-8完整JSON响应上限、限时和fetch / close；[登记 / 通知控制面](src/review-control-plane.ts)仅改用此运输，原审查生产者与决定不变。超时停止交付但保留原在途处理至结算，close停止新请求并等待原处理，不证明撤权或DB回滚。现有grant与notice两个测试文件一次定向组合已消费实际API工厂 / Auth / 管理 / store和原审查入口；SQL / session / native commit仍为明确替身，API为transpileOnly。未注册Nest / 原Guard路由或管理UI，没有新SQL / 迁移、监听或生产启用；这个fetch工厂不替换AS / 标准MCP业务service。

### 审查完成后的登记 / 通知投影 Web 保存

子出口`@rental-os/mcp-server/reviewed-governance-control-plane`提供[createMcpReviewedGovernanceControlPlane](src/reviewed-governance-control-plane.ts)：登记与通知各一组固定HTTPS同源read GET / save POST / 原键receipt GET。登记按clientId定位、通知按原正式target定位，query闭合；保存仅最多64 KiB UTF-8 JSON，原store继续校验完整输入及原CAS，不接受actor、任意URL代理或模型批准。POST须同Origin，拒绝Cookie混用 / 不符Fetch Metadata及MCP专用token，响应沿共用安全Web运输，不是标准MCP业务Tools或AS替代。

[原API工厂](../../apps/api/src/modules/auth/original-mcp-reviewed-governance-control-plane.ts)使用实际正式capture / factory，固定resource / 函数身份 / source方法，再按每次请求捕获原Web身份构造两份原管理store；数据库与审计同一Prisma.TransactionClient。原宿主可把原review控制面clientReview.source / noticeReview.source供给该工厂，模型不能从请求中指定source。登记创建 / 变更与通知创建 / 变更仍须独立已批准来源匹配完整候选；缺source仅原已有metadata的精确关闭，不新建、不重新启用或夹带callback / scopes / 期限 / 文案变化。保存不批准review、不执行MFA / 用户同意或发grant；原source缺真实验证生产者时不补默认成功。

原registry的`read / readIn`是AS内部caller-owned读取，不公开给Web；新增`readManaged`先在原事务核对当前SaaS管理，再读配置 / 索引并复验身份。通知read沿原平台或租户集成管理权，历史receipt独立当前管理读权、不依赖新审查。unknown只读原键，不重做；关闭投影不证明所有凭据已分别撤销、业务回滚或客户端副本已删除。原store写入 / 原日志与审查producer保持；仅增加受管读取口，无新SQL / 迁移、监听 / Nest路由 / UI或业务发布。现有client-review与notice-review文件定向消费批准source → 实际API工厂 / Web保存 → 原store / 审计，验证源 / SQL / session / native commit为明确替身，API为transpileOnly，非真实MFA / DB / 全API-Prisma类型或Host验收。

### 原服务端只读完成观察与安全摘要消费

子出口`@rental-os/mcp-server/prisma-oauth-grant-use`提供[createPrismaOAuthGrantUseStore](src/prisma-oauth-grant-use.ts)。将其`reads`交给原业务`readTools.usage`，同一个实例作为上述grant管理store第四个参数供给`readIn`；缺此source或尚无行仍明确unavailable，不填零或never。原[只读注册](src/read-tools.ts)在当前发布 / 原Guard与计量返回、完整输出schema校验后才调用观察，再复验当前授权 / 发布。不是额外计量许可，原持久目标 / 字段生产者仍必需；不对发现、Prompts、Web管理或被动资源metadata装配此写入者。

[原Core](../../apps/api/src/modules/auth/original-mcp-oauth-core.ts)现用自己的store / grant authority构造唯一grantUse，自动绑定到已有业务readTools；[原host](../../apps/api/src/modules/auth/original-mcp-host.ts)把同一实例交Web grant管理端。缺readTools不新增业务适配，已有usage构造时报错而非覆盖 / 双写，原配置对象不修改。固定官方SDK的同宿主发现 → 只读 → 安全摘要 / 本人页及失败拒绝证据见[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段同宿主使用观察与本人摘要接线2026-11-05)；read / 发布计量释放、SQL / commit仍为替身，不是生产目录、完整计量或发布证明。

原[persistent-oauth-tokens](src/persistent-oauth-tokens.ts)共用唯一access / family / 当前grant reader，内部原grant定位从凭据关联取，外部verifier仍只交最少资源身份并且不写使用。观察沿同一原store的native事务，复验当前原账户 / client / 政策及固定user / tenant / workspace；服务端时钟和grant修订写入最少last-use行，不收caller时间、grant ID或业务正文。原grant锁串行化更新、时间取最大值，写后关联 / 当前权再查；没有次数、tokens、金额或第二任务账本。SQL对BIGINT显式取十进制字符再做安全整数捕获，不依赖Prisma把它返回为JS number。

摘要和本人页仅释放`observed / server_read_completed / observedAtMs`，表示该服务端已完成一次获准只读及输出校验，不证明客户端收到结果、正式业务提交、完整使用历史或当前仍可访问。保存失败 / commit不明拒绝本次交付、不自动重读；commit后取消或返回前失权不删除已经保存的观察。撤销不抹除历史，索引 / 原scope或修订关联损坏拒绝。原[SQL结构](mysql-oauth-schema.sql)只追加last-use metadata一表，未执行DDL。现有grant冒烟复用原Auth / Guard、官方schema转换器及实际handler提交点；业务reader / accounting、SQL / native commit为明确替身，生产业务装配、真实DB / API / UI仍未验。

### 平台 / 经营空间准入 Web 控制面

子出口`@rental-os/mcp-server/admission-control-plane`提供[createMcpAdmissionControlPlane](src/admission-control-plane.ts)，把原准入store的当前read / CAS save / 原键operation接到固定HTTPS同源GET / POST / GET三路由。[原API工厂](../../apps/api/src/modules/auth/original-mcp-admission-control-plane.ts)按每次请求捕获原Web身份，并依同一正式captureOAuthAdmissionTarget分派给已有平台SaaS管理或经营空间租户集成管理 / 原审计，不作两种权力的fallback。target只定位候选，不能自授权；平台身份不开放空间，租户身份不能管平台。缺原Auth / store / 登记reader或关闭拒绝。

读取query只含target，原键收据只含target / operationKey，重复 / 多余字段拒绝；保存仅最多64 KiB UTF-8 JSON，原四字段及policy由同一store闭合校验。POST须同Origin，拒绝Cookie混用、错误Fetch Metadata / 方法、客户端actor / 权限字段及MCP专用token；无Origin的正常同源GET仍须原Web Bearer。保存沿原CAS / 原审计，unknown不自动重发，只按原键核对。enabled只保存准入metadata，不批准通知、做MFA、创建grant或发布工具 / 字段，完整权限交集仍必需。

原准入合同允许最多50个client ID，运输仅对此原metadata显式固定50项响应上限，grant / review仍保留原32项上限；完整UTF-8响应仍不超过64 KiB，不裁剪合法数组或把局部返回冒充完整配置。原超时 / close / no-store等运输复用，Web管理流量不写业务使用。已有workspace / platform两个测试文件一次组合消费真实API工厂 / 原Auth / 权限 / store / 审计，SQL / session / client登记 / native commit仍为明确替身，API为transpileOnly；未注册Nest / 可信UI、未连真实DB或应用迁移。

原营运二次验证不能用占位成功补齐：已核对[原二次确认入口](../../apps/api/src/modules/platform/platform.service.ts#L814)仍是演示校验，[原AuthSession](../../apps/api/prisma/schema.prisma#L2105)不产生或持有MFA完成证据。普通登录、客户实名 / 微信身份或未在原动作表出现的MCP动作都不构成MFA完成或豁免。原同意 / 审查缺真实验证源时继续unavailable，本控制面不改该条件。

### 稳定 issuer subject 的安全 Web 管理

子出口`@rental-os/mcp-server/subject-control-plane`提供[createMcpSubjectControlPlane](src/subject-control-plane.ts)，由[原API工厂](../../apps/api/src/modules/auth/original-mcp-subject-control-plane.ts)供给同一Native数据库、原租户集成管理 / active目标和原OperationLog。固定HTTPS同源read GET、save POST与原键receipt GET；读取按userId / tenantId定位、收据另加operationKey，query重复或额外字段拒绝。保存仅4 KiB UTF-8 JSON，原五字段 / target / CAS仍由原subject store闭合校验，不接受caller subject / actor。POST须同Origin、原Web Bearer，Cookie混用 / 错Fetch Metadata / 方法和MCP专用token不能授权管理。

所有读取、保存和收据统一只返回resource / userId / tenantId / revision / enabled / expiresAt，**不返回subject值**或未过滤的第二包装。原subject仍只由服务端首次生成，停用 / 续期 / 恢复都不旋转，原key重放读同收据；unknown只按原key核对，不生成第二映射。旧收据是历史状态，不冒充当前启用；配置或enabled不等于同意 / grant / 业务访问，停用也不证明所有既有grant已撤销或业务回滚。

原target capture从同一store正式复用，旧生成 / CAS / 审计 / 索引完整性不改，Web管理不计业务使用。现有subject测试文件一次消费实际API工厂 / 原Auth / 管理 / store / 原审计，验证所有响应无subject、unknown恢复与稳定映射；SQL / session / account / native commit仍为明确替身，API为transpileOnly。没有新SQL / 迁移、监听、生产Nest / 可信UI注册、真实DB / MFA或Host验收。

### 原 API 同仓储 OAuth 装配底座

[createOriginalMcpOAuthCore](../../apps/api/src/modules/auth/original-mcp-oauth-core.ts)从实际正式包出口构造唯一原store / 登记reader / 准入reader，复用原Auth / browser-grant identity、原批准通知与适用验证读、持久Web同意source及原OperationLog，供已有标准createRentalMcpService的code / token / resource使用同一事务所有者。resource / scope从同一service配置固定，原service继续核对issuer / token端点和scope一致性；缺真实AS元数据source或必要原身份依赖拒绝，没有默认grant / 同意 / MFA / 计量或字段发布。

`createPrismaOAuthAdmissionReader`从原准入store抽出同一native只读实现，正式出口复用；不创建事务、不授权，也不需要伪造Web管理者或audit就能给原AS读元数据。当前管理store亦用它，原CAS / 权限 / 审计不变。已存在/缺配置与坏索引 / SQL不可读仍分别处理，原身份 / 当前策略和grant交集由调用方在同一native事务保持。

Core返回原宿主内部store、Web同意及grant / receipt生产者，不是模型工具或公开native句柄；上述host已整合后台控制面、用户Web准备 / 决定 / 历史恢复及组件关闭，可信人类UI / 全准备恢复仍未验。`core.service.close`只覆盖已有标准service，不意味着内部生产者已撤权或原历史清除。现有web-consent文件消费实际API Core到标准code / token，同原admission-CAS文件一次验证，SQL / session / notice / verification / native commit及AS元数据为明确替身，API为transpileOnly；未注册Nest / UI、未启服务或验真DB / MFA / Host，不因装配存在开放业务。

### 原目录单 Core 生产者组合

[createOriginalMcpOAuthCore](../../apps/api/src/modules/auth/original-mcp-oauth-core.ts)可在原宿主内部配置一次同步`createReadTools`：取得本 Core 的同一store／grantAuthority及固定数据库方法后、构造唯一标准service之前调用。与旧`resource.readTools`互斥，缺完整返回／异步返回／自带usage拒绝，不回退或新建第二Core；旧直接供给路径保持。此内部callback不是MCP工具、授权或I/O许可；同一Core完成观察仍唯一由grantUse提供。

[createOriginalMcpCatalogReadTools](../../apps/api/src/modules/auth/original-mcp-catalog-read-tools.ts)可直接消费该端口，将真实原授权／初始目标准备、只读已提交frontier的原预算source、原Native目录reader接成一个`McpReadTools`。原目标／binding／audit事务先确认，预算另用同一数据库的独立事务，不重锁外围Auth／grant；实际目录沿原Auth／Guard／scope、Core配置分页与facts读取。计量产生的原call引用只在该次callback内使用，错误输入／外部调用／嵌套计量／第二读取／回调结束或取消均拒绝；此一次性关联不是本地配额或另一账本。

宿主须显式供给**正式闭合MCP wire描述符、当前发布、外部字段释放与原分类限流政策源**；组合只固定目录运输名，不从内部投影或enabled推定许可。缺任何政策拒绝构造，未完成能力不开放。目录自动业务类现消费下述原桶参加者，整次调用占用保持；合法下一目标仍只沿原Web采用，不由初始作者自动轮换。其他三类生产入口、完整活跃、其他工具或生产Nest／可信UI／真实DB仍未齐。验证入口为[既有Web组](../../tests/mcp-web-consent.test.cjs)：官方SDK在进程内消费真实原Auth／目标SQL／原审计／预算／Core／facts，SQL锁／commit、MFA、wire／发布／release明确为夹具；不等于真实Host或字段批准。阶段证据与完整边界见[开发记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录单-core-生产者组合2026-11-06)。

### 准入 CAS 与原管理收据

子出口`@rental-os/mcp-server/prisma-oauth-admission-store`提供[createPrismaOAuthAdmissionStore](src/prisma-oauth-admission-store.ts)，对上一节的最少平台 / 固定空间投影作原管理保存、当前读取和精确原键收据读取。保存 / 当前读取共用`captureOAuthAdmission`闭合校验；resource / scope ceiling固定于服务端配置，客户端不能自报actor、修订后的resource或身份字段。平台与经营空间管理范围来自原当前授权，必须与固定target精确相同，不把平台权限当租户授权，也不让空间管理者扩大到另一空间或平台。

原管理权和同事务审计缺一不可。Serializable / 行锁、expectedRevision CAS、全局operationKey及actor / target / 输入hash / 完整原收据同事务保存；键序重排不新保存，同键变内容 / target拒绝，原历史收据不冒充当前政策。失权 / 审计失败在原事务内拒绝，提交不明 / commit后取消保持unknown、不重试或换键，not_observed仍retryable:false。`readIn`只供原服务端当前grant / 写入作者在同一native事务使用，不是Model Tools或无鉴权业务读取。

[SQL结构源码](mysql-oauth-schema.sql)只追加准入管理原操作收据表，保留原九表；未应用迁移。当前grant读取已消费实际CAS生成的投影，仍须所有原准入 / client / grant / 身份条件相交；保存enabled意图不意味着业务已开放。这里没有真实后台权限 / UI装配、原登录 / 同意source、字段释放或持久目标；同意后的grant存储接点见下节，原管理scope callback不能以测试 / 常量作者替代生产授权。[定向测试](../../tests/mcp-admission-cas.test.cjs)为明确SQL / 原管理 / 审计替身和真实包源码 / ESM验证，不是真库或后台验收。

### 已完成可信同意后的 grant 创建与原键核对

子出口`@rental-os/mcp-server/prisma-oauth-consent-authority`提供[createPrismaOAuthConsentAuthority](src/prisma-oauth-consent-authority.ts)，供已有`createPersistentOAuthAuthorization`或统一service的原consent参数消费。原source必须从已认证浏览器定位精确的、持久已完成的同意决定，并在同一native事务锁住原会话 / 改密 / MFA / CSRF和当前同意权限；缺source或审计拒绝，不解析URL / body / 模型confirmed作为人类批准。此模块不创建同意页、账号 / 角色、业务批准或默认grant。

同意请求的client / 登记修订 / resource / scopes / state / 实际回调 / S256与原请求完全匹配，普通JSON快照及scopes冻结后交原source；原Auth身份、当前client、平台 / 固定空间准入复验后，生成唯一随机grant，与原authorizationId、同意 / 政策hash、原grant审计及后续一次码审计同事务提交。既有grant读取 / token / resource verifier直接消费这份持久对象。原主体与issuer subject分别保存，不借Web token；最短期限、原政策修订和scope ceiling保持，grant不替代业务Guard / 字段 / 目标计量。

原同意键唯一关联grant，重复请求不会创建第二grant或重新发码；同键换主体 / request / 政策内容拒绝，失权 / 迟到变化 / 审计失败拒绝。提交不明或commit后取消不推定回滚、不重试 / 换键。`receipt`仅供原可信Web按同一决定和当前独立读权核对原关联，不创建、不返回code / token或当前签发许可；停用政策 / grant仍可核对历史关联，完全无当前Web读权则拒绝，not_observed保持retryable:false。

[结构源码](mysql-oauth-schema.sql)仅追加原同意到grant关联表和唯一 / RESTRICT约束，原十表保持，未应用迁移。原API的[createOriginalMcpBrowserIdentity](../../apps/api/src/modules/auth/original-mcp-browser-identity.ts)现提供同意源的Web身份接点：原Auth签名验证、原持久session行锁和空间角色在同一事务内复验，返回固定session / 用户 / 空间及原最短期限，不返回Web token或角色树、不认定同意。MCP bearer和客户端身份字段不能走此入口，缺显式Web密钥 / 持久会话及失权拒绝；该密钥仍只由原Auth持有。持久Web同意 / nonce source见下节；原可信Web UI / API装配、真实通知 / 适用MFA / 审计政策、管理权限仍未完成，不以此身份接点或离线决定宣称真实OAuth通过。[定向测试](../../tests/mcp-consent-grant.test.cjs)严格编译依赖闭包 / 正式NodeNext出口，运行原Auth / Guard和实际grant → code → token链；同意、SQL锁和审计仍是明确外部替身，完整API / Prisma类型、真库和浏览器未验。

### 原可信 Web 的持久同意与 nonce 提交

子出口`@rental-os/mcp-server/prisma-oauth-web-consent`提供[createPrismaOAuthWebConsent](src/prisma-oauth-web-consent.ts)，具体实现原Web同意准备、固定同源POST / nonce CAS，以及供上一节grant作者消费的已完成决定source。不监听或渲染UI、不注册MCP管理Tools；原Auth浏览器身份、当前登记 / 平台 / 空间准入、原审查通知及适用验证政策、同事务审计缺一不可。验证policy须有真实satisfied或明确not_required的原依据 / 修订 / 期限，没有默认MFA豁免，也不由此模块实现二次验证。

原操作键固定到完整OAuth请求，首个准备持久绑定原session / user / tenant / space、原通知 / 验证 / 准入快照hash和最短期限；只把随机nonce交原可信Web，数据库只存摘要。重复准备仅核对原记录，不发新nonce / 改期限，不因失应答重新开授权。可信提交仅接受固定HTTPS同源、原Web Bearer及最多4 KiB的严格UTF-8表单；重复 / 未知字段、GET确认、JSON模型confirmed、错nonce / 原键 / 修订及失权拒绝。原nonce摘要匹配后pending→approved / denied一次CAS，与原审计同事务；同键同决定只返回原收据，不改决定，不直接签发code / grant。

`source.current`从持久已完成决定定位，不再用测试预填批准。签发目的复验原session / 请求 / 通知和当前准入，返回前原身份及政策再次核对；grant / code作者仍另外核对全部条件。内部purpose由原issuer / receipt方法选定，不从HTTP / 模型参数读取：历史收据按当前原Web本人 / 固定空间独立读权核对，停用新签发或过期通知不删除历史关联，当前Web身份失效仍拒绝；不能借read_receipt签发或消费nonce。

[SQL结构源码](mysql-oauth-schema.sql)只追加浏览器同意表及状态 / 修订 / 决定时间CHECK，原十一表保持，未应用迁移。具体当前通知 / 验证适用读取见下节；原可信Web UI / API装配、审查元数据真实写入 / 管理权 / 审计、原MFA生产源仍缺，不以Origin / nonce、库接口或离线提交替代真实人类 / MFA / 浏览器验收。[定向测试](../../tests/mcp-web-consent.test.cjs)以实际原Auth / 持久同意source → grant / code / token源码组合验证；SQL、原通知 / 验证政策与审计为明确外部替身，完整API / Prisma类型及真库未验。

### 当前审查通知、验证适用政策与 subject 读取

子出口`@rental-os/mcp-server/prisma-oauth-consent-review`提供[createPrismaOAuthConsentReview](src/prisma-oauth-consent-review.ts)，具体供上一节policy.current消费。锁定当前平台审查、固定空间审查及原issuer subject映射，核对索引 / 闭合JSON、原review来源 / 修订、同一通知版本、enabled / 到期和原当前账号 / 空间；缺记录 / 来源、getter、错索引或同修订内容变化保持unavailable，不默认通知 / 主体或批准。构造明确关闭时零读取。此模块只读接入元数据，不新增账号 / 角色、管理工具或业务授权。

只有两级当前已批准政策均明确verificationRequired:false才产生not_required；任一级要求时必须供给原只读已完成MFA证据source，精确绑定user / tenant / workspace / session / resource、当前政策hash和原授权请求hash，原引用 / 修订 / 有效期及前后证据一致才返回satisfied。不存在默认豁免，不接密码 / factor / 模型确认、不执行MFA或重试验证。最短期限及当前政策 / 证据引用进入原Web同意快照，同文案但元数据修订变化也拒绝旧同意。

[结构源码](mysql-oauth-schema.sql)只追加审查投影及subject映射三表，原十二表保持，尚未应用迁移。subject映射是原已有用户的AS元数据，不能创建用户或原地改旧grant的主体，停用此映射 / 通知不等于撤销已有grant；当前grant / 原Auth及独立Web收据继续按其原规则处理。同意 / grant / code的原同事务审计接点见下节；批准后投影管理写入 / CAS及原审计见下述接点；原审查批准记录生产者、原MFA生产接点和可信UI / API装配仍缺，不以SQL夹具或原引用字段存在证明真实批准 / MFA通过。

[读取验证](../../tests/mcp-consent-review.test.cjs)严格编译依赖闭包和正式NodeNext子出口，执行原Auth当前账号 / 空间；[原同意组合](../../tests/mcp-web-consent.test.cjs)已改消费此具体生产者，不再直接返回notice对象，继续走nonce → completed source → grant / code / token及独立收据。SQL / 审查记录 / 原验证及审计仍为明确替身，不是真库 / 完整API类型 / 真实人类或MFA / 发布证据。

### 已批准通知投影的原管理保存与收据

子出口`@rental-os/mcp-server/prisma-oauth-consent-policy-store`提供[createPrismaOAuthConsentPolicyStore](src/prisma-oauth-consent-policy-store.ts)，与当前同意读取共用`captureOAuthConsentPolicy`，原host把实际policy / target / receipt capture函数交给[原管理适配](../../apps/api/src/modules/auth/original-mcp-consent-policy-management.ts)。平台SaaS与原租户集成管理权分别核对，新增 / 文案 / 验证要求 / 引用 / 期限变更及恢复启用必须精确匹配独立原completed review；不从候选 / 引用字段默认批准或豁免。缺source仅允许已有policy精确关闭，其余字段不变，不准新建或夹带修改。

原policy → operation行锁、CAS、原键 / actor / scope / hash / 完整收据及原OperationLog同native提交，权 / review和写后原关联复验；两类policy.saved分别固定平台null-space及原经营空间，只记原键 / 修订，不记通知正文。unknown只按原键读取，不重审查、重保存或换键；历史原actor收据按当前管理读权独立读取，不要求新review或启用，不改旧grant。[结构源码](mysql-oauth-schema.sql)只追加一表及scope CHECK / 两份RESTRICT外键，原十八表保持，未迁移。

[定向测试](../../tests/mcp-consent-policy.test.cjs)实际原管理 / CAS / 原审计到当前同意读取，严格验证正式NodeNext / rich Native；原批准review / SQL / native commit仍为明确替身，API为transpileOnly。原通知review生产者见下节；真实MFA / UI / CSRF、完整API / Prisma类型、真库与发布仍未齐或未验，本库不开放管理或业务Tools。

### 原通知审查的持久准备、决定与批准 source

子出口`@rental-os/mcp-server/prisma-oauth-notice-review`提供[createPrismaOAuthNoticeReview](src/prisma-oauth-notice-review.ts)：固定同源JSON准备pending / nonce摘要，严格五字段表单POST明确批准 / 拒绝，一次CAS发布同scope批准pointer。原[管理适配](../../apps/api/src/modules/auth/original-mcp-notice-review-management.ts)复用原SaaS / 租户集成管理权及Web身份；适用验证必须来自独立原证据并绑定账号 / session / target / candidate hash，没有默认MFA豁免。

source只消费已批准原draft及当前配置 / 期限，供投影store另行CAS保存；准备不批准，拒绝不覆盖既有pointer，批准不保存投影或开业务。原审计同native提交，只记原键 / 修订，unknown不换键或重做；历史owner收据按当前原读权独立读取，损坏关联不可用。[冒烟入口](../../tests/mcp-notice-review.test.cjs)已实际连通原身份 / 审查source / 投影，SQL / 原验证 / commit仍为替身。真实原验证生产者、Controller / Guard / 可信UI、全API / 实际Prisma类型与真库未齐或未验；结构源码只追加draft / pointer两表，未迁移。

### 原宿主统一审查控制面

子出口`@rental-os/mcp-server/review-control-plane`提供[createMcpReviewControlPlane](src/review-control-plane.ts)，实际构造上述登记 / 通知审查并提供六个互异HTTPS同源路由的fetch / close。原[API装配工厂](../../apps/api/src/modules/auth/original-mcp-review-control-plane.ts)将原Auth / 管理 / 审计和显式适用验证接入同一Native数据库 / reader；缺依赖不补默认验证。准备、决定及历史收据仍由原producer核对，组合不保存投影或开业务，不替换原MCP资源 / AS service。

响应有界且no-store，无HTML / 模型身份；取消 / 超时拒绝迟到交付，可能变更保持unknown，close只停止新请求并等待原处理结算，不证明回滚 / 撤销。原内部sources供投影管理消费，不是模型Tools。[现有冒烟入口](../../tests/mcp-notice-review.test.cjs)验证实际原API工厂到统一HTTP准备 / 决定 / 收据；SQL / 验证 / commit仍为替身，未注册到Nest / 启动监听器。真实原验证生产者、可信UI / Controller / Guard装配及全API / Prisma / 真库仍未齐或未验。

### 原租户 issuer subject 的稳定映射治理

子出口`@rental-os/mcp-server/prisma-oauth-subject-store`提供[createPrismaOAuthSubjectStore](src/prisma-oauth-subject-store.ts)。原[管理适配](../../apps/api/src/modules/auth/original-mcp-subject-management.ts)固定原Web身份，复用原租户集成管理权 / 完整租户范围及同事务active账户投影，目标必须是同tenant原非SaaS账户；不把管理者或目标身份当业务授权。仅首次由服务端生成opaque subject，请求不能选择或旋转它；CAS停用 / 续期 / 恢复启用保留原值，没有删除重绑、用户 / 角色创建或grant改写入口。

当前同意读取与存储共用正式`captureOAuthSubjectBinding`，原host把同一`captureOAuthSubjectReceipt`交原审计消费者。subject → 原operation行锁、当前权前后复验、CAS与原键收据 / 原日志同native提交；原输入hash与永久subject关联分别核对，损坏收据 / 索引不可用，不能拿新subject替历史。mcp.oauth.subject.binding.saved只记原tenant / 管理者workspace、目标账户引用、原键 / 修订，不记opaque subject或凭据。unknown只读原键，not_observed仍retryable:false。历史收据按当前本人原管理读权 / active目标读取，不要求新映射仍启用；停用映射不冒充旧grant已撤销。

[结构源码](mysql-oauth-schema.sql)只追加原操作收据一表及RESTRICT关联，原十七表保持，未执行迁移。[定向测试](../../tests/mcp-subject-management.test.cjs)实际原Auth / 租户管理 → CAS / 原日志 → 当前同意读取，严格验证正式NodeNext / rich Native类型；SQL / 账户 / 原通知与native commit仍为外部替身，API为transpileOnly。原验证、通知 / 空间审查治理、公开Controller / Guard / CSRF / 可信UI与完整API / 实际Prisma类型仍未齐；本控制面库接口不开放MCP管理或业务Tools。

### 原 OperationLog 的同事务 OAuth 审计

原API的[createOriginalMcpOAuthAudit](../../apps/api/src/modules/auth/original-mcp-oauth-audit.ts)提供consent / grant / code三个回调，供原Web policy.audit / auditGrant及PrismaOAuthStore的code audit消费；均沿[OperationLogService.recordOriginalOAuthAudit](../../apps/api/src/common/operation-log.service.ts)写原OperationLog，不新建审计表或另开事务。原作者仍负责当前授权及commit / unknown核对，记录审计本身不授权或执行业务。

原native事务和operationLog.create必须存在，写入异常 / 缺原写入ID / 取消直接拒绝，不借全局Prisma、不吞错 / 重试。同意及grant记录只接原作者输出的固定user / tenant / workspace和最少事件关联；code从原持久grant读取并核对原同意ID / 修订 / 索引关系后定位同一范围。空间不从可变Web ALS取，不接受HTTP / 模型body、nonce、token或任意事件。只保存原操作 / grant引用及修订，不记录明文code、摘要或浏览器凭据；旧Web的ALS / best-effort审计方法正文保持。

[审计验证](../../tests/mcp-original-audit.test.cjs)执行实际原日志服务 / 回调，检查缺native / 写入失败 / 缺ID、getter及原grant关系错配拒绝；[原Web组合](../../tests/mcp-web-consent.test.cjs)已改使用实际原日志服务，验证原同意 / grant / code与日志同事务、失权 / 审计失败回滚和提交不明后原事件仍可能持久。native Prisma / DB commit、审查 / MFA来源仍是明确外部替身；API执行transpileOnly，不是全API / 实际Prisma类型、真库原子性 / DI、真实人类或发布证明。管理保存所需当前权限 / 审查写入及对应管理审计接点、可信UI / API装配仍缺，不因审计已接而开放。

### 原经营空间的 MCP 管理授权

原API的[createOriginalMcpWorkspaceManagement](../../apps/api/src/modules/auth/original-mcp-workspace-management.ts)供给admission management.authorize，绑定本次原Web Request的签名凭据和signal，不读body中的actor / scope或MCP token。原Auth在同native事务核对当前session / 用户 / 空间，目标必须与固定tenant / workspace相同；原Platform的[事务管理检查](../../apps/api/src/modules/platform/platform.repository.ts)复用原assertTenantPermissionInTransaction，以租户级当前角色的集成管理权限及完整租户范围授权，再复验有效空间成员 / 改密义务。前后原Web主体及当前租户角色再查，权限变化拒绝；没有角色副本或默认管理员。

空间角色的fixedAllPermissions不能冒充租户管理权，SaaS / staff / 另一个空间 / memory / 失效Web身份都不取得此许可；platform target明确不提供，待专用当前平台授权接入。此处只有经营空间内部管理端口，不是公开Controller / Guard / CSRF、候选policy审查或业务权限；缺完整消费者不开放。

同文件的`createOriginalMcpWorkspaceAdmissionManagement`复用上述authorize，并供给经营空间准入保存的原同事务audit。固定resource、原actor / target / operationKey / revision闭合校验；再次取得原管理权后，在同native事务锁住原admission operation，核对索引和saved收据的原键 / 固定空间 / policy修订，再沿原OperationLog强制写入`mcp.oauth.admission.workspace.saved`，写后复验原管理权。没有原保存关联、actor / 空间 / 修订错配或日志失败就拒绝，不记录policy正文、凭据或任意事件，不借全局Prisma / 活动ALS。CAS、提交及unknown由原admission store负责，audit不新开事务、不重试或替调用方commit。

[定向测试](../../tests/mcp-workspace-management.test.cjs)实际原Web Auth / 原租户权限 → admission CAS / 原操作收据 → 原日志服务，失权 / 审计失败整体回滚，坏原保存关联零新增事件；提交失应答 / 提交后取消保持unknown，读取同一原键不重复成功日志。原session / SQL / 角色资料、native OperationLog写入和DB commit仍是明确外部替身，API执行transpileOnly，MCP / 声明NodeNext维持严格验证。未验全API / Prisma类型、真实管理 / UI或DB原子性；平台 / 审查管理及公开消费者仍缺，不给平台管理员自动空间业务权。

### 原平台的 MCP 准入管理授权

原API的[createOriginalMcpPlatformManagement](../../apps/api/src/modules/auth/original-mcp-platform-management.ts)提供平台admission management.authorize，复用[AuthService.resolveTrustedPlatformBrowserPrincipal](../../apps/api/src/modules/auth/auth.service.ts)和原Platform的`assertTrustedSaasManagement`。固定原Web签名 / operator、同native session锁、原account / tenant有效性和mustChangePassword:false；当前原数据库SaaS身份复用原assertSaasAdmin，不用租户isPlatformAdmin或空间通配角色替代。前后读取稳定才返回最少平台actor / kind，无token、角色树或经营空间业务权。

没有默认Web密钥 / memory身份；MCP bearer、自报actor / SaaS标记、staff、坏session或失权均拒绝。签名wid仍须与原session精确一致，但不作为平台授权结果输出；平台target与workspace target分开，后者明确无许可。本authorizer不批准候选policy，public-client登记管理由上述专用adapter供给，不放宽原Guard路由白名单；平台准入audit由下述companion供给。真实审查保存 / 批准及公开Controller / Guard / CSRF仍缺对应消费者，未齐不开放。

同文件`createOriginalMcpPlatformAdmissionManagement`复用上述authorizer及原Auth平台绑定，在同native事务锁住精确admission operation，核对原actor / platform / resource / null tenant-workspace索引、saved收据的原键及policy修订，再沿原OperationLog写`mcp.oauth.admission.platform.saved`，日志后再查原管理权和会话。日志tenantId来自原平台账号，经营空间归属必须null，不借当前Web ALS；只记原账号 / 操作键 / 修订，不记policy正文、凭据或任意事件。缺原保存关联 / 日志ID、失败 / 取消或失权拒绝，原store继续负责CAS / commit / unknown，audit不开事务、不重试或自行提交。

[定向测试](../../tests/mcp-platform-management.test.cjs)实际原Auth / Platform → admission CAS / 原键收据 → 原日志服务，失败 / 失权整体回滚，坏原关联拒绝；同键不重复审计，失应答及提交后取消仍unknown、只读原键。MCP / 正式NodeNext、内部平台绑定及实际内部审计类型的space / null分支严格验证；API运行transpileOnly，账号 / session / SQL和native OperationLog / DB commit仍为明确外部替身，不是完整API / 实际Prisma类型、真库、管理UI / MFA或公开生产装配证明。

### 标准token与撤销控制面

子出口`@rental-os/mcp-server/oauth-token-endpoint`提供[createOAuthTokenEndpoint](src/oauth-token-endpoint.ts)，只处理固定HTTPS token / revocation地址的POST表单，不启动服务或另建业务API。构造捕获原登记reader和AS方法；授权码交换只接登记client、code / S256 verifier、精确回调及单resource，refresh只接原token与相同resource。拒绝重复 / 未知参数、client secret、Web cookie / Bearer、DPoP、非表单及未许可Origin；非法UTF-8以400 invalid_request在登记读取 / AS调用前拒绝，不当服务故障。完整请求最多配置的65,536字节，整请求等待最多30秒。

原持久AS负责原子核对clientRevision、原登录 / 同意 / grant、码一次性及PKCE、refresh轮换 / reuse和token归属撤销。运输不签发或保存token、不建立账号 / grant、不重试AS；缺AS或关闭返回安全503。交换 / refresh仅释放标准token字段、有限短期Bearer及当前许可scope，refresh必须返回不同的新refresh token。输出脱离原对象，私有字段 / getter / 坏token拒绝，完整响应最多65,536字节、禁止缓存；返回前再次读取当前登记，停用、到期、修订或内容变化拒绝迟到token。该复验不代替原AS的提交事务，也不证明已经签发的token被回滚或撤销。

停用或过期但仍有登记的client可以请求原AS撤销已知token，归属与未知token接受仍由AS判断；成功仅返回RFC7009空200，不声明整个grant已核实撤销。取消 / 超时 / provider故障返回安全503，不含凭据 / 私人异常，迟到完成不释放token、不自动重发。原AS明确的invalid_grant / invalid_client / invalid_scope返回400。生产登记 / AS、可信登录、持久grant和原身份适配仍缺，根运输不自动装配此控制面。

[既有测试](../../tests/mcp-foundation.test.cjs)经官方SDK实际交换 / refresh及编译包子出口验证严格表单、轮换、取消迟到、当前登记失效和停用后撤销；[Harness组合](../../tests/harness-plugin.test.cjs)的原登录 / disconnect已经过此运输代码。登记和AS签发 / 撤销仍是外部夹具，Host后续并发refresh另用原专门夹具，不将运输通过当持久AS、真实OAuth或全部grant验收。

### 原授权只读注册

[readTools](src/read-tools.ts)是服务端内部注入，不是客户端配置或权限声明。每项注册必须由原契约作者提供闭合输入 / 输出JSON Schema、无业务副作用的reader，并同时提供当前`publication`、Controller等价`authority`、原服务端持久`accounting`及完整外发`release`。原authority负责Guard / ALS及返回前业务复验；当前资源认证不能代替它，本地计数器也不能代替原目标准入。

原只读候选构造时绑定原reader方法，后续修改binding.read不会更换执行者；替换reader须重新构造候选及端点。端点构造时捕获工具名称、说明、输入 / 输出schema及reader和原provider方法；schema副本冻结，定义替换须重新装配端点，不能在等待发布时插入工具或改reader。方法绑定不冻结原政策状态，当前grant / 撤回仍逐次读取。官方SDK沿同一schema校验输入和输出；输入适配保留原validator及完整JSON Schema转换，只将失败issues换成固定安全说明，避免SDK在本端handler之前回显调用方字段路径。非法参数仍在原权限 / 计量 / reader之前拒绝，不削约束或伪装通过；返回前复用同一输出validator把无效投影转安全错误，不回显私人校验明细。当前发布条件决定列表，旧缓存直接调用仍复验。执行顺序为原权限 → 原计量 → reader → 获准投影，投影只接受普通JSON字段：有限数字、字符串、布尔、null、完整数组及普通对象；循环、稀疏数组、undefined、非有限数、自定义对象、getter / toJSON等整项拒绝，不调用转换或把缺值改成null。字段先形成一份脱离原对象的JSON快照，文本及structuredContent从同一份生成，不把后台原对象交给PTC。每个外发字符串最多2,000字符、每个数组最多50条；超限整项不可用，不裁掉事实。注册最多50个互异名称；这不是业务分页实现，实际reader仍须有界读取并提供正式来源 / 期限，不能全量读取后仅在此过滤。

工具handler还将SDK的`context.mcpReq.signal`与原endpoint信号相交，传给当前发布、原authority / accounting、reader / release及成功使用观察；原计量的剩余额度只能进一步收紧。原身份复验等待结束后再次检查协议信号，再调用发布政策；预检中已取消的请求不迟到进入原授权 / 计量 / reader。该检查不把原身份查询伪作已停止，也不证明历史操作未发生，见[预检取消阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段tools预检取消后零派发2026-11-06)。共享通道上单个MCP请求取消不要求关闭整个连接，也不证明业务回滚；取消发生在原工作内时等待实际结束，原计量按原键保留unknown占用，迟到reader不进入release、迟到投影不外发。此注册消费不补完整跨实例取消 / 目标分类，原使用观察已经持久化时不能靠后来的取消抹除事实。实际SDK共享通道与现代HTTP的验证范围见[本阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段tools协议取消传播2026-11-06)。

只读配置的请求从首次认证到执行、最终输出共用最长15秒截止，身份读取另受更短配置限制。一次请求捕获不可变subject / client / resource / scopes供原providers消费，SDK认证对象只由本端私有WeakMap关联该引用，不靠模型actor或客户端上下文。发布 / 调用 / 读后及整份MCP响应发送前复核主体与范围；即使client / scopes相同而subject变化也拒绝。整份MCP响应在发送前缓冲并再次核验当前资源身份，最多65,536 UTF-8字节，包含envelope、文本转义及structuredContent重复；超限返回安全503，不截断成成功。单投影32,000字节预检查仅提前拒绝，不能代替整包上限。内部失败返回安全不可用结果，不能把权限或计量失败冒充空业务结果。

[离线测试](../../tests/mcp-foundation.test.cjs)用真实两代SDK验证发现 / 调用、未知输入、当前发布撤回、原权限 / 计量 / 释放顺序、私有字段不返回、投影与重复包装超限及读后身份失效。所注入业务provider均明确synthetic，仅验证注册编排；没有接原目录Core、真实Guard、持久目标或获准字段生产者。

### 四类原限流与目录消费

正式子出口[original-traffic-meter](src/original-traffic-meter.ts)按**服务端固定操作**区分协议发现／纯指引、人工当前展示复核、主动原收据核对和自动业务。Tools／Resources业务读取固定自动类，URI／工具名称／Header／clientInfo或模型human字段不决定豁免；人工与收据类须原policy source返回匹配本人／租户／空间的当前独立原引用证据，缺项／错kind／到期／错owner拒绝。source负责原事实与批准政策，不接普通登录或客户端确认补证据；分类函数不是原角色／批准系统。

`consumeIn`只参加调用方已有Native，复用[原客户端限流](../../apps/api/src/modules/client/client-api-rate-limit.service.ts)所用`client_api_rate_buckets`的唯一桶／原子递增，不开事务、连库、安装表、重试、清理或创建业务goal／Task。scopeKey仅原class与user／tenant／workspace的固定哈希，不含token／client／query／goal／policyRef或修订；四类分别累计，同类跨操作和重建共享。限额／窗口／期限由原政策源显式供给，没有生产默认值；期限使用原Unix秒，窗口才使用毫秒，窗口最多1h以不被原2h清理提前移除。计数缺行／非法或超限、缺表、取消／晚政策变化拒绝；原owner负责rollback／commit与unknown，返回不是提交或业务许可，不能把失应答当退款。

[原目录组合](../../apps/api/src/modules/auth/original-mcp-catalog-read-tools.ts)现在必需原`traffic.current`，在原Guard／context已建立且目标已确认后，于同一预算Native按goal→class桶→budget／call消费固定mcp.tools.call；source再次复验不重复计数，不重锁外围grant。限流拒绝在原Core派发之前；失败业务仍保留已确认的桶及原调用资源，分类桶不是20次／5分钟／并发账。目录自动业务、下述原本人收据／索引及原认证JSON-RPC发现类现各有实际消费；人工当前复核、匿名来源限流／完整原政策、Resources及副作用仍未齐，不称完整四类生产放行。2/2与实际Core／SDK1/1、strict声明及夹具边界见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段四类原限流参加者与目录消费2026-11-06)。无新DDL或生产迁移，插件未改。

### 原认证协议发现实际限流

正式子出口[protocol-traffic](src/protocol-traffic.ts)将当前已认证原grant／Auth身份与[原class率桶](src/original-traffic-meter.ts)接到发现方法。原[Core](../../apps/api/src/modules/auth/original-mcp-oauth-core.ts)可显式供给protocolTraffic政策源，使用本Core同一store／grantAuthority；不存在第二Core、登录身份或目标准入。原政策源与直接resource.protocolTraffic互斥，声明源却缺factory／current拒绝，不默认限额；旧未声明来源只保留旧运输，不能当发现类完整放行。

[运输入口](src/index.ts)在原认证后先构造serving Request，调用官方SDK readRequestBody并显式传原maxRequestBytes，再以isJSONRPCRequest按实际body.method取得固定initialize／server-discover、Tools／Resources／Prompts发现和纯指引请求；每个legacy批次的匹配request分别计数，通知／响应不冒充request。批次最多50是技术完整性门，超限拒绝而非截断。Tools／Resources业务读仍是自动类，不从Header／clientInfo／字段human／批次首项免费转换。原完整parsedBody交回SDK公开fetch选项；SDK仍控制消息／方法validator、工具注册／列表、标准头与协议代次，不重造列表或删字段。原Body超限413、非法JSON400、缺policy／超限／取消503，不返回敏感错误。

准备读取及原discovery政策work保留原deadline／shutdown信号，取消先停止交付但不证明原工作停止；close等待已接受的Body／Native政策工作，不只等raced HTTP响应。原认证发现只计本人／空间协议class桶，不建goal、不写business call／usage／audit；原自动目标20次／并发／活跃与收据独立类保持。匿名RFC9728／AS HTTP元数据的来源地址限流、人工当前复核及其余流量仍需可信宿主／原作者来源，不借虚拟owner或MCP Header填齐。实际同Core／Auth／官方SDK双代、Header冒充／输入界限／政策拒绝／close1/1与必要strict声明见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原认证协议发现实际限流2026-11-06)；SQL／锁／commit／政策及MFA／字段为明确夹具，不是完整协议／真库或生产Host验收。

### 原持久只读计量来源适配

子出口`@rental-os/mcp-server/persistent-read-accounting`提供[createPersistentMcpReadAccounting](src/persistent-read-accounting.ts)，只适配必需原持久目标budget source，不实现第二任务 / 财务库或本地额度。原source须在reserve返回前原子持久化目标、主体 / grant / 用途 / 原输入政策绑定和次数 / 活跃 / 并发占用；不能从client goalId、"human"字段、新token / 连接或重建适配重置。完整预留快照须符合20次、5分钟、2并行只读及本次最多15秒，缺源 / 坏或不明预留不调用reader。

原source确认denied / limit与未知提交分开；其他预留不明只按预留前生成的callId标unknown。新增可选服务端`withInvocation`：标准Tools handler从原整次包装开始计时，覆盖原身份／发布复验、目标准备、Auth／Guard、reserve、读取／投影、原owner事务确认、输出schema与最终使用观察／复验。只有其中一次匹配授权／tool／完整输入hash的`withCall`能在原授权回调内reserve；读返回时仍reserved，整次原工作结束后再于外围grant锁外settle。初始15秒截止与原预留更短剩额相交；pre-reserve耗时不重新开窗口，已耗尽不启动reader。源码[read-tools](src/read-tools.ts)、[持久生命周期](src/persistent-read-accounting.ts)、[input-aware适配](src/prisma-mcp-read-accounting.ts)及[原目录组合](../../apps/api/src/modules/auth/original-mcp-catalog-read-tools.ts)共用此接点；call／Native读引用仍只在一次读取callback内使用。旧provider省略withInvocation或直接withCall仍保留reserve＋callback口径，不冒充整次覆盖；不接客户端耗时、goal或人工等待标记。

即便原读取、owner确认或最终检查忽略取消也等待真实结束；未await读取的整次callback返回不释放占用，先等原工作后标unknown。已reserve后的明确晚失败记failed，次数不退款；取消、额度超时或结算不明仍保留原键／占用，不证明未消耗、rollback或可重发。丢结算应答若原行已terminal，沿原markUnknown保留那份证据，不反造占用或二次计费。定时器持续至settle结束，结束signal不可再借。**settle自身SQL／commit尾段仍只受截止与占用保护，不在pre-write实测中；SDK外层输出包装、provider构造及Resources／其他流量也不在本片口径内，不能称完整五分钟／MCP-04完成。** source不得重夺grant锁，预算SQL／原限额与目标切换算法不改，不用财务tokens／Gateway calls代替业务累计。新阶段和分次3/3、实际Core／SDK1/1、strict／声明与夹具边界见[记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录整次调用占用与活动边界2026-11-06)；旧[额度截止阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原额度截止传播2026-11-06)保留。

[既有宿主冒烟](../../tests/mcp-web-consent.test.cjs)已实际消费该适配，但原目标 / budget存储仍为明确替身；缺真正持久source时不能生产装配，也不能把接口和单次绿色当MCP-04完成，见[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段持久只读计量来源与结算适配2026-11-05)。原Task calls只计Gateway invocation，原桌面审计预览也不是MCP自动目标；真实目标与四类流量来源仍缺；具体只读预算仓储见下一节，已用native prepared SQL测试驱动定向验证原仓储，见[实库阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原仓储原生sql实库事务2026-11-06)；不是PrismaClient或生产目标装配。原Guard / ALS、字段release及发布独立必需。

### 原持久只读预算仓储

子出口`@rental-os/mcp-server/prisma-mcp-read-budget`提供[createPrismaMcpReadBudget](src/prisma-mcp-read-budget.ts)，具体实现上述生命周期所需的持久预算来源。必需原target source在同Native事务内只读定位已授权自动业务目标并持有原目标关联栅栏；不能从token / connection / Agent / client目标ID造目标，不能重新争抢外层业务authority的grant / 身份锁。缺source拒绝构造；源缺目标明确denied，不可读证据 / 未知commit为unavailable。此处只建立计量投影，不创建业务Task或改Gateway / 财务账。

唯一原goalId的不可变主体 / grant / scopes / purpose / 原输入hash / policy版本绑定与计量行不随新token、实例或修订重置；同键绑定变化拒绝。reserve在一次Serializable事务中以goal → call顺序保存次数、最多15秒的活跃预留及并发，CAS / 原callId唯一关联且commit确认后才允许reader；固定20次、300000ms、2并行只读。settle只释放实际完成的本次预留、累加实测活跃，failed仍保留调用次数；unknown不释放，不能凭迟到claim重结算。未知标记先单独完成只读定位事务，再锁goal / call：MySQL Serializable的普通SELECT亦可能加共享锁，不能在同事务反向锁call → goal。结算已持久化而应答丢失时保留原terminal证据，不二次计费或伪造新占用；持续失应答可能连unknown标记也未确认，但原reserved占用不清。存储只放必要绑定、输入 / 凭据hash和预留，不放token、模型正文或reader结果。

[独立SQL结构源码](mysql-read-budget-schema.sql)保留两份计量投影表，并追加下节原目标 / 调用关联表，包含唯一键、CHECK及RESTRICT关联，只在本树独立空库执行验证，未执行原API / 业务库迁移；原OAuth结构不改。[既有仓储冒烟](../../tests/mcp-mysql-store.test.cjs)仅新增一组预算行为，复用明确SQL替身，经strict / 声明 / 正式NodeNext执行新仓储与生命周期；[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段持久只读预算仓储与锁序2026-11-05)区分每次失败 / 通过。真实目标source、四类流量原事实分类、完整活跃时间口径 / unknown证据恢复、原操作索引及副作用限额仍缺，不提供公开goal管理、生产业务注册或权限豁免。原源码预算锁 / 结算及双连接已用真实native SQL定向验证，目标和驱动仍是明确夹具，不是PrismaClient / 真实目标 / 完整生产Host组合；不据本子功能宣称MCP-04完成。

### 原输入绑定的计量装配

子出口`@rental-os/mcp-server/prisma-mcp-read-accounting`提供[createPrismaMcpReadAccounting](src/prisma-mcp-read-accounting.ts)，将同一原数据库与必需的`OriginalMcpReadInputTargetSource`接到标准`readTools.accounting`槽。原目标作者在每次预算事务中取得原call引用、已捕获完整输入及同一Native句柄，可据输入定位原记录，不必反推inputHash。输入只是定位数据，client goalId / human / actor字段不授予目标或豁免；source必须按已有真实目标、输入关联和当前政策持锁复验，不得重新争抢外层grant / 身份锁。缺source拒绝构造，确认无目标denied，不可读或提交不明保持不可用 / unknown。

[共用captureMcpReadInput](src/persistent-read-accounting.ts)沿原普通JSON限制及稳定键序产生深冻结副本与同一SHA-256：每字符串最多2048字符、数组50项、完整输入32768 UTF-8字节，原生命周期亦复用它，旧hash语义不变。异步解析不会读到调用方后来改写的输入；原对象不冻结或改写，正文只在本次source调用内保留，不加入计量SQL或MCP返回。数据库 / source方法构造时固定，真实政策仍由source逐次读；每次调用的组合适配仍消费同一持久goal计量，重建或refresh不初始化额度，原reserve / settle / unknown算法和SQL不变。

此装配补原目标解析缺少输入的接点，不产生目标、四类分类、正式输入schema或字段许可，也不是完整业务reader接线。原Guard / 发布 / release仍独立必需，真实原目标生产者未供给时保持不可用；不得用该工厂、接口或测试goal替身宣称生产目标已接通。源码2/2与独立native SQL1/1分次验证原输入捕获、正式出口、同事务source和跨实例累计，见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原输入绑定的计量接点2026-11-06)及[实例收据](../../output/mcp-isolated-mysql-gOX5jK/receipt.json)；不是PrismaClient或生产目标证明。

### 原目标与调用的持久关联

子出口`@rental-os/mcp-server/prisma-mcp-read-bindings`提供[createPrismaMcpReadBindings](src/prisma-mcp-read-bindings.ts)。原目标作者必须供给同Native的`readExisting / locate / current / auditPublished`，同一原目录授权的请求内context可作为`subjects.current(call)`；没有真实已建立目标、原请求定位、当前政策或原审计，不提供默认实现。该模块不建Goal / Task、公开目标管理、执行器或新权限库。

原作者仅在自己的Serializable事务内调用`publishIn(originalGoalId, native, signal)`；readExisting前后复验已建立目标及当前作者证据，关联与原目标 / 审计由外层原owner一起提交或回滚。已有关联必须完整相同，精确重复不新增审计；不接受同键改owner、目标修订、用途 / 原输入或政策来重置计量。返回只是写入准备完成，不是commit收据；提交不明只沿原关联观察，不自动重做或换ID。metadata批次最多32项是快照的技术边界，独立于最多20次业务调用，发布不消耗或初始化预算。

将同实例`source`交[createPrismaMcpReadAccounting](src/prisma-mcp-read-accounting.ts)。它先比对捕获输入hash，再从原callback取得当前grant / 用户空间；原`locate`必须在同Native下按可信原请求关联定位唯一已存在目标，不从caller goalId、token / 连接、新client或最近行生成目标。持久键是原goal / grant / tool / input，合法不同原目标可有相同查询；每一目标仍由原预算唯一计量，不能因新调用ID / token或关联重建而重置。读取锁定关联并核对标量 / JSON / hash及当前owner / grant修订，再交原current复验目标 / 输入 / 政策，最终重验locator、主体与signal；缺关联是确认无目标，忙锁或证据不可读必须报不可用，不伪称已撤销。

[mcp_read_target_bindings结构](mysql-read-budget-schema.sql)仅存内部最少目标 / 主体与输入摘要，不存输入正文、token、动态权限或reader结果；缺表拒绝，没有自动建表、回填、清理或到期释放。关联锁用`FOR UPDATE NOWAIT`：原writer可能持有goal锁，而reader持关联等goal；writer遇冲突拒绝并由原事务回滚，不能等待成反序环或自动重试。外层grant / 身份锁不重新获取，原预算的goal → call及settle / unknown保持。

验证入口仍为[既有仓储组](../../tests/mcp-mysql-store.test.cjs)和[唯一隔离MySQL入口](../../tests/mcp-isolated-mysql.cjs)的`--native-stores`，不新增测试脚本或重跑插件Loader。完整阶段证据见[记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目标调用持久关联2026-11-06)。目标作者 / locator / current / 主体在验证中是明确夹具，不是生产目标创建、原请求分类或实际Guard；native prepared SQL不是PrismaClient。真实目标 / 分类 / 完整活动、正式字段及生产装配未齐，业务仍不发布。

原[PrismaOriginalRequestRepository.withCurrentInputIn](../../apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts)现提供同Native受权观察参与者：在原scope / owner行锁下复用当前creation-policy / resource / 身份、期限 / 撤销 / 关闭与hash核对，只交深冻结receipt / request / context及policy给metadata callback；回调后再读原行及当前权。外层原owner负责Serializable、commit / rollback / unknown，不创建请求 / Task、返回creationAllowed或执行许可。

准备事务须先提交，再进入独立预算事务，不能持原目标锁嵌套读取同一目标预算。真实MCP grant / 原请求 / 工具输入的locator、当前身份和原审计仍需生产供给，不能由Web token、Run lease或测试元数据代替。验证及I/O边界见[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段原请求同native受权观察2026-11-06)，不是公开MCP工具、生产装配或完整API-Prisma类型证明。

### 原首次目录目标作者与定位

[createOriginalMcpCatalogGoals](../../apps/api/src/modules/auth/original-mcp-catalog-goals.ts)复用原Auth／目录Guard的活动主体，配合正式子出口[createPrismaMcpCatalogGoals](src/prisma-mcp-catalog-goals.ts)、原bindings和[OperationLog](../../apps/api/src/common/operation-log.service.ts)建立初始持久目标及准确输入关联。[结构源码](mysql-catalog-goal-schema.sql)另列新增metadata表／所需索引，旧两份DDL不改，本片未执行。目标不是第二份Task／Run、grant或财务账；owner／空间frontier不含token、client、query或resource，goal UUID只由服务端首次生成，不选最近行或接受caller goalId。

[原catalog authority](../../apps/api/src/modules/auth/original-mcp-catalog-read-authority.ts)新增可选第七参数preparation：同原Auth Native保存目标／关联／审计并确认事务后，再以全新原权事务进入预算／读取；准备失败或unknown不进读、不自动重试。缺准备器保留旧路径，但不能当本首片前置已齐。将同一作者source交原input-aware accounting，预算事务只读已提交目标和原关联／audit，不再抢外围Auth／grant或创建新目标。当前Role／范围／grant绑定及计量政策hash逐次核对，字段释放仍是另一个必需生产者。

本初始作者只创建**首个目录frontier**：换查询／token／Host或重建适配器不变更原goal、首次输入或计量；换grant／client／范围／政策拒绝，不生成替代。旧本人任一grant的预算／关联存在、缺表／索引／audit／原行或忙锁均拒绝bootstrap，不回填／删除。20次／并发／活跃占用满后连业务准备的新关联metadata也不新增；unknown原占用不退款。合法下一目标现须由下节独立原Web采用参加者在已接受nonce决定、完整结算与原审计下建立；本初始作者本身**不自动轮换**。多工具／完整四类流量／活跃及正式发布前置仍缺，业务不开放。初始作者证据见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段首次目录持久目标作者2026-11-06)。

### 原目标Web控制面与宿主接入

子出口`@rental-os/mcp-server/catalog-goal-control-plane`提供[createMcpCatalogGoalControlPlane](src/catalog-goal-control-plane.ts)，以固定POST准备／决定／可选采用与GET原key收据路由原意图／采用仓储。共用原Web运输的no-store／完整JSON上限、超时与close；配置需原正式scope ceiling／tool scopes，不从UI或MCP客户端字段授予豁免。缺原authority时已声明路径返回不可用，不返回假成功；不启动HTTP监听或发布MCP管理工具。

[原API工厂](../../apps/api/src/modules/auth/original-mcp-catalog-goal-control-plane.ts)取**同一原Core**的store／grantAuthority，复用原Auth／catalog Guard、日志、独立目标适用验证与采用参加者。原[host](../../apps/api/src/modules/auth/original-mcp-host.ts)新增可选catalogGoal配置／原guard-verification来源：resource／enabled／scopes必须匹配原Core，唯一router接这些固定路径并共用close；未配置不注册，已配置但缺真实验证来源只不可用，不借OAuth同意验证或默认MFA补齐。

决定POST严格五字段（原key、nextInput、revision、decision、nonce），复用原有界流读取后转成原意图方法的四字段nonce表单，nextInput仍核原准备hash。收据GET只允许单个operationKey，验证后用固定已登记URL传原Web身份；actor、scope、重复key、未知字段、Cookie／跨来源、任意URL／方法拒绝，Web token不透传MCP资源服务器。采用不在GET发生，unknown不换key／nonce／UUID；超时响应不是回滚证明，close等待原工作而非仅HTTP响应。

[既有Web组](../../tests/mcp-web-consent.test.cjs)实际构造原host／Core并经fetch调用目标准备→决定→采用→原key收据，保留完整原Auth／Guard／预算／审计及旧意图／目录SDK组合；15.78秒定向3/3与必要strict／声明边界见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段目标web控制面与原宿主接入2026-11-06)。这是进程内原Request／Response和明确SQL／commit／MFA夹具，不是监听中的真实HTTP、浏览器／UI、生产Nest、真实数据库或字段发布验收。Host实际整体运行，但类型仅新目标工厂／owner整份及host目标装配精确片段，不称全Host／API-Prisma strict。

### 原目录目标关闭与可信采用

子出口`@rental-os/mcp-server/prisma-mcp-catalog-goal-adoptions`提供[createPrismaMcpCatalogGoalAdoptions](src/prisma-mcp-catalog-goal-adoptions.ts)，是原Web owner的同Native参加者，不自开／提交事务。必须已有原nonce决定、精确goal／输入hash与新鲜完整结算；缺预算／not_observed、reserved／unknown、缺调用、损坏或忙锁均拒绝，不凭TTL／20次／新token／断线生成新goal。当前只允许同一原owner／grant／client／scope／政策的目录目标转换，缺其他生产者不扩大用途。

原[意图工厂](src/prisma-mcp-catalog-goal-intents.ts)只有显式配置adoptEndpoint及真实[原API withTransition](../../apps/api/src/modules/auth/original-mcp-catalog-goal-intent-authority.ts)／同实例参加者时才接固定同源JSON POST；缺源不回退普通意图authority。POST核对原key／nextInput／revision2／原nonce，已接受意图或GET不自动采用。已有原采用收据只按独立当前Web owner读取，不生成第二UUID；缺收据不证明未提交或允许换键重做。普通withCurrent仍栅栏未变旧goal，专用withTransition须在当前grant／Auth／Guard／适用验证前后校验及原事务确认后，验证实际历史／收据／新frontier／旧结算。

在同一原事务内写原键采用收据、完整旧goal历史，再用ownerKey／旧goalId／recordHash CAS当前物化frontier，沿[原OperationLog](../../apps/api/src/common/operation-log.service.ts)记新目标admitted与稳定adopted事件，最后完整复验。goal UUID只由服务端当场生成，新goal首次输入为原已确认hash；原旧预算、全部call／binding／audit不删、不退款、不改零，unknown占用不解除。新goal首次业务读取仍由原catalog准备发布input关联及审计后进独立预算；采用本身不读业务／发模型，也不是订单选择／批准。

[独立结构源码](mysql-catalog-goal-adoption-schema.sql)追加两份原metadata表和RESTRICT原键关联，未执行，不重写旧DDL、自动回填或清理。`readHistoricalIn`只按精确原goalId／采用收据观察不可变metadata；Web原key收据只返closedGoalId／adoptedGoalId及`catalog_frontier_transition_not_business_completion`，不推定业务完成或当前仍可调用。当前指针再次转换不改旧收据；缺原history或audit拒绝、不补成功事件。生产可信UI／验证、Nest及完整分类／活跃／其他工具／副作用仍未齐，业务不开放。实际源码／原AS／Guard／预算／日志消费与3/3、strict声明／夹具边界见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录目标关闭与可信采用2026-11-06)。

### 原可信Web目录目标切换意图

子出口`@rental-os/mcp-server/prisma-mcp-catalog-goal-intents`提供[createPrismaMcpCatalogGoalIntents](src/prisma-mcp-catalog-goal-intents.ts)：固定同源JSON POST准备／决定、独立本人GET原键收据，以及内部已接受意图的受控观察callback。准备只存原goal／owner／会话、下一目录输入hash、当前政策及原期限，nonce只首次交可信Web、数据库只存摘要；重复／unknown不生成新nonce或延长期限。原键按user／tenant／workspace稳定定位，不接受caller goal／actor／人工豁免。输入使用shared原目录runtime和正式普通JSON capture，最多50条，未知字段／跨来源／Cookie／错误nonce／修订拒绝。

[原API意图authority](../../apps/api/src/modules/auth/original-mcp-catalog-goal-intent-authority.ts)先结束短原Web owner／目标定位事务，再在同一原store里按当前grant → 原Auth／目录Guard → 原goal进入实际意图事务；不造MCP资源token或借Web token代理工具，不重建角色／权限。必需原owner提供正式tool scopes和独立适用验证source，goal／grant／Web会话、完整Guard准入指纹及验证的原键／goal／输入hash／修订／期限前后核对；缺MFA或明确not_required的原政策证据拒绝。callback结束取消本地signal，不证明SQL回滚。

[原OperationLog](../../apps/api/src/common/operation-log.service.ts)与意图行同Native记prepared／accepted／denied稳定事件；完成事件还须原prepared事件存在，历史读取不补审计。原收据只沿独立当前Web owner读权，原OAuth新签发／grant停用、MFA变化或目录失权不自动删除历史；不返回nonce、grant、policy或输入hash。原source.withAccepted仍只观察同一原goal的已接受意图，明确`trusted_web_intent_not_goal_completion_or_adoption`；**这个观察callback不关闭／新建目标、更新指针、消耗意图或重置计量，不是订单选择／批准**，不能把缓存结果当永久采用许可。实际转换只走上节显式配置的独立adopt POST及原参加者／授权转换栅栏；真实可信UI／验证、Nest与完整生产组合仍未齐。

[新增独立结构源码](mysql-catalog-goal-intent-schema.sql)未执行，不修改原goal／预算DDL或自动建表。[既有Web组](../../tests/mcp-web-consent.test.cjs)实际运行原Web签名／session、OAuth同意／grant／token、原Auth／Guard／goal与日志及新意图仓储，验证原键unknown、失权／政策／nonce拒绝和历史零修补；适用验证、SQL锁／commit／真实人类UI仍是明确外部夹具。阶段与严格类型边界见[记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段原可信web目录目标切换意图2026-11-06)，不是生产目标采用或业务发布。

### 原目标完整调用结算观察

子出口`@rental-os/mcp-server/prisma-mcp-read-goal-settlement`提供[createPrismaMcpReadGoalSettlement](src/prisma-mcp-read-goal-settlement.ts)，只在原已授权作者的同一Native内核对既有目标、预算与全部原调用。原目标metadata由[共用captureOriginalMcpCatalogGoal](src/prisma-mcp-catalog-goals.ts)复用原行／hash校验，不复制相似DTO；原目标reader前后必须完全一致，传入goal不是调用方授权。原API[目标作者](../../apps/api/src/modules/auth/original-mcp-catalog-goals.ts)新增受控settlement.readIn，经私有owner callback核对当前call／完整输入／主体、同Native、原owner frontier及已存在准入audit；缺helper或证据拒绝，不补日志。

预算 → calls使用既有固定goal索引与NOWAIT，最多21行溢出哨兵，超过原20次拒绝而非截断。全部call必须与consumedCalls相等，原索引／JSON／hash／grant、唯一ID、连续消费序号、terminal实测活跃和reserved／unknown预留之和均与原预算一致；读后再核对原行，缺调用、损坏、忙锁或迟到变化拒绝。无预算且无调用是not_observed，计数保留null，不补零或证明未消耗；在途／unknown是pending，原占用保持；全terminal一致才settled。

结果只给必要内部goal／计量摘要及ledgerHash，明确`native_call_rows_not_commit_or_goal_completion_evidence`、retryable:false，不返完整调用或凭据／输入。**settled不证明外围Auth提交、外部交付或业务目标完成**；这不是目标关闭／新目标采用、额度重置、退款、重试或公开MCP工具。原目录采用参加者现仅在可信Web原意图和原权栅栏下消费这份新鲜结算证据；它不据结算自行宣布业务完成，完整活跃时间口径仍未实现。没有新DDL或事务owner，不修改原预算／关联／审计算法。验证入口仍为[既有SQL组](../../tests/mcp-mysql-store.test.cjs)，2/2与具名facade下原API整份strict／声明分别通过，SQL锁／commit与原grant仍为明确夹具，见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目标完整调用结算观察2026-11-06)。

### 原可用性 MCP 凭据授权

[createOriginalMcpAvailabilityReadAuthority](../../apps/api/src/modules/auth/original-mcp-availability-read-authority.ts)用同一原Core的store／grantAuthority，通过正式persistent access reader核对MCP资源专用token、当前grant／主体／client／resource／scopes／expiry，再沿原Auth和固定availability POST Guard进入私有owner Native。`requiredToolScopes`必须由原已批准能力作者显式供给且在原scope ceiling内，缺失／空／重复／未登记拒绝构造；本模块不自造生产scope或借catalog／order-view权。方法、scope绑定及原数据库owner构造时固定，当前原权仍逐次读。

完整普通JSON输入、原授权和tool／inputHash在await前固定，明细最多50；input／授权变化、错空间地点、失权／撤销、错误tool／client／subject／resource及Web token拒绝。已验证资源投影与含token的运输对象职责不同，只比较对应身份／scope字段；前后完整verified grant／revision／expiry仍复验。可选原availability preparation先在原Auth Native提交，确认后才以新原权事务读取；准备失败／unknown无第二读或自动重试。省略准备只提供授权桥，**不代表持久目标／预算或业务已就绪**，不能反用初始catalog frontier。

本片原调用callback只交内部当前Native，不提供reader／字段释放／目标创建、模型批准或新服务；可用性专属目标／输入发布／适用计量、正式wire／release／生产注册仍须对应作者供给。验证入口为[既有Web组](../../tests/mcp-web-consent.test.cjs)，实际同Core签发不同scope凭据并消费原grant／Auth／Guard／Native，准备端口是明确观察夹具，不是持久作者；SQL锁／commit／MFA仍未验证真实环境，详见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原可用性-mcp-凭据授权2026-11-06)。

### 原可用性Native事实读取

[createOriginalMcpAvailabilityResources](../../apps/api/src/modules/auth/original-mcp-availability-resources.ts)在原已授权callback内固定完整call／主体及普通JSON，复用原availability输入parser和shared请求／结果类型；MCP明细上限50，原API／Core的100条门不改。经[Guard固定availability POST桥](../../apps/api/src/common/api-auth.guard.ts)执行原order-create／operate权限及当前地点范围，不借目录GET或order-view权；原Auth／私有票据、scope和前后失权复验保持。输入／原事实仍是内部接点，不推定正式MCP wire或外发许可。

[Core.readAvailabilityInTransaction](../../apps/api/src/modules/rental-core/rental-core.service.ts)透传同一调用方Native到原配置页、原履约准入行锁和[库存快照](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts)的可选tx。复用原有界readAvailability正文与computeAvailability，不调用可能初始化的旧availability／state／factContext，不另算可用量或生成预占。每个实际delegate／raw SQL派发复验取消／身份，结束后fence失效；缺Native／当前operator／delegate拒绝，不回退全局。履约workspace／location／operator原锁保留，Native路径不另开ReadCommitted事务；旧非Native读继续原路径。

库存按原location／依赖商品读取完整有界事实，10,001溢出哨兵拒绝部分库存计算，不改为外发50条就截库存；原半开区间最大占用、历史缓冲／逾期、耗材全部有效预占、own资产及套装合并需求算法保持。**可用性不代表已预占／已下单**。可用性OAuth授权桥现由上节供给；原目标／输入发布／完整计量或正式wire／release／Nest消费者仍未接，不把初始catalog goal反用为availability目标；依赖不齐不注册业务。现有[主体定向组](../../tests/mcp-trusted-principal.test.cjs)执行原Auth／Guard／Core／配置／履约原SQL／库存／facts，SQL过滤／锁、Prisma／commit仍是明确夹具，不是真库。完整证据见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原可用性native事实读取2026-11-06)。

### 原目录Native事实读取

[createOriginalMcpCatalogResources](../../apps/api/src/modules/auth/original-mcp-catalog-resources.ts)在原授权callback内固定调用／主体和普通JSON输入，复用正式目录输入schema与原Auth／目录GET Guard，再沿[Core.listItemGroupsPageInTransaction](../../apps/api/src/modules/rental-core/rental-core.service.ts)及[配置仓储原分页](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)的可选Native参数执行实际有界查询。原空间前后核对、limit+1与套装关联上限、分页转换及configurationVersion算法保持；Native派发前复验取消／身份，不走全局client、state初始化或默认空间回退。原Core／API上限100保持，MCP接点独立最多50。

[原目录facts](../../apps/api/src/modules/ai-native/catalog-read-facts.service.ts)沿同一Native Core端口生成原封闭内部投影，仍保留原scope／观察时点／配置版本、partial和游标语义；条目不携带tenantId、attributes、描述或图片。仅受权空页才返回空，不补缓存商品、价格或库存。原显式readIn保留；read现沿[私有context.withReadNative](../../apps/api/src/modules/auth/original-mcp-read-context.ts)消费[原catalog authority](../../apps/api/src/modules/auth/original-mcp-catalog-read-authority.ts)当前持有的同一事务，调用方不再另传句柄。当前元数据仍不含Native，只有真实授权callback内的固定调用／signal匹配才可执行内部读回调；无owner Native、取消／结束／迟到返回拒绝，不自开事务或fallback。owner仍必须await全部读工作并负责提交／unknown，回调取消不证明SQL回滚。此接点不是原MCP reader生产注册，不建立首次目标／可信locator或批准字段外发。原[事实阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录native事实读取2026-11-06)及[owner消费阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录owner-native消费2026-11-06)分别记录类型、实际源码与离线AS／SDK组合和ORM／真库边界。

### 原请求Native统一参加者

[createOriginalMcpRequestParticipant](../../apps/api/src/modules/auth/original-mcp-request-participant.ts)在真实授权callback内组合原仓储saveIn、原Native authority和必需的原保存审计；saveIn不接受可省略的审计callback。原命令在await前捕获普通JSON，同Native原关联只进入一次，审计结束后仍核对当前主体与准备收据；漏审计／换Native／收据不符均拒绝。原键重放只核对同一原事件，不另造成功日志。

独立reconcileIn只转入原仓储Native历史读，不保存、重发、补日志或查询Task。缺记录仍不证明未提交，返回prepared／commit:not_observed或原行观察不代替原owner确认事务；失败须由owner回滚并核对unknown。原调用方仍必须提供可信命令映射、目标／调用关联、完整计量和提交栅栏。本内部参加者没有新目标、Task、预算或公开MCP／Nest消费者，首次catalog缺口保持。完整源码strict／声明与有限行为及替身边界见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原请求native统一参加者2026-11-06)。

### 原请求键的Native只读核对

[PrismaOriginalRequestRepository.reconcileIn](../../apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts)沿原命令／原requestKey和当前本人范围定位原行，不按query／最近行／caller goalId猜引用。原前驱与完整正文匹配算法同Web reconcile共用，Native必须原signal与真实current／read authority，无Web／global fallback。前后原行及当前读权核对，结果标明native_row_not_commit_or_execution_evidence；Task保持not_loaded，不查询全局Task或推定未执行。

缺记录仅not_observed／retryable:false，不证明未提交、未消耗或可换键。已过期／已关闭创建的原记录可以按独立当前历史读权核对，不恢复创建或有效期；擦除原文仍不可用。核对不保存、重发、写审计或初始化预算。Web reconcile的原Task收据消费者保持，Native读事务确认／unknown由原owner负责，也不能在独立budget source里重锁外围Auth／资源。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原请求键native只读核对2026-11-06)覆盖原引用恢复与缺项／失权、原保存与日志零写入，并区分精确strict方法与ORM／commit替身；这只补原键到原引用的Native读取，不是首次catalog可信call locator、目标发布／调用audit、真实DB或完整API-Prisma装配。

### 原请求保存的同Native审计

[createOriginalMcpRequestSaveAudit](../../apps/api/src/modules/auth/original-mcp-request-save-audit.ts)供原saveIn的association回调消费，只接受原仓储当场产生的receipt、活动Native及原signal。它复用正式captureMcpReadInput捕获普通JSON并拒绝getter，完整原receipt比对拒绝额外字段；按同一callback的主体／grant／scope核对，沿原withCurrentInputIn复验完整原行与当前creation政策，再调用[OperationLogService.recordOriginalMcpRequestSaveAudit](../../apps/api/src/common/operation-log.service.ts)。缺真实依赖拒绝，无Web／global、默认审计或新账本。

日志方法固定mcp.original-request.saved，原scope／owner／request与摘要须匹配；使用Prisma原存储枚举AiAudience.OPERATOR，而非wire的operator。原inputRef UUID就是这一次保存事件的稳定键：同键重放只核对相同日志，不换ID／覆盖事件或重记成功。只记录原引用、原键hash、版本／content／policy摘要及内部grant关联，不记录正文、凭据、URL、金额或完整角色。返回与回读必须匹配；失败由外层与原请求／关联一起回滚，unknown只沿原键观察，不自动重做。

这是原请求保存事件，不是完整目标建立／调用计量审计、Core执行或commit收据；原OAuth允许集及Web best-effort方法保持。原creator仍负责同Native当前权限／锁与确认提交，准备完成后才能进独立预算，不能在这里重锁外围grant或嵌套预算。[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原请求保存同native审计2026-11-06)区分实际原代码／精确strict方法与ORM／SQL／commit替身，未验真库、全API-Prisma、首次catalog作者／locator／目标发布及字段／Host生产装配。

### 原请求保存的Native参加者

[PrismaOriginalRequestRepository.saveIn](../../apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts)供原已授权作者在自己的Native事务内保存原三类scene请求及关联元数据。必需活动Native、原signal和Native authority；解析、owner／hash、前驱／同键、原写入与association共用原Web save算法。前驱和所有current／read／create用同一Native，缺源不回退构造时的Web authority／global DB，不开或提交事务，不创建Task／预算。

返回明确为prepared／commit:not_observed并内含原receipt，不可当Web已提交收据使用。关联后再读原行、复验当前政策及原期限；metadata不能改写原输入／政策／有效期。原Web save仍保留自有Serializable事务、P2002核对和提交unknown分支；Native唯一性竞态不自动全局回读或重放。外层作者负责coherent fences、原grant／身份、元数据失败整体回滚、确认commit后采用及原键unknown核对，不能在这里嵌套预算读取。

[原conversation.readAdmission](../../apps/api/src/modules/ai-native/conversation.repository.ts)可按当前本人精确conversationId／admissionKey取持久轮次的原inputRef；它不是最新行或query定位，现有读取也未改为MCP Native生产源。当前catalog context不带这个引用，原三类scene无首次catalog场景，原OAuth专用日志不覆盖业务目标audit；本片不补造这些依赖、不通过上层scene.create隐式建Task。[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原请求保存native参加者2026-11-06)区分实际原代码、具名ORM／commit替身与精确方法片段strict；不是完整MCP目标／locator／audit、实库或全API-Prisma装配。

### 原订单支付事实的Native来源

[原资源工厂](../../apps/api/src/modules/auth/original-mcp-order-status-resources.ts)的可选第十一参数originalPayments要求原PaymentRuntimeService的两份Native分页方法及[固定财务Guard](../../apps/api/src/common/api-auth.guard.ts)。withTrustedOrderPaymentRead只接原订单支付列表／指定支付单退款列表GET，复用原私有票据、权限／数据范围和读后复验，不由订单读权自动放行，不接refresh、支付／退款动作或任意URL。

[PaymentRuntimeService](../../apps/api/src/modules/integrations/payment.runtime.service.ts)共用原有界分页、requirePaymentIntent及原金额／状态投影。Native方法必须当前operator、精确tenant／workspace／order、活动Native／signal与owner生命周期，游标按原范围核对，实际委托派发前后复验；不读全局Prisma、支付配置／密钥、Provider或资金执行器。既有非Native分页、完整列表与所有支付／退款执行代码保持。

[原支付事实服务](../../apps/api/src/modules/ai-native/tools/order-payment-facts.service.ts)正文不改，只在原payments问题选择下消费这些Native端口；原20个intent、单退款页50及内部累计100的读取限制保持，不能当MCP外发50条／64 KiB门已验。原paid、verified_pending_funding映射为pending、funding_failed及accepted／funding_pending／succeeded语义保持，金额不聚合，实收／资金账本不补零。缺源／财务拒绝或坏证据是unavailable；受权空记录仍无计算总额。checkoutURL、Provider／商户引用、退款原因和message不进原最少投影。来源只供内部policy，未释放MCP结果或发布工具。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原订单支付事实native来源2026-11-06)说明实际原Guard／PaymentRuntime／准备服务执行、具名外部ORM及精确方法片段strict；真实数据库、完整API-Prisma、生产OAuth／grant同Native、原目标／locator／audit、字段／wire／Host和完整金融变体仍未验。

### 原订单检查记录的Native来源

[原订单资源工厂](../../apps/api/src/modules/auth/original-mcp-order-status-resources.ts)可通过可选第十参数originalInspections消费[Core.listInspectionsPageInTransaction](../../apps/api/src/modules/rental-core/rental-core.service.ts)。同一原订单Guard / Native下复用原订单读取和[原检查仓储](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts)的有界分页：原tenant / workspace / order、游标归属和limit+1查询，实际派发前复验signal / owner，页后再核对原订单。无global、配置初始化、当前模板或业务动作回退；旧status-only仍不读取检查。

[原检查事实服务](../../apps/api/src/modules/ai-native/tools/order-inspection-facts.service.ts)正文不改，仅由Native方法供给原端口。费用准备按原选择读取最多50条，保留原模板版本、检查 / 复核状态及partial / truncated / nextCursor，不将一页当全量。results、附件URL、operator和责任 / 结算推断不进入该投影，32 KiB内部字节及文本上限保持；缺source仍unavailable，受权空页仍明确partial。来源只供内部原policy，尚不是MCP字段释放或工具发布。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原订单检查记录native来源2026-11-06)区分实际Core / 仓储 / 原准备执行、精确方法片段strict及具名ORM / grant / 事务替身；未验证实库、完整API-Prisma、生产OAuth / 原目标 / locator / audit、字段 / wire / Host。历史报价来源保持，完整金融变体与发布前置仍缺；可选支付Native子源见上一节，不补零或执行下一步。

### 原关联报价的Native历史来源

[原订单资源工厂](../../apps/api/src/modules/auth/original-mcp-order-status-resources.ts)可通过可选第九参数originalQuotes消费[BusinessService.readQuoteInTransaction](../../apps/api/src/modules/rental-core/rental-business.service.ts)。它共用原精确quote事实核对、原仓储Native / workspace与原领域投影，不读当前计价、构造BusinessContext、更新缓存或创建报价。无source仍保持not_loaded，不给默认成功。

[AiNativeOrderSavedQuoteSource](../../apps/api/src/modules/ai-native/tools/order-saved-quote.source.ts)在原固定订单Guard内读取原订单quoteId，Native查询报价后再完整核对原订单；原历史reader继续校验版本并投影原快照。缺报价missing、错版本不返回历史事实；过期或已消费仍是可核对的原历史，不是重新报价或业务执行许可。现有Web source及legacy loadQuote Native缓存行为保持。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原关联报价native历史来源2026-11-06)区分实际原方法 / 新源与具名type facade、ORM / grant / 事务替身；不证明真实数据库锁、生产OAuth / 目标 / 字段或MCP发布。原报价正文仅供内部原历史投影，字段释放和计量前置不省略。

### 原订单问题的Native资源消费

同一[原Native资源文件](../../apps/api/src/modules/auth/original-mcp-order-status-resources.ts)现提供createOriginalMcpOrderResources，供原请求policy消费order_explanation的status / fees / payments / next_steps。它与原status-only工厂共用真实Auth / 订单GET Guard / Native Core与原facts / preparation；旧createOriginalMcpOrderStatusResources仍只接受status，不扩大旧宿主。问题走原请求校验，其他scene或任意refund问题拒绝；固定原映射 / scopes、当前主体 / 原scope / signal和Native限制保持。

fees只读原订单关联历史，不用当前配置补quote / rule / price，原缺项 / references_only / complete:false保持；请求检查但缺source为unavailable。payments没有专用金融source时保持unavailable / 无value，实收 / funding仍not_loaded，不补零或推定未支付。next_steps仍是原不可执行候选，allowedActions unavailable，不授动作权。资源工厂只返内部context，原材料不作为MCP输出；字段 / 目标计量及真实生产前置不省略。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原订单问题native资源消费2026-11-06)验证实际原准备方法、原快照与缺项、版本变化拒绝和旧入口范围。外部ORM / grant / plan / 事务仍为明确替身，其他scene与专用证据、生产order OAuth / grant同Native、目标 / locator / audit / 字段 / Host未闭合，不称生产业务开放或完整API-Prisma / 实库验收。

### 原订单状态的Native资源授权

原私有[createOriginalMcpOrderStatusResources](../../apps/api/src/modules/auth/original-mcp-order-status-resources.ts)可作为下述MCP请求authority的authorizeResourcesIn，只供原order_explanation / status。原固定order.explain映射与owner正式工具scopes必须匹配原call；不从名称猜scope或用测试scope当生产批准。缺当前callback / Native / 权限、其他问题 / scene直接拒绝，不以catalog权限读订单。

源沿同Native原Auth / opaque ticket → [固定订单GET Guard](../../apps/api/src/common/api-auth.guard.ts) / ALS → [Core.getOrderInTransaction](../../apps/api/src/modules/rental-core/rental-core.service.ts) → 原FactRepository / 原订单facts / explanation / preparation检查。Core复用原范围SQL / 原聚合与publicOrder，不触发state / 配置初始化、默认空间、锁 / lease或写入；实际delegate派发前复验取消 / identity / callback。状态源只返回最少内部context给原policy，绝不输出全订单、金额、个人资料或凭据，不注册MCP / HTTP或生成业务执行权。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原订单状态native资源授权2026-11-06)明确实际原业务方法执行、具名外部type facade / 精确Core方法片段与ORM / grant / plan / 事务替身。其他Native资源、生产order OAuth / grant同事务、原目标 / locator / audit、字段 / wire及Host仍缺，不能以此子源或测试状态证明整项接通；原实库I/O失败保持。

### 原请求同Native政策与仓储消费

原API私有[createOriginalMcpRequestAuthority](../../apps/api/src/modules/auth/original-mcp-request-authority.ts)在原Guard callback内固定原call / 完整主体，实际组合下述scope.currentIn、原订阅readIn及原[请求authority](../../apps/api/src/modules/ai-native/task-request/original-request.authority.ts)共用算法。原scene规则、权限 / 资源前后身份核对、plan / entitlement与policyHash不复制；Native计划行只按原scopeId / sceneCode / sceneVersion读取，慢资源跨原期限拒绝。真实Native资源authorizer必须显式供给，catalog Guard、scope观察或接口存在均不替代它；缺源拒绝，无Web / global client / 嵌套事务回退。

将该实例作为原withCurrentInputIn的内部第五参数：在同一调用方Native / signal绑定current / create，原checked / 原行栅栏 / metadata participant及前后政策复验共用；同步assertCurrent防止callback结束后继续锁 / 查询原行。省略第五参数保留原Web authority且不证明其其他查询同事务，坏Native绑定不fallback。原owner仍负责Serializable、grant / 身份与政策栅栏、锁顺序、最终采用及commit / unknown；返回不是执行许可或提交收据。不会创建scope / 请求 / Goal / Task、计量预留或发布MCP工具。

[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段原请求同native政策与仓储消费2026-11-06)执行实际原Guard / scope / SubscriptionService / 请求政策和仓储；资源authorizer与ORM / 事务为明确facade，类型也是具名外部声明，不是完整API-Prisma或真实SQL / Core证据。真实Native资源、原请求locator / 首次目标 / 原审计及grant同事务生产装配仍待原owner接通；原实库I/O失败边界保持，业务仍不开放。

### 原MCP主体到canonical请求scope的同Native接点

原API私有[createOriginalMcpRequestScopeSource](../../apps/api/src/modules/auth/original-mcp-request-scope.ts)消费同一原catalog Guard回调内的context.current(call)，从原user / tenant / workspace / 当前数据与地点范围构造原AiExecutionContext，再把调用方Native交原AiScopeRepository。原canonical scopeKey、既有行匹配、原上下文校验和投影规则全部复用；只查既有scope，不创建scope、请求 / Task / 目标或提供第二角色库。

原call / 授权元组以普通data descriptor快照捕获，拒绝getter / 未知字段；原issuer subject不猜成userId，token只供本次私有context匹配，不存储或返回。当前方法构造时固定，真实subject逐次读取并比对含grant修订的完整事实。查询派发前、读后及返回前复验原callback / signal / subject，避免当前身份await期间callback结束后仍启动读取；已派发读取迟到则不返回scope metadata。调用方仍负责原grant / 身份锁、coherent隔离、当前业务policy及最终采用 / commit / unknown，不在本接点二次获取grant。

currentIn只返回深冻结原scopeId / context；它不是原请求locator、policy批准、执行许可或MCP响应，不向模型开放。缺当前原callback、Native / canonical scope、错行 / 修订 / 范围或取消保持unavailable，无Web token / 全局client / 默认scope回退。验证边界见[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段原mcp主体同native请求scope接点2026-11-06)，实际Prisma / 数据库和完整原请求policy装配仍需另有证据。

### 原订阅权益的同Native观察接点

原[PrismaSubscriptionBudgetReader.readIn](../../apps/api/src/modules/ai-native/budget/prisma-subscription-budget-reader.ts)可在调用方活动Native内读取原SubscriptionService的当前term / feature / tenant-grant投影和账期边界；不另开事务、不新增角色、计价、预算预留或计数。原`read()`仍使用RepeatableRead / maxWait2500 / timeout5000并在事务完成后复验失效时点，两条入口共用同一原投影算法。

`readIn(tenantId, featureCode, native, signal)`只供原可信作者，参数不是授权。调用方负责原当前身份、租户绑定、coherent isolation / 行栅栏及最终采用 / 提交复验；不在此重新夺取grant / 身份 / 目录锁。原公开结果仍只有revision和所需feature的available，不返回内部期限、价格、备注或凭据。全局client、缺Native或已取消拒绝，异步观察后复验取消与原订阅 / 计划边界；available或返回完成不表示commit收据、永久许可或业务已执行。

此接点不自动接通AiCurrentOriginalRequestAuthority、MCP首次目标 / locator / current / 原审计，不提供默认恒真source或新的MCP工具。阶段与实际验证边界见[原权益阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原订阅权益同native观察接点2026-11-06)；真实Prisma driver / 生产Guard / API注册及新实库行为仍须对应证据，不能以源码或facade类型代替。

### 原目录结果的公共运行时校验

`@rental-os/shared`正式根出口的`aiCatalogReadProjectionSchema`校验原有界目录reader的完整内部结果；原API兼容再导出同一实例，并在返回前实际消费该schema。字段仍为原request / workspace / 观察时间、item投影、分页和持久配置证据，不新增tenantId到item、actor / permissions或业务字段。

它保持原API最多100条，检查原item字符限制、唯一ID / code及ASCII ID顺序、truncated与末项游标 / null、64位配置hash及persisted source，观察时间按原有限Date的canonical ISO接受（含扩展年份）。requestId保持原字符串契约。原reader仍核对当前授权、输入过滤 / 页上限、Core tenant及配置关联；结构校验不证明这些事实，也不是普通JSON安全捕获、完整MCP wire schema、字段 / 接收端释放政策或工具发布。MCP独立50条 / 2,000字符 / 64 KiB限制、原Guard、持久目标及release仍必需，缺前置不开放。

类型 / 运行时消费者与阶段证据见[目录结果阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录结果公共运行时校验2026-11-06)。包版本仍为未发布的0.1.0源码 / 本树隔离产物，不覆盖公共shared/dist或继承API / Host整体验收。

### 原调用键只读计量核对

子出口`@rental-os/mcp-server/prisma-mcp-read-receipt`提供[createPrismaMcpReadReceiptStore](src/prisma-mcp-read-receipt.ts)。原grant Web控面可配置`readCallReceiptEndpoint`／`readCallListEndpoint`，经[原API工厂](../../apps/api/src/modules/auth/original-mcp-grant-control-plane.ts)每请求原Web身份及[原host](../../apps/api/src/modules/auth/original-mcp-host.ts)同仓储路由；未配置不注册。已声明路径须显式供给`receiptTraffic.forRequest`原独立读取政策源，缺源只使这两路503，不借新grant／MFA或无条件默认限额，不影响原治理摘要／撤销。reader第五参数原ratePolicy可给历史内部消费者保留旧直读，但未接独立限流的legacy不能成为这两条公开Web路径的供给。它不是MCP工具、第二业务API或自动恢复入口，MCP token、actor／scope／human字段、Cookie、跨来源或POST不能授权核对。

仅当前原owner可读，租户grant管理权不自动取得他人call收据。先在短事务完成当前grant / owner及原call定位，再在独立事务按grant / 当前原身份 → goal → call核对；读取后再完整比对行与grant，最后复验当前原Web读权，不能把定位键或过期OAuth许可当授权。目标、调用索引 / hash绑定、完整预留和状态共用原[计量仓储校验](src/prisma-mcp-read-budget.ts)，历史验证用真实grant身份，不造假token。生命周期仍独立核对原call输入hash / credential绑定，不因历史reader复用元数据校验而放宽持有者检查。

返回只有原callId / goalId、`callsConsumed`、`reserved / unknown / returned / failed`计量状态及本次`held / settled`活跃时间；不放token、subject、输入hash / 正文、业务结果或目标额度全量。returned仅表示callback计量结算，不证明MCP结果最终通过投影 / 权限 / 交付，也不证明业务提交。not_observed不证明没有执行 / 消耗，retryable恒为false。核对不执行reserve / settle / markUnknown、写审计 / 观察或清除占用；原grant撤销 / 到期后仍需独立当前Web owner读权，历史不因新签发停用而消失。

可选`readCallListEndpoint`固定GET按原grant分页读取本人计量调用引用，每页1～20条；索引`(grantId, callId)`最多读取limit+1，短定位事务结束后按稳定goal → call顺序核验完整绑定并复验当前Web本人读权。游标仅是位置，不授予读权；callId按ASCII排序而非时间，翻页不是完整历史快照，空页不证明未执行。返回的callId可交上述精确收据核对，不提供自动重发或释放占用。

独立收据类在首个Native内完成当前原Web本人／grant验证及输入／游标核验后，仅消费一次[原class率桶](src/original-traffic-meter.ts)，再定位／核对；第二核验事务不双计。读取源的queryHash绑定固定exact_call／call_index、原grant／修订、本人空间及已解析原键／页位置；它只证实正在做这次原键查询，**不证明call／收据存在、已执行、已提交或已解除unknown**。原政策源只提供批准的限额／窗口／Unix秒期，不能提交evidence或client人工声明；真实读取源生成临时查询事实，不新增验证／批准系统。缺政策／桶表／计数或超限拒绝，丢首个事务应答可能已计原率桶，不退款／自动重查；业务预算／call／审计／最近使用零写入，撤销后仍经独立当前Web本人读权核对。实际源码1/1与受影响原宿主／Web1/1、必要strict／精确宿主类型及夹具边界见[本阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原本人收据独立分类限流2026-11-06)。

[结构源码](mysql-read-budget-schema.sql)为目标和调用增加grant标量、复合关联与分页索引，尚未执行DDL或迁移；旧表缺列时不可用，不自动回填或扫描JSON。[阶段记录](../../docs/MCP服务/MCP服务-开发记录.md#阶段本人原调用计量索引2026-11-05)记录离线验证及边界：SQL / 原目标为明确替身，API为transpileOnly，不是真MySQL或完整API-Prisma证明。此索引不是提交前业务原键 / Core收据或完整恢复；真实自动目标关联、四类流量限流、完整活跃口径、生产注册及可信UI / Harness消费仍缺。

### 原固定目录授权适配

[createOriginalMcpCatalogReadAuthority](../../apps/api/src/modules/auth/original-mcp-catalog-read-authority.ts)只为正式映射的rental.catalog.search供给McpReadAuthority，不接受其他运输名或任意URL / Web凭据代理。原access / family / 当前grant在同一Native事务内与输入的subject / client / resource / scopes核对，实际limit必须为自有数值字段1～50，再由原Auth / 固定catalog GET Guard建立当前ALS / 地点和数据范围；原权限及完整凭据关联在读后复验，错误不回显内部正文。

原宿主可显式供给同一[createOriginalMcpCatalogReadContext](../../apps/api/src/modules/auth/original-mcp-read-context.ts)实例作为第六参数。适配在异步授权前固定输入hash / 凭据绑定，只有原Guard的真实consume回调才发布已确认的grantId / revision与原用户 / tenant / workspace / audience / permissions / dataScope / locationScope给内部目标source；不重查或争抢grant锁。原接口省略context时保持旧回调，无主体读取能力；配置context却缺共用输入capture出口则拒绝构造。

context.current(call)只在该实例、当前callback、原输入 / 工具 / 凭据匹配且signal有效时返回深冻结的最少原事实，回调完成 / 失败、取消以及继承ALS的迟到子操作均不可再读；无current callback或其他实例不回退全局身份。没有token、operationToken、输入正文或Native句柄，也不入模型 / SQL / 恢复存储；这些事实不是可重用许可，原目标 / 分类 / 字段生产者及业务授权仍必需。原SDK / Auth / Guard到预算source消费以及串请求、取消 / 结束后的拒绝已定向1/1通过，见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段请求内可信只读主体接点2026-11-06)；SQL / 原目标仍为明确替身，不能称生产目标或完整API类型已齐。

此适配不决定完整输入schema、原reader、目标计量或字段release，也不注册业务。原内部目录schema允许100，但本MCP适用上限为50；不改原schema迁就外部调用。实际宿主 / 官方SDK主链已消费该生产适配和正式MCP / shared映射，非目录名、超限、错主体及读后失权拒绝，见[阶段证据](../../docs/MCP服务/MCP服务-开发记录.md#阶段固定目录原授权适配2026-11-05)。业务reader / 发布计量释放、SQL / session / 验证 / commit为明确替身，API为transpileOnly；未验完整API / 真实DB或目录字段发布。

原[目录输入校验器及结果类型](../shared/src/ai-catalog-read.ts)已从`@rental-os/shared`[正式出口](../shared/src/index.ts)提供。原[AiCatalogReadFactsService](../../apps/api/src/modules/ai-native/catalog-read-facts.service.ts)直接复用，并为已有API-local调用方再导出同一实例 / 类型；没有私有同名协议或深层shared源码导入。原输入limit1～100、ID、name trim / 长度及strict未知字段拒绝保持，MCP原授权仍独立上限50；原结果字段、版本、scope / observedAt / 配置证据及Core投影逻辑不改。公开类型不是字段释放许可或完整MCP输出schema。

[既有原主体冒烟](../../tests/mcp-trusted-principal.test.cjs)已从隔离shared正式产物经NodeNext ESM消费输入校验和结果声明，验证API兼容再导出为同一runtime，原Guard / ALS到Core-port读取仍保留原投影 / 拒绝，见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原目录公共运行时接点2026-11-06)。shared strict / 声明通过；API为原源码transpileOnly，SQL / current / Nest与Core-port为明确外部夹具，未证明生产目录、全API-Prisma或真实DB。Harness对原schema的不支持仍拒绝，不裁剪min/max / pattern；生产目标、字段 / 目的地释放及工具版本 / 完整输入输出schema尚未齐，不注册业务。

### 固定业务能力运输映射

子出口`@rental-os/mcp-server/capability-mapping`提供[映射表与只读构造器](src/capability-mapping.ts)，根运输不自动导入shared或注册业务。`rental-mcp-capability-map-1`只版本化运输映射，不代替原schema、能力、字段政策或grant版本。七项原码从shared公开出口核对，目录 / 可用性 / 已选客户结果 / 原订单事实对应固定下划线名称及原R0；报价`preview`映射为quote_save，报价 / 提案保存为原R1，批准后建单为原R2，三者不能经只读构造器发布。风险类型复用shared的AiRisk，等级依据原AI Native R04 / R05及MCP R04 / R07，测试与原baseline核对；标签不代替当前权限或就绪状态。原工具版本不能用映射版本或历史baseline版本填造，仍由实际生产者供给。选择结果读取不包含个人候选查询；映射不扩大原首批清单。

`createMappedBusinessRead`只接受四项原只读码，由原作者显式给出闭合schema、说明与无副作用reader，再交原注册器处理权限 / 持久计量 / release。构造捕获schema副本和原reader方法，不运行reader、不安装HTTP或发模型；未知码、原写入码和直接运输名都拒绝。映射存在不等于生产者ready；原目录输入运行时与结果类型已由shared正式出口供给，完整MCP输入 / 输出schema、正式字段与生产身份、持久目标仍缺，不能用测试schema或旧human_preview / not_sent填空开放。

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

原`accounting.withRead`可将原剩余额度信号传给callback；注册层与原endpoint / 协议请求信号相交，同一收紧信号交reader和release，不能用provider新信号延长请求。未传信号的旧provider保留原请求取消，不因此获得独立额度保证。额度超时后的迟到reader不进入release，迟到release不返正文；原持久计量源仍负责unknown占用与实际结算，注册层不创建目标、清占用或自动重发。当前Resources的真实目标 / 四类分类生产者仍缺。原host / 官方SDK进程内证据见[本阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段resources原额度截止传播2026-11-06)，不是实际用户安装或生产业务发布。

说明和正文固定`text/plain`，包含`Rental OS resource (版本)`归属后整体最多2,000字符；不是HTML、二进制、任意文件或模型批准。完整响应仍受15秒 / 65,536 UTF-8字节限制，50项分别合规也不能超整包。现代协议通过官方SDK输出`ttlMs: 0 / cacheScope: private`，连续默认read仍重查当前权限；旧代次不混入现代字段。空 / 省略cursor只读完整有界目录，非空cursor拒绝；`resources/templates/list`为空，不声明订阅 / listChanged / 通知，不产生新的执行或刷新许可。

[两代SDK验证](../../tests/mcp-foundation.test.cjs)覆盖源码及正式编译包 / 公共类型，匿名零目录读取、精确URI、原权限 / 计量顺序、拒权零reader、撤回 / 版本 / 主体变化、零TTL、缺投影 / getter、50与51项、2,000字符及整包超限、取消 / 关闭后的迟到拒绝。原providers仍为外部夹具，不是生产字段、Guard / ALS或持久计量验收。原Harness插件已通过同一私有连接显式列目录 / 按名称选择资源，沿原maintenance / inbox / Loop提交有来源文本；精确Agent / Session、取消 / 断开 / 重载 / 模型服务移除及来源重建后的材料检查见[既有组合](../../tests/harness-plugin.test.cjs)。未注册原`mcpResources.register`继承式provider或第二份Tools；模型自主资源访问、最终Provider线包 / 目的地及全部重放仍未验，不用Resources包装规避已有Tools schema拒绝。

## 真实隔离MySQL验证入口

[独立实例冒烟](../../tests/mcp-isolated-mysql.cjs)仅在明确授权后显式执行；复用本机已安装MySQL 8.4，不下载 / 安装、不读`.env`或用户MySQL默认配置、不dump或连接原业务库。每次在本树新建datadir及空测试库，禁用MySQL自带monitor后由受控子进程启动，原进程PID / loopback端口 / 实际datadir和库名核对后才执行SQL；原Node离线守卫保留。父测试退出由stdin监督停止自己的子进程，不搜索或停止系统服务，不删除旧现场。

默认DDL模式只在本次库应用两份MCP结构源码，核验真实InnoDB约束、外键、计量行和事务回滚 / 结算。该模式的SQL目标及身份是明确夹具，不证明TypeScript仓储 / Prisma driver、业务Auth / MFA或生产迁移 / 注册已接通。失败日志、实例目录及收据保留，按原阶段证据收口，不把目录存在或初始化完成当作通过。当前真实MySQL 8.4.8已验证25表 / 原索引、预算约束 / 外键及单客户端事务，最终1/1与此前八次失败分开，见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段真实独立mysql结构与约束2026-11-06)及[实例收据](../../output/mcp-isolated-mysql-6eTqCq/receipt.json)。临时ASCII junction仅用于避免Windows路径编码问题，物理数据留本树；正常退出后只移除本次别名。

显式`--native-stores`模式将原OAuth / read-budget仓储及实际依赖闭包编译到本次隔离目录，从正式NodeNext出口消费，再通过[原生SQL测试驱动](../../tests/helpers/mcp-native-sql.cjs)执行。每个事务是独立mysql客户端连接；使用真实PREPARE及参数、Serializable / FOR UPDATE / COMMIT / ROLLBACK，不用本地队列模拟跨连接锁。只将原SELECT的裸列投影包装为服务端JSON以保留实际字段类型，原WHERE / 锁不改，未知语句拒绝；错误与完成标记共用有界日志，不自动重试。新增的审计 / 目标行仅为本次空库测试夹具，不是生产登录、同意、目标或四类分类；本模式也不是PrismaClient / engine验证，不安装或生成共享client。实际编译仓储的双实例码 / refresh竞争、审计回滚、预算并发及跨store结算 / unknown保持已定向1/1通过，首个驱动语法失败分开保留，见[阶段](../../docs/MCP服务/MCP服务-开发记录.md#阶段原仓储原生sql实库事务2026-11-06)、[实例收据](../../output/mcp-isolated-mysql-G1SlwT/receipt.json)和[编译范围](../../output/mcp-isolated-mysql-G1SlwT/store-build/scope.json)。

## 依赖和消费边界

声明`@modelcontextprotocol/server` 2.2.0、TypeScript 6.0.3及Node类型22.20.1，来源是本树已安装版本的实际声明与行为。**本包尚未安装依赖或更新根锁文件**，不声称当前根`npm ci` / 工作区构建就绪。源码只按包出口导入，不依赖Harness私有目录。原对话结果子出口另声明`@rental-os/shared`0.1.0可选peer；使用该子出口时必需，根运输不依赖它加载。版本号相同不证明schema产物已同步，实际组合须核对源码 / 声明和运行时。

测试仅用本树Harness已有SDK安装进行进程内装配，没有复制依赖、改锁、打开端口或发HTTP。当前源码还严格编译到独立output，NodeNext消费者从实际包manifest出口读取声明并加载编译产物，真实两代SDK完成认证 / 发现 / synthetic只读调用及释放投影；这是隔离产物消费，不是root安装、tarball分发或生产业务验收。生产接线须先在获准依赖工作中建立本包正式依赖 / 产物，并由原身份作者补全当前OAuth / grant及Guard / ALS，不把测试synthetic verifier放入生产。

## 下一接点

1. MCP-02：原身份OAuth / grant、后台准入和当前权限生产者；不能使用Web token替代MCP资源身份。
2. MCP-04 / 05：持久目标准入、原计量 / 收据和明确字段释放政策。
3. MCP-06：经过上述门槛再消费原有界目录reader、注册工具；未齐不注册，不提供假数据。

正式范围见[需求](../../docs/MCP服务/MCP服务-需求.md)，阶段命令与证据见[开发记录](../../docs/MCP服务/MCP服务-开发记录.md)。当前离线入口是`tests/mcp-foundation.test.cjs`，须按根AGENTS的offline preload、固定无效DATABASE_URL及绝对audit / TEMP运行；不是无条件可执行的安装或启动说明。
