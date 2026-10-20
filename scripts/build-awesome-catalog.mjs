#!/usr/bin/env node
// Build src/awesome-catalog.ts from the live awesome-opencode registry.
//
// The upstream registry does not include npm package names, so this script also
// reads each project's package.json and the npm registry metadata. Results are
// committed as a TypeScript snapshot: the plugin itself never needs network
// access just to list the catalog.

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_URL =
  process.env.AWESOME_REGISTRY_URL ??
  "https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/dist/registry.json";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = resolve(ROOT, "src", "awesome-catalog.ts");
const CONCURRENCY = Math.max(1, Number(process.env.AWESOME_CONCURRENCY) || 8);
const TIMEOUT_MS = Math.max(1000, Number(process.env.AWESOME_TIMEOUT_MS) || 20_000);

function parseRepo(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (!owner || !repo || owner === "gist" || repo === "gist") return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function isPackageName(value) {
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(value);
}

function packageNamesFromInstallation(text) {
  if (typeof text !== "string" || !text) return [];
  const found = new Set();
  const quotedArrays = [/"plugins?"\s*:\s*\[([^\]]*)\]/gi, /plugins?\s*:\s*\[([^\]]*)\]/gi];
  for (const pattern of quotedArrays) {
    for (const match of text.matchAll(pattern)) {
      for (const quoted of match[1].matchAll(/["']([^"']+)["']/g)) {
        if (isPackageName(quoted[1])) found.add(quoted[1]);
      }
    }
  }
  const command =
    /(?:npm\s+(?:i|install)|npx|bun\s+add|pnpm\s+add|yarn\s+add|opencode\s+plugin\s+add)\s+(?:--?[\w-]+\s+)*(@?[a-z0-9][\w./@-]*)/gi;
  for (const match of text.matchAll(command)) {
    if (isPackageName(match[1])) found.add(match[1]);
  }
  return [...found];
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "opencode-ecosystem-manager-catalog" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { status: response.status, data: null };
    return { status: response.status, data: await response.json() };
  } catch (error) {
    return { status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function hasExportKey(exportsField, key) {
  if (!exportsField || typeof exportsField !== "object") return false;
  for (const [name, value] of Object.entries(exportsField)) {
    if (name === key) return true;
    if (hasExportKey(value, key)) return true;
  }
  return false;
}

function dependencyNames(root, npm) {
  const names = new Set();
  for (const source of [root, npm]) {
    if (!source || typeof source !== "object") continue;
    for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
      const value = source[field];
      if (!value || typeof value !== "object") continue;
      for (const name of Object.keys(value)) names.add(name);
    }
  }
  return names;
}

function detectCompat(root, npm) {
  if (hasExportKey(npm?.exports, "./server") || hasExportKey(npm?.exports, "./v2")) return "v2";
  const deps = dependencyNames(root, npm);
  const hasV2 = deps.has("@opencode/plugin");
  const hasV1 = deps.has("@opencode-ai/plugin");
  if (hasV2 && !hasV1) return "v2";
  if (hasV1 && !hasV2) return "v1";
  // Packages that ship both API generations are usually V2-first, but without
  // checking the actual entrypoint we cannot be certain. Treat them as unknown
  // instead of silently allowing a V1-only entry.
  if (hasV2 && hasV1) return "unknown";

  const readme = typeof npm?.readme === "string" ? npm.readme : "";
  const mentionsV2 = /@opencode\/plugin|Plugin\.define/.test(readme);
  const mentionsV1 = /@opencode-ai\/plugin/.test(readme);
  if (mentionsV2 && !mentionsV1) return "v2";
  if (mentionsV1 && !mentionsV2) return "v1";
  return "unknown";
}

function npmUrl(pkg) {
  if (pkg.startsWith("@")) {
    const slash = pkg.indexOf("/");
    if (slash > 0) return `https://registry.npmjs.org/${pkg.slice(0, slash)}%2F${pkg.slice(slash + 1)}/latest`;
  }
  return `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
}

function cleanText(value, max = 160) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function choosePackage(entry, root) {
  const fromInstall = packageNamesFromInstallation(entry.installation);
  if (fromInstall.length === 1) return fromInstall[0];

  const rootName = typeof root?.name === "string" && isPackageName(root.name) ? root.name : null;
  if (fromInstall.length > 1) {
    const rootMatch = rootName ? fromInstall.find((name) => name === rootName) : undefined;
    return rootMatch ?? fromInstall[0];
  }
  if (!rootName) return null;
  if (root?.private === true) return null;
  if (root?.workspaces) return null; // Workspace root, not the plugin package itself.
  return rootName;
}

function noteFor({ pkg, npmStatus, compat }) {
  const parts = ["社区收录 · awesome-opencode"];
  if (!pkg) parts.push("未找到 npm 包");
  else if (npmStatus === 404) parts.push("npm 上未找到");
  if (compat === "v1") parts.push("仅支持 V1");
  else if (compat === "unknown" && pkg) parts.push("V2 兼容性未验证");
  return parts.join("；");
}

async function buildEntry(entry) {
  const repo = parseRepo(entry.repoUrl);
  let root = null;
  let rootStatus = "skip";
  if (repo) {
    const response = await fetchJson(
      `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/package.json`,
    );
    rootStatus = String(response.status);
    root = response.data;
  }

  const pkg = choosePackage(entry, root);
  let npm = null;
  let npmStatus = 0;
  if (pkg) {
    const response = await fetchJson(npmUrl(pkg));
    npmStatus = response.status;
    npm = response.data;
  }

  const compat = detectCompat(root, npm);
  const description =
    cleanText(entry.tagline) || cleanText(entry.description) || "Community OpenCode plugin";

  return {
    name: cleanText(entry.displayName, 100) || pkg || "Community plugin",
    package: pkg,
    compat,
    description,
    note: noteFor({ pkg, npmStatus, compat }),
    repo: entry.repoUrl,
    source: "awesome",
    tags: Array.isArray(entry.tags)
      ? [...new Set(entry.tags.map((tag) => cleanText(tag, 30)).filter(Boolean))].slice(0, 8)
      : [],
    productId: entry.productId,
    npmStatus,
    rootStatus,
  };
}

function render(rows, generatedAt) {
  const lines = [
    "// Generated by scripts/build-awesome-catalog.mjs. Do not edit by hand.",
    "// Community source: https://github.com/awesome-opencode/awesome-opencode",
    `// Snapshot: ${generatedAt}`,
    'import type { CatalogEntry } from "./catalog";',
    "",
    "export const AWESOME_CATALOG: CatalogEntry[] = [",
  ];
  for (const row of rows) {
    lines.push("  {");
    lines.push(`    name: ${JSON.stringify(row.name)},`);
    lines.push(`    package: ${row.package ? JSON.stringify(row.package) : "null"},`);
    lines.push(`    compat: ${JSON.stringify(row.compat)},`);
    lines.push(`    description: ${JSON.stringify(row.description)},`);
    lines.push(`    note: ${JSON.stringify(row.note)},`);
    lines.push(`    repo: ${JSON.stringify(row.repo)},`);
    lines.push('    source: "awesome",');
    if (row.tags.length) lines.push(`    tags: ${JSON.stringify(row.tags)},`);
    lines.push("  },");
  }
  lines.push("];", "");
  return lines.join("\n");
}

