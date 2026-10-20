// Local browser dashboard for the ecosystem manager.
//
// The server lives for the lifetime of the OpenCode process. It is deliberately
// not closed on plugin cleanup: installing a plugin rewrites opencode.json,
// which reloads plugins, and closing the dashboard mid-action would be rude.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./catalog";
import { basePackage, configFile, loadState, readConfiguredPlugins, STATE_FILE } from "./paths";
import { checkUpdates, perform, serialize, type ActionInput, type ActionResult } from "./manager";

const COOKIE = "opencode_ecosystem_ui";
const HTML_FILE = fileURLToPath(new URL("./ui.html", import.meta.url));
const PREFERRED_PORT = Number(process.env.OPENCODE_ECOSYSTEM_UI_PORT) || 47821;
const MAX_BODY = 64 * 1024;
const UI_KEY = Symbol.for("opencode.ecosystem-manager.ui");

class BadRequestError extends Error {}

const ALLOWED_ACTIONS = new Set<ActionInput["action"]>([
  "on",
  "off",
  "enable",
  "disable",
  "sync",
  "check",
  "updates",
  "upgrade",
]);

interface UiItem {
  name: string;
  package: string | null;
  compat: string;
  description: string;
  note?: string;
  repo?: string;
  source: "official" | "awesome";
  tags?: string[];
  selected: boolean;
  installed: boolean;
  configured: boolean;
  canToggle: boolean;
  reason: string;
  npm: {
    status: "ok" | "missing" | "deprecated" | "error";
    version?: string;
    message?: string;
    checked: number;
  } | null;
}

export interface UiSnapshot {
  enabled: boolean;
  selected: string[];
  installed: string[];
  items: UiItem[];
  counts: {
    total: number;
    official: number;
    awesome: number;
    v2: number;
    selected: number;
    installed: number;
    configured: number;
  };
  configPath: string;
  statePath: string;
}

interface UiServerState {
  server: Server;
  token: string;
  port: number;
  url: string;
  handler: (req: IncomingMessage, res: ServerResponse, state: UiServerState) => Promise<void>;
  action: (input: ActionInput) => Promise<ActionResult>;
  snapshot: () => Promise<UiSnapshot>;
}

type UiGlobal = { [UI_KEY]?: UiServerState };

