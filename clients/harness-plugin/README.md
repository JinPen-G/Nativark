# Rental OS Harness 插件

本目录提供原版Harness的独立MCP连接Bundle，不替换保留的`clients/agent-desktop/`。当前可显式发起标准OAuth登录，私有内存持有短期凭据，并通过原公开MCP工具桥消费服务端已发布只读工具；**尚无生产业务工具发布，也未与真实Rental OAuth服务联调**。原个人聊天与模型配置不受影响。

## 已接入的宿主机制

- [package.json](package.json)声明`dsh.bundle.patch`及真实`.`入口；[cordis.patch.yml](cordis.patch.yml)插入`rental-os`插件行，不修改原模型、聊天、Electron或其他插件配置。
- [Host入口](src/index.ts)仅导出`name / inject / Config / apply`，注入原`commands`服务，通过Schemastery校验配置；没有混用default export。
- Cordis与`dsh-commands`以peer共享宿主实例。当前只声明核对过的`dsh 0.2.1-rc.2`；不兼容版本由原profile预检拒绝，不承诺其他版本。
- 新增`/rental`人类命令；默认不注册业务Tools、不启动模型或自动联网。明确配置只读名称并登录后，复用原MCP工具桥 / ToolRuntime为原Agent提供服务端已发布工具，不新增native同名业务通路或固定业务页。

| 命令 | 当前行为 |
| --- | --- |
| `/rental`、`/rental status` | 显示是否配置地址；不进行网络请求，也不声称连接或授权有效 |
| `/rental check` | 未登录时无凭据发现；已连接时用现代协议`server/discover`复核同一连接，必要时先单次刷新，不执行业务 |
| `/rental oauth-check` | 核对资源发现与授权服务器的标准元数据、可信端点、S256和所需scope；不打开浏览器、不交换令牌，兼容声明不等于客户端已登记 |
| `/rental login` | 显式启用后打开系统浏览器，经配置选择的本机Host路由或临时数字loopback监听器接收一次性回调，授权码 / S256交换后完成MCP握手；只绑定发起命令的原会话 |
| `/rental disconnect` | 先停止本地新请求、清除凭据，再向精确撤销端点发送一次请求；服务器接受请求不等于整个grant已独立核实撤销 |
| `/rental prompts` | 显式配置后查看当前会话获准且位于本地名称白名单的模板及版本；不读模板正文、不启动模型 |
| `/rental prompt <名称>` | 人主动选择一个当前模板；原Agent空闲时读取版本化正文，提交为原用户消息并启动自配模型，费用照常；不是业务授权或模型完成证明 |
| 其他参数 / 附件 | 拒绝；命令原始参数不写`command/run`，避免误粘贴凭据进入这份日志。适配器在命令分派之前的输入留存不由本插件保证 |

一次插件实例最多一个检查；重复发起返回忙碌状态。请求同时受命令取消、插件卸载和配置截止控制。重载重新注册一份命令，不自动复查；卸载先移除命令、取消并等待本片有界操作，迟到响应不能继续发现或取得授权。第三方插件配置错误只令该插件失败，原Harness继续运行；原Loader报告错误，不伪装加载成功。

## 配置

Bundle默认只设中文，无部署地址、token或自动请求。配置可覆盖同一`rental-os`行的整个`config`；Harness patch不是逐键深度合并。

```yaml
- id: rental-os
  config:
    language: zh-CN
    connection:
      resourceUrl: https://mcp.example.invalid/mcp
      authorizationServerUrl: https://auth.example.invalid/
      timeoutMs: 5000
      maxMetadataBytes: 16384
```

这是离线夹具地址格式，不是已部署服务。`connection`整体省略时明确未配置；填写后两个地址均必需。只接受无凭据、query、fragment及well-known路径的HTTPS地址。语言仅`zh-CN / en`；超时1～60000毫秒，元数据上限1～65536字节，未填分别为5000 / 16384。未知配置字段拒绝，不接受token、headers或模型Key。

