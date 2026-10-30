# 网络出口审计与 v0.13.7 核验 — 2026-10-30

审计源码：`68f74d88ce6ecf3a1a5645ed976ebee35bd05438`，分支 `overlay`。
审计时最近发行是 v0.13.6（`34c6c983020d51fb441506959c2746e96611c420`）；
审计源码多出 FILE-03 文件定位提交。下面保留修复前的成因与探针；
v0.13.7 的提供商代理修复、验证和延期范围见末节。
行为目标归 [NET-01–04](../networking.md)，跟踪项为 `item_8ff2ca71`。

## 根本模式

被审计实现把凭证、目标地址和网络执行环境拆开处理。某个功能从 agent 环境或
用户目录取得凭证，再在插件、daemon 或桌面主进程自行创建网络客户端。
凭证被复用，原操作的代理、服务归属或启动选项却没有一同保留。

另一处断点是把网络 API 当成具有相同环境语义：Node `fetch`、`ws`、
Electron `net` 和外部 CLI 的代理行为不同。此前项目缺少统一的有效出口约束，
一个子系统能连通不能证明其派生请求使用了相同出口。

这类错误会让提供商把登录身份与本机/daemon 的直接出口 IP 关联起来。
TLS 保护传输内容，但不隐藏这层关联。错误的服务归属还可能把凭证交给另一个服务。

## 修复前确认的源码缺口

下表的“确认”指源码调用链与本地探针支持该结论，不表示已对真实账号发起请求。

| 编号 | 范围与位置                                                                                                                                                                                                  | 发现与影响                                                                                                                                                                                                | 契约      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| E01  | `plugins/*-usage-source/server/usage.ts`，端点表见下节                                                                                                                                                      | 九个提供商实现默认使用 Node 全局 `fetch`；没有配置代理 transport。仅设置常见代理环境变量时仍可直连                                                                                                        | NET-01    |
| E02  | `packages/plugin/src/server/usage.ts:69`；`packages/server/src/server/plugins/usage-sources/index.ts:139,216,356`；`plugins/codex-usage-source/shared/input.ts:16`                                          | session discovery 收到 env，后续 fetch 只收到 input。Codex/Claude/Cursor 的凭证 locator 不带原网络上下文；合并、去重与候选请求沿用该 locator                                                              | NET-02/03 |
| E03  | `plugins/claude-usage-source/server/usage.ts:367,669`                                                                                                                                                       | 账号发现阶段就带 OAuth token 查询 `/api/oauth/profile`。只修最终的 usage 请求仍遗漏一次外发请求                                                                                                           | NET-01/02 |
| E04  | `packages/server/src/server/plugins/runtime.ts:218,234`                                                                                                                                                     | 打包后的插件 fork 使用 `execArgv: []`；开发态也重建参数。父进程通过命令行传入的代理启动选项不会继承。环境变量仍继承，二者不能混称为“全部丢失”                                                             | NET-03    |
| E05  | `packages/server/src/server/relay-transport.ts:71`；`packages/client/src/node/index.ts:67`；`packages/server/src/server/hub/relationship-remote.ts:168`；`packages/desktop/src/features/tunnels/ipc.ts:259` | 裸 `ws` 构造覆盖 daemon relay、CLI、Connected Hosts、Hub 长连接和桌面 Viewer/tunnel。无代理 agent；本地 WSS 探针在 Node 环境代理已启用时仍直连                                                            | NET-01/03 |
| E06  | `packages/server/src/server/agent/providers/omp/mcp-bridge.ts:111`                                                                                                                                          | stdio 分支使用传入 env；HTTP/SSE 分支保留 URL、认证头，却忽略同一 env，改由 daemon 的默认网络栈访问远端 MCP                                                                                               | NET-02/03 |
| E07  | `packages/server/src/server/speech/providers/openai/stt.ts:58`、`tts.ts:29`                                                                                                                                 | OpenAI SDK 仅配置 apiKey/baseURL，安装的 SDK 默认回到全局 fetch。语音和文本请求存在与普通 Node fetch 相同的出口缺口                                                                                       | NET-01    |
| E08  | `packages/server/src/server/push/push-service.ts:64`；`plugins/managed-source/registry.ts:41`（同 server 目录）；`speech/providers/local/sherpa/model-downloader.ts:49`（同 server 目录）                   | 推送、插件目录和语音模型下载使用默认 fetch；分别涉及推送内容/设备 token、可选目录认证及下载出口                                                                                                           | NET-01    |
| E09  | `packages/server/src/server/hub/relationship-remote.ts:102,133,152`；`packages/cli/src/commands/hub/hub-client/internal/transport.ts:21`                                                                    | Hub 注册、权限更新、撤销和 CLI HTTP API 使用默认 fetch；包含 Hub 认证和 daemon 身份                                                                                                                       | NET-01    |
| E10  | `plugins/copilot-usage-source/server/usage.ts:23,54`                                                                                                                                                        | 从 `gh/hosts.yml` 正则读取第一个 oauth_token，没有解析其主机归属，固定发送到 `api.github.com`。仅企业主机的假凭证文件也命中                                                                               | NET-02    |
| E11  | `plugins/muse-provider/server/catalog.ts:21`；`plugins/muse-provider/server/usage.ts:21,34,71`                                                                                                              | catalog key 仅列出大写 HTTP_PROXY/HTTPS_PROXY/NO_PROXY，忽略小写及 ALL_PROXY；usage 按配置目录合并账号、保存最后一次 launch，不能区分同账号的会话网络上下文。这不是已证实的 Muse 直连，属于上下文复用缺口 | NET-03    |

