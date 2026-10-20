// Reconciliation between the switch state and the global opencode.json.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { BY_PACKAGE, BY_NAME, CATALOG, resolveEntry, type CatalogEntry } from "./catalog";
import { checkNpm, npmLabel } from "./npm";
import {
  basePackage,
  HOME,
  loadState,
  readConfiguredPlugins,
  saveState,
  unique,
  type ManagerState,
} from "./paths";

export interface ActionInput {
  action: "list" | "status" | "on" | "off" | "enable" | "disable" | "sync" | "check";
  plugins?: string[];
}

export interface ActionResult {
  ok: boolean;
  text: string;
  changed: boolean;
}

let chain: Promise<unknown> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function perform(input: ActionInput): Promise<ActionResult> {
  return serialize(async () => {
    const state = await loadState();
    switch (input.action) {
      case "list":
        return { ok: true, text: await listText(state, false), changed: false };
      case "check":
        return { ok: true, text: await listText(state, true), changed: false };
      case "status":
        return { ok: true, text: statusText(state), changed: false };
      case "enable":
        state.enabled = true;
        await saveState(state);
        return finish(state, ["总开关已打开。"]);
      case "disable":
        state.enabled = false;
        await saveState(state);
        return finish(state, ["总开关已关闭，开始卸载受管插件。"]);
      case "on":
      case "off":
        return toggle(state, input.plugins ?? [], input.action === "on");
      case "sync":
        return finish(state, ["手动同步。"]);
    }
  });
}

async function toggle(state: ManagerState, names: string[], on: boolean): Promise<ActionResult> {
  const notes: string[] = [];
  if (names.length === 0) {
    return { ok: false, text: "请提供至少一个插件名称或 npm 包名。", changed: false };
  }
  let anyAccepted = false;
  for (const raw of names) {
    const entry = resolveEntry(raw);
    if (!entry) {
      notes.push(`✘ 无法识别：${raw}`);
      continue;
    }
    const pkg = entry.package ?? entry.name;
    if (on) {
      if (!entry.package) {
        notes.push(`✘ ${entry.name}：没有可安装的 npm 包`);
        continue;
      }
      if (entry.compat === "v1") {
        notes.push(`✘ ${entry.name}：只支持 OpenCode V1，V2 无法加载，已拒绝`);
        continue;
      }
      if (entry.compat === "none") {
        notes.push(`✘ ${entry.name}：不是可加载的插件，已拒绝`);
        continue;
      }
      const npm = await checkNpm(pkg, state.npm?.[pkg]);
      state.npm = { ...(state.npm ?? {}), [pkg]: npm };
      if (npm.status === "missing") {
        notes.push(`✘ ${entry.name}：npm 上不存在（404），已拒绝`);
        continue;
      }
      if (npm.status === "deprecated") {
        notes.push(`✘ ${entry.name}：npm 包已弃用（${npm.message ?? "deprecated"}），已拒绝`);
        continue;
      }
      if (npm.status === "error") {
        notes.push(`✘ ${entry.name}：无法确认 npm 可用性（${npm.message ?? "网络错误"}），已拒绝`);
        continue;
      }
      state.selected = unique([...state.selected, pkg]);
      anyAccepted = true;
      notes.push(`✔ ${entry.name} 开关已打开`);
    } else {
      state.selected = state.selected.filter((item) => item.toLowerCase() !== pkg.toLowerCase());
      anyAccepted = true;
      notes.push(`✔ ${entry.name} 开关已关闭`);
    }
  }
  // Only flip the master switch when at least one requested plugin was valid,
  // so a typo or a V1-only package does not silently enable global management.
  if (on && anyAccepted) state.enabled = true;
  await saveState(state);
  return finish(state, notes);
}

async function finish(state: ManagerState, notes: string[]): Promise<ActionResult> {
  const sync = await reconcile(state);
  const lines = [...notes, ...sync.messages];
  return {
    ok: sync.ok,
    text: [...lines, "", statusText(sync.state)].join("\n"),
    changed: sync.changed,
  };
}