const registryResponse = await fetchJson(REGISTRY_URL);
if (!registryResponse.data || !Array.isArray(registryResponse.data)) {
  console.error(`Could not read the awesome-opencode registry (HTTP ${registryResponse.status}).`);
  process.exit(1);
}
const plugins = registryResponse.data.filter((entry) => entry.type === "plugins");
if (plugins.length < 50) {
  console.error(`Registry returned only ${plugins.length} plugins; refusing to overwrite the catalog.`);
  process.exit(1);
}

const rows = await pool(plugins, CONCURRENCY, buildEntry);
rows.sort((left, right) => left.name.localeCompare(right.name, "en"));

// Display names occasionally collide. Keep catalog resolution deterministic by
// adding the product id to later entries instead of losing one behind a name.
const seenNames = new Set();
for (const row of rows) {
  const key = row.name.toLowerCase();
  if (seenNames.has(key)) row.name = `${row.name} (${row.productId ?? row.package ?? "community"})`;
  seenNames.add(row.name.toLowerCase());
}

const generatedAt = new Date().toISOString();
await writeFile(OUT_FILE, render(rows, generatedAt), "utf8");

const stats = {
  total: rows.length,
  packages: rows.filter((row) => row.package).length,
  npmOk: rows.filter((row) => row.npmStatus === 200).length,
  npm404: rows.filter((row) => row.npmStatus === 404).length,
  noPackage: rows.filter((row) => !row.package).length,
  v2: rows.filter((row) => row.compat === "v2").length,
  v1: rows.filter((row) => row.compat === "v1").length,
  unknown: rows.filter((row) => row.compat === "unknown").length,
};
console.log(`awesome-opencode plugins: ${stats.total}`);
console.log(
  `packages: ${stats.packages} (npm ok ${stats.npmOk}, 404 ${stats.npm404}); no package: ${stats.noPackage}`,
);
console.log(`compat: v2 ${stats.v2}, v1 ${stats.v1}, unknown ${stats.unknown}`);
console.log(`wrote ${OUT_FILE}`);