E02 的实际链条是：agent `usageSession()` → registry 的 `discoverAgent()` →
插件 `usage.discover(scope)` → `UsageAccount.input` → `usage.fetch(input)` →
`fetchUsage()`。Codex 的 input 仅包含 route；变更 session HTTPS_PROXY 不改变 input。
registry 的 `loginKey` / `cacheIdentity` 也因此无法区分这两个网络上下文。

E05 的 SDK 路径由 `packages/cli/src/utils/client.ts:194` 和
`packages/server/src/server/connected-hosts/index.ts:247` 进入。
桌面主连接可使用 Chromium 的 WebSocket，派生 Viewer 则在 Electron 主进程中
构造 Node `ws`；系统代理不会自动从 Chromium 传给这条连接。

### 用量端点清单

下面路径均相对 `plugins/`。九个 source，十处 HTTP 调用；Claude 有发现和用量两处。

| Source      | 位置                                          | 目标                                                                |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Codex       | `codex-usage-source/server/usage.ts:207`      | `chatgpt.com/backend-api/wham/usage`                                |
| Claude      | `claude-usage-source/server/usage.ts:537,669` | `api.anthropic.com/api/oauth/usage`、`profile`                      |
| Copilot     | `copilot-usage-source/server/usage.ts:54`     | `api.github.com/copilot_internal/user`                              |
| Cursor      | `cursor-usage-source/server/usage.ts:160`     | `api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` |
| Grok        | `grok-usage-source/server/usage.ts:124`       | `cli-chat-proxy.grok.com/v1/billing`                                |
| Kimi        | `kimi-usage-source/server/usage.ts:260`       | `api.kimi.com/coding/v1/usages`                                     |
| MiniMax     | `minimax-usage-source/server/usage.ts:157`    | `${auth.baseUrl}/v1/token_plan/remains`                             |
| OpenCode Go | `opencode-go-usage-source/server/usage.ts:59` | `opencode.ai/zen/go/v1/usage`                                       |
| Z.ai        | `zai-usage-source/server/usage.ts:35`         | `api.z.ai/api/biz/subscription/list`                                |

