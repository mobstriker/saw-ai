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
 * TWO transports are supported, auto-detected from `server.type` and the
 * server's behavior:
 *   - **JSON-RPC / streamable HTTP** (`server.type === 'jsonrpc'`): a single
 *     POST to `server.url` returns the JSON-RPC response. Simple and what most
 *     self-hosted servers use.
 *   - **SSE** (`server.type === 'sse'`): the MCP SSE transport. The client GETs
 *     `server.url`; the server opens an event stream and emits an `endpoint`
 *     event whose data is the URL to POST JSON-RPC requests to. We capture that
 *     endpoint, then POST requests to it. Responses arrive on the SSE stream as
 *     `message` events (JSON-RPC envelopes). This is what hosted MCP servers
 *     (Higgsfield, many remote servers) use — the old code only did plain POST,
 *     so SSE servers never connected.
 *
 * All requests go through `universalFetch` so they work identically on the web
 * and in the Tauri desktop webview (with the CORS-bypassing native fallback).
 */

export interface MCPToolCallResult {
  ok: boolean;
  /** Text result to feed back to the model. */
  content: string;
  isError?: boolean;
  /** Image/video URLs the tool returned, if any (surfaced for media tools). */
  media?: { type: 'image' | 'video'; url: string; mimeType?: string }[];
}

/** Resolve the JSON-RPC POST endpoint for an SSE server via the `endpoint`
 *  event. Returns null if the server isn't reachable or doesn't emit one. */
async function resolveSseEndpoint(server: MCPServer, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await universalFetch(server.url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok && res.status !== 200) return null;
    // The endpoint event usually arrives immediately; read the stream until we
    // see it (or time out). universalFetch returns a Response whose body is a
    // ReadableStream we can read incrementally.
    const reader = res.body?.getReader();
    if (!reader) {
      // Fallback: some SSE servers accept POST directly too.
      return server.url;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by blank lines; each has `event:` and `data:`.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const eventLine = frame.match(/^event:\s*(.+)$/m);
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart());
        const eventName = eventLine?.[1]?.trim();
        const data = dataLines.join('\n');
        if (eventName === 'endpoint' && data) {
          reader.cancel().catch(() => {});
          // Resolve relative endpoints against the server URL.
          try {
            return new URL(data, server.url).toString();
          } catch {
            return data;
          }
        }
      }
    }
    reader.cancel().catch(() => {});
  } catch {
    // SSE handshake failed — fall back to plain POST (some "sse" servers accept it).
  }
  return null;
}

/**
 * Ping a server and discover its real tools. Returns the updated server object
 * (status + tools). For SSE servers we first resolve the POST endpoint, then
 * `tools/list` against it. For JSON-RPC servers we POST directly.
 */
export async function probeMcpServer(server: MCPServer): Promise<MCPServer> {
  const startTime = Date.now();
  try {
    const isSse = server.type === 'sse';
    // For SSE: resolve the endpoint first. For JSON-RPC: POST straight to url.
    let endpoint = server.url;
    if (isSse) {
      const ep = await resolveSseEndpoint(server);
      if (ep) {
        endpoint = ep;
      } else {
        // SSE handshake failed but the GET itself may have opened a stream (which
        // is itself a sign the server is alive). Mark online with no tools.
        return { ...server, status: 'online', latencyMs: Date.now() - startTime };
      }
    }

    // Reachability + tools/list in one call: many servers respond to tools/list
    // even without a separate ping. We also send ping first for JSON-RPC servers
    // so a pure-ping server still registers as online.
    let online = false;
    if (!isSse) {
      try {
        const pingRes = await universalFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
          signal: AbortSignal.timeout(8000),
        });
        online = pingRes.status > 0 && pingRes.status < 500;
      } catch {
        online = false;
      }
    } else {
      online = true; // SSE endpoint resolved => reachable
    }

    let discoveredTools: MCPTool[] | null = null;
    if (online || isSse) {
      try {
        const toolsRes = await universalFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
          signal: AbortSignal.timeout(10000),
        });
        if (toolsRes.ok) {
          // The response may be a plain JSON-RPC envelope OR an SSE stream of
          // `message` events. Handle both.
          const ct = toolsRes.headers.get('content-type') || '';
          let toolsJson: any = null;
          if (ct.includes('text/event-stream')) {
            const text = await toolsRes.text();
            toolsJson = extractJsonFromSse(text);
          } else {
            toolsJson = await toolsRes.json();
          }
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
            online = true;
          }
        }
      } catch {
        // CORS/transport blocked tool discovery — keep existing tools.
      }
    }

    return {
      ...server,
      status: online ? 'online' : 'offline',
      latencyMs: Date.now() - startTime,
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

/** Pull the first JSON-RPC `message` event's data out of an SSE text blob. */
function extractJsonFromSse(text: string): any | null {
  const frames = text.split('\n\n');
  for (const frame of frames) {
    const eventLine = frame.match(/^event:\s*(.+)$/m);
    const eventName = eventLine?.[1]?.trim();
    const dataLines = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart());
    const data = dataLines.join('\n');
    if ((!eventName || eventName === 'message') && data) {
      try {
        return JSON.parse(data);
      } catch {
        // not JSON — keep scanning
      }
    }
  }
  return null;
}

