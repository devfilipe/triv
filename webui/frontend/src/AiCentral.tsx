/* triv WebUI — AI Central panel */

import React, { useEffect, useState, useCallback } from 'react'
import {
  Cpu, Zap, Globe, RefreshCw, HardDrive, Layers,
  CheckCircle, AlertTriangle, XCircle, HelpCircle,
  Package, Key, Box, Lock, Plus, Trash2, Eye, EyeOff, Edit2,
  History, Download, ChevronDown, ChevronRight,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopologyAiNode {
  id: string
  label: string
  category: string
  runtime: string
  driver: string
  env?: string | null
  properties: Record<string, any>
}

interface LocalModel {
  name: string
  size_gb: number | null
  modified?: string | null
  capability: 'green' | 'orange' | 'red' | 'unknown'
}

interface RemoteApi {
  provider: string
  base_url: string
  env_var: string
  key_hint: string
  capability: 'green'
}

interface SecretEntry {
  type: string
  hint: string
  env_override: boolean
}

interface LlmContainer {
  name: string
  image: string
  status: string
  ports: string
}

interface AiInventory {
  topology_nodes: TopologyAiNode[]
  local_models: LocalModel[]
  remote_apis: RemoteApi[]
  llm_containers: LlmContainer[]
}

interface Gpu {
  name: string
  vram_total_gb: number
  vram_free_gb: number
  vendor: string
}

interface AiSysinfo {
  ram_total_gb: number | null
  ram_available_gb: number | null
  gpus: Gpu[]
  ollama_models: LocalModel[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Capability = 'green' | 'orange' | 'red' | 'unknown'

function CapBadge({ cap }: { cap: Capability }) {
  const cfg: Record<Capability, { icon: React.FC<any>; color: string; label: string }> = {
    green:   { icon: CheckCircle,    color: '#a6e3a1', label: 'Ready' },
    orange:  { icon: AlertTriangle,  color: '#f9e2af', label: 'Slow' },
    red:     { icon: XCircle,        color: '#f38ba8', label: 'Too big' },
    unknown: { icon: HelpCircle,     color: '#6c7086', label: '?' },
  }
  const { icon: Icon, color, label } = cfg[cap] ?? cfg.unknown
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 600, color,
      background: `${color}18`, borderRadius: 6,
      padding: '2px 7px',
    }}>
      <Icon size={10} />
      {label}
    </span>
  )
}