[发现实现](src/connection.ts)只无凭据POST配置资源、读取标准401挑战，再用官方SDK读取一个精确RFC9728地址；校验resource、预期issuer及header凭据方式，禁止跳转和额外回退，元数据声明及实际流均有界。结果是`authorization_required`，不是认证成功。HTTP适配必须实际遵守取消和redirect限制；一个不合作的底层请求是否已停止，不由“停止等待”推定。

### OAuth前置核验

配置中的可选`oauth`对象要求`clientId`、`redirectUri`、`scopes`和三个精确可信地址`authorizationEndpoint / tokenEndpoint / revocationEndpoint`，不接受client secret。它与`connection`同时配置；地址和client ID应由服务管理员提供，不能从模型或不可信发现信息反向写入配置。

[OAuth核验](src/oauth-discovery.ts)只在显式命令时读取配置issuer的RFC8414元数据；仅404允许回退其标准OIDC发现路径，每个地址最多一次，全部读取共用原检查截止。没有根issuer回退、跨issuer发现、重定向或错误重试。每份元数据复用[有界流读取](src/discovery-response.ts)，官方SDK解析后再次精确比较issuer、三个端点、授权码、S256、public client的`none`认证以及scope。OIDC解析不保留的撤销扩展从同一有界原文验证，不信任任意附加字段。

`redirectUri`仅接受规范化且无query / fragment / 凭据的HTTPS地址，或数字loopback `127.0.0.1 / [::1]` HTTP；不接受`localhost`、自定义scheme或通配。此处只检查配置格式，不监听端口、不核实回调归属或远端登记。scopes为1～32个互异的合法OAuth scope，每个最长128字符；client ID为1～200个可打印ASCII字符。成功反馈不返回原元数据、端点或client ID，不产生PKCE verifier / 授权码 / token。

### 进程内登录适配

可选`login`对象必须明确给出`enabled`、`attemptTimeoutMs`（1～600000）、`sessionLifetimeMs`（1～28800000）、`maxAccessTtlSeconds`（1～900）和`callbackMode`（`host / loopback`），并完整配置`connection / oauth`。默认Bundle不提供此对象、不启用登录。此处限制是本地寿命上限，不延长服务端grant、原任务或access token。

[登录所有者](src/oauth-session.ts)复用官方SDK生成S256、交换授权码与刷新，校验state、issuer、精确回调、重复参数、资源和返回scope。token只保留在私有内存字段 / 闭包，无共享token getter、不写默认credentials、文件、环境或日志。SDK逐请求取当前凭据，刷新为单所有者且必须轮换refresh token；首次应答丢失、取消或轮换不明保持unknown，不重试交换或刷新，不换ID重新登录。已知401 / 403会使旧凭据不可用，不能自动重新授权 / 重发；本片只现代协议，不用已删除的ping。

[Host交互](src/oauth-host.ts)使用固定`open`依赖启动系统浏览器，登录回调要求数字loopback、非根path且无尾斜杠。`host`模式注册现有`webServer`的精确路由，origin必须与已绑定监听器一致；`loopback`模式仅HTTP，由操作系统以`listen(0)`原子分配临时端口，只改变登记地址的端口，scheme / 数字host / path保持原值。两种模式都精确核对HTTP Host并在登录结束 / 取消后关闭本片路由或监听器；无适用回调在打开浏览器前拒绝。临时模式不依赖Harness WebServer、不修改Electron，但真实OS端口 / 浏览器 / Electron组合未验；远端Web及HTTPS回调仍未接通。

一次插件实例只持有一条连接，绑定原命令会话对象，其他会话 / fork不继承。进程重启不恢复凭据，用户需重新登录。断开 / 卸载 / 本地最长寿命到期先取消、等待本地操作并清除已知凭据和指引，再关闭transport并请求撤销。transport关闭失败仍尝试远端撤销，但结果保持未确认、不重复使用本地凭据；迟到撤销应答由原请求负责取消body，不恢复已清身份。unknown不会因清除而解锁，用户到可信后台核对。RFC7009接受不证明整个grant已撤销，未收到的远端token不能声称已删除。

