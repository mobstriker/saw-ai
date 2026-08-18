import { MCPServer, MCPTool } from '../types';
import { universalFetch } from './chatProxy';

/**
 * MCP (Model Context Protocol) execution bridge.
 *
 * The app talks to MCP servers over JSON-RPC 2.0 (the same wire format every
 * MCP server speaks). Two methods are used:
 *   - `tools/list`  → discover the server's real tools (name, description,
 *     input schema). Replaces the placeholder tool list the UI seeds.
 *   - `tools/call`  → actually execute a tool with arguments and return the
 *     result text the model can read.
 *
 * All requests go through `universalFetch` so they work identically on the web
 * and in the Tauri desktop webview (with the CORS-bypassing native fallback).
 */

export interface MCPToolCallResult {
  ok: boolean;
  /** Text result to feed back to the model. */
  content: string;
  isError?: boolean;
}

/**
 * Ping a server and discover its real tools. Returns the updated server object
 * (status + tools). Mirrors the manual "Test connection" path in MCPTab so the
 * auto status-check on app load can reuse it.
 */
export async function probeMcpServer(server: MCPServer): Promise<MCPServer> {
  const startTime = Date.now();
  try {
    // Reachability probe: JSON-RPC servers respond to POST.
    const pingRes = await universalFetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - startTime;
    const online = pingRes.status > 0 && pingRes.status < 500;

    let discoveredTools: MCPTool[] | null = null;
    if (online) {
      try {
        const toolsRes = await universalFetch(server.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
          signal: AbortSignal.timeout(8000),
        });
        if (toolsRes.ok) {
          const toolsJson = await toolsRes.json();
          const list = toolsJson?.result?.tools || toolsJson?.tools;
          if (Array.isArray(list) && list.length > 0) {
            discoveredTools = list.map((t: any, i: number) => ({
              id: `t-${server.id}-${i}-${Date.now()}`,
              name: t.name || `tool-${i}`,
              description: t.description || '',
              parametersSchema:
                typeof t.inputSchema === 'string'
                  ? t.inputSchema
                  : t.inputSchema
                    ? JSON.stringify(t.inputSchema)
                    : undefined,
              enabled: true,
            }));
          }
        }
      } catch {
        // CORS/transport blocked tool discovery — keep existing tools.
      }
    }

    return {
      ...server,
      status: online ? 'online' : 'offline',
      latencyMs,
      ...(discoveredTools ? { tools: discoveredTools } : {}),
    };
  } catch (e: any) {
    const isAbort = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    // SSE servers open a stream that never "completes" — an abort still means
    // the server was reachable.
    return {
      ...server,
      status: isAbort && server.type === 'sse' ? 'online' : 'offline',
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a single tool call against an MCP server via JSON-RPC `tools/call`.
 * Returns the result text (concatenated content items) for the model.
 */
export async function callMcpTool(
  server: MCPServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<MCPToolCallResult> {
  try {
    const res = await universalFetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} },
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = j?.error?.message || j?.message || detail;
      } catch {
        // ignore
      }
      return { ok: false, content: `MCP tool "${toolName}" failed: ${detail}`, isError: true };
    }

    const json = await res.json();
    // JSON-RPC error envelope
    if (json?.error) {
      return {
        ok: false,
        content: `MCP tool "${toolName}" error: ${json.error.message || JSON.stringify(json.error)}`,
        isError: true,
      };
    }

    const result = json?.result;
    // MCP tools/call result: { content: [{ type: 'text', text: '...' }, ...], isError? }
    if (result?.content && Array.isArray(result.content)) {
      const text = result.content
        .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
        .filter(Boolean)
        .join('\n');
      return {
        ok: !result.isError,
        content: text || '(tool returned no text content)',
        isError: Boolean(result.isError),
      };
    }
    // Some servers return a plain string / object.
    if (typeof result === 'string') {
      return { ok: true, content: result };
    }
    return { ok: true, content: JSON.stringify(result ?? '(empty result)') };
  } catch (e: any) {
    return {
      ok: false,
      content: `MCP tool "${toolName}" could not be reached: ${e?.message || String(e)}`,
      isError: true,
    };
  }
}

export interface ParsedToolCall {
  /** Server + tool, e.g. "serverName/toolName". Split on first '/'. */
  raw: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Parse tool-call requests the model emitted. Supports two shapes:
 *
 * 1. Native OpenAI-style tool_calls (handled by the caller from the SSE delta;
 *    this function is for the text-based fallback).
 * 2. A fenced ```mcp_tool_call JSON block the model is instructed to emit when
 *    the provider doesn't support native function calling:
 *
 *    ```mcp_tool_call
 *    { "tool": "serverName/toolName", "arguments": { ... } }
 *    ```
 *
 *    A plain inline form `<tool_call>{...}</tool_call>` is also accepted.
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  if (!text) return [];
  const out: ParsedToolCall[] = [];

  // Fenced ```mcp_tool_call ... ``` blocks
  const fence = /```mcp_tool_call\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const parsed = parseOne(m[1]);
    if (parsed) out.push(parsed);
  }

  // Inline <tool_call>{...}</tool_call>
  const inline = /<tool_call>\s*([\s\S]*?)<\/tool_call>/gi;
  while ((m = inline.exec(text)) !== null) {
    const parsed = parseOne(m[1]);
    if (parsed) out.push(parsed);
  }

  return out;
}

function parseOne(raw: string): ParsedToolCall | null {
  try {
    const obj = JSON.parse(raw.trim());
    const tool = obj.tool || obj.name || '';
    if (!tool) return null;
    const args = obj.arguments || obj.args || obj.parameters || {};
    const idx = tool.indexOf('/');
    const serverName = idx >= 0 ? tool.slice(0, idx).trim() : '';
    const toolName = idx >= 0 ? tool.slice(idx + 1).trim() : tool.trim();
    if (!toolName) return null;
    return { raw: tool, serverName, toolName, args };
  } catch {
    return null;
  }
}