function SectionHeader({ icon: Icon, title, count }: {
  icon: React.FC<any>; title: string; count?: number
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: 12,
    }}>
      <Icon size={16} color="var(--mauve)" />
      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{title}</span>
      {count !== undefined && (
        <span style={{
          fontSize: 10, color: 'var(--subtext0)',
          background: 'var(--surface0)',
          padding: '1px 6px', borderRadius: 10,
        }}>
          {count}
        </span>
      )}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--mantle)',
      border: '1px solid var(--surface0)',
      borderRadius: 10, padding: 14,
      ...style,
    }}>
      {children}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      padding: '24px 0', textAlign: 'center',
      color: 'var(--subtext0)', fontSize: 12,
    }}>
      {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Topology AI Nodes
// ---------------------------------------------------------------------------

function TopologyTab({ nodes }: { nodes: TopologyAiNode[] }) {
  const llmNodes = nodes.filter(n => n.category === 'llm' || n.runtime === 'llm')
  const agentNodes = nodes.filter(n => n.category === 'agent' || n.runtime === 'agent')
  const otherNodes = nodes.filter(n =>
    !llmNodes.includes(n) && !agentNodes.includes(n)
  )

  function NodeRow({ node }: { node: TopologyAiNode }) {
    const props = node.properties || {}
    const host = props['host'] || props['base_url'] || props['url'] || ''
    const model = props['model'] || props['default_model'] || ''
    return (
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: node.category === 'llm' ? '#cba6f715' : '#f5c2e715',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {node.category === 'llm'
              ? <Cpu size={16} color="#cba6f7" />
              : <Zap size={16} color="#f5c2e7" />
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginBottom: 4,
            }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                {node.label}
              </span>
              <span style={{
                fontSize: 9, color: 'var(--subtext0)',
                background: 'var(--surface0)',
                padding: '1px 5px', borderRadius: 4,
                textTransform: 'uppercase',
              }}>
                {node.category}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {node.driver && (
                <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                  driver: <code style={{ color: 'var(--subtext1)' }}>{node.driver}</code>
                </span>
              )}
              {host && (
                <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                  host: <code style={{ color: 'var(--blue)' }}>{host}</code>
                </span>
              )}
              {model && (
                <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                  model: <code style={{ color: 'var(--green)' }}>{model}</code>
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    )
  }

  if (nodes.length === 0) {
    return (
      <EmptyState message="No LLM or Agent nodes in the active topology. Add nodes with category 'llm' or 'agent' in the Builder." />
    )
  }

  return (
    <div>
      {llmNodes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader icon={Cpu} title="LLM Nodes" count={llmNodes.length} />
          {llmNodes.map(n => <NodeRow key={n.id} node={n} />)}
        </div>
      )}
      {agentNodes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader icon={Zap} title="Agent Nodes" count={agentNodes.length} />
          {agentNodes.map(n => <NodeRow key={n.id} node={n} />)}
        </div>
      )}
      {otherNodes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader icon={Cpu} title="Other AI Nodes" count={otherNodes.length} />
          {otherNodes.map(n => <NodeRow key={n.id} node={n} />)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Host / Local
// ---------------------------------------------------------------------------

function HostTab({ sysinfo, models }: { sysinfo: AiSysinfo | null; models: LocalModel[] }) {
  return (
    <div>
      {/* Hardware summary */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader icon={HardDrive} title="Host Hardware" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          <Card>
            <div style={{ fontSize: 10, color: 'var(--subtext0)', marginBottom: 4 }}>Total RAM</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
              {sysinfo?.ram_total_gb != null ? `${sysinfo.ram_total_gb} GB` : '—'}
            </div>
            {sysinfo?.ram_available_gb != null && (
              <div style={{ fontSize: 10, color: 'var(--subtext0)', marginTop: 2 }}>
                {sysinfo.ram_available_gb} GB available
              </div>
            )}
          </Card>
          {sysinfo && sysinfo.gpus.length > 0 ? (
            sysinfo.gpus.map((gpu, i) => (
              <Card key={i}>
                <div style={{ fontSize: 10, color: 'var(--subtext0)', marginBottom: 4 }}>
                  {gpu.vendor.toUpperCase()} GPU
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                  {gpu.vram_total_gb} GB
                </div>
                <div style={{ fontSize: 10, color: 'var(--subtext0)', marginTop: 2 }}>
                  {gpu.vram_free_gb} GB free VRAM
                </div>
                <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 3 }}>
                  {gpu.name}
                </div>
              </Card>
            ))
          ) : (
            <Card>
              <div style={{ fontSize: 10, color: 'var(--subtext0)', marginBottom: 4 }}>GPU</div>
              <div style={{ fontSize: 14, color: 'var(--overlay1)' }}>Not detected</div>
            </Card>
          )}
        </div>
      </div>

      {/* Ollama models */}
      <div>
        <SectionHeader icon={Package} title="Local Models (Ollama)" count={models.length} />
        {models.length === 0 ? (
          <EmptyState message="No Ollama models found. Install Ollama and pull models to see them here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map(m => (
              <Card key={m.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600, fontSize: 13, color: 'var(--text)',
                      marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                      {m.size_gb != null ? `~${m.size_gb} GB` : 'size unknown'}
                      {m.modified ? `  ·  ${m.modified}` : ''}
                    </div>
                  </div>
                  <CapBadge cap={m.capability} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Containers & Remote APIs
// ---------------------------------------------------------------------------

function ServicesTab({ containers, apis }: { containers: LlmContainer[]; apis: RemoteApi[] }) {
  return (
    <div>
      {/* Remote APIs */}
      <div style={{ marginBottom: 20 }}>
        <SectionHeader icon={Key} title="Remote API Keys" count={apis.length} />
        {apis.length === 0 ? (
          <EmptyState message="No API keys detected. Set environment variables like OPENAI_API_KEY, ANTHROPIC_API_KEY, etc." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {apis.map(api => (
              <Card key={api.provider}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: '#a6e3a115',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Globe size={16} color="#a6e3a1" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                      {api.provider}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                      <code style={{ color: 'var(--overlay1)', marginRight: 8 }}>{api.env_var}</code>
                      key: {api.key_hint}
                    </div>
                  </div>
                  <CapBadge cap="green" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* LLM Containers */}
      <div>
        <SectionHeader icon={Box} title="LLM Containers" count={containers.length} />
        {containers.length === 0 ? (
          <EmptyState message="No running LLM containers detected (checked: ollama, lmstudio, vllm, localai, open-webui, …)." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {containers.map(c => (
              <Card key={c.name}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: '#89b4fa15',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Layers size={16} color="#89b4fa" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--subtext0)', marginBottom: 2 }}>
                      {c.image}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 600,
                        color: c.status.startsWith('Up') ? '#a6e3a1' : '#f38ba8',
                        background: c.status.startsWith('Up') ? '#a6e3a115' : '#f38ba815',
                        padding: '1px 5px', borderRadius: 4,
                      }}>
                        {c.status}
                      </span>
                      {c.ports && (
                        <span style={{ fontSize: 9, color: 'var(--overlay1)', fontFamily: 'var(--font-mono)' }}>
                          {c.ports.split(',')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Secrets
// ---------------------------------------------------------------------------

const SECRET_TYPES = ['api-key', 'bearer', 'url', 'token']

function SecretsTab({ secrets, onRefresh }: {
  secrets: Record<string, SecretEntry>
  onRefresh: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [editName, setEditName] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', type: 'api-key', value: '' })
  const [showValue, setShowValue] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function startAdd() {
    setForm({ name: '', type: 'api-key', value: '' })
    setEditName(null)
    setShowValue(false)
    setErr(null)
    setAdding(true)
  }

  function startEdit(name: string, entry: SecretEntry) {
    setForm({ name, type: entry.type, value: '' })
    setEditName(name)
    setShowValue(false)
    setErr(null)
    setAdding(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setErr('Name is required'); return }
    if (!form.value.trim()) { setErr('Value is required'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(form.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, type: form.type, value: form.value }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.detail ?? 'Error'); return }
      setAdding(false)
      onRefresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete secret "${name}"?`)) return
    setBusy(true)
    try {
      await fetch(`/api/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' })
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const entries = Object.entries(secrets)

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface0)', border: '1px solid var(--surface1)',
    borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)',
    width: '100%', boxSizing: 'border-box',
  }
  const selectStyle: React.CSSProperties = { ...inputStyle }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionHeader icon={Lock} title="Secrets" count={entries.length} />
        {!adding && (
          <button
            onClick={startAdd}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: 'var(--mauve)18', color: 'var(--mauve)',
              border: '1px solid var(--mauve)30', cursor: 'pointer',
            }}
          >
            <Plus size={12} /> Add Secret
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {adding && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
            {editName ? `Edit: ${editName}` : 'New Secret'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600, marginBottom: 3 }}>NAME</div>
              <input
                style={{ ...inputStyle, opacity: editName ? 0.6 : 1 }}
                value={form.name}
                readOnly={!!editName}
                placeholder="openai-prod"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600, marginBottom: 3 }}>TYPE</div>
              <select style={selectStyle} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {SECRET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600, marginBottom: 3 }}>
                VALUE{editName ? ' (leave blank to keep current)' : ''}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: 32 }}
                  type={showValue ? 'text' : 'password'}
                  value={form.value}
                  placeholder={editName ? '(unchanged)' : 'sk-...'}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                />
                <button
                  onClick={() => setShowValue(v => !v)}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--overlay1)', padding: 0,
                  }}
                >
                  {showValue ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            {err && <div style={{ fontSize: 11, color: '#f38ba8' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                onClick={handleSave}
                disabled={busy}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: '#a6e3a1', color: '#1e1e2e', border: 'none',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                Save
              </button>
              <button
                onClick={() => setAdding(false)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11,
                  background: 'var(--surface0)', color: 'var(--subtext1)',
                  border: '1px solid var(--surface1)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Secret list */}
      {entries.length === 0 && !adding ? (
        <EmptyState message="No secrets configured. Add API keys and credentials here — nodes reference them by name." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map(([name, entry]) => (
            <Card key={name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: '#f9e2af15',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Lock size={14} color="#f9e2af" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{name}</span>
                    <span style={{
                      fontSize: 9, color: 'var(--subtext0)',
                      background: 'var(--surface0)', padding: '1px 5px', borderRadius: 4,
                    }}>
                      {entry.type}
                    </span>
                    {entry.env_override && (
                      <span style={{
                        fontSize: 9, color: '#f9e2af',
                        background: '#f9e2af15', padding: '1px 5px', borderRadius: 4,
                      }}>
                        env override
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--overlay1)', fontFamily: 'var(--font-mono)' }}>
                    {entry.hint}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => startEdit(name, entry)}
                    title="Edit"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--overlay1)', padding: 4, borderRadius: 4,
                    }}
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(name)}
                    title="Delete"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--overlay0)', padding: 4, borderRadius: 4,
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 8, background: 'var(--mantle)', fontSize: 10, color: 'var(--subtext0)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--subtext1)' }}>Usage:</strong> In node capabilities, set{' '}
        <code style={{ color: 'var(--blue)' }}>"credential": "secret-name"</code> in driver_args
        instead of storing the key directly.
        Env override: <code style={{ color: 'var(--green)' }}>TRIV_SECRET_SECRET_NAME=…</code>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capability legend
// ---------------------------------------------------------------------------

function CapLegend() {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      padding: '6px 12px',
      background: 'var(--mantle)',
      borderRadius: 8,
      fontSize: 10, color: 'var(--subtext0)',
    }}>
      <span style={{ fontWeight: 600 }}>Capability:</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a6e3a1' }}>
        <CheckCircle size={10} /> GPU VRAM fits OR &gt;1.5× RAM
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f9e2af' }}>
        <AlertTriangle size={10} /> ~1× RAM (slow)
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f38ba8' }}>
        <XCircle size={10} /> Insufficient RAM
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main AiCentral component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tab: History
// ---------------------------------------------------------------------------

interface HistoryEntry {
  ts: string
  type: string
  agent_node: string
  llm_node: string
  model: string
  task: string
  output: string
  tokens: { in: number; out: number }
  duration_s: number
  steps: number
  tool_calls: string[]
}

function HistoryTab({ agentNodeIds }: { agentNodeIds: string[] }) {
  const [selectedNode, setSelectedNode] = useState<string>(agentNodeIds[0] ?? '')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [nodeLabels, setNodeLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/nodes')
      .then(r => r.json())
      .then((nodes: any[]) => {
        const m: Record<string, string> = {}
        for (const n of nodes) m[n.id] = n.label || n.properties?.label || n.id
        setNodeLabels(m)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (agentNodeIds.length > 0 && !selectedNode) setSelectedNode(agentNodeIds[0])
  }, [agentNodeIds, selectedNode])

  const fetchHistory = useCallback(async (nodeId: string) => {
    if (!nodeId) return
    setLoading(true)
    try {
      const data = await fetch(`/api/nodes/${nodeId}/history?limit=100`).then(r => r.json())
      setEntries((data.entries ?? []).slice().reverse())
    } catch { setEntries([]) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchHistory(selectedNode) }, [selectedNode, fetchHistory])

  const handleExport = () => {
    window.open(`/api/nodes/${selectedNode}/history/export`, '_blank')
  }

  const handleClear = async () => {
    if (!confirm('Clear history for this node?')) return
    await fetch(`/api/nodes/${selectedNode}/history`, { method: 'DELETE' })
    setEntries([])
  }

  const totalIn  = entries.reduce((s, e) => s + (e.tokens?.in ?? 0), 0)
  const totalOut = entries.reduce((s, e) => s + (e.tokens?.out ?? 0), 0)

  const st = {
    card: { background: 'var(--surface0)', borderRadius: 8, border: '1px solid var(--surface1)', marginBottom: 8 } as React.CSSProperties,
    mono: { fontFamily: 'var(--font-mono)', fontSize: 11 } as React.CSSProperties,
    badge: (color: string) => ({ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: `${color}20`, color, fontWeight: 600 } as React.CSSProperties),
  }

  return (
    <div style={{ padding: '16px 20px', overflow: 'auto', flex: 1 }}>
      {/* Node selector + controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select
          value={selectedNode}
          onChange={e => setSelectedNode(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--surface1)', background: 'var(--surface0)', color: 'var(--text)', fontSize: 12 }}
        >
          {agentNodeIds.length === 0 && <option value="">— no agent nodes —</option>}
          {agentNodeIds.map(id => (
            <option key={id} value={id}>{nodeLabels[id] ?? id} ({id})</option>
          ))}
        </select>
        <button onClick={() => fetchHistory(selectedNode)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--surface1)', background: 'var(--surface0)', color: 'var(--text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <RefreshCw size={11} /> Refresh
        </button>
        <button onClick={handleExport} disabled={entries.length === 0} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--surface1)', background: 'var(--surface0)', color: 'var(--text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <Download size={11} /> Export JSONL
        </button>
        <button onClick={handleClear} disabled={entries.length === 0} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #f3838720', background: '#f3838710', color: '#f38387', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <Trash2 size={11} /> Clear
        </button>
        {entries.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--subtext0)', marginLeft: 4 }}>
            {entries.length} entries · {totalIn.toLocaleString()} tokens in · {totalOut.toLocaleString()} tokens out
          </span>
        )}
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--overlay0)' }}>Loading…</div>}

      {!loading && entries.length === 0 && (
        <EmptyState message="No interactions recorded yet. Run a task on an Agent node to see history." />
      )}

      {entries.map((e, i) => {
        const key = `${e.ts}-${i}`
        const isOpen = expanded === key
        const dt = new Date(e.ts)
        const timeStr = dt.toLocaleString()
        return (
          <div key={key} style={st.card}>
            {/* Header row */}
            <div
              onClick={() => setExpanded(isOpen ? null : key)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer' }}
            >
              {isOpen ? <ChevronDown size={12} color="var(--overlay1)" /> : <ChevronRight size={12} color="var(--overlay1)" />}
              <span style={{ fontSize: 10, color: 'var(--overlay0)', flexShrink: 0 }}>{timeStr}</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.task}</span>
              <span style={st.badge('#cba6f7')}>{e.model || e.llm_node}</span>
              {e.tokens?.in > 0 && <span style={st.badge('#89b4fa')}>↑{e.tokens.in} ↓{e.tokens.out}</span>}
              <span style={st.badge('#a6e3a1')}>{e.duration_s}s</span>
              {e.steps > 0 && <span style={st.badge('#fab387')}>{e.steps} step{e.steps !== 1 ? 's' : ''}</span>}
              {e.tool_calls?.length > 0 && <span style={st.badge('#f9e2af')}>{e.tool_calls.length} tool{e.tool_calls.length !== 1 ? 's' : ''}</span>}
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--surface1)' }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>LLM node: <b>{nodeLabels[e.llm_node] ?? e.llm_node}</b></span>
                  <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>Model: <b>{e.model || '—'}</b></span>
                  <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>Tokens in: <b>{e.tokens?.in ?? 0}</b></span>
                  <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>Tokens out: <b>{e.tokens?.out ?? 0}</b></span>
                  <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>Duration: <b>{e.duration_s}s</b></span>
                  <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>Steps: <b>{e.steps}</b></span>
                </div>
                {e.tool_calls?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--overlay1)', marginBottom: 4 }}>Tool calls:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {e.tool_calls.map((tc, j) => (
                        <span key={j} style={{ ...st.mono, padding: '2px 6px', borderRadius: 4, background: 'var(--surface1)', color: 'var(--subtext0)', fontSize: 10 }}>{tc}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--overlay1)', marginBottom: 4 }}>Output:</div>
                <pre style={{ ...st.mono, background: 'var(--base)', border: '1px solid var(--surface1)', borderRadius: 6, padding: '8px 10px', margin: 0, overflowX: 'auto', fontSize: 10, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.output}</pre>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

type Tab = 'topology' | 'host' | 'services' | 'secrets' | 'history'

export default function AiCentral() {
  const [tab, setTab] = useState<Tab>('topology')
  const [inventory, setInventory] = useState<AiInventory | null>(null)
  const [sysinfo, setSysinfo] = useState<AiSysinfo | null>(null)
  const [secrets, setSecrets] = useState<Record<string, SecretEntry>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSecrets = useCallback(async () => {
    try {
      const data = await fetch('/api/secrets').then(r => r.json())
      setSecrets(data)
    } catch { /* ignore */ }
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [inv, sys] = await Promise.all([
        fetch('/api/ai/inventory').then(r => r.json()),
        fetch('/api/ai/sysinfo').then(r => r.json()),
      ])
      setInventory(inv)
      setSysinfo(sys)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
    fetchSecrets()
  }, [fetchSecrets])

  useEffect(() => { fetchAll() }, [fetchAll])

  const agentNodeIds = (inventory?.topology_nodes ?? [])
    .filter((n: any) => n.category === 'agent' || n.runtime === 'agent')
    .map((n: any) => n.id)

  const TABS: { id: Tab; label: string; icon: React.FC<any> }[] = [
    { id: 'topology', label: 'Topology Nodes', icon: Cpu },
    { id: 'host',     label: 'Host / Local',   icon: HardDrive },
    { id: 'services', label: 'Services & APIs', icon: Globe },
    { id: 'secrets',  label: 'Secrets',         icon: Lock },
    { id: 'history',  label: 'History',         icon: History },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px 0',
        borderBottom: '1px solid var(--surface0)',
        background: 'var(--base)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
              AI Central
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--subtext0)' }}>
              Inventory of AI/LLM resources: topology nodes, local models, and remote APIs
            </p>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            title="Refresh"
            style={{
              background: 'var(--surface0)', border: '1px solid var(--surface1)',
              borderRadius: 8, padding: '6px 10px',
              cursor: loading ? 'wait' : 'pointer',
              color: 'var(--subtext1)', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12,
            }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(t => {
            const active = tab === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  border: 'none', borderRadius: '8px 8px 0 0',
                  cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400,
                  background: active ? 'var(--surface0)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--subtext0)',
                  borderBottom: active ? '2px solid var(--mauve)' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {error && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            background: '#f38ba815', border: '1px solid #f38ba830',
            color: '#f38ba8', fontSize: 12,
          }}>
            Error: {error}
          </div>
        )}

        {/* Capability legend — only on host tab */}
        {tab === 'host' && inventory && (
          <div style={{ marginBottom: 16 }}>
            <CapLegend />
          </div>
        )}

        {tab === 'topology' && (
          <TopologyTab nodes={inventory?.topology_nodes ?? []} />
        )}
        {tab === 'host' && (
          <HostTab
            sysinfo={sysinfo}
            models={inventory?.local_models ?? []}
          />
        )}
        {tab === 'secrets' && (
          <SecretsTab secrets={secrets} onRefresh={fetchSecrets} />
        )}
        {tab === 'services' && (
          <ServicesTab
            containers={inventory?.llm_containers ?? []}
            apis={inventory?.remote_apis ?? []}
          />
        )}
        {tab === 'history' && (
          <HistoryTab agentNodeIds={agentNodeIds} />
        )}
      </div>
    </div>
  )
}