Codex session discovery 已排除 `OPENAI_BASE_URL`；Claude session discovery 已排除
第三方 base URL、Bedrock、Vertex。不能把它们描述为所有自定义端点都会触发官方查询。
host 级发现仍从账号目录枚举；MiniMax 会从凭证/config 解析 base URL；这些都不能
代替出站代理的处理。其余六个仅提供 global discovery 的 source 不会误称为已支持
session scope；Cursor、Codex、Claude 的 session locator 丢失网络上下文已单独列出。

## 全局扫描中区分出的其它路径

| 类别               | 位置与处理结论                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron 下载/更新 | `features/daemon-package.ts`、`official-release-electron.ts` 使用 Electron `net.fetch`；`auto-updater.ts` 的 electron-updater 使用 Electron `net.request`。这些走 Chromium 网络栈，有系统代理支持，不能列为裸 Node fetch 直连缺陷。更新器的独立 session 与系统代理实机矩阵仍未验收 |
| Web/native 客户端  | `changelog/internal/changelog-source.ts`、`updates/fork-android-release.ts`、附件读取、文件下载、Markdown 远程图片、内嵌浏览器及默认 WebSocket 由浏览器/native 网络栈执行。没有发现强制禁用代理的配置；系统代理和原生下载的具体行为列为平台待验收                                  |
| 本机 HTTP/IPC      | `local-service-connection.ts`、Viewer HTTP controller、本机 OpenCode bridge/runtime、桌面 `local-transport.ts`、Android loopback listener、本地 Viewer HEAD 探测均为本机目标。不能机械替换为外部代理；全局代理修复要保持本机通信                                                   |
| 显式 TCP/SSH       | `server/tunnels/controller.ts` 也支持用户指定任意 TCP host，`client/node/ssh-tunnel.ts` 使用 SSH。它们不是 HTTP forward-proxy API；应核对其所声明传输的配置与目标，不能把任意 TCP 一律解释成漏用 HTTP_PROXY，也不能把所有 tunnel 都算本机流量                                      |
| 外部 CLI           | Git/gh/glab/tea、npm 安装与自更新、skill Git 同步继承进程环境；`server/paseo-env.ts` 只删除内部控制变量，不删除代理变量。provider launch、ACP/Muse/Antigravity 等子进程传递 env。未发现普遍清除代理变量；需保持工具自身的代理/config 语义，不能据此给所有外部 CLI 判定直连         |
| Muse 用量          | 通过现有 MSP 会话或保存的 launch 启动 Muse 后查询 `usage/read`，不属于九个原始 HTTP 用量实现；其上下文合并风险见 E11                                                                                                                                                               |
| 网站/托管 relay    | `packages/website/src/{hub-plans,latest-release,plugins/published,stars}.ts` 与 `relay/src/cutover-proxy.ts` 是部署侧 fetch；Cloudflare binding 的 `stub.fetch` 是内部调用。执行环境独立于客户机器，不当作客户 provider 凭证外泄路径                                               |
| 开发/发行工具      | ACP PyPI 版本检查、relay/terminal benchmark、dictation baseline 脚本也使用 Node fetch/ws/SDK，具有同一运行时前提。开发健康检查为本机请求；发行 shell 的 curl/gh/npm 使用各工具配置。未将工具脚本风险混算为已发布客户端功能                                                         |

扫描覆盖 Git 中 packages、plugins、scripts 的网络调用、别名、SDK 构造、连接工厂、
子进程和代理配置；补查原生模块、浏览器加载入口与发行脚本。生成 bundle、测试
fixture 的命中不计为产品入口。关键词/语法扫描用于找候选，以上结论经过调用链分类，
不是把搜索命中数当作缺陷数。

## 本地验证与证据边界

执行环境 Linux、Node `v26.3.0`、仓库安装的 `ws`。假 HTTP/HTTPS 目标和 CONNECT
代理仅监听回环地址，`NO_PROXY` 清空，临时 CA 仅传给测试子进程。
未读取真实 provider 凭证，未访问真实提供商，未重启生产 daemon。

