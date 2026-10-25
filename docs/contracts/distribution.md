# Fork 发行行为契约

版本与安装的具体约定分别由 [desktop distribution](../fork-desktop-distribution.md)、
[daemon distribution](../fork-daemon-distribution.md) 和[发布流程](../release.md)维护。
以下要求适用于迁移后的全部 fork 产物。

## DIST-01 — 一个可追溯的 fork 发行身份

用户能分辨精确官方 baseline 与 fork revision。Tag、安装包、daemon、Android
使用同一派生版本，符合 desktop distribution 的版本规则；
baseline 更新后 revision 从新基线开始计数。

验收：从候选提交的元数据、产物和运行中的客户端/daemon 读到的身份一致；
内部协议版本不会冒充实际安装的 fork 版本。

## DIST-02 — 独立 daemon 包与显式更新

发行包在没有既有 Paseo、源码工作区或全局依赖补位的受支持 Node/npm 环境中，
按正常安装方式获得完整运行时依赖。代码引用、依赖版本要求和包内文件相符，
不会因依赖缺失、错误版本或开发目录残留而无法加载。

Fork 包包含所需内部工作区，缺失内部 CLI 或依赖时明确失败，不被全局官方包补位。
Agent 使用的 CLI 与运行中的 fork 发行一致。显式更新保持发行身份，并遵守
daemon distribution 中的更新契约，包括同版本重新安装。

用户可观察安装输出、等待和失败；失败有可处理状态。新 worker 继承正确环境；
需要完整 supervisor 重启的变化有明确说明，不将 worker 替换冒充完整升级。

验收：独立安装、旁边同时安装官方 CLI、同版本重装、慢文件系统、安装失败和
worker 替换后均显示真实结果，不静默切换到官方发行。

## DIST-03 — 桌面更新保持发行与用户数据

Windows x64 和 Linux x64 的 fork 更新保留应用身份、设置与 daemon 数据。
日常更新跟随 fork。用户可显式选择官方发行，下载并校验完整安装包，
事先知道安装对运行中会话的影响。

验收：fork 升级、显式切换到等版本或更低版本的官方安装包均遵守专题约定；
检查官方新版本本身不安装、不切换发行或停止会话。

## DIST-04 — Android 共存与可升级安装

Android fork 有独立应用身份和链接 scheme，使用持续有效的签名，
可与官方应用共存。Fork 不接收官方 OTA/push 配置，APK 更新来源属于 fork。

验收：arm64 安装包可构建、安装和覆盖升级，保留 fork 自身数据；
官方与 fork 不串包、不串更新。构建满足项目约定的内存限制。

## DIST-05 — 客户端版本差异不打断 daemon

桌面启动能连接已经 running/starting 的 daemon。客户端与 daemon 独立更新，
可用功能由主机能力决定；单纯版本号不一致不触发 daemon 重启。

验收：不同版本 app 打开时，既有 agents 和 terminals 继续运行；
缺失能力有明确提示，用户主动生命周期操作仍有效。
协议兼容规则见[protocol compatibility](../protocol-compatibility.md)。

## RELEASE-01 — 发布可追溯、产物不可变

官方 mirror 与 fork 产品分支遵守 [overlay workflow](../fork-overlay.md)。
发行对应经过验证的产品提交；已发布版本、tag 和同名资产不被重用或替换，
重新构建形成新的 revision。

Fork 工作流不会发布到官方 npm、商店或云端渠道。Release 的可见性与各产物的
独立附加符合发布流程，不因某个构建未完成阻塞已完成产物。
默认产物与 Android 的选用遵守本次发布范围；已退役的 VS Code 扩展不再构建或发布。

验收：发布元数据能追到唯一源码提交和所有已完成资产；某个平台失败时，
其他产物状态准确，重试不覆盖已公开的同名资产。

发布者可以撤回 GitHub 分发。撤回并刷新发布端/客户端缓存后，新版本检查与 latest
下载入口只选择仍公开的发行；旧发行及其资产保持可用。停止该版本的发布任务后，
撤回不会被仍在运行的任务重新发布。撤回不自动降级已安装实例、不收回已下载文件，
也不删除源码历史或构建记录；该版本号仍不得重用。操作归[发布流程](../release.md#withdraw-a-release)。

## RELEASE-02 — 验证范围与发行解耦

常规 push、PR 和发布不会自动启动全量测试矩阵、浏览器下载、E2E、集成或原生
provider 验证。自动检查限于格式、lint、typecheck 及明确保留的快速 Node 单测；
构建所需声明不改变验证范围。远程轻量检查与产物发布独立，其状态不成为发行门槛。

发行产物在上传前通过固定的依赖完整性检查。新增检查仅覆盖依赖声明、模块解析、
打包文件和版本关系；不附带代码风格、未使用代码、包元数据偏好等通用 lint 建议。
依赖检查不启动产品或 provider、不执行功能测试，也不要求每次重新进行隔离安装。

用户授权的专项验证只适用于其声明的范围，不自动成为后续每次开发或发布的固定
步骤。Baseline bump 后仍保持这一边界，不能因上游 workflow 存在而恢复常驻任务。

验收：检查候选全部 workflow 的触发条件和执行命令，普通 push／PR 不启动上述
重型任务；发布工作流只执行已授权产物的构建、校验和分发。
