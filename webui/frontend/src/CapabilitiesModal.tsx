/* triv WebUI — CapabilitiesModal: capabilities editor as a pop-up modal.
   Extracted from NodeCapabilities; opened from BuilderCanvas properties panel. */

import React, { useCallback, useEffect, useState } from 'react'
import {
  Cpu, Monitor, Box, Shield, Zap, Plus, Trash2, Save,
  X, ChevronDown, ChevronRight, AlertTriangle, Loader2,
  FileJson, RefreshCw, Settings, Terminal, Play, Info, Activity,
  HardDrive, Layers, Package, Copy, Code, Search,
} from 'lucide-react'
import type { NodeDef } from './types'
import { RUNTIME_BADGE } from './types'

/* ── Types ────────────────────────────────────────────────────────── */
interface DriverEntry {
  driver: string
  driver_args: Record<string, any>
}

interface SchemaField {
  type: string; label: string; description: string
  required?: boolean; default?: any; placeholder?: string
  depends_on?: string; provider?: string; filter_runtime?: string
}

interface CatalogDriver {
  id: string; kind: 'json-driver' | 'py-driver'
  type: string; label: string; vendor: string; version: string
  accent_color: string
  driver_args_schema: Record<string, SchemaField>
  actions: Record<string, any>
  origin?: string
}

interface CapabilitiesData {
  node_id: string; env_file: string; file_exists: boolean
  drivers: DriverEntry[]
  driver_args: Record<string, any>
  actions: any[]; health: any; raw: any
}

/* ── LLM provider / model data ────────────────────────────────────── */
const _PROVIDERS = ['openai', 'anthropic', 'xai', 'gemini', 'groq', 'lmstudio', 'mistral', 'together', 'fireworks', 'deepseek', 'cohere'] as const
const _PROVIDER_LABELS: Record<string, string> = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  xai:       'xAI (Grok)',
  gemini:    'Google Gemini',
  groq:      'Groq',
  lmstudio:  'LM Studio (local)',
  mistral:   'Mistral AI',
  together:  'Together AI',
  fireworks: 'Fireworks AI',
  deepseek:  'DeepSeek',
  cohere:    'Cohere',
}
const _PROVIDER_BASE_URLS: Record<string, string> = {
  openai:    'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  xai:       'https://api.x.ai/v1',
  gemini:    'https://generativelanguage.googleapis.com/v1beta/openai',
  groq:      'https://api.groq.com/openai/v1',
  lmstudio:  'http://localhost:1234/v1',
  mistral:   'https://api.mistral.ai/v1',
  together:  'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  deepseek:  'https://api.deepseek.com/v1',
  cohere:    'https://api.cohere.com/v2',
}
const _KNOWN_BASE_URLS = new Set(Object.values(_PROVIDER_BASE_URLS))

const _PROVIDER_MODELS: Record<string, string[]> = {
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini', 'gpt-3.5-turbo'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  xai:       ['grok-3', 'grok-3-mini', 'grok-3-fast', 'grok-3-mini-fast', 'grok-2-1212', 'grok-2-vision-1212', 'grok-beta'],
  gemini:    ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-thinking-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
  groq:      ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'gemma-7b-it', 'deepseek-r1-distill-llama-70b'],
  mistral:   ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'pixtral-large-latest', 'codestral-latest', 'open-mixtral-8x22b', 'open-mixtral-8x7b', 'open-mistral-7b'],
  together:  ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'Qwen/Qwen2.5-7B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'google/gemma-2-27b-it', 'deepseek-ai/DeepSeek-R1'],
  fireworks: ['accounts/fireworks/models/llama-v3p1-70b-instruct', 'accounts/fireworks/models/llama-v3p1-8b-instruct', 'accounts/fireworks/models/qwen2p5-72b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct', 'accounts/fireworks/models/deepseek-r1'],
  deepseek:  ['deepseek-chat', 'deepseek-reasoner'],
  cohere:    ['command-r-plus-08-2024', 'command-r-08-2024', 'command-r7b-12-2024', 'command-light', 'command'],
  // ollama and lmstudio: fetched dynamically from local API
}

/* ── ProviderField component ──────────────────────────────────────── */
function ProviderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isKnown = (_PROVIDERS as readonly string[]).includes(value)
  const [showCustom, setShowCustom] = React.useState(!isKnown && value !== '')
  const selectVal = showCustom ? '__custom__' : (isKnown ? value : '')
  return (
    <>
      <select
        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--surface1)', background: 'var(--surface0)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
        value={selectVal}
        onChange={e => {
          if (e.target.value === '__custom__') { setShowCustom(true); if (isKnown) onChange('') }
          else { setShowCustom(false); onChange(e.target.value) }
        }}
      >
        <option value="">— select provider —</option>
        {_PROVIDERS.map(p => <option key={p} value={p}>{_PROVIDER_LABELS[p]}</option>)}
        <option value="__custom__">Custom…</option>
      </select>
      {showCustom && (
        <input
          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--surface1)', background: 'var(--surface0)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box', marginTop: 4 }}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="custom-provider"
          autoFocus
        />
      )}
    </>
  )
}

