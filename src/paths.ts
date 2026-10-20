// Filesystem helpers: global config discovery, JSONC parsing, state persistence.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HOME = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
export const CONFIG_DIR = join(HOME, ".config", "opencode");
export const PLUGIN_DIR = join(CONFIG_DIR, "plugins", "ecosystem-manager");
export const DATA_DIR = join(HOME, ".local", "share", "opencode", "ecosystem-manager");
export const STATE_FILE = join(DATA_DIR, "state.json");

export function configFile(): string {
  const json = join(CONFIG_DIR, "opencode.json");
  const jsonc = join(CONFIG_DIR, "opencode.jsonc");
  if (existsSync(json)) return json;
  if (existsSync(jsonc)) return jsonc;
  return json;
}

export interface ManagerState {
  /** Master switch. When false every managed plugin is uninstalled. */
  enabled: boolean;
  /** Packages the user turned on. Kept while the master switch is off. */
  selected: string[];
  /** Packages this manager installed and may uninstall. */
  installed: string[];
  /** Cached npm availability, keyed by package name. */
  npm?: Record<string, NpmStatus>;
}

export const EMPTY_STATE: ManagerState = { enabled: false, selected: [], installed: [] };

export async function loadState(): Promise<ManagerState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagerState>;
    return {
      enabled: parsed.enabled === true,
      selected: unique(Array.isArray(parsed.selected) ? parsed.selected.filter(isString) : []),
      installed: unique(Array.isArray(parsed.installed) ? parsed.installed.filter(isString) : []),
      npm: parsed.npm && typeof parsed.npm === "object" ? parsed.npm : {},
    };
  } catch {
    return { ...EMPTY_STATE, npm: {} };
  }
}

export async function saveState(state: ManagerState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const text = JSON.stringify(state, null, 2) + "\n";
  await writeFile(STATE_FILE, text, "utf8");
}

export interface NpmStatus {
  status: "ok" | "missing" | "deprecated" | "error";
  version?: string;
  message?: string;
  checked: number;
}

/** Strip // and block comments plus trailing commas, preserving string contents. */
export function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  let line = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (line) {
      if (c === "\n") {
        line = false;
        out += c;
      }
      continue;
    }
    if (block) {
      if (c === "*" && n === "/") {
        block = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      line = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      block = true;
      i++;
      continue;
    }
    out += c;
  }
  return dropTrailingCommas(out);
}

function dropTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

/** Read the global config's plugin entries as bare package names. */
export async function readConfiguredPlugins(): Promise<string[]> {
  try {
    const raw = await readFile(configFile(), "utf8");
    const parsed = JSON.parse(stripJsonc(raw)) as { plugins?: unknown };
    if (!Array.isArray(parsed.plugins)) return [];
    const out: string[] = [];
    for (const item of parsed.plugins) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object" && typeof (item as { package?: unknown }).package === "string") {
        out.push((item as { package: string }).package);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Remove a trailing @version from a package specifier. */
export function basePackage(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return trimmed;
  const at = trimmed.lastIndexOf("@");
  if (at > 0) return trimmed.slice(0, at);
  return trimmed;
}

export function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export async function ensureDataDir(): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
}