该方案避免普通文件、共享凭据服务和默认工具读取token，但**不隔离恶意同进程插件、任意代码执行或OS管理员**。尚未认证企业受管信息、全部宿主、崩溃恢复和远端撤销传播；相关业务不开放。本片只通过原公开MCP工具桥消费正式发布的只读映射，不另建native业务工具、不同时挂原静态headers客户端；生产原权限、字段和持久计量未齐仍不发布业务。

## 当前Agent的只读工具

可选`readTools`是本地展示名称白名单，最多50个互异的`A-Za-z0-9_-`名称、每名最长48字符。默认未配置；非空时要求明确启用OAuth，并等待原`tools / agents / llm`服务；缺模型材料检查接点时相关登录不可用。名称必须来自原服务端契约作者，不是可自授权的业务能力列表。生产AS / grant、原权限 / 持久目标 / 字段政策未齐，服务端不得发布相关工具；配置名称不能绕过这些前置。

[mcp-tools](src/mcp-tools.ts)在登录及显式check后读取单页标准Tools，无自动分页 / 重试，超过50项或存在续页拒绝。只消费白名单、闭合输入 / 输出schema、明确只读 / 非破坏且无需task扩展的发布项；Host不支持的schema约束整项拒绝，不移除约束或降级为任意JSON。通过原公开`createMcpToolDefinition`及ToolRuntime注册，模型名称为`mcp__rental_os__<原名>`，原名称直接发标准MCP，不由模型拼HTTP。

工具只属发起登录的精确、仍存活Agent及原Session。另一个Agent / 会话看不到，子Agent继承层由原限制器过滤；直接持有旧执行器仍按精确身份、Session与当前连接拒绝。断开、401 / 403、refresh unknown、Agent销毁、Tools / Agents / LlmRuntime服务移除和插件卸载撤回注册并取消所属在途工作，旧generation不会因迟到读取复活。服务端未通知撤权时，本地可见列表不表示当前授权；每次真实调用仍由MCP当前复验，显式check更新或撤回列表。

每次调用只有一个官方SDK驱动，无自动重发，最长15秒且更短连接限制优先；结果仅接受同一JSON投影的单文本 / structuredContent，错误转换为安全可读拒绝，不把SDK或服务端私人正文写入模型结果。原ToolRuntime持有标准结果 / PTC和呈现，不新增业务renderer。模型材料在下述原LlmRuntime接点检查，完整发送 / 留存控制尚未完成，不能把该工具桥、64 KiB单结果或离线synthetic业务计量当完整生产门槛。

## 当前会话的服务器指引

服务端从原政策作者的`instructions` provider读取已审查、版本化的外发指引；缺许可不发布，指引不发行授权、不调用业务。服务端可独立提供可选Prompts；插件只在人主动列出或选择时读取，不自动采用，Tools / instructions不依赖模板入口或采用情况。插件只消费同一标准MCP发现结果，不保存另一份业务规则或固定页面模板。

登录握手后，原`SystemPrompt`服务若存在，插件贡献一个`mcp:rental-os` section，只在发起登录的精确Agent与原Session仍一致时返回文字；其他会话、fork / 子Agent或Agent重绑定不继承。指引使用字面文本、不展开`{{变量}}`，不设置complete、不覆盖原系统提示词。显式`check`刷新版本、撤回移除旧文本；发现失败、到期 / unknown / 断开均不返回指引，卸载移除注册。没有自动请求或后台模型循环。