export interface ReconcileResult {
  ok: boolean;
  messages: string[];
  state: ManagerState;
  changed: boolean;
}

export async function reconcile(input?: ManagerState): Promise<ReconcileResult> {
  const state = input ?? (await loadState());
  const messages: string[] = [];
  let changed = false;

  const configured = await readConfiguredPlugins();
  const configuredBase = new Map(configured.map((spec) => [basePackage(spec).toLowerCase(), spec]));
  const selected = state.enabled ? state.selected : [];
  const desired = new Map<string, CatalogEntry>();

  for (const key of selected) {
    const entry = resolveEntry(key);
    if (!entry) {
      messages.push(`! 跳过无法识别的开关项：${key}`);
      continue;
    }
    if (!entry.package) {
      messages.push(`! ${entry.name}：没有 npm 包，已跳过`);
      continue;
    }
    if (entry.compat === "v1" || entry.compat === "none") {
      // Stale state from an older catalog: never install incompatible entries.
      messages.push(`! ${entry.name}：${entry.compat === "v1" ? "只支持 V1" : "不是可加载插件"}，已跳过`);
      continue;
    }
    desired.set(entry.package.toLowerCase(), entry);
  }

  const managed = new Set(state.installed.map((pkg) => pkg.toLowerCase()));
  const npmCache = { ...(state.npm ?? {}) };

  // Install desired packages that are missing.
  for (const [key, entry] of desired) {
    const pkg = entry.package!;
    if (configuredBase.has(key)) {
      managed.add(key);
      continue;
    }
    const npm = await checkNpm(pkg, npmCache[pkg]);
    npmCache[pkg] = npm;
    if (npm.status === "missing") {
      messages.push(`✘ ${entry.name}：npm 上不存在（404）`);
      continue;
    }
    if (npm.status === "deprecated") {
      messages.push(`✘ ${entry.name}：npm 包已弃用，已跳过`);
      continue;
    }
    if (npm.status === "error") {
      messages.push(`✘ ${entry.name}：无法确认 npm 可用性（${npm.message ?? "网络错误"}）`);
      continue;
    }
    const result = await runCli(["plugin", "add", pkg]);
    if (result.code === 0) {
      managed.add(key);
      changed = true;
      messages.push(`＋ 已安装 ${entry.name}（${pkg}）`);
    } else {
      messages.push(`✘ 安装 ${entry.name} 失败：${cliError(result)}`);
    }
  }

  // Remove managed packages that are not desired right now.
  for (const key of [...managed]) {
    if (desired.has(key)) continue;
    const spec = configuredBase.get(key);
    if (!spec) {
      managed.delete(key);
      continue;
    }
    const entry = BY_PACKAGE.get(key);
    const result = await runCli(["plugin", "remove", spec]);
    if (result.code === 0) {
      managed.delete(key);
      changed = true;
      messages.push(`－ 已卸载 ${entry?.name ?? key}`);
    } else {
      messages.push(`✘ 卸载 ${entry?.name ?? key} 失败：${cliError(result)}`);
    }
  }

  state.installed = [...managed];
  state.selected = unique(state.selected);
  state.npm = npmCache;
  await saveState(state);

  if (messages.length === 0) messages.push("配置已是最新，无需改动。");
  return {
    ok: !messages.some((line) => line.startsWith("✘")),
    messages,
    state,
    changed,
  };
}