/**
 * Execute a single tool call against an MCP server via JSON-RPC `tools/call`.
 * Returns the result text (concatenated content items) for the model, plus any
 * image/video media the tool returned. For SSE servers we POST to the resolved
 * endpoint and read the response (plain JSON or SSE `message` event).
 */
export async function callMcpTool(
  server: MCPServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<MCPToolCallResult> {
  try {
    // For SSE servers, resolve the POST endpoint fresh (it can rotate).
    let endpoint = server.url;
    if (server.type === 'sse') {
      const ep = await resolveSseEndpoint(server, 10000);
      if (ep) endpoint = ep;
    }

    const res = await universalFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} },
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(60000),
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

    // Response may be plain JSON-RPC or an SSE stream of `message` events.
    const ct = res.headers.get('content-type') || '';
    let json: any;
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      json = extractJsonFromSse(text);
      if (!json) {
        return { ok: false, content: `MCP tool "${toolName}" returned no response on the SSE stream.`, isError: true };
      }
    } else {
      json = await res.json();
    }

    // JSON-RPC error envelope
    if (json?.error) {
      return {
        ok: false,
        content: `MCP tool "${toolName}" error: ${json.error.message || JSON.stringify(json.error)}`,
        isError: true,
      };
    }

    const result = json?.result;
    const media: MCPToolCallResult['media'] = [];
    // MCP tools/call result: { content: [{ type: 'text', text }, { type: 'image', data, mimeType }, ...], isError? }
    if (result?.content && Array.isArray(result.content)) {
      const textParts: string[] = [];
      for (const c of result.content) {
        if (typeof c?.text === 'string' && c.text) {
          textParts.push(c.text);
        } else if (c?.type === 'image' && c.data) {
          // Inline base64 image — surface as a data URL the UI can render.
          media.push({ type: 'image', url: `data:${c.mimeType || 'image/png'};base64,${c.data}`, mimeType: c.mimeType });
        } else if (c?.type === 'resource' && c.resource?.uri) {
          // A resource reference (e.g. a generated video/image URL).
          const uri = c.resource.uri as string;
          const mt = c.resource.mimeType as string | undefined;
          if (/^data:image\//.test(uri) || /\.(png|jpe?g|gif|webp|svg)$/i.test(uri)) {
            media.push({ type: 'image', url: uri, mimeType: mt });
          } else if (/\.(mp4|webm|mov|gif)$/i.test(uri) || (mt && mt.startsWith('video/'))) {
            media.push({ type: 'video', url: uri, mimeType: mt });
          } else {
            textParts.push(`Resource: ${uri}`);
          }
        }
      }
      const text = textParts.filter(Boolean).join('\n');
      // If the tool only returned media (no text), describe it so the model can
      // still reference it; the UI also gets the media array to render.
      let content = text;
      if (media.length > 0 && !text) {
        content = media
          .map((m, i) => `${m.type === 'image' ? 'Image' : 'Video'} ${i + 1}: ${m.url}`)
          .join('\n');
      } else if (media.length > 0) {
        content += '\n' + media.map((m, i) => `${m.type === 'image' ? 'Image' : 'Video'} ${i + 1}: ${m.url}`).join('\n');
      }
      return {
        ok: !result.isError,
        content: content || '(tool returned no content)',
        isError: Boolean(result.isError),
        media: media.length > 0 ? media : undefined,
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
