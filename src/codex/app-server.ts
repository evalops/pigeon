import { spawn } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import readline from "node:readline";

type Scope = "discuss_only" | "read_only" | "workspace_write";
type RunInput = { id: string; objective: string; workspace: string; scope: Scope };
type Options = { command?: string; args?: string[]; timeoutMs?: number; model?: string };

export class CodexAppServerAdapter {
  constructor(private readonly options: Options = {}) {}
  async run(input: RunInput, signal?: AbortSignal) {
    if (!isAbsolute(input.workspace)) throw new Error("invalid_workspace");
    let temporary: string | undefined; const cwd = input.scope === "discuss_only" ? (temporary = await mkdtemp(join(tmpdir(), "pigeon-discuss-"))) : await realpath(input.workspace);
    const child = spawn(this.options.command ?? "codex", this.options.args ?? ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"], env: process.env }); const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>(); let nextId = 1; let summary = ""; let terminalResolve: ((value: void) => void) | undefined; let terminalReject: ((error: Error) => void) | undefined;
    const terminal = new Promise<void>((resolve, reject) => { terminalResolve = resolve; terminalReject = reject; }); const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", line => {
      try { const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown> }; if (message.id !== undefined) { const request = pending.get(message.id); if (!request) return; pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message ?? "app_server_error")); else request.resolve(message.result); return; } if (message.method === "item/agentMessage/delta") summary += String(message.params?.delta ?? ""); if (message.method === "turn/completed") { const turn = message.params?.turn as { status?: string } | undefined; if (turn?.status === "completed") terminalResolve?.(); else terminalReject?.(new Error(`codex_turn_${turn?.status ?? "failed"}`)); } } catch (error) { terminalReject?.(error instanceof Error ? error : new Error("invalid_app_server_message")); }
    });
    let stderr = ""; child.stderr.on("data", chunk => { stderr = `${stderr}${String(chunk)}`.slice(-4_000); }); child.once("exit", code => { if (code && pending.size) { const error = new Error(`app_server_exit_${code}:${stderr}`); for (const request of pending.values()) request.reject(error); pending.clear(); terminalReject?.(error); } });
    const request = <T>(method: string, params: unknown) => new Promise<T>((resolve, reject) => { const id = nextId++; pending.set(id, { resolve: value => resolve(value as T), reject }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); });
    const abort = () => { child.kill("SIGTERM"); terminalReject?.(new Error("codex_cancelled")); }; signal?.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => { child.kill("SIGTERM"); terminalReject?.(new Error("codex_timeout")); }, this.options.timeoutMs ?? 30 * 60_000);
    try {
      await request("initialize", { clientInfo: { name: "pigeon", version: "0.1.0" }, capabilities: { experimentalApi: true } }); child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      const sandbox = input.scope === "workspace_write" ? "workspace-write" : "read-only"; const started = await request<{ thread: { id: string } }>("thread/start", { cwd, runtimeWorkspaceRoots: [cwd], sandbox, approvalPolicy: "never", ephemeral: true, serviceName: "pigeon", model: this.options.model ?? process.env.PIGEON_CODEX_MODEL ?? "gpt-5.4" });
      await request("turn/start", { threadId: started.thread.id, cwd, input: [{ type: "text", text: `Pigeon delegation ${input.id}. Complete this bounded objective and report a concise result:\n\n${input.objective}` }], approvalPolicy: "never" }); await terminal; return { threadId: started.thread.id, summary: summary.trim() || "Codex completed the delegation." };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); lines.close(); child.kill("SIGTERM"); if (temporary) await rm(temporary, { recursive: true, force: true }); }
  }
}