export async function autoSync(): Promise<void> {
  try {
    const state = await loadState();
    if (!state.enabled && state.installed.length === 0) return;
    const result = await reconcile(state);
    if (result.changed) {
      console.log(`[ecosystem-manager] 自动同步：${result.messages.join("；")}`);
    }
  } catch (error) {
    console.error(`[ecosystem-manager] 自动同步失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function listText(state: ManagerState, checkAll: boolean): Promise<string> {
  const configured = new Set((await readConfiguredPlugins()).map((spec) => basePackage(spec).toLowerCase()));
  const selected = new Set(state.selected.map((pkg) => basePackage(pkg).toLowerCase()));
  const npm = { ...(state.npm ?? {}) };
  if (checkAll) {
    const targets = [
      ...new Set(
        CATALOG.filter((entry) => entry.package && entry.compat !== "none").map((entry) => entry.package!),
      ),
    ];
    // The community list is large; keep registry pressure polite.
    await mapLimit(targets, 8, async (pkg) => {
      npm[pkg] = await checkNpm(pkg, npm[pkg]);
    });
    state.npm = npm;
    await saveState(state);
  }

  const official = CATALOG.filter((entry) => entry.source !== "awesome").length;
  const lines: string[] = [];
  lines.push(`OpenCode 插件清单（官方 ${official} + 社区 ${CATALOG.length - official}，共 ${CATALOG.length} 项）`);
  lines.push(`总开关：${state.enabled ? "开" : "关"}　已选：${state.selected.length}　受管安装：${state.installed.length}`);
  lines.push("");
  lines.push("开关  来源  名称 / npm 包 / 兼容 / npm / 作用");
  for (const entry of CATALOG) {
    const pkg = entry.package;
    const key = pkg?.toLowerCase() ?? "";
    const mark = selected.has(key) ? (state.enabled ? "[x]" : "[-]") : configured.has(key) ? "[+]" : "[ ]";
    const compat = entry.compat === "v2" ? "V2" : entry.compat === "v1" ? "V1" : entry.compat === "none" ? "非插件" : "未知";
    const availability = pkg ? npmLabel(npm[pkg]) : "无 npm 包";
    const note = entry.note ? `（${entry.note}）` : "";
    const source = entry.source === "awesome" ? "社区" : "官方";
    lines.push(
      `${mark} [${source}] ${entry.name} / ${pkg ?? "-"} / ${compat} / ${availability} / ${entry.description}${note}`,
    );
  }
  lines.push("");
  lines.push("[x] 开关打开　[-] 已选中但总开关关闭　[+] 已在配置中但未由开关管理　[ ] 关闭");
  lines.push("V1 和非插件条目无法在 OpenCode V2 加载，打开开关时会被拒绝。");
  lines.push("社区条目来自 awesome-opencode；未验证兼容性的条目安装后可能无法加载。");
  return lines.join("\n");
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export function statusText(state: ManagerState): string {
  const lines: string[] = [];
  lines.push(`总开关：${state.enabled ? "开" : "关"}`);
  lines.push(`已选插件（${state.selected.length}）：${state.selected.length ? state.selected.join(", ") : "无"}`);
  lines.push(`受管安装（${state.installed.length}）：${state.installed.length ? state.installed.join(", ") : "无"}`);
  return lines.join("\n");
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 180_000): Promise<CliResult> {
  return new Promise((resolve) => {
    const binary = cliBinary();
    const child = spawn(binary, args, {
      cwd: HOME,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: -1, stdout, stderr: `${stderr}\n命令超时` });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function cliError(result: CliResult): string {
  const text = (result.stderr || result.stdout).trim();
  return text ? text.split(/\r?\n/).slice(-3).join(" ") : `退出码 ${result.code}`;
}

function cliBinary(): string {
  if (process.env.OPENCODE_CLI) return process.env.OPENCODE_CLI;
  if (process.execPath && /opencode/i.test(basename(process.execPath))) return process.execPath;
  const appData = process.env.APPDATA;
  if (appData) {
    const root = join(appData, "ai.opencode.desktop", "cli");
    if (existsSync(root)) {
      const dirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const dir of dirs) {
        for (const name of ["opencode-cli.exe", "opencode.exe"]) {
          const candidate = join(root, dir, name);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  return "opencode";
}