完整指引含版本 / 归属最多2,000字符，MCP完整包仍按64 KiB限制。服务端provider负责审查文字和当前释放政策；字符限制不是安全审查。原AgentLoop已用脚本模型验证指引进入原日志及模型材料，工具事实用于下一轮请求，序列化事件可重建相同消息；未验证真实模型采用、磁盘持久化 / 跨重启或全部Host材料生命周期，不能以指引加载证明业务可用。缺原`SystemPrompt`时命令和连接不因此失败，指引未加载明确属于未覆盖组合；该宿主服务是可选peer。

### 人主动选择可选模板

可选`readPrompts`最多50个互异的`A-Za-z0-9_-`名称，每名最长64字符；默认省略或空列表不启用。非空时须明确启用OAuth，并具备原`llm / agents`服务；无需`tools`或`SystemPrompt`才能消费模板。名称只限制客户端可选范围，服务端每次仍按当前原政策发布 / 验权；不是业务或字段授权。

[模板消费者](src/mcp-prompts.ts)用同一私有MCP连接列出单页当前模板，拒绝续页、业务参数、未发布名称、重复 / 超限和未知指引格式。选择先读当前目录，再获取一条`user / text`正文；目录、响应说明与正文版本必须一致，完整文字含`Rental OS guidance (版本)`归属最多2,000字符。不展开变量、不自动读全部模板、不替换SystemPrompt、不造第二Agent循环。列表反馈含名称 / 版本 / 说明，UTF-8超过64 KiB整项拒绝。

正文只交给登录的精确存活Agent及原Session。原`runMaintenance`空闲占用保持选择至提交；忙碌或已被其他维护占用时立即拒绝，不排队。成功通过原`followup`提交一条`rental-prompt`来源、名称 / 版本和`instructions`形式的普通用户消息；原inbox / `user/message`日志保留同一正文，原Loop启动用户自配模型。反馈仅确认提交，不保证模型完成或不再调用其他获准工具，后续业务仍受原权限 / 计量约束。

命令取消、Agent取消 / 销毁、断开、401 / unknown、插件卸载 / 重载及模型服务移除中止未提交选择并等待本地操作结算，迟到正文不进入原消息；读取、提交共用原15秒及更短连接截止，无自动重试。人类命令取消沿原CommandRuntime抛出`AbortError`并记错误结算。原消息提交后，本插件不取消用户整个模型任务或删除普通Host历史；此时按Harness自身取消 / 留存机制处理，不能把本地断开说成撤销模型消耗或远端删除。

## 模型材料的本地上限

[材料检查](src/model-material.ts)通过原`llm/stream` waterfall，在实际模型adapter派发前检查中立`GenerateOptions`：除取消signal外，消息、系统文字、工具、历史及其重复表示整体按JSON序列化UTF-8计量，最多262,144字节；超限或无法序列化返回`RENTAL_MATERIAL_UNAVAILABLE`，不截断、改写日志或自动重发。

检查覆盖本插件明确登录绑定过的原Session，由原`AgentRegistry.currentInitiator()`定位；断开清除调用资格和当前指引，但不会删除Harness历史，因此同一Session在本插件仍加载时继续受上限限制。请求中含`rental-prompt`来源的原消息、`mcp__rental_os__`工具声明、原toolHistory声明 / 更新或工具调用 / 增删记录时，即使没有发起Agent也检查整体材料；插件重载后可由这些原记录重新收紧检查，而不恢复凭据、工具或授权。未含Rental材料且未标记的个人Session保持原行为，断开后的正常大小输入仍可用。进程内Session标记不跨插件卸载 / 重载、Session重建或进程重启保存。

此处不是最终Provider HTTP线包限制：后续文件 / 图片投影、adapter中间件、供应商序列化及重定向可能改变材料；没有原发起Agent且没有上述来源 / 工具记录的直接调用未纳入。fork / 恢复保留这些原记录时会重新检查，但丢失来源、仅含结果正文、自动instructions或派生摘要的材料无法据此可靠识别；普通复制、摘要、导出与卸载后的读取仍不保证，更不能继承业务授权。需要精确目的地、全部重放或强制到期证据的资料仍不得发布；普通用户输入不是被本插件预脱敏的材料。

