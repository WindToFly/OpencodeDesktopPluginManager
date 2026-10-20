// Reconciliation between the switch state and the global opencode.json.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
  type NpmStatus,
} from "./paths";

export interface ActionInput {
  action:
    | "list"
    | "status"
    | "on"
    | "off"
    | "enable"
    | "disable"
    | "sync"
    | "check"
    | "updates"
    | "upgrade";
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
      case "updates":
        return { ok: true, text: updatesText(await checkUpdates(state, true)), changed: false };
      case "upgrade":
        return upgrade(state, input.plugins ?? []);
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

export type UpdateStatus = "outdated" | "current" | "unknown" | "error" | "local";

export interface UpdateItem {
  name: string;
  package: string;
  spec: string;
  current: string;
  latest: string | null;
  status: UpdateStatus;
  self: boolean;
  message?: string;
}

export interface UpdateReport {
  checkedAt: number;
  items: UpdateItem[];
  summary: {
    checked: number;
    outdated: number;
    current: number;
    skipped: number;
  };
}

const SELF_PACKAGE = "opencode-ecosystem-manager";

/**
 * Check every package plugin in the global config for updates. The manager
 * itself is included: when it was installed from npm it is just another
 * configured package, and when it runs from a local directory it is reported
 * as a local build instead of being silently ignored.
 */
export async function checkUpdates(input?: ManagerState, force = false): Promise<UpdateReport> {
  const state = input ?? (await loadState());
  const configured = await readConfiguredPlugins();
  const installed = await cliPluginVersions();
  const own = await ownVersion();
  const items: UpdateItem[] = [];
  const seen = new Set<string>();
  let selfSeen = false;

  for (const spec of configured) {
    const pkg = npmPackageOf(spec);
    if (!pkg) continue;
    const key = pkg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const self = key === SELF_PACKAGE;
    if (self) selfSeen = true;
    const entry = BY_PACKAGE.get(key);
    const current =
      installed.versions.get(spec.trim().toLowerCase()) ??
      installed.versions.get(key) ??
      (self ? own : "unknown");
    const npm = await checkNpm(pkg, state.npm?.[pkg], force);
    state.npm = { ...(state.npm ?? {}), [pkg]: npm };
    items.push(
      buildUpdateItem({
        name: self ? "Ecosystem Manager（管理器自身）" : (entry?.name ?? pkg),
        package: pkg,
        spec,
        current,
        npm,
        self,
        cliError: installed.error,
      }),
    );
  }

  if (!selfSeen) {
    const npm = await checkNpm(SELF_PACKAGE, state.npm?.[SELF_PACKAGE], force);
    state.npm = { ...(state.npm ?? {}), [SELF_PACKAGE]: npm };
    items.unshift({
      name: "Ecosystem Manager（管理器自身）",
      package: SELF_PACKAGE,
      spec: "",
      current: own,
      latest: npm.version ?? null,
      status: "local",
      self: true,
      message:
        own === "dev" || own === "unknown"
          ? "本地开发版 / 未通过全局 npm 安装，无法自动升级"
          : "未在全局配置中，无法自动升级",
    });
  }

  await saveState(state);
  const outdated = items.filter((item) => item.status === "outdated").length;
  return {
    checkedAt: Date.now(),
    items,
    summary: {
      checked: items.length,
      outdated,
      current: items.filter((item) => item.status === "current").length,
      skipped: items.filter((item) => item.status === "local" || item.status === "unknown" || item.status === "error")
        .length,
    },
  };
}

interface BuildUpdateItemInput {
  name: string;
  package: string;
  spec: string;
  current: string;
  npm: NpmStatus;
  self: boolean;
  cliError?: string;
}

function buildUpdateItem(input: BuildUpdateItemInput): UpdateItem {
  const base = {
    name: input.name,
    package: input.package,
    spec: input.spec,
    current: input.current,
    latest: input.npm.version ?? null,
    self: input.self,
  };
  if (input.npm.status !== "ok") {
    return {
      ...base,
      status: "error",
      message: `${npmLabel(input.npm)}${input.npm.message ? `：${input.npm.message}` : ""}`,
    };
  }
  if (!input.npm.version) return { ...base, status: "unknown", message: "npm 未返回版本" };
  if (input.current === "dev") {
    return { ...base, status: "local", message: "本地开发版，跳过自身升级" };
  }
  if (input.current === "unknown") {
    return {
      ...base,
      status: "unknown",
      message: input.cliError ? `无法读取已安装版本：${input.cliError}` : "无法读取已安装版本",
    };
  }
  const comparison = compareVersions(input.npm.version, input.current);
  if (comparison === null) {
    return { ...base, status: "unknown", message: `无法比较版本 ${input.current} → ${input.npm.version}` };
  }
  return { ...base, status: comparison > 0 ? "outdated" : "current" };
}

export function updatesText(report: UpdateReport): string {
  const lines = [
    `OpenCode 插件升级检查（检查 ${report.summary.checked} 个，可升级 ${report.summary.outdated} 个）`,
  ];
  for (const item of report.items) {
    if (item.status === "outdated") {
      lines.push(`↑ ${item.name} / ${item.package} / ${item.current} → ${item.latest}`);
    } else if (item.status === "current") {
      lines.push(`✓ ${item.name} / ${item.package} / ${item.current} 已是最新`);
    } else if (item.status === "local") {
      lines.push(`· ${item.name} / ${item.current} / ${item.message ?? "跳过"}`);
    } else if (item.status === "unknown") {
      lines.push(`? ${item.name} / ${item.package} / ${item.message ?? "版本未知"}`);
    } else {
      lines.push(`✘ ${item.name} / ${item.package} / ${item.message ?? "检查失败"}`);
    }
  }
  lines.push("");
  lines.push("运行 /ecosystem upgrade [名称...] 升级；不带名称会升级全部可升级插件。");
  return lines.join("\n");
}

async function upgrade(state: ManagerState, names: string[]): Promise<ActionResult> {
  const report = await checkUpdates(state, true);
  const picked = pickUpdateTargets(report, names);
  const notes: string[] = picked.missing.map((name) => `✘ 未找到可升级项：${name}`);
  if (picked.targets.length === 0) {
    if (notes.length === 0) notes.push(names.length ? "没有匹配的可升级插件。" : "所有已安装插件都是最新版本。");
    return {
      ok: !notes.some((line) => line.startsWith("✘")),
      text: [...notes, "", updatesText(report)].join("\n"),
      changed: false,
    };
  }

  let changed = false;
  for (const item of picked.targets) {
    if (item.status === "local") {
      notes.push(`· ${item.name}：${item.message ?? "本地开发版，跳过"}`);
      continue;
    }
    if (item.status === "current") {
      notes.push(`✓ ${item.name} 已是最新（${item.current}）`);
      continue;
    }
    if (item.status !== "outdated") {
      notes.push(`? ${item.name}：${item.message ?? "版本未知，跳过"}`);
      continue;
    }
    if (!item.spec) {
      notes.push(`✘ ${item.name}：没有可更新的配置项`);
      continue;
    }
    const result = await runCli(["plugin", "update", item.spec]);
    if (result.code === 0) {
      changed = true;
      notes.push(`↑ 已升级 ${item.name}：${item.current} → ${item.latest ?? "latest"}`);
      if (item.self) notes.push("  管理器自身已更新，重启 OpenCode 后生效。");
    } else {
      notes.push(`✘ 升级 ${item.name} 失败：${cliError(result)}`);
    }
  }

  const refreshed = await checkUpdates(state, true);
  return {
    ok: !notes.some((line) => line.startsWith("✘")),
    text: [...notes, "", updatesText(refreshed)].join("\n"),
    changed,
  };
}

function pickUpdateTargets(
  report: UpdateReport,
  names: string[],
): { targets: UpdateItem[]; missing: string[] } {
  if (names.length === 0) {
    return { targets: report.items.filter((item) => item.status === "outdated"), missing: [] };
  }
  const targets: UpdateItem[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const pkg = basePackage(key);
    const item = report.items.find(
      (candidate) =>
        ((key === "self" || key === "manager") && candidate.self) ||
        candidate.package.toLowerCase() === pkg ||
        candidate.spec.toLowerCase() === key ||
        candidate.name.toLowerCase() === key,
    );
    if (!item) {
      missing.push(raw);
      continue;
    }
    const itemKey = item.package.toLowerCase();
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    targets.push(item);
  }
  return { targets, missing };
}

interface CliPluginVersions {
  versions: Map<string, string>;
  error?: string;
}

async function cliPluginVersions(): Promise<CliPluginVersions> {
  const result = await runCli(["plugin", "list"]);
  const versions = new Map<string, string>();
  if (result.code !== 0) return { versions, error: cliError(result) };
  const output = result.stdout.replace(/\x1b\[[0-9;]*m/g, "");
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^ID\s+VERSION\s+SOURCE$/i.test(line)) continue;
    let version = "";
    let source = "";
    const columns = line.split(/\s{2,}/);
    if (columns.length >= 3) {
      version = columns[1];
      source = columns.slice(2).join("  ").trim();
    } else {
      const match = /^(\S+)\s+(\S+)\s+(.+)$/.exec(line);
      if (!match) continue;
      version = match[2];
      source = match[3].trim();
    }
    if (!source || !version || version === "VERSION") continue;
    versions.set(source.toLowerCase(), version);
    const base = basePackage(source).toLowerCase();
    if (base) versions.set(base, version);
  }
  return { versions };
}

function npmPackageOf(spec: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/^(file:|link:|workspace:|git\+|git@|ssh:|https?:|github:|npm:)/i.test(trimmed)) return null;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^\.{0,2}[\\/]/.test(trimmed)) return null;
  const pkg = basePackage(trimmed);
  if (!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i.test(pkg)) return null;
  return pkg;
}

async function ownVersion(): Promise<string> {
  try {
    const text = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
    if (parsed.name === SELF_PACKAGE && typeof parsed.version === "string") return parsed.version;
  } catch {
    // Local directory plugins do not ship a package.json.
  }
  return "dev";
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index++) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) return difference > 0 ? 1 : -1;
    } else if (xNumeric) {
      return -1;
    } else if (yNumeric) {
      return 1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(value: string): { parts: [number, number, number]; pre: string[] } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
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