| 探针                                                                       | 结果                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 仅设置 HTTP_PROXY/HTTPS_PROXY：HTTP fetch、HTTPS fetch、https.get、WSS     | 四者均成功访问本地目标，代理收到 0 次连接                                       |
| 再设置 NODE_USE_ENV_PROXY=1                                                | 两种 fetch 与 https.get 各经过代理一次；WSS 仍经过代理 0 次                     |
| 父进程使用 --use-env-proxy；子进程继承 execArgv / 重置为空                 | 前者经过代理一次；后者直接访问目标                                              |
| 实际 Codex discovery：同一假 auth.json、两个不同 HTTPS_PROXY               | 产生完全相同的 input；实际 fetchUsage 只提交 headers/signal，没有保留网络上下文 |
| 实际 Copilot fetchUsage：只有企业主机的假 hosts.yml，替换 fetch 为记录函数 | 将该假 token 提交给固定 github.com URL；没有外部请求                            |
| 实际 Muse launchKey：只变更小写 https_proxy / 大写 HTTPS_PROXY             | 前者 key 相同，后者不同                                                         |

网络栈/子进程探针共十种组合，另三组调用实际 source 函数。它们没有覆盖完整产品
界面、Windows 系统 PAC、Android/iOS、SOCKS、代理认证与所有失败/取消场景；
这些保留在 NET 验收项目中，当前不标通过。