## 构建与安装状态

包使用ESM，发布文件为`dist`、patch和README。TS构建保留宿主peer外部依赖，不打包第二份Cordis；第三方MCP client和Schemastery为正式依赖。现有`./connection`出口保留上一片兼容，新插件运行入口为`.`。

本轮测试把当前源码严格编译到独立output，按包manifest和patch让真实profile / Loader加载编译产物；没有安装到用户的Harness profile，没有运行GUI或真实OAuth。实际依赖安装与锁文件尚未完成，不把源目录直接当作已安装的发布包。后续在获准环境按原[Bundle安装要求](../agent-desktop/harness/docs/user/develop/basic/publish.zh.md)使用预构建包 / tarball，不运行来源不明的安装脚本、不修改应用安装文件。

## 验证与下一片

[Loader集成测试](../../tests/harness-plugin.test.cjs)使用真实profile解析、兼容预检、Loader、CommandRuntime、SessionStore及官方OAuth / MCP SDK。外部HTTP、系统浏览器、监听器和原业务providers为明确替身；真实AgentRegistry / ToolRuntime / MCP工具桥验证身份注册、调用及释放，原AgentLoop用脚本模型驱动工具调用、下一轮模型材料和原日志重建；模型adapter输出为替身。覆盖无配置零请求、日志不留原参数 / 凭据、一次性回调、原会话绑定、并发单refresh、401不重发、取消 / 迟到 / unknown、host路由及临时端口模式释放、重载和非法配置。另验证中立材料精确256 KiB可用、超限零模型派发、断开后旧Session仍检查及无关个人Session不受影响；模板列表零正文 / 模型、显式选择一条原消息 / 模型续轮、版本更新 / 拒绝、JSON日志重建、Prompt-only重载检查、忙碌 / 错会话及取消 / 断开 / Agent销毁 / 模型服务移除 / 插件重载的迟到正文拒绝。它不是完整Agent变体、真实模型、磁盘恢复、OS监听 / 安装或浏览器验收。原[MCP基础测试](../../tests/mcp-foundation.test.cjs)继续保留。

真实登录目前有三项具体前置，核验命令不会绕过：

1. 原Rental Auth仅有Web operator / staff会话，固定MCP grant、OAuth AS、refresh / 撤销及原Guard复验未交付；公共Auth / Guard由原服务端作者维护，不透传Web token。
2. Harness原[HTTP工厂](../agent-desktop/harness/packages/mcp/mcp-client/src/transport.ts)只传静态headers，没有供外部Bundle注册的OAuth provider / transport工厂。不能猴子补丁、全局fetch拦截或写token到patch；需要受支持的逐请求认证接点，或经明确确认由独立标准MCP适配拥有唯一连接。
3. 原[authorization](../agent-desktop/harness/packages/credentials/authorization/src/index.ts)的成功点必须写共享credentials，不适合本片不共享token的策略；本插件复用原人类命令、Host路由及官方OAuth SDK，不注册假flow或占位grant。默认[credentials-local](../agent-desktop/harness/packages/credentials/credentials-local/README.md#who-can-read-the-file)仍不用于Rental，长期安全凭据和跨进程恢复未交付。

客户端授权码 / PKCE到专用MCP握手已有离线组合，不能替代上述服务端生产者、真实系统浏览器 / listener、grant撤销传播或业务准入。下一片须接原固定身份 / 持久目标 / 字段生产者，并补所需最终发送 / 恢复控制，才能开放目录首片；不堆检查命令或用synthetic工具冒充生产业务。完整范围、实际命令 / 失败 / 通过和剩余见[开发记录](../../docs/Harness插件/Harness插件-开发记录.md)及[协作接续](../../docs/Harness插件/Harness插件-协作接续.md)。