export async function startUi(): Promise<{ url: string; started: boolean }> {
  const global = globalThis as UiGlobal;
  const existing = global[UI_KEY];
  if (existing) {
    if (!existing.handler) {
      // Server created by an older build of this plugin: rebuild it so the
      // current request handler and UI assets are used.
      await closeServer(existing.server);
      delete global[UI_KEY];
    } else {
      existing.handler = handleRequest;
      existing.action = perform;
      existing.snapshot = snapshot;
      return { url: existing.url, started: false };
    }
  }

  const state = {} as UiServerState;
  state.token = randomBytes(24).toString("hex");
  state.handler = handleRequest;
  state.action = perform;
  state.snapshot = snapshot;
  state.port = 0;
  state.url = "";
  state.server = createServer((req, res) => {
    void state.handler(req, res, state);
  });
  state.server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  try {
    state.port = await listen(state.server, PREFERRED_PORT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    // Another process owns the preferred port. Fall back to an ephemeral port.
    state.server = createServer((req, res) => {
      void state.handler(req, res, state);
    });
    state.server.on("clientError", (_error, socket) => {
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });
    state.port = await listen(state.server, 0);
  }

  state.server.unref();
  state.url = `http://127.0.0.1:${state.port}/?token=${state.token}`;
  global[UI_KEY] = state;
  return { url: state.url, started: true };
}

/** Keep an already-running dashboard bound to the latest plugin code. */
export function bindUi(): void {
  const existing = (globalThis as UiGlobal)[UI_KEY];
  if (!existing || !existing.handler) return;
  existing.handler = handleRequest;
  existing.action = perform;
  existing.snapshot = snapshot;
}

async function closeServer(server: Server): Promise<void> {
  (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const command = platform === "win32" ? "cmd.exe" : platform === "darwin" ? "open" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => {
      console.error(`[ecosystem-manager] 无法打开浏览器：${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.error(
      `[ecosystem-manager] 无法打开浏览器：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function snapshot(): Promise<UiSnapshot> {
  const state = await loadState();
  const configured = await readConfiguredPlugins();
  const configuredBase = new Set(configured.map((spec) => basePackage(spec).toLowerCase()));
  const selected = new Set(state.selected.map((spec) => basePackage(spec).toLowerCase()));
  const installed = new Set(state.installed.map((spec) => spec.toLowerCase()));

  const items = CATALOG.map((entry): UiItem => {
    const pkg = entry.package;
    const key = pkg?.toLowerCase() ?? "";
    const source = entry.source === "awesome" ? "awesome" : "official";
    const canToggle = Boolean(pkg) && entry.compat !== "v1" && entry.compat !== "none";
    const reason = !pkg
      ? source === "awesome"
        ? "社区条目未找到 npm 包"
        : "没有 npm 包"
      : entry.compat === "v1"
        ? "仅支持 V1，V2 无法加载"
        : entry.compat === "none"
          ? "不是可加载插件"
          : "";
    return {
      name: entry.name,
      package: pkg,
      compat: entry.compat,
      description: entry.description,
      note: entry.note,
      repo: entry.repo,
      source,
      tags: entry.tags,
      selected: pkg ? selected.has(key) : false,
      installed: pkg ? installed.has(key) : false,
      configured: pkg ? configuredBase.has(key) : false,
      canToggle,
      reason,
      npm: pkg ? (state.npm?.[pkg] ?? null) : null,
    };
  });

  return {
    enabled: state.enabled,
    selected: state.selected,
    installed: state.installed,
    items,
    counts: {
      total: items.length,
      official: items.filter((item) => item.source === "official").length,
      awesome: items.filter((item) => item.source === "awesome").length,
      v2: items.filter((item) => item.canToggle).length,
      selected: items.filter((item) => item.selected).length,
      installed: items.filter((item) => item.installed).length,
      configured: items.filter((item) => item.configured).length,
    },
    configPath: configFile(),
    statePath: STATE_FILE,
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: UiServerState,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${state.port || 80}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, app: "ecosystem-manager" });
    }

    if (req.method === "GET" && url.pathname === "/") {
      const queryToken = url.searchParams.get("token");
      if (queryToken && safeEqual(queryToken, state.token)) {
        res.setHeader(
          "Set-Cookie",
          `${COOKIE}=${state.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
        );
      } else if (!authorized(req, state.token)) {
        return text(
          res,
          401,
          "未授权。请在 OpenCode 中运行 /ecosystem ui 获取新的访问链接。",
        );
      }
      const html = await readFile(HTML_FILE, "utf8");
      return htmlResponse(res, html);
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/api/state") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      if (!authorized(req, state.token)) return json(res, 401, { error: "unauthorized" });
      return json(res, 200, await state.snapshot());
    }

    if (url.pathname === "/api/updates") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      if (!authorized(req, state.token)) return json(res, 401, { error: "unauthorized" });
      return json(res, 200, await serialize(() => checkUpdates(undefined, true)));
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      if (!authorized(req, state.token)) return json(res, 401, { error: "unauthorized" });
      if (!sameOrigin(req, state.port)) return json(res, 403, { error: "bad origin" });

      const body = await readJson(req);
      const action = body && typeof body.action === "string" ? body.action : "";
      const plugins = body?.plugins;
      if (!ALLOWED_ACTIONS.has(action as ActionInput["action"])) {
        return json(res, 400, { error: "不支持的操作" });
      }
      if (
        plugins !== undefined &&
        (!Array.isArray(plugins) ||
          plugins.length > 50 ||
          plugins.some((item) => typeof item !== "string" || item.length > 200))
      ) {
        return json(res, 400, { error: "plugins 参数无效" });
      }

      const result = await state.action({
        action: action as ActionInput["action"],
        plugins: plugins as string[] | undefined,
      });
      return json(res, 200, {
        ok: result.ok,
        text: result.text,
        snapshot: await state.snapshot(),
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    if (error instanceof BadRequestError) {
      if (!res.headersSent) return json(res, 400, { error: error.message });
      res.end();
      return;
    }
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[ecosystem-manager] 可视化界面请求失败：${message}`);
    if (!res.headersSent) return json(res, 500, { error: "internal error" });
    res.end();
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("无法获取可视化界面端口"));
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers["x-ecosystem-token"];
  if (typeof header === "string" && safeEqual(header, token)) return true;
  const cookie = cookieValue(req.headers.cookie, COOKIE);
  return Boolean(cookie && safeEqual(cookie, token));
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameOrigin(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // curl and other local tools do not send Origin.
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY) {
        fail(new BadRequestError("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("error", (error) => fail(error));
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined,
        );
      } catch {
        reject(new BadRequestError("请求体不是有效 JSON"));
      }
    });
  });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function htmlResponse(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    ...SECURITY_HEADERS,
    "Content-Security-Policy": CSP,
  });
  res.end(html);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader("Allow", allow);
  json(res, 405, { error: "method not allowed" });
}