Node 的环境代理需要启用，见 [Node 启动选项](https://nodejs.org/api/cli.html#--use-env-proxy)。
Electron `net` 使用 Chromium 网络栈并支持系统代理，见
[Electron net](https://www.electronjs.org/docs/latest/api/net/)。运行时结论以本轮本地
探针为准；Node 默认代理能力不能覆盖 `ws` 自建连接或恢复已丢失的 session env。

## 当前范围与 v0.13.7 修复

用户确认实际代理配置来自 daemon/agent 的 `HTTP_PROXY`、`HTTPS_PROXY` 等环境变量，
并将当前排查范围收窄为可能向模型提供商暴露隐私的路径。当前优先级如下；
它调整处理顺序，保留 NET-01–04 对其它功能的长期约束。

| 当前范围                                      | 提供商实际收到什么                                                                                            | 已知风险与证据                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 用量与账号发现，E01/02/03；E04 为进程边界成因 | 九个 source 的十处 HTTP 调用均携带 token/API key；Codex 还可能携带 account ID。请求没有提交会话正文或项目文件 | 直连使提供商把认证身份与 daemon 的真实出口 IP 关联起来。Claude discovery 查询 profile 也在范围内；daemon 环境代理与 agent 级覆盖分别核对 |
| Copilot 凭证主机归属，E10                     | GitHub 官方接口可能收到原本属于企业 GitHub 的 token                                                           | 假凭证已复现错误主机选择；即便流量经过代理，凭证归属错误仍存在                                                                           |
| 云端语音，E07                                 | 配置的 OpenAI/兼容服务收到 API key、转写音频及可选 prompt，或待合成文本                                       | 这些是启用语音功能所需的数据；已确认的额外风险是 SDK 默认 fetch 没有落实代理出口。未启用云端语音不会因该功能产生请求                     |
| Muse 用量/模型目录，E11                       | 外发由 Muse 子进程决定，Paseo 通过 MSP 读取结果                                                               | 相同账号目录合并 launch、小写代理未进入 catalog key 已确认；是否导致提供商直连尚需实际流量验证                                           |
| Codex/Claude 独立模型目录探测，新增待验证项   | provider 探测进程可能使用账号凭证读取远端模型目录；实际外发时机取决于 provider                                | 目录进程使用 daemon/provider 配置，不带某个 agent 的环境覆盖。仅在 agent 上配置代理时，主会话成功不能证明目录探测采用了该代理            |

目录路径依据：`codex-app-server-agent.ts:8504` 的 `fetchModelsFromAppServer()` 使用
`buildCodexAppServerEnv(this.runtimeSettings)` 启动新 app-server，之后调用 `model/list`；
`claude/agent.ts:1645` 的 `fetchCatalog()` 使用 host 级 `buildProviderEnv()`。
两条路径都位于 `packages/server/src/server/agent/providers/`。这里记录作用域差异，
尚未将 provider 内部何时发 HTTP 请求判定为已复现的泄露。
普通 Codex/Claude 主会话启动则保留 daemon/provider 环境和 launch overlay，未发现
Paseo 在这两条启动路径普遍删除代理变量；第三方 CLI 自身的网络行为仍需按实际运行核对。

用户随后授权先修复这些路径的代理，并发行桌面、daemon 和 Android。该范围内：

| 项目         | v0.13.7 结果                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E01/02/03/04 | 九个用量源、Claude profile 使用有效代理；发现、读取、插件 IPC、缓存与并发去重保留会话网络上下文。host 查询保留每个登录来源的出口。插件不再依赖父进程代理启动参数。 |
| E07          | OpenAI STT/TTS SDK 使用 daemon 的有效代理，包括兼容服务 base URL。                                                                                                 |
| E11          | Muse 同账号的不同 launch 不再覆盖彼此；用量绑定对应连接/launch，小写与 ALL_PROXY 纳入目录缓存身份。第三方 Muse 实际外发仍由其自身网络栈执行。                      |
| E10          | 本次只改代理。企业 GitHub token 主机归属问题仍待修复，不能因 Copilot 请求经过代理便标为解决。                                                                      |
| 其它范围     | E05/08/09、OMP 远端 MCP、桌面系统代理及平台设备矩阵仍延期。Codex/Claude host 级目录的作用域说明见 [NET 配置](../networking.md#当前提供商-http-出口的配置)。        |

隔离验证使用本地 HTTP/HTTPS 假目标、两个独立代理、假凭证和临时 CA；探针拒绝
对外直连，不读取真实 provider 凭证。没有重启生产 daemon。覆盖以下实际调用：

- 九个 source 的真实 HTTPS 请求，以及相同 Claude token 的双出口 profile 查询；
- 编译后的插件子进程与 registry：同账号双会话、强制刷新、保留 session key 后修改
  代理、host 级合并；全部带认证的提供商请求经过指定代理；
- OpenAI STT/TTS 类通过真实 SDK 发出转写、合成请求；Muse 同账号的两个活动会话
  分别读取各自连接，目录 key 区分小写代理；
- HTTP/HTTPS、大小写优先级、ALL_PROXY、HTTP 代理复用、NO_PROXY 主机/端口/通配符、
  重定向、代理认证、并发、连接池淘汰、取消及拒绝/无效/不支持配置。失败未回落直连。

网络探针共 29 项，观察到 27 次携带假认证的提供商请求，全部通过代理。
覆盖内置插件与真正 fork 的插件进程。registry 28 项、Muse 113 项通过（原有 2 项跳过）。
格式、lint、全仓 typecheck 及 daemon tarball 的固定依赖检查通过。
既有 registry 用例与 Muse 用例继续使用；仅调整原有 fixture 的环境和内部 route
预期，不在仓库添加网络探针或 CI。临时脚本和结果归 `item_8ff2ca71` storage。

HTTPS 代理以主机名连接已验收；本机 Node 26 对 IP 形式的 TLS servername 会拒绝，
该组合当前返回错误，不回落直连。HTTP 代理使用 IP 已验收。

本次解决 NET-01–04 中上述已验收路径的代理与上下文缺口，不将整个 NET 契约标为
完成。更广的网络范围和 E10 保持未完成，后续 baseline bump 继续核对。
