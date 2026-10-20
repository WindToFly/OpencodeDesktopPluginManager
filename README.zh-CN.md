# OpenCode 生态插件管理器

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个统一管理 OpenCode 生态插件的控制台。浏览社区插件清单，查看 V1/V2 兼容性与 npm
状态，用开关安装或卸载，不必手动编辑 `opencode.json(c)`。

## 为什么

OpenCode 生态页列出了几十个插件，但试用一个插件通常意味着修改全局配置、记住自己加过哪些
包，试用结束后再手动清理。生态插件管理器把这些记录集中起来：

- **清单内置。** 39 个插件，附带简短说明、V1/V2 兼容性和 npm 状态。
- **逐插件开关。** 打开即安装，关闭即卸载。
- **受管归属。** 只卸载由开关安装的包，不会碰你手动添加的插件。
- **安装前检查。** 只有能在 npm 解析、且能被 OpenCode V2 加载的包才允许打开。
- **本地面板。** 在浏览器中搜索、筛选和切换，服务只监听 `127.0.0.1`。
- **保留 JSONC。** 通过 `opencode plugin add/remove` 修改配置，注释和其他设置不会丢失。

## 要求

- OpenCode 2.x
- `opencode` CLI 位于 `PATH`，或通过 `OPENCODE_CLI` 环境变量指定。桌面版自带的 CLI
  会被自动探测。

## 安装

```sh
opencode plugin add opencode-ecosystem-manager
```

或手动加入 `~/.config/opencode/opencode.json(c)`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-ecosystem-manager"]
}
```

安装后重新加载 OpenCode。

## 使用

在会话里让 AI 调用 `ecosystem_manager` 工具，或使用斜杠命令：

```text
/ecosystem ui                   # 打开浏览器可视化面板
/ecosystem list                 # 清单（不刷新 npm）
/ecosystem check                # 刷新 npm 状态后列清单
/ecosystem status               # 查看总开关和已选插件
/ecosystem on opencode-tavily   # 打开开关并自动安装
/ecosystem off opencode-tavily  # 关闭开关并自动卸载
/ecosystem enable               # 打开总开关，安装所有已选项
/ecosystem disable              # 关闭总开关，卸载全部受管插件
/ecosystem sync                 # 按当前状态重新同步
```

`on`/`off` 支持一次传多个名称，名称可以是清单名称或 npm 包名。也支持清单之外的 npm
包（按原样安装）。

### 可视化面板

运行 `/ecosystem ui` 会启动一个只监听 `127.0.0.1` 的面板（优先端口 `47821`，被占用时
使用临时端口），并自动打开浏览器。面板提供：

- 39 个插件的搜索、筛选、作用说明、V1/V2 与 npm 状态
- 每个插件一个开关，以及总开关
- npm 刷新与手动同步
- 访问令牌通过 URL 一次性写入 `HttpOnly`、`SameSite=Strict` Cookie，接口还校验 `Origin`

面板服务器随 OpenCode 进程存活，不随插件重载关闭，因此安装/卸载触发的配置重载不会把
面板踢掉。重启 OpenCode 后重新运行 `/ecosystem ui` 即可。

## 安全规则

- 只写入全局配置 `~/.config/opencode/opencode.json`，并且只通过
  `opencode plugin add/remove` 修改。
- 只卸载 `state.json` 中 `installed` 记录的受管包。
- npm 返回 404、包已弃用、或无法连接 npm 时拒绝打开开关。
- `compat: "v1"` 和 `compat: "none"` 的条目拒绝打开；V2 与未知包允许。
- 总开关关闭时保留 `selected` 选择，卸载所有受管插件；再次 `enable` 会重新安装。
- 插件加载后约 2 秒自动同步一次；配置变化触发重新加载时也会再次同步。

## 文件与状态

- `src/index.ts`：注册工具、`/ecosystem` 命令、自动同步
- `src/manager.ts`：开关状态与全局配置的 reconcile、CLI 调用、文本输出
- `src/ui.ts`：本地 HTTP 面板、令牌校验、API
- `src/ui.html`：可视化界面
- `src/catalog.ts`：39 项生态清单
- `src/npm.ts`：npm registry 检查与 30 分钟缓存
- `src/paths.ts`：配置发现、JSONC 解析、状态读写

状态文件：`~/.local/share/opencode/ecosystem-manager/state.json`

生态页更新后，需要同步维护 `src/catalog.ts` 中的清单。

## 开发

```sh
npm install
npm run typecheck
npm run pack:dry
```

如果不想发布就本地加载，可以把 OpenCode 指向仓库目录：

```jsonc
{
  "plugins": ["/absolute/path/to/OpencodeDesktopPluginManager"]
}
```

## 许可证

MIT
