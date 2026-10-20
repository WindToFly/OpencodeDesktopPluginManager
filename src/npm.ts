// npm registry availability checks, with a short-lived cache.

import type { NpmStatus } from "./paths";

const TTL = 30 * 60 * 1000;

export async function checkNpm(pkg: string, cached?: NpmStatus, force = false): Promise<NpmStatus> {
  if (!force && cached && Date.now() - cached.checked < TTL) return cached;
  const url = registryUrl(pkg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "opencode-ecosystem-manager" },
    });
    if (response.status === 404) {
      return { status: "missing", message: "npm 上不存在（404）", checked: Date.now() };
    }
    if (!response.ok) {
      return { status: "error", message: `npm registry 返回 HTTP ${response.status}`, checked: Date.now() };
    }
    const data = (await response.json()) as {
      version?: string;
      deprecated?: string;
    };
    if (typeof data.deprecated === "string" && data.deprecated.length > 0) {
      return {
        status: "deprecated",
        version: data.version,
        message: data.deprecated,
        checked: Date.now(),
      };
    }
    return { status: "ok", version: data.version, checked: Date.now() };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      checked: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function registryUrl(pkg: string): string {
  if (pkg.startsWith("@")) {
    const slash = pkg.indexOf("/");
    if (slash > 0) return `https://registry.npmjs.org/${pkg.slice(0, slash)}%2F${pkg.slice(slash + 1)}/latest`;
  }
  return `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
}

export function npmLabel(status: NpmStatus | undefined): string {
  if (!status) return "未检查";
  switch (status.status) {
    case "ok":
      return `可用 ${status.version ?? ""}`.trim();
    case "missing":
      return "404";
    case "deprecated":
      return "已弃用";
    case "error":
      return "检查失败";
  }
}