/* ── ModelField component ─────────────────────────────────────────── */
function ModelField({ value, onChange, provider, baseUrl }: {
  value: string; onChange: (v: string) => void; provider: string; baseUrl?: string
}) {
  const [dynamicModels, setDynamicModels] = React.useState<string[]>([])
  const [fetching, setFetching] = React.useState(false)
  const knownModels = _PROVIDER_MODELS[provider] ?? []
  const allModels = knownModels.length > 0 ? knownModels : dynamicModels
  const isKnown = allModels.includes(value)
  const [showCustom, setShowCustom] = React.useState(!isKnown && value !== '')
  const selectVal = showCustom ? '__custom__' : (isKnown ? value : '')
  const isLocalProvider = provider === 'ollama' || provider === 'lmstudio'

  const fetchLocal = React.useCallback(async () => {
    const base = (baseUrl ?? '').replace(/\/$/, '') || (provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1')
    setFetching(true)
    try {
      if (provider === 'ollama') {
        const r = await fetch(`${base}/api/tags`)
        const data = await r.json()
        setDynamicModels((data.models ?? []).map((m: any) => String(m.name)))
      } else {
        const r = await fetch(`${base}/v1/models`)
        const data = await r.json()
        setDynamicModels((data.data ?? []).map((m: any) => String(m.id)))
      }
    } catch { /* service not running */ }
    setFetching(false)
  }, [provider, baseUrl])

  React.useEffect(() => { if (isLocalProvider) fetchLocal() }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

  const st: React.CSSProperties = { width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--surface1)', background: 'var(--surface0)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box' }

  if (allModels.length === 0) {
    // Local provider with no models fetched yet, or unknown provider → plain text input
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <input style={{ ...st, flex: 1 }} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="model-name" />
        {isLocalProvider && (
          <button style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid #89b4fa40', background: '#89b4fa15', color: '#89b4fa', fontSize: 11, display: 'inline-flex', alignItems: 'center' }} onClick={fetchLocal} title="Fetch available models">
            {fetching ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          style={{ ...st, flex: 1, cursor: 'pointer' }}
          value={selectVal}
          onChange={e => {
            if (e.target.value === '__custom__') { setShowCustom(true); if (isKnown) onChange('') }
            else { setShowCustom(false); onChange(e.target.value) }
          }}
        >
          <option value="">— select model —</option>
          {allModels.map(m => <option key={m} value={m}>{m}</option>)}
          <option value="__custom__">Other…</option>
        </select>
        {isLocalProvider && (
          <button style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid #89b4fa40', background: '#89b4fa15', color: '#89b4fa', fontSize: 11, display: 'inline-flex', alignItems: 'center' }} onClick={fetchLocal} title="Refresh model list">
            {fetching ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
          </button>
        )}
      </div>
      {showCustom && (
        <input style={{ ...st, marginTop: 4 }} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="model-name" autoFocus />
      )}
    </>
  )
}

/* ── ActionMultiselectField component ────────────────────────────── */
// Used by generic-driver-ai-tool's "expose_actions" field.
// Shows the node's OWN resolved actions so the user can pick which to expose.
function ActionMultiselectField({ value, onChange, nodeId, catalog }: {
  value: string; onChange: (v: string) => void; nodeId: string; catalog: CatalogDriver[]
}) {
  const [groups, setGroups] = React.useState<{ driverId: string; driverLabel: string; accent: string; actions: { id: string; label: string }[] }[]>([])
  const [fetching, setFetching] = React.useState(false)

  const selected = React.useMemo(
    () => new Set(value.split(',').map(s => s.trim()).filter(Boolean)),
    [value],
  )

  const AI_TYPES = new Set(['ai-llm', 'ai-agent', 'ai-tool'])
  const SKIP_TYPES = new Set(['console', 'ssh', 'link', 'webui'])

  const fetchActions = React.useCallback(async () => {
    setFetching(true)
    try {
      const nodesData: any[] = await fetch('/api/nodes').then(r => r.json())
      const nd = nodesData.find(n => n.id === nodeId)
      if (nd?.actions) {
        const groupMap = new Map<string, { id: string; label: string }[]>()
        for (const a of nd.actions as any[]) {
          if (!a.id || SKIP_TYPES.has(a.type ?? '')) continue
          const drvId: string = a.driver || ''
          const catEntry = catalog.find(c => c.id === drvId || `${c.id}-python` === drvId || c.id === drvId.replace(/-python$/, ''))
          if (catEntry && AI_TYPES.has(catEntry.type)) continue
          if (!groupMap.has(drvId)) groupMap.set(drvId, [])
          groupMap.get(drvId)!.push({ id: a.id, label: a.label || a.id })
        }
        setGroups(Array.from(groupMap.entries()).map(([drvId, actions]) => {
          const cat = catalog.find(c => c.id === drvId || `${c.id}-python` === drvId || c.id === drvId.replace(/-python$/, ''))
          return { driverId: drvId, driverLabel: cat?.label ?? (drvId || 'Unknown'), accent: cat?.accent_color ?? '#6c7086', actions }
        }))
      }
    } catch { /* topology not loaded */ }
    setFetching(false)
  }, [nodeId, catalog]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { fetchActions() }, [fetchActions])

  const allActions = groups.flatMap(g => g.actions)

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange([...next].join(', '))
  }

  const smallBtn: React.CSSProperties = {
    padding: '2px 7px', borderRadius: 4, border: '1px solid var(--surface1)',
    background: 'var(--surface0)', color: 'var(--subtext0)',
    fontSize: 9, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
  }

  if (fetching) return <div style={{ fontSize: 11, color: 'var(--overlay0)' }}>Loading actions…</div>

  if (allActions.length === 0) return (
    <div style={{ fontSize: 10, color: 'var(--overlay0)', padding: '6px 0' }}>
      No executable actions found on this node yet.<br />
      Save the capabilities file first, then re-open to see available actions.
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <button style={smallBtn} onClick={() => onChange(allActions.map(a => a.id).join(', '))}>All</button>
        <button style={smallBtn} onClick={() => onChange('')}>None (expose all)</button>
        <button style={smallBtn} onClick={fetchActions}><RefreshCw size={9} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.map(g => (
          <div key={g.driverId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <div style={{ width: 3, height: 12, borderRadius: 2, background: g.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: g.accent, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{g.driverLabel}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8, borderLeft: `2px solid ${g.accent}30` }}>
              {g.actions.map(a => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, background: selected.has(a.id) ? 'var(--surface1)' : 'transparent' }}>
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} style={{ cursor: 'pointer' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)', flex: 1 }}>{a.id}</span>
                  {a.label !== a.id && <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>{a.label}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {selected.size === 0 && (
        <div style={{ fontSize: 9, color: 'var(--overlay1)', marginTop: 4 }}>
          ↳ Empty = expose all non-interactive actions to the agent
        </div>
      )}
    </div>
  )
}

/* ── AgentToolMultiselectField component ─────────────────────────── */
function AgentToolMultiselectField({ value, onChange, nodeId }: {
  value: string; onChange: (v: string) => void; nodeId: string
}) {
  const [tools, setTools] = React.useState<{ name: string; description: string; node_id: string; action_id: string }[]>([])
  const [fetching, setFetching] = React.useState(false)

  const selected = React.useMemo(
    () => new Set(value.split(',').map(s => s.trim()).filter(Boolean)),
    [value],
  )

  const [nodeLabelMap, setNodeLabelMap] = React.useState<Record<string, string>>({})

  const fetchTools = React.useCallback(async () => {
    setFetching(true)
    try {
      const [toolsRes, nodesRes] = await Promise.all([
        fetch(`/api/nodes/${nodeId}/agent/tools`),
        fetch('/api/nodes'),
      ])
      const toolsData = await toolsRes.json()
      const nodesData: any[] = await nodesRes.json()
      const labelMap: Record<string, string> = {}
      for (const n of nodesData) {
        labelMap[n.id] = n.label || n.properties?.label || n.id
      }
      setNodeLabelMap(labelMap)
      if (toolsData.ok) setTools(toolsData.tools ?? [])
    } catch { /* topology not loaded */ }
    setFetching(false)
  }, [nodeId])

  React.useEffect(() => { fetchTools() }, [fetchTools])

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name); else next.add(name)
    onChange([...next].join(', '))
  }

  // Group by node_id
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof tools>()
    for (const t of tools) {
      if (!map.has(t.node_id)) map.set(t.node_id, [])
      map.get(t.node_id)!.push(t)
    }
    return Array.from(map.entries()).map(([nid, items]) => ({ nodeId: nid, tools: items }))
  }, [tools])

  const smallBtn: React.CSSProperties = {
    padding: '2px 7px', borderRadius: 4, border: '1px solid var(--surface1)',
    background: 'var(--surface0)', color: 'var(--subtext0)',
    fontSize: 9, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
  }

  if (fetching) return <div style={{ fontSize: 11, color: 'var(--overlay0)' }}>Discovering tools…</div>

  if (tools.length === 0) return (
    <div style={{ fontSize: 10, color: 'var(--overlay0)', padding: '6px 0' }}>
      No tools discovered in topology.<br />
      Add <code style={{ color: 'var(--mauve)' }}>generic-driver-ai-tool</code> to a node and select actions to expose.
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <button style={smallBtn} onClick={() => onChange(tools.map(t => t.name).join(', '))}>All</button>
        <button style={smallBtn} onClick={() => onChange('')}>None (allow all)</button>
        <button style={smallBtn} onClick={fetchTools}><RefreshCw size={9} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.map(g => (
          <div key={g.nodeId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <div style={{ width: 3, height: 12, borderRadius: 2, background: '#cba6f7', flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{nodeLabelMap[g.nodeId] ?? g.nodeId}</span>
              {(nodeLabelMap[g.nodeId] && nodeLabelMap[g.nodeId] !== g.nodeId) && (
                <span style={{ fontSize: 9, color: 'var(--overlay0)', fontFamily: 'var(--font-mono)' }}>({g.nodeId})</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8, borderLeft: '2px solid #cba6f730' }}>
              {g.tools.map(t => (
                <label key={t.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11, cursor: 'pointer', padding: '4px 6px', borderRadius: 4, background: selected.has(t.name) ? 'var(--surface1)' : 'transparent' }}>
                  <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggle(t.name)} style={{ cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)' }}>{t.action_id}</div>
                    {t.description && <div style={{ fontSize: 9, color: 'var(--subtext0)', lineHeight: 1.4, marginTop: 1 }}>{t.description}</div>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {selected.size === 0 && (
        <div style={{ fontSize: 9, color: 'var(--overlay1)', marginTop: 4 }}>
          ↳ Empty = all discovered tools are allowed
        </div>
      )}
    </div>
  )
}

/* ── NodeSelectField component ────────────────────────────────────── */
function NodeSelectField({ value, onChange, filterRuntime }: {
  value: string; onChange: (v: string) => void; filterRuntime?: string
}) {
  const [nodes, setNodes] = React.useState<{ id: string; label: string }[]>([])
  const [fetching, setFetching] = React.useState(false)

  const fetchNodes = React.useCallback(async () => {
    setFetching(true)
    try {
      const r = await fetch('/api/nodes')
      const data: any[] = await r.json()
      setNodes(
        data
          .filter(n => {
            if (!filterRuntime) return true
            if (n.runtime === filterRuntime) return true
            // Also accept nodes that have a driver of the matching semantic type
            // assigned (primary or overlay). e.g. filterRuntime='llm' → nodes
            // with an ai-llm driver (like Ollama on a docker container).
            const types: string[] = n.driver_types ?? []
            if (filterRuntime === 'llm' && types.includes('ai-llm')) return true
            if (filterRuntime === 'agent' && types.includes('ai-agent')) return true
            return false
          })
          .map(n => ({ id: n.id, label: n.label || n.properties?.label || n.id }))
      )
    } catch { /* topology not loaded */ }
    setFetching(false)
  }, [filterRuntime])

  React.useEffect(() => { fetchNodes() }, [fetchNodes])

  const st: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 6,
    border: '1px solid var(--surface1)', background: 'var(--surface0)',
    color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <select style={{ ...st, flex: 1, cursor: 'pointer' }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— select node —</option>
        {nodes.map(n => (
          <option key={n.id} value={n.id}>{n.label !== n.id ? `${n.label} (${n.id})` : n.id}</option>
        ))}
        {value && !nodes.find(n => n.id === value) && (
          <option value={value}>{value} ⚠ not found</option>
        )}
      </select>
      <button
        onClick={fetchNodes}
        title="Refresh node list"
        style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid #89b4fa40', background: '#89b4fa15', color: '#89b4fa', fontSize: 11, display: 'inline-flex', alignItems: 'center' }}
      >
        {fetching ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
      </button>
    </div>
  )
}

/* ── Icon mapping ─────────────────────────────────────────────────── */
const ACTION_ICON: Record<string, React.FC<any>> = {
  terminal: Terminal, play: Play, info: Info, activity: Activity,
  'hard-drive': HardDrive, zap: Zap, settings: Settings, box: Box,
  shield: Shield, layers: Layers, package: Package,
}

/* ── Props ────────────────────────────────────────────────────────── */
interface Props {
  node: NodeDef
  onClose: () => void
  onRefresh: () => void
}

/* ── Styles ───────────────────────────────────────────────────────── */
const inputSt: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--surface1)', background: 'var(--surface0)',
  color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
  outline: 'none', boxSizing: 'border-box',
}
const selectSt: React.CSSProperties = { ...inputSt, cursor: 'pointer' }
const labelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--subtext0)',
  textTransform: 'uppercase' as const, letterSpacing: '0.3px',
  marginBottom: 3, display: 'block',
}
const btn = (color: string, filled = false): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
  border: filled ? 'none' : `1px solid ${color}40`,
  background: filled ? color : `${color}15`,
  color: filled ? 'var(--crust)' : color,
  fontSize: 11, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', gap: 5,
})
const card: React.CSSProperties = {
  background: 'var(--mantle)', borderRadius: 10,
  border: '1px solid var(--surface1)', overflow: 'hidden',
}
const sectionHdr: React.CSSProperties = {
  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
  borderBottom: '1px solid var(--surface0)', cursor: 'pointer',
  userSelect: 'none',
}

/* ── Modal ────────────────────────────────────────────────────────── */
export default function CapabilitiesModal({ node, onClose, onRefresh }: Props) {
  const nodeId = node.id

  const [caps, setCaps] = useState<CapabilitiesData | null>(null)
  const [catalog, setCatalog] = useState<CatalogDriver[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Editable state
  const [drivers, setDrivers] = useState<DriverEntry[]>([])
  const [actions, setActions] = useState<any[]>([])
  const [health, setHealth] = useState<any>(null)

  // UI state
  const [showDrivers, setShowDrivers] = useState(true)
  const [showActions, setShowActions] = useState(true)
  const [showHealth, setShowHealth] = useState(false)
  const [showAddAction, setShowAddAction] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [collapsedDrivers, setCollapsedDrivers] = useState<Set<number>>(new Set())
  const [domainTemplates, setDomainTemplates] = useState<{ name: string; path: string; source: string }[]>([])
  const [secrets, setSecrets] = useState<Record<string, { type: string; hint: string; env_override: boolean }>>({})

  // Load catalog + domain templates + secrets once
  useEffect(() => {
    fetch('/api/drivers/catalog').then(r => r.json()).then(setCatalog).catch(() => {})
    fetch('/api/templates/libvirt/domains').then(r => r.json()).then(setDomainTemplates).catch(() => {})
    fetch('/api/secrets').then(r => r.json()).then(setSecrets).catch(() => {})
  }, [])

  // Load capabilities when catalog is ready
  const loadCaps = useCallback(async (cat: CatalogDriver[]) => {
    setLoading(true); setError(''); setSuccess(''); setCollapsedDrivers(new Set())
    try {
      const res = await fetch(`/api/nodes/${nodeId}/capabilities`)
      if (!res.ok) throw new Error(await res.text())
      const data: CapabilitiesData = await res.json()
      setCaps(data)
      const drv = (data.drivers || []).map((d: any) => ({
        driver: d.driver ?? d.name ?? d.id ?? '',
        driver_args: d.driver_args ?? {},
      }))
      setDrivers(drv)
      const acts = (data.actions || []).map((a: any) => {
        if (a['$ref']) {
          const refId = a['$ref']
          const driverId = a.driver || ''
          const origin = a.origin || ''
          const catEntry = cat.find((c: any) => c.id === driverId)
          const catalogAction = catEntry?.actions?.[refId]
          return { ...(catalogAction || {}), ...a, _ref: `$ref:${refId}`, _driver: driverId, _origin: origin }
        }
        return a
      })
      setActions(acts)
      setHealth(data.health || null)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [nodeId])

  useEffect(() => {
    if (catalog.length > 0) loadCaps(catalog)
  }, [catalog, loadCaps])

  // Reload manually
  const handleReload = useCallback(() => {
    loadCaps(catalog)
  }, [catalog, loadCaps])

  // Init capabilities
  const handleInit = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/nodes/${nodeId}/capabilities/init`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setSuccess(data.created ? 'Capabilities file created!' : 'Already exists')
        loadCaps(catalog)
        onRefresh()
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [nodeId, catalog, loadCaps, onRefresh])

  // Save capabilities
  const handleSave = useCallback(async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      const actionsToSave = actions.map(a => {
        if (a._ref) {
          const out: any = { '$ref': a._ref.replace('$ref:', '') }
          if (a._driver) out.driver = a._driver
          if (a._origin) out.origin = a._origin
          return out
        }
        const { _ref, _driver, _origin, ...rest } = a
        return rest
      })
      const body: any = { drivers, actions: actionsToSave }
      if (health) body.health = health
      const res = await fetch(`/api/nodes/${nodeId}/capabilities`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) { setSuccess(`Saved to ${data.env_file}`); onRefresh() }
      else setError(data.detail || 'Save failed')
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }, [nodeId, drivers, actions, health, onRefresh])

  /* ── Driver helpers ─────────────────────────────────────────────── */
  const addDriver = (driverId: string) => {
    const cat = catalog.find(c => c.id === driverId)
    const defaultArgs: Record<string, any> = {}
    if (cat?.driver_args_schema) {
      for (const [k, v] of Object.entries(cat.driver_args_schema)) {
        defaultArgs[k] = v.default ?? ''
      }
    }
    setDrivers(prev => [...prev, { driver: driverId, driver_args: defaultArgs }])
    if (cat?.actions) {
      const origin = cat.origin || 'native'
      const newActions = Object.keys(cat.actions)
        .filter(key => !actions.some(a => a._ref === `$ref:${key}` && a._driver === driverId))
        .map(key => ({ ...cat.actions[key], _ref: `$ref:${key}`, _driver: driverId, _origin: origin }))
      if (newActions.length > 0) setActions(prev => [...prev, ...newActions])
    }
  }

  const removeDriver = (idx: number) => {
    const removedId = drivers[idx]?.driver
    setDrivers(prev => prev.filter((_, i) => i !== idx))
    if (removedId) setActions(prev => prev.filter(a => a._driver !== removedId))
  }

  const updateDriverArg = (dIdx: number, key: string, value: any) => {
    setDrivers(prev => prev.map((d, i) =>
      i === dIdx ? { ...d, driver_args: { ...d.driver_args, [key]: value } } : d,
    ))
  }

  /* ── Action helpers ─────────────────────────────────────────────── */
  const addActionFromDriver = (driverId: string, actionKey: string) => {
    const cat = catalog.find(c => c.id === driverId)
    if (!cat) return
    const act = cat.actions[actionKey]
    if (!act) return
    setActions(prev => [...prev, { ...act, _ref: `$ref:${actionKey}`, _driver: driverId, _origin: cat.origin || 'native' }])
    setShowAddAction(false)
  }

  const removeAction = (idx: number) => setActions(prev => prev.filter((_, i) => i !== idx))

  const moveAction = (idx: number, dir: -1 | 1) => {
    setActions(prev => {
      const arr = [...prev]
      const t = idx + dir
      if (t < 0 || t >= arr.length) return prev
      ;[arr[idx], arr[t]] = [arr[t], arr[idx]]
      return arr
    })
  }

  // Compatible drivers for this node's runtime.
  // AI overlay drivers (ai-llm, ai-agent, ai-tool) are valid for any runtime —
  // e.g. a docker container running Ollama can use the Generic Ollama driver.
  const nodeRuntime = node.runtime ?? null
  const compatibleDrivers = catalog.filter(c => {
    if (!nodeRuntime) return true
    if (c.type === 'unknown') return true
    if (c.type === 'ai-tool' || c.type === 'ai-llm' || c.type === 'ai-agent') return true
    if (nodeRuntime === 'libvirt' && c.type === 'libvirt') return true
    if ((nodeRuntime === 'docker' || nodeRuntime === 'podman') && c.type === 'container') return true
    if (nodeRuntime === 'app' && c.type === 'app') return true
    if (nodeRuntime === 'remote' && c.type === 'remote') return true
    return false
  })

  // JSON preview
  const jsonPreview = JSON.stringify({
    drivers: drivers.map(d => ({ driver: d.driver, driver_args: d.driver_args })),
    actions: actions.map(a => {
      if (a._ref) {
        const out: any = { '$ref': a._ref.replace('$ref:', '') }
        if (a._driver) out.driver = a._driver
        if (a._origin) out.origin = a._origin
        return out
      }
      const { _ref, _driver, _origin, ...rest } = a
      return rest
    }),
    ...(health ? { health } : {}),
  }, null, 2)

  const rtBadge = nodeRuntime ? RUNTIME_BADGE[nodeRuntime] : null
  const nodeLabel = (node.properties as any)?.label ?? node.vm_name ?? node.id
  const shortId = (node.properties as any)?.short_id

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 48, paddingBottom: 48,
        overflow: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--base)', borderRadius: 16,
          border: '1px solid var(--surface1)',
          width: 820, maxWidth: 'calc(100vw - 64px)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 96px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--surface1)',
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0,
        }}>
          <Shield size={16} color="var(--mauve)" />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                {nodeLabel}
              </span>
              {shortId && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: 'var(--surface1)', color: 'var(--overlay1)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {shortId}
                </span>
              )}
              {rtBadge && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: rtBadge.bg, color: rtBadge.color, fontWeight: 600,
                }}>
                  {rtBadge.label}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--overlay0)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
              {nodeId}
            </div>
          </div>

          {/* Header actions */}
          {!caps?.file_exists && (
            <button onClick={handleInit} style={btn('#a6e3a1', true)}><Plus size={12} /> Initialize</button>
          )}
          <button onClick={() => setShowJson(v => !v)} style={btn(showJson ? '#cba6f7' : '#6c7086')}>
            <Code size={12} /> {showJson ? 'Hide JSON' : 'JSON'}
          </button>
          <button onClick={handleSave} disabled={saving} style={btn('#89b4fa', true)}>
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={handleReload} style={btn('#6c7086')} title="Reload">
            <RefreshCw size={12} />
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)', padding: 4, borderRadius: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* ── Body (scrollable) ───────────────────────────────────── */}
        <div style={{ overflowY: 'auto', padding: 20, flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--overlay0)' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : (
            <>
              {/* Messages */}
              {error && (
                <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12, background: '#f38ba820', border: '1px solid #f38ba840', color: '#f38ba8', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
              {success && (
                <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12, background: '#a6e3a120', border: '1px solid #a6e3a140', color: '#a6e3a1', fontSize: 11 }}>
                  ✓ {success}
                </div>
              )}

              {/* Env file info */}
              {caps && (
                <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 16, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 11, color: 'var(--subtext0)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileJson size={14} color="var(--mauve)" />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{caps.env_file}</span>
                  <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, background: caps.file_exists ? '#a6e3a120' : '#f38ba820', color: caps.file_exists ? '#a6e3a1' : '#f38ba8' }}>
                    {caps.file_exists ? 'exists' : 'not created'}
                  </span>
                </div>
              )}

              {/* ── JSON Preview ────────────────────────────────── */}
              {showJson && (
                <div style={{ ...card, marginBottom: 16 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--surface0)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Code size={14} color="var(--mauve)" />
                    <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Generated JSON</span>
                    <button onClick={() => { navigator.clipboard.writeText(jsonPreview); setSuccess('JSON copied!') }} style={btn('#6c7086')}>
                      <Copy size={10} /> Copy
                    </button>
                  </div>
                  <pre style={{ margin: 0, padding: 14, fontSize: 10, lineHeight: 1.6, color: 'var(--text)', fontFamily: 'var(--font-mono)', background: 'var(--crust)', overflowX: 'auto', maxHeight: 300 }}>
                    {jsonPreview}
                  </pre>
                </div>
              )}

              {/* ── Drivers Section ─────────────────────────────── */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={sectionHdr} onClick={() => setShowDrivers(v => !v)}>
                  {showDrivers ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <HardDrive size={14} color="var(--blue)" />
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Drivers ({drivers.length})</span>
                </div>
                {showDrivers && (
                  <div style={{ padding: 14 }}>
                    {drivers.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 16 }}>
                        No drivers selected. Add a driver to define parameters and unlock its actions.
                      </div>
                    )}
                    {drivers.map((drv, dIdx) => {
                      const cat = catalog.find(c => c.id === drv.driver)
                      const schema = cat?.driver_args_schema ?? {}
                      const isCollapsed = collapsedDrivers.has(dIdx)
                      const toggleCollapse = () => setCollapsedDrivers(prev => {
                        const next = new Set(prev)
                        if (next.has(dIdx)) next.delete(dIdx); else next.add(dIdx)
                        return next
                      })
                      const argCount = Object.keys(drv.driver_args).length
                      const actionCount = actions.filter(a => a._driver === drv.driver).length
                      return (
                        <div key={dIdx} style={{ marginBottom: 12, borderRadius: 8, background: 'var(--surface0)', border: `1px solid ${cat?.accent_color ?? 'var(--surface1)'}40`, overflow: 'hidden' }}>
                          <div onClick={toggleCollapse} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}>
                            {isCollapsed ? <ChevronRight size={14} color="var(--overlay1)" /> : <ChevronDown size={14} color="var(--overlay1)" />}
                            <div style={{ width: 6, height: 28, borderRadius: 3, background: cat?.accent_color ?? '#6c7086' }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{cat?.label ?? drv.driver}</div>
                              <div style={{ fontSize: 9, color: 'var(--subtext0)', display: 'flex', gap: 6, alignItems: 'center' }}>
                                {cat?.kind ?? ''} · {cat?.type ?? ''} · {cat?.vendor ?? ''}
                                <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'var(--surface1)', color: 'var(--overlay1)' }}>{argCount} args</span>
                                <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#f9e2af20', color: '#f9e2af' }}>{actionCount} act</span>
                              </div>
                            </div>
                            <button onClick={e => { e.stopPropagation(); removeDriver(dIdx) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f38ba8' }}><Trash2 size={14} /></button>
                          </div>

                          {!isCollapsed && (
                            <div style={{ padding: '0 12px 12px' }}>
                              <div style={{ ...labelSt, marginBottom: 8 }}>Driver Args</div>
                              {Object.keys(schema).length > 0 ? (
                                Object.entries(schema).map(([key, field]) => (
                                  <div key={key} style={{ marginBottom: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>{field.label || key}</span>
                                      {field.required && <span style={{ fontSize: 8, color: '#f38ba8' }}>*</span>}
                                    </div>
                                    {field.type === 'boolean' ? (
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text)', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={!!drv.driver_args[key]} onChange={e => updateDriverArg(dIdx, key, e.target.checked)} />
                                        {field.description}
                                      </label>
                                    ) : field.type === 'provider-select' ? (
                                      <>
                                        <ProviderField
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={v => {
                                            updateDriverArg(dIdx, key, v)
                                            const curUrl = drv.driver_args['base_url'] ?? ''
                                            if (!curUrl || _KNOWN_BASE_URLS.has(curUrl))
                                              updateDriverArg(dIdx, 'base_url', _PROVIDER_BASE_URLS[v] ?? '')
                                          }}
                                        />
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 1 }}>{field.description}</div>}
                                      </>
                                    ) : field.type === 'model-select' ? (
                                      <>
                                        <ModelField
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={v => updateDriverArg(dIdx, key, v)}
                                          provider={field.depends_on ? (drv.driver_args[field.depends_on] ?? '') : (field.provider ?? '')}
                                          baseUrl={drv.driver_args['base_url'] ?? ''}
                                        />
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 1 }}>{field.description}</div>}
                                      </>
                                    ) : field.type === 'secret' ? (
                                      <>
                                        <select
                                          style={selectSt}
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={e => updateDriverArg(dIdx, key, e.target.value)}
                                        >
                                          <option value="">— none —</option>
                                          {Object.entries(secrets).map(([sName, sMeta]) => (
                                            <option key={sName} value={sName}>
                                              {sName} ({sMeta.type}){sMeta.env_override ? ' [env]' : ''}
                                            </option>
                                          ))}
                                        </select>
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 1 }}>{field.description}</div>}
                                        {Object.keys(secrets).length === 0 && (
                                          <div style={{ fontSize: 9, color: '#f9e2af', marginTop: 2 }}>
                                            No secrets yet — add them in AI Central › Secrets.
                                          </div>
                                        )}
                                      </>
                                    ) : field.type === 'agent-tool-multiselect' ? (
                                      <>
                                        <AgentToolMultiselectField
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={v => updateDriverArg(dIdx, key, v)}
                                          nodeId={nodeId}
                                        />
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 4 }}>{field.description}</div>}
                                      </>
                                    ) : field.type === 'action-multiselect' ? (
                                      <>
                                        <ActionMultiselectField
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={v => updateDriverArg(dIdx, key, v)}
                                          nodeId={nodeId}
                                          catalog={catalog}
                                        />
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 4 }}>{field.description}</div>}
                                      </>
                                    ) : field.type === 'node-select' ? (
                                      <>
                                        <NodeSelectField
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={v => updateDriverArg(dIdx, key, v)}
                                          filterRuntime={field.filter_runtime}
                                        />
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 1 }}>{field.description}</div>}
                                      </>
                                    ) : key === 'template' && domainTemplates.length > 0 ? (
                                      <>
                                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                          <select style={{ ...selectSt, flex: 1 }} value={drv.driver_args[key] ?? ''} onChange={e => updateDriverArg(dIdx, key, e.target.value)}>
                                            <option value="">— default (auto) —</option>
                                            {domainTemplates.map(t => (
                                              <option key={t.path} value={t.path}>{t.name} ({t.source})</option>
                                            ))}
                                          </select>
                                          <Search size={12} color="var(--overlay1)" />
                                        </div>
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 1 }}>{field.description}</div>}
                                      </>
                                    ) : (
                                      <>
                                        <input
                                          style={inputSt}
                                          type={field.type === 'number' ? 'number' : 'text'}
                                          value={drv.driver_args[key] ?? ''}
                                          onChange={e => updateDriverArg(dIdx, key, field.type === 'number' ? (parseInt(e.target.value) || '') : e.target.value)}
                                          placeholder={field.placeholder ?? ''}
                                        />
                                        {field.description && <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 1 }}>{field.description}</div>}
                                      </>
                                    )}
                                  </div>
                                ))
                              ) : (
                                <div>
                                  {Object.entries(drv.driver_args).map(([key, val]) => (
                                    <div key={key} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                                      <input style={{ ...inputSt, width: '35%', fontSize: 10 }} value={key} readOnly />
                                      <input style={{ ...inputSt, flex: 1, fontSize: 10 }} value={String(val)} onChange={e => updateDriverArg(dIdx, key, e.target.value)} />
                                    </div>
                                  ))}
                                  <button onClick={() => {
                                    const k = `param-${Object.keys(drv.driver_args).length}`
                                    updateDriverArg(dIdx, k, '')
                                  }} style={{ ...btn('#89b4fa'), padding: '2px 6px', fontSize: 9, marginTop: 4 }}><Plus size={9} /> Add Arg</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Add driver picker */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ ...labelSt, marginBottom: 6 }}>Add driver:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {compatibleDrivers.map(cat => {
                          const alreadyAdded = drivers.some(d => d.driver === cat.id)
                          return (
                            <button key={cat.id} onClick={() => !alreadyAdded && addDriver(cat.id)}
                              disabled={alreadyAdded}
                              title={`${cat.kind} · ${cat.type} · ${cat.vendor}`}
                              style={{
                                ...btn(alreadyAdded ? 'var(--overlay0)' : cat.accent_color),
                                padding: '4px 10px', fontSize: 10,
                                opacity: alreadyAdded ? 0.4 : 1,
                                borderLeft: `3px solid ${cat.accent_color}`,
                              }}
                            >
                              {cat.label}
                              <span style={{ fontSize: 7, opacity: 0.6, marginLeft: 2 }}>({cat.kind === 'json-driver' ? 'json' : 'py'})</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Actions Section ──────────────────────────────── */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={sectionHdr} onClick={() => setShowActions(v => !v)}>
                  {showActions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Zap size={14} color="var(--yellow)" />
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Actions ({actions.length})</span>
                  <button onClick={e => { e.stopPropagation(); setShowAddAction(v => !v) }} style={{ ...btn('#a6e3a1'), padding: '3px 8px', fontSize: 9 }}><Plus size={10} /> Add Action</button>
                </div>
                {showActions && (
                  <div style={{ padding: 14 }}>
                    {showAddAction && (
                      <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--surface0)', border: '1px solid #89b4fa30' }}>
                        {drivers.map(drv => {
                          const cat = catalog.find(c => c.id === drv.driver)
                          if (!cat || Object.keys(cat.actions).length === 0) return null
                          return (
                            <div key={drv.driver} style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 9, fontWeight: 700, color: cat.accent_color, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 4, height: 12, borderRadius: 2, background: cat.accent_color }} />
                                {cat.label} actions:
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {Object.entries(cat.actions).map(([refId, act]) => {
                                  const alreadyAdded = actions.some(a => a._ref === `$ref:${refId}`)
                                  return (
                                    <button key={refId} onClick={() => !alreadyAdded && addActionFromDriver(drv.driver, refId)}
                                      disabled={alreadyAdded}
                                      style={{ ...btn(alreadyAdded ? 'var(--overlay0)' : cat.accent_color), padding: '3px 8px', fontSize: 9, opacity: alreadyAdded ? 0.4 : 1 }}
                                    >
                                      {(act as any).label || refId}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                        <div style={{ borderTop: '1px solid var(--surface1)', paddingTop: 8, display: 'flex', gap: 6 }}>
                          <button onClick={() => setShowAddAction(false)} style={btn('#6c7086')}><X size={10} /> Close</button>
                          <span style={{ fontSize: 9, color: 'var(--overlay0)', alignSelf: 'center' }}>
                            To create new actions, edit the driver in the Drivers screen.
                          </span>
                        </div>
                      </div>
                    )}

                    {actions.length === 0 && !showAddAction && (
                      <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 16 }}>
                        No actions. Add a driver first, then pick actions from it.
                      </div>
                    )}

                    {/* Group actions by driver */}
                    {(() => {
                      const groups: { driverId: string; items: { act: any; idx: number }[] }[] = []
                      const groupMap = new Map<string, { act: any; idx: number }[]>()
                      for (let i = 0; i < actions.length; i++) {
                        const key = actions[i]._driver || ''
                        if (!groupMap.has(key)) {
                          const items: { act: any; idx: number }[] = []
                          groupMap.set(key, items)
                          groups.push({ driverId: key, items })
                        }
                        groupMap.get(key)!.push({ act: actions[i], idx: i })
                      }
                      return groups.map(g => {
                        const cat = g.driverId ? catalog.find(c => c.id === g.driverId) : null
                        const accent = cat?.accent_color ?? '#6c7086'
                        const groupLabel = (cat?.label ?? g.driverId) || 'Custom'
                        return (
                          <div key={g.driverId || '_custom'} style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, paddingLeft: 2 }}>
                              <div style={{ width: 3, height: 14, borderRadius: 2, background: accent }} />
                              <span style={{ fontSize: 10, fontWeight: 700, color: accent }}>{groupLabel}</span>
                              <span style={{ fontSize: 9, color: 'var(--overlay0)' }}>({g.items.length})</span>
                            </div>
                            {g.items.map(({ act, idx }) => {
                              const AIcon = ACTION_ICON[act.icon] || Terminal
                              return (
                                <div key={idx} style={{ marginBottom: 6, marginLeft: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--surface0)', border: `1px solid ${accent}25` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <AIcon size={12} color={accent} />
                                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{act.label || act.id || act._ref?.replace('$ref:', '')}</span>
                                    {act._ref && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#89b4fa20', color: '#89b4fa' }}>$ref</span>}
                                    {act._origin && <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, background: act._origin === 'native' ? '#a6e3a120' : '#f9e2af20', color: act._origin === 'native' ? '#a6e3a1' : '#f9e2af' }}>{act._origin}</span>}
                                    <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--surface1)', color: 'var(--subtext0)' }}>{act.type}</span>
                                    <button onClick={() => moveAction(idx, -1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)', padding: '0 1px', fontSize: 10 }}>▲</button>
                                    <button onClick={() => moveAction(idx, 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)', padding: '0 1px', fontSize: 10 }}>▼</button>
                                    <button onClick={() => removeAction(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f38ba8', padding: '0 2px' }}><Trash2 size={11} /></button>
                                  </div>
                                  {act.command && (
                                    <div style={{ fontSize: 10, color: 'var(--overlay1)', fontFamily: 'var(--font-mono)', padding: '4px 8px', borderRadius: 4, background: 'var(--crust)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.command}</div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })
                    })()}
                  </div>
                )}
              </div>

              {/* ── Health Section ───────────────────────────────── */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={sectionHdr} onClick={() => setShowHealth(v => !v)}>
                  {showHealth ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Activity size={14} color="var(--green)" />
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Health Check</span>
                  {!health && <button onClick={e => { e.stopPropagation(); setHealth({ type: 'docker', interval: 30, timeout: 5 }); setShowHealth(true) }} style={{ ...btn('#a6e3a1'), padding: '3px 8px', fontSize: 9 }}><Plus size={10} /> Configure</button>}
                </div>
                {showHealth && (
                  <div style={{ padding: 14 }}>
                    {!health ? (
                      <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 16 }}>No health check configured.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div><label style={labelSt}>Type</label><select style={selectSt} value={health.type || 'docker'} onChange={e => setHealth((h: any) => ({ ...h, type: e.target.value }))}><option value="docker">Docker</option><option value="exec">Exec</option></select></div>
                        {health.type === 'exec' && <div><label style={labelSt}>Command</label><input style={inputSt} value={health.command || ''} onChange={e => setHealth((h: any) => ({ ...h, command: e.target.value }))} /></div>}
                        <div style={{ display: 'flex', gap: 12 }}>
                          <div style={{ flex: 1 }}><label style={labelSt}>Interval (s)</label><input style={inputSt} type="number" value={health.interval ?? 30} onChange={e => setHealth((h: any) => ({ ...h, interval: parseInt(e.target.value) || 30 }))} /></div>
                          <div style={{ flex: 1 }}><label style={labelSt}>Timeout (s)</label><input style={inputSt} type="number" value={health.timeout ?? 5} onChange={e => setHealth((h: any) => ({ ...h, timeout: parseInt(e.target.value) || 5 }))} /></div>
                        </div>
                        <button onClick={() => setHealth(null)} style={{ ...btn('#f38ba8'), alignSelf: 'flex-start' }}><Trash2 size={10} /> Remove</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Template Variables Reference ─────────────────── */}
              <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 10, color: 'var(--subtext0)', lineHeight: 1.8 }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 6 }}>Template Variables Reference</div>
                <code style={{ fontSize: 9 }}>
                  {'${vm_name}'} — resolved VM/container name<br />
                  {'${node.id}'} — node ID · {'${node.properties.<key>}'} — node property<br />
                  {'${iface.<id>.<field>}'} — interface attribute (e.g. {'${iface.mgmt.ip}'})<br />
                  {'${env.<key>}'} — driver_args value · {'${json:env.<key>}'} — JSON-serialised<br />
                  {'${project_dir}'} — absolute project directory · {'${project_id}'} — project identifier
                </code>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
