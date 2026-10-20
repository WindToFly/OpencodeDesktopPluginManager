// OpenCode ecosystem plugin catalog.
// Source: https://opencode.ai/docs/ecosystem#plugins (checked 2026-10-19).
// `compat` is based on the published package entrypoints:
//   v2   = default export with { id, setup } (directly or via the ./server export)
//   v1   = legacy @opencode-ai/plugin implementation, cannot load in OpenCode V2
//   none = not a loadable plugin (CLI tool / instructions only / not on npm)
//   unknown = ad-hoc package supplied by the user

export type Compat = "v2" | "v1" | "none" | "unknown";

export interface CatalogEntry {
  /** Name shown on the ecosystem page. */
  name: string;
  /** npm package name, or null when the project is not published to npm. */
  package: string | null;
  compat: Compat;
  /** One-line Chinese summary. */
  description: string;
  note?: string;
  repo?: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    name: "opencode-daytona",
    package: "@daytona/opencode",
    compat: "v1",
    description: "在 Daytona 隔离沙箱中运行会话，带 Git 同步与实时预览",
    repo: "https://github.com/daytona/integrations/tree/main/packages/opencode-plugin",
  },
  {
    name: "opencode-helicone-session",
    package: "opencode-helicone-session",
    compat: "v1",
    description: "自动注入 Helicone 会话头，便于按会话分组请求",
    repo: "https://github.com/H2Shami/opencode-helicone-session",
  },
  {
    name: "opencode-type-inject",
    package: "@nick-vi/opencode-type-inject",
    compat: "v1",
    description: "读取文件时自动注入 TypeScript/Svelte 类型定义",
    repo: "https://github.com/nick-vi/opencode-type-inject",
  },
  {
    name: "opencode-openai-codex-auth",
    package: "opencode-openai-codex-auth",
    compat: "v1",
    description: "用 ChatGPT Plus/Pro 订阅替代 OpenAI API 计费",
    repo: "https://github.com/numman-ali/opencode-openai-codex-auth",
  },
  {
    name: "opencode-gemini-auth",
    package: "opencode-gemini-auth",
    compat: "v2",
    description: "用现有 Gemini 套餐替代 API 计费",
    note: "V2 入口位于包的 ./server 导出",
    repo: "https://github.com/jenslys/opencode-gemini-auth",
  },
  {
    name: "opencode-antigravity-auth",
    package: "opencode-antigravity-auth",
    compat: "v1",
    description: "使用 Antigravity 的免费模型替代 API 计费",
    repo: "https://github.com/NoeFabris/opencode-antigravity-auth",
  },
  {
    name: "opencode-devcontainers",
    package: "opencode-devcontainers",
    compat: "v1",
    description: "多分支 devcontainer 隔离，浅克隆并自动分配端口",
    repo: "https://github.com/athal7/opencode-devcontainers",
  },
  {
    name: "opencode-google-antigravity-auth",
    package: "opencode-google-antigravity-auth",
    compat: "v1",
    description: "Google Antigravity OAuth，支持 Google 搜索与更稳的 API 处理",
    repo: "https://github.com/shekohex/opencode-google-antigravity-auth",
  },
  {
    name: "opencode-dynamic-context-pruning",
    package: "@tarquinen/opencode-dcp",
    compat: "v2",
    description: "裁剪过期的工具输出，降低 token 消耗",
    note: "npm 包名为 @tarquinen/opencode-dcp",
    repo: "https://github.com/Tarquinen/opencode-dynamic-context-pruning",
  },
  {
    name: "opencode-vibeguard",
    package: "opencode-vibeguard",
    compat: "v1",
    description: "调用 LLM 前把密钥/PII 脱敏为占位符，本地再还原",
    repo: "https://github.com/inkdust2021/opencode-vibeguard",
  },
  {
    name: "opencode-websearch-cited",
    package: "opencode-websearch-cited",
    compat: "v1",
    description: "为支持的提供商增加带引用的原生联网搜索",
    repo: "https://github.com/ghoulr/opencode-websearch-cited",
  },
  {
    name: "opencode-pty",
    package: "opencode-pty",
    compat: "v1",
    description: "让 AI 在 PTY 中运行后台进程并发送交互输入",
    note: "包含 ./v2 入口，但默认加载入口仍是 V1",
    repo: "https://github.com/shekohex/opencode-pty",
  },
  {
    name: "opencode-shell-strategy",
    package: "@bgerona/opencode-shell-non-interactive-strategy",
    compat: "none",
    description: "提供非交互式 shell 指令，避免 TTY 操作挂起",
    note: "只发布指令文件（markdown），不是可加载插件",
    repo: "https://github.com/JRedeker/opencode-shell-strategy",
  },
  {
    name: "opencode-wakatime",
    package: "opencode-wakatime",
    compat: "v2",
    description: "用 WakaTime 统计 OpenCode 使用时长",
    note: "V2 入口位于包的 ./server 导出",
    repo: "https://github.com/angristan/opencode-wakatime",
  },
  {
    name: "opencode-md-table-formatter",
    package: "@franlol/opencode-md-table-formatter",
    compat: "v1",
    description: "清理 LLM 生成的 Markdown 表格排版",
    repo: "https://github.com/franlol/opencode-md-table-formatter",
  },
  {
    name: "opencode-morph-fast-apply",
    package: "@f97/opencode-morph-fast-apply",
    compat: "v1",
    description: "通过 Morph Fast Apply API 与惰性编辑标记加速改代码",
    repo: "https://github.com/JRedeker/opencode-morph-fast-apply",
  },
  {
    name: "opencode-morph-plugin",
    package: "@morphllm/opencode-morph-plugin",
    compat: "v1",
    description: "Morph 快速编辑、WarpGrep 代码搜索与上下文压缩",
    repo: "https://github.com/morphllm/opencode-morph-plugin",
  },
  {
    name: "oh-my-opencode",
    package: "oh-my-opencode",
    compat: "v1",
    description: "后台代理、预置 LSP/AST/MCP 工具与精选代理合集",
    repo: "https://github.com/code-yeongyu/oh-my-opencode",
  },
  {
    name: "opencode-notificator",
    package: "opencode-notificator",
    compat: "v2",
    description: "会话桌面通知与声音提醒",
    repo: "https://github.com/panta82/opencode-notificator",
  },
  {
    name: "opencode-notifier",
    package: "@mohak34/opencode-notifier",
    compat: "v2",
    description: "权限、完成、错误事件的桌面通知与声音",
    note: "npm 包名为 @mohak34/opencode-notifier",
    repo: "https://github.com/mohak34/opencode-notifier",
  },
  {
    name: "opencode-zellij-namer",
    package: "opencode-zellij-namer",
    compat: "v1",
    description: "根据 OpenCode 上下文自动命名 Zellij 会话",
    repo: "https://github.com/24601/opencode-zellij-namer",
  },
  {
    name: "opencode-skillful",
    package: "@zenobius/opencode-skillful",
    compat: "v1",
    description: "按需发现并懒加载技能提示",
    note: "npm 包名为 @zenobius/opencode-skillful",
    repo: "https://github.com/zenobi-us/opencode-skillful",
  },
  {
    name: "opencode-supermemory",
    package: "opencode-supermemory",
    compat: "v2",
    description: "用 Supermemory 实现跨会话持久记忆",
    repo: "https://github.com/supermemoryai/opencode-supermemory",
  },
  {
    name: "@plannotator/opencode",
    package: "@plannotator/opencode",
    compat: "v2",
    description: "可视化计划评审、批注与离线分享",
    repo: "https://github.com/backnotprop/plannotator",
  },
  {
    name: "@openspoon/subtask2",
    package: "@openspoon/subtask2",
    compat: "v1",
    description: "把 /commands 扩展成可编排、细粒度控制的工作流",
    repo: "https://github.com/spoons-and-mirrors/subtask2",
  },
  {
    name: "opencode-scheduler",
    package: "opencode-scheduler",
    compat: "v1",
    description: "用 cron 语法调度周期任务（launchd/systemd）",
    repo: "https://github.com/different-ai/opencode-scheduler",
  },
  {
    name: "opencode-conductor",
    package: "opencode-conductor-plugin",
    compat: "v1",
    description: "Context → Spec → Plan → Implement 的协议化工作流",
    note: "npm 包名为 opencode-conductor-plugin",
    repo: "https://github.com/derekbar90/opencode-conductor",
  },
  {
    name: "micode",
    package: "micode",
    compat: "v1",
    description: "头脑风暴 → 计划 → 实现的结构化流程，带会话延续",
    repo: "https://github.com/vtemian/micode",
  },
  {
    name: "octto",
    package: "octto",
    compat: "v1",
    description: "浏览器中的交互式头脑风暴 UI，支持多问题表单",
    repo: "https://github.com/vtemian/octto",
  },
  {
    name: "opencode-background-agents",
    package: "opencode-background-agents",
    compat: "v1",
    description: "Claude Code 风格的后台代理、异步委派与上下文持久化",
    repo: "https://github.com/kdcokenny/opencode-background-agents",
  },
  {
    name: "opencode-notify",
    package: "opencode-notify",
    compat: "v1",
    description: "原生系统通知，任务完成时提醒",
    repo: "https://github.com/kdcokenny/opencode-notify",
  },
  {
    name: "opencode-workspace",
    package: null,
    compat: "none",
    description: "多代理编排套件，16 个组件一次安装",
    note: "npm 上不存在，仅通过 GitHub 分发",
    repo: "https://github.com/kdcokenny/opencode-workspace",
  },
  {
    name: "opencode-worktree",
    package: "opencode-worktree",
    compat: "none",
    description: "零摩擦管理 Git worktree",
    note: "CLI/TUI 工具，没有 OpenCode 插件入口",
    repo: "https://github.com/kdcokenny/opencode-worktree",
  },
  {
    name: "opencode-sentry-monitor",
    package: "opencode-sentry-monitor",
    compat: "v1",
    description: "用 Sentry AI Monitoring 追踪和调试代理",
    repo: "https://github.com/stolinski/opencode-sentry-monitor",
  },
  {
    name: "opencode-firecrawl",
    package: "@firecrawl/opencode",
    compat: "v2",
    description: "通过 Firecrawl CLI 抓取、爬取和搜索网页",
    note: "npm 包名为 @firecrawl/opencode",
    repo: "https://github.com/firecrawl/opencode-firecrawl",
  },
  {
    name: "opencode-jfrog-plugin",
    package: "@jfrog/opencode-jfrog-plugin",
    compat: "v1",
    description: "把 OpenCode 接入 JFrog 平台",
    note: "npm 包名为 @jfrog/opencode-jfrog-plugin",
    repo: "https://github.com/jfrog/opencode-jfrog-plugin",
  },
  {
    name: "opencode-goal-plugin",
    package: "opencode-goal-plugin",
    compat: "v2",
    description: "会话级 /goal 工作流，目标未完成时自动继续",
    repo: "https://github.com/willytop8/OpenCode-goal-plugin",
  },
  {
    name: "opencode-tavily",
    package: "opencode-tavily",
    compat: "v2",
    description: "通过 Tavily CLI 搜索、提取、爬取与深度研究",
    repo: "https://github.com/tavily-ai/opencode-tavily",
  },
  {
    name: "opencode-supabase",
    package: "opencode-supabase",
    compat: "v1",
    description: "Supabase 登录、Management API 工具与配套技能",
    repo: "https://github.com/supabase-community/opencode-supabase",
  },
];

export const BY_NAME = new Map<string, CatalogEntry>();
export const BY_PACKAGE = new Map<string, CatalogEntry>();

for (const entry of CATALOG) {
  BY_NAME.set(entry.name.toLowerCase(), entry);
  if (entry.package) BY_PACKAGE.set(entry.package.toLowerCase(), entry);
}

/** Resolve an ecosystem name, npm package, or ad-hoc npm package. */
export function resolveEntry(input: string): CatalogEntry | undefined {
  const key = input.trim().toLowerCase();
  if (!key) return undefined;
  const known = BY_NAME.get(key) ?? BY_PACKAGE.get(key);
  if (known) return known;
  // Accept a package specifier with a version, e.g. foo@1.2.3.
  const at = key.lastIndexOf("@");
  if (at > 0) {
    const bare = key.slice(0, at);
    const byName = BY_NAME.get(bare) ?? BY_PACKAGE.get(bare);
    if (byName) return byName;
  }
  // Unknown but plausible npm package: manage it as an ad-hoc entry.
  if (/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(key)) {
    return { name: input.trim(), package: input.trim(), compat: "unknown", description: "（生态列表之外的插件）" };
  }
  return undefined;
}
