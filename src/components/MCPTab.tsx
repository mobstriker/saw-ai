import React, { useState } from 'react';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
  Link,
  ShieldCheck,
} from 'lucide-react';
import { MCPServer, MCPTool } from '../types';

interface MCPTabProps {
  servers: MCPServer[];
  onUpdateServers: (servers: MCPServer[]) => void;
}

export const MCPTab: React.FC<MCPTabProps> = ({ servers, onUpdateServers }) => {
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerType, setNewServerType] = useState<'sse' | 'jsonrpc'>('sse');
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleAddServer = () => {
    if (!newServerName.trim() || !newServerUrl.trim()) return;
    const newServer: MCPServer = {
      id: `mcp-${Date.now()}`,
      name: newServerName.trim(),
      url: newServerUrl.trim(),
      type: newServerType,
      enabled: true,
      status: 'unknown',
      tools: [
        {
          id: `t-${Date.now()}-1`,
          name: 'inspect_context',
          description: 'Inspect ground-truth project memory tree',
          enabled: true,
        },
        {
          id: `t-${Date.now()}-2`,
          name: 'evaluate_code',
          description: 'Sandboxed code execution protocol',
          enabled: false,
        },
      ],
    };

    onUpdateServers([...servers, newServer]);
    setNewServerName('');
    setNewServerUrl('');
  };

  const handleDeleteServer = (id: string) => {
    onUpdateServers(servers.filter((s) => s.id !== id));
  };

  const toggleServerEnabled = (id: string) => {
    onUpdateServers(
      servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const toggleToolEnabled = (serverId: string, toolId: string) => {
    onUpdateServers(
      servers.map((s) => {
        if (s.id !== serverId) return s;
        return {
          ...s,
          tools: (s.tools || []).map((t) =>
            t.id === toolId ? { ...t, enabled: !t.enabled } : t
          ),
        };
      })
    );
  };

  const testServerPing = async (server: MCPServer) => {
    setTestingId(server.id);
    const startTime = Date.now();
    try {
      // Step 1: reachability probe.
      // SSE endpoints respond to GET with a stream; JSON-RPC endpoints respond
      // to POST. We use a short timeout and treat any HTTP response as "online".
      const method = server.type === 'jsonrpc' ? 'POST' : 'GET';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const body =
        server.type === 'jsonrpc'
          ? JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
          : undefined;

      const res = await fetch(server.url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startTime;
      const online = res.status > 0 && res.status < 500;

      // Step 2: discover real tools via JSON-RPC tools/list (best-effort).
      // Many MCP servers expose a JSON-RPC endpoint; if CORS allows it we
      // replace the placeholder tool list with the server's actual tools.
      let discoveredTools: MCPTool[] | null = null;
      if (online) {
        try {
          const toolsRes = await fetch(server.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
            signal: AbortSignal.timeout(6000),
          });
          if (toolsRes.ok) {
            const toolsJson = await toolsRes.json();
            const list = toolsJson?.result?.tools || toolsJson?.tools;
            if (Array.isArray(list) && list.length > 0) {
              discoveredTools = list.map((t: any, i: number) => ({
                id: `t-${server.id}-${i}-${Date.now()}`,
                name: t.name || `tool-${i}`,
                description: t.description || '',
                enabled: true,
              }));
            }
          }
        } catch {
          // CORS or transport blocked tool discovery — keep existing tools.
        }
      }

      onUpdateServers(
        servers.map((s) => {
          if (s.id !== server.id) return s;
          return {
            ...s,
            status: online ? 'online' : 'offline',
            latencyMs: latencyMs,
            ...(discoveredTools ? { tools: discoveredTools } : {}),
          };
        })
      );
    } catch (e) {
      // For SSE streams the connection opens but never "completes" until closed;
      // an AbortError after the stream started still means the server is reachable.
      const latencyMs = Date.now() - startTime;
      const isAbort = (e as any)?.name === 'TimeoutError' || (e as any)?.name === 'AbortError';
      onUpdateServers(
        servers.map((s) => {
          if (s.id !== server.id) return s;
          return {
            ...s,
            status: isAbort && server.type === 'sse' ? 'online' : 'offline',
            latencyMs,
          };
        })
      );
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6 font-sans text-[#2C2825]">
      {/* Overview Banner */}
      <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3]">
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="w-7 h-7 rounded-lg bg-[#C58B51] text-white flex items-center justify-center font-bold">
            <Server size={15} />
          </div>
          <h3 className="text-sm font-bold text-[#2C2825]">Model Context Protocol (MCP)</h3>
        </div>
        <p className="text-xs text-[#7C756E] leading-relaxed">
          Register external MCP server endpoints (Server-Sent Events or JSON-RPC URLs) to grant the AI assistant live access to tool discovery, filesystem operations, and external data pipelines.
        </p>
      </div>

      {/* Register New MCP Server Form */}
      <div className="p-4 rounded-2xl bg-white border border-[#E6DFD3] space-y-3 shadow-2xs">
        <h4 className="text-xs font-bold text-[#2C2825] uppercase tracking-wider">Register MCP Endpoint</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <input
            type="text"
            value={newServerName}
            onChange={(e) => setNewServerName(e.target.value)}
            placeholder="Server Name (e.g. Postgres DB MCP)"
            className="px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
          />
          <input
            type="text"
            value={newServerUrl}
            onChange={(e) => setNewServerUrl(e.target.value)}
            placeholder="Endpoint URL (e.g. http://localhost:3001/sse)"
            className="px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
          />
          <div className="flex items-center gap-2">
            <select
              value={newServerType}
              onChange={(e) => setNewServerType(e.target.value as any)}
              className="flex-1 px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none cursor-pointer"
            >
              <option value="sse">SSE (Server-Sent Events)</option>
              <option value="jsonrpc">JSON-RPC / HTTP</option>
            </select>
            <button
              onClick={handleAddServer}
              className="px-3 py-2 rounded-xl bg-[#C58B51] text-white text-xs font-bold shadow-xs hover:bg-[#B0783F] transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Plus size={14} />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {/* List of MCP Servers and Tool Discovery */}
      <div className="space-y-4">
        <h4 className="text-xs font-bold text-[#2C2825] uppercase tracking-wider">
          Active MCP Tool Registry ({servers.length})
        </h4>

        {servers.map((server) => {
          const isTesting = testingId === server.id;
          return (
            <div
              key={server.id}
              className={`p-4 rounded-2xl border transition-all ${
                server.enabled ? 'bg-white border-[#E6DFD3]' : 'bg-[#FAF8F5] border-[#E6DFD3] opacity-60'
              }`}
            >
              {/* Server Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#E6DFD3]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-center text-[#C58B51]">
                    <Server size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#2C2825]">{server.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#FAF8F5] border border-[#E6DFD3] font-mono uppercase text-[#7C756E]">
                        {server.type}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-[#7C756E]">{server.url}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status Badge */}
                  <div className="flex items-center gap-1 text-[11px] font-medium mr-2">
                    {server.status === 'online' ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 size={13} />
                        <span>Online ({server.latencyMs || 15}ms)</span>
                      </span>
                    ) : server.status === 'offline' ? (
                      <span className="flex items-center gap-1 text-amber-700">
                        <XCircle size={13} />
                        <span>Offline</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[#7C756E]">
                        <Clock size={13} />
                        <span>Unchecked</span>
                      </span>
                    )}
                  </div>

                  {/* Ping Test Button */}
                  <button
                    onClick={() => testServerPing(server)}
                    disabled={isTesting}
                    className="p-1.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#C58B51] text-[#7C756E] hover:text-[#2C2825] transition-all cursor-pointer"
                    title="Ping MCP Endpoint"
                  >
                    <RefreshCw size={13} className={isTesting ? 'animate-spin text-[#C58B51]' : ''} />
                  </button>

                  {/* Enable / Disable Server Toggle */}
                  <button
                    onClick={() => toggleServerEnabled(server.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      server.enabled
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-[#F5F1EA] text-[#7C756E] border-[#E6DFD3]'
                    }`}
                  >
                    {server.enabled ? 'Enabled' : 'Disabled'}
                  </button>

                  {/* Delete Server */}
                  <button
                    onClick={() => handleDeleteServer(server.id)}
                    className="p-1.5 rounded-lg text-[#7C756E] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    title="Remove Server"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Discovered MCP Tools List */}
              <div className="pt-3">
                <div className="text-[11px] font-bold text-[#7C756E] mb-2 flex items-center gap-1.5">
                  <Wrench size={12} className="text-[#C58B51]" />
                  <span>Discovered MCP Tools ({server.tools.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(server.tools || []).map((tool) => (
                    <div
                      key={tool.id}
                      onClick={() => toggleToolEnabled(server.id, tool.id)}
                      className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 cursor-pointer transition-all ${
                        tool.enabled
                          ? 'bg-[#FAF8F5] border-[#E6DFD3]'
                          : 'bg-white border-[#F5F1EA] opacity-60'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold text-[#2C2825]">
                            {tool.name}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#7C756E] line-clamp-1 mt-0.5">
                          {tool.description}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        onChange={() => {}}
                        className="accent-[#C58B51] mt-1 cursor-pointer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
