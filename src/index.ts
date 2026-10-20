import { Plugin } from "@opencode/plugin";
import { autoSync, perform, type ActionInput } from "./manager";
import { bindUi, openBrowser, startUi } from "./ui";

const AUTO_KEY = Symbol.for("opencode.ecosystem-manager.auto-sync");
let timer: ReturnType<typeof setTimeout> | undefined;

const ACTIONS = ["list", "status", "on", "off", "enable", "disable", "sync", "check", "ui"] as const;
type ToolAction = (typeof ACTIONS)[number];

export default Plugin.define({
  id: "ecosystem.manager",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "ecosystem_manager",
        description:
          "OpenCode 生态插件开关管理器。列出 39 个生态插件及作用、V1/V2 兼容性与 npm 可用性；" +
          "打开开关会自动安装到全局配置，关闭开关会自动卸载。只管理开关选中的插件，不会一次性安装全部。" +
          "action=ui 可打开浏览器可视化面板。",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ACTIONS,
              description:
                "list=列出清单；status=查看开关；on=打开指定插件开关并安装；off=关闭指定插件开关并卸载；" +
                "enable=打开总开关；disable=关闭总开关并卸载所有受管插件；sync=重新同步；check=刷新 npm 可用性；" +
                "ui=打开可视化界面",
            },
            plugins: {
              type: "array",
              items: { type: "string" },
              description: "插件名称或 npm 包名，on/off 时必填。支持一次传多个。",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input) => {
          try {
            const action = (input as { action: ToolAction }).action;
            if (action === "ui") {
              const { url } = await startUi();
              openBrowser(url);
              return {
                content: `可视化界面已打开：${url}\n如果浏览器没有自动打开，请手动访问这个地址。`,
              };
            }
            const result = await perform(input as ActionInput);
            return { content: result.text };
          } catch (error) {
            return {
              content: `生态插件管理失败：${error instanceof Error ? error.message : String(error)}`,
            };
          }
        },
      });
    });

    await ctx.command.transform((editor) => {
      editor.add({
        name: "ecosystem",
        description:
          "查看/切换 OpenCode 生态插件开关（/ecosystem list|on 名称|off 名称|enable|disable|sync|ui）",
        execute: async ({ sessionID, prompt }) => {
          const raw = String(prompt?.text ?? "").trim().replace(/^\/ecosystem\b/i, "").trim();
          const tokens = raw ? raw.split(/\s+/) : [];
          const action = (tokens.shift()?.toLowerCase() ?? "list") as ToolAction;
          let text: string;
          if (!(ACTIONS as readonly string[]).includes(action)) {
            text = [
              "用法：/ecosystem [list|status|on 名称...|off 名称...|enable|disable|sync|check|ui]",
              "示例：/ecosystem on opencode-tavily",
              "示例：/ecosystem off opencode-tavily",
              "示例：/ecosystem ui",
            ].join("\n");
          } else if (action === "ui") {
            try {
              const { url } = await startUi();
              openBrowser(url);
              text = `可视化界面已打开：${url}\n如果浏览器没有自动打开，请手动访问这个地址。`;
            } catch (error) {
              text = `打开可视化界面失败：${error instanceof Error ? error.message : String(error)}`;
            }
          } else {
            try {
              const result = await perform({
                action,
                plugins: action === "on" || action === "off" ? tokens : undefined,
              });
              text = result.text;
            } catch (error) {
              text = `执行失败：${error instanceof Error ? error.message : String(error)}`;
            }
          }
          try {
            await ctx.session.synthetic({ sessionID, text });
          } catch (error) {
            console.error(`[ecosystem-manager] 命令输出失败：${error instanceof Error ? error.message : String(error)}`);
          }
        },
      });
    });

    bindUi();
    scheduleAutoSync();
    return () => {
      if (timer) clearTimeout(timer);
    };
  },
});

function scheduleAutoSync(): void {
  const global = globalThis as Record<symbol, unknown>;
  const last = typeof global[AUTO_KEY] === "number" ? (global[AUTO_KEY] as number) : 0;
  if (Date.now() - last < 15_000) return;
  global[AUTO_KEY] = Date.now();
  timer = setTimeout(() => {
    void autoSync();
  }, 2_000);
}
