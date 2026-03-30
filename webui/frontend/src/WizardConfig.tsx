import { apiFetch } from './apiFetch'
/* triv WebUI — WizardConfig: ReactFlow canvas for the built-in AI Wizard */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls,
  type Node as RFNode, type Edge as RFEdge,
  Handle, Position, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  BrainCircuit, Bot, Wrench, CheckCircle, AlertCircle,
  RefreshCw, Save, ChevronRight, Settings, Lock, Play, Loader,
  List, X,
} from 'lucide-react'
import CapabilitiesModal from './CapabilitiesModal'
import type { NodeDef } from './types'

/* ── Types ──────────────────────────────────────────────────────── */
interface CapabilityGroups {
  node_capabilities: boolean
  node_actions: boolean
  node_lifecycle: boolean
  network_ops: boolean
  secrets: boolean
  topology_ai_tools: boolean
}

interface WizardConfig {
  enabled: boolean
  instructions: string
  capability_groups: CapabilityGroups
}

interface WizardStatus {
  enabled: boolean
  topology_loaded: boolean
  provider: string
  model: string
}

interface WizardNodeInfo {
  id: string
  label: string
  runtime: string
  status: string
  internal?: boolean
  locked_drivers?: boolean
}

interface NodeAction {
  id: string
  label: string
  icon: string
  type: string
}

interface ActionResult {
  actionId: string
  ok: boolean
  output?: string
  error?: string
}

interface TopoToolAction { id: string; label: string }
interface TopoToolDriver { driver_id: string; actions: TopoToolAction[] }
interface TopoToolNode   { node_id: string; node_label: string; drivers: TopoToolDriver[] }

/* ── Node meta ──────────────────────────────────────────────────── */
const NODE_META: Record<string, { icon: React.ReactNode; color: string; sub: string }> = {
  'triv-wizard-llm':   { icon: <BrainCircuit size={18} color="#cba6f7" />, color: '#cba6f7', sub: 'ai-llm'   },
  'triv-wizard-agent': { icon: <Bot          size={18} color="#f5c2e7" />, color: '#f5c2e7', sub: 'ai-agent' },
  'triv-wizard-app':   { icon: <Wrench       size={18} color="#f9e2af" />, color: '#f9e2af', sub: 'ai-tools' },
}

/* ── Custom ReactFlow node ──────────────────────────────────────── */
function WizardFlowNode({ data }: { data: any }) {
  const meta = NODE_META[data.nodeId] ?? { icon: null, color: '#585b70', sub: '' }
  const selected = data.selected

  return (
    <div
      style={{
        minWidth: 150,
        background: selected ? 'var(--surface0)' : 'var(--mantle)',
        border: selected ? `2px solid ${meta.color}` : `1px solid ${meta.color}40`,
        borderRadius: 10,
        boxShadow: selected ? `0 0 14px ${meta.color}40` : '0 2px 8px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ background: meta.color, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: meta.color, width: 8, height: 8 }} />

      {/* Header */}
      <div style={{
        background: `color-mix(in srgb, ${meta.color} 15%, var(--surface0))`,
        borderRadius: '8px 8px 0 0', padding: '8px 12px',
        borderBottom: `1px solid ${meta.color}30`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {meta.icon}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{data.label}</span>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, padding: '2px 6px', borderRadius: 10,
          background: `color-mix(in srgb, ${meta.color} 20%, var(--surface1))`,
          color: meta.color, fontWeight: 600,
        }}>
          {meta.sub}
        </span>
        {data.internal && (
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 8,
            background: 'var(--surface1)', color: 'var(--overlay0)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Lock size={8} /> internal
          </span>
        )}
      </div>
    </div>
  )
}

const NODE_TYPES = { wizardNode: WizardFlowNode }

/* ── Static layout ──────────────────────────────────────────────── */
const STATIC_NODES: RFNode[] = [
  { id: 'triv-wizard-llm',   type: 'wizardNode', position: { x: 60,  y: 120 }, data: {} },
  { id: 'triv-wizard-agent', type: 'wizardNode', position: { x: 280, y: 120 }, data: {} },
  { id: 'triv-wizard-app',   type: 'wizardNode', position: { x: 500, y: 120 }, data: {} },
]

const STATIC_EDGES: RFEdge[] = [
  {
    id: 'llm-agent', source: 'triv-wizard-llm', target: 'triv-wizard-agent',
    type: 'smoothstep', animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#cba6f7' },
    style: { stroke: '#cba6f7', strokeWidth: 1.5 },
  },
  {
    id: 'agent-app', source: 'triv-wizard-agent', target: 'triv-wizard-app',
    type: 'smoothstep', animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#f5c2e7' },
    style: { stroke: '#f5c2e7', strokeWidth: 1.5 },
  },
]

/* ── Styles ─────────────────────────────────────────────────────── */
const sLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block',
}
const sInput: React.CSSProperties = {
  width: '100%', background: 'var(--surface1)', border: '1px solid var(--overlay0)',
  borderRadius: 6, color: 'var(--text)', fontSize: 12,
  padding: '6px 10px', outline: 'none', boxSizing: 'border-box',
}

/* ── Main component ─────────────────────────────────────────────── */
export default function WizardConfig() {
  const [config, setConfig]           = useState<WizardConfig | null>(null)
  const [status, setStatus]           = useState<WizardStatus | null>(null)
  const [nodes, setNodes]             = useState<WizardNodeInfo[]>([])
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [capsOpen, setCapsOpen]       = useState(false)
  const [nodeActions, setNodeActions] = useState<NodeAction[]>([])
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [actionResult, setActionResult]   = useState<ActionResult | null>(null)
  const [topoToolsOpen, setTopoToolsOpen] = useState(false)
  const [topoTools, setTopoTools]         = useState<TopoToolNode[]>([])
  const [topoToolsLoading, setTopoToolsLoading] = useState(false)

  const fetchAll = useCallback(() => {
    apiFetch('/api/wizard/config').then(r => r.json()).then(setConfig)
    apiFetch('/api/wizard/status').then(r => r.json()).then(setStatus)
    apiFetch('/api/wizard/nodes').then(r => r.json()).then(setNodes)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    setNodeActions([])
    setActionResult(null)
    if (!selectedId) return
    apiFetch(`/api/wizard/nodes/${selectedId}/actions`)
      .then(r => r.json())
      .then(data => setNodeActions(Array.isArray(data) ? data : []))
      .catch(() => setNodeActions([]))
  }, [selectedId])

  async function runAction(actionId: string) {
    if (!selectedId) return
    setRunningAction(actionId)
    setActionResult(null)
    try {
      const res = await apiFetch(`/api/wizard/nodes/${selectedId}/actions/${actionId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      setActionResult({ actionId, ok: data.ok ?? res.ok, output: data.output, error: data.error })
    } catch (e: any) {
      setActionResult({ actionId, ok: false, error: String(e) })
    } finally {
      setRunningAction(null)
    }
  }

  async function openTopoTools() {
    setTopoToolsLoading(true)
    setTopoToolsOpen(true)
    try {
      const res = await apiFetch('/api/wizard/topology-tools')
      const data = await res.json()
      setTopoTools(Array.isArray(data) ? data : [])
    } catch {
      setTopoTools([])
    } finally {
      setTopoToolsLoading(false)
    }
  }

  function updateConfig(patch: Partial<WizardConfig>) {
    setConfig(c => c ? { ...c, ...patch } : c)
    setSaved(false)
  }

  async function save() {
    if (!config) return
    setSaving(true)
    try {
      const res  = await apiFetch('/api/wizard/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          instructions: config.instructions,
          capability_groups: config.capability_groups,
        }),
      })
      const data = await res.json()
      if (data.ok) { setSaved(true); fetchAll() }
    } finally {
      setSaving(false)
    }
  }

  /* Build ReactFlow nodes — memoised so RF doesn't reinitialise on every render */
  const rfNodes: RFNode[] = useMemo(() => STATIC_NODES.map(n => {
    const info = nodes.find(x => x.id === n.id)
    return {
      ...n,
      data: {
        nodeId:   n.id,
        label:    info?.label ?? n.id,
        selected: selectedId === n.id,
        internal: info?.internal ?? false,
      },
    }
  }), [nodes, selectedId])

  const selectedNode = selectedId ? nodes.find(x => x.id === selectedId) : null
  const selectedMeta = selectedId ? NODE_META[selectedId] : null

  if (!config) {
    return (
      <div style={{ padding: 32, color: 'var(--subtext0)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
        Loading…
        <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sans)' }}>

      {/* ── Top toolbar ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', borderBottom: '1px solid var(--surface0)',
        background: 'var(--mantle)', flexShrink: 0,
      }}>
        <Settings size={14} color="#cba6f7" />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Wizard</span>
        <span style={{ fontSize: 12, color: 'var(--subtext0)' }}>AI assistant topology</span>

        {/* Status badge */}
        {status && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
            {status.topology_loaded
              ? <CheckCircle size={12} color="#a6e3a1" />
              : <AlertCircle size={12} color="#f38ba8" />}
            <span style={{ fontSize: 11, color: status.topology_loaded ? '#a6e3a1' : '#f38ba8' }}>
              {status.topology_loaded ? 'topology loaded' : 'not loaded'}
            </span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Enable toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={e => updateConfig({ enabled: e.target.checked })}
              style={{ width: 14, height: 14, accentColor: '#cba6f7' }}
            />
            Enable Wizard
          </label>

          {/* Save */}
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none',
              background: '#cba6f7', color: '#1e1e2e',
              fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <Save size={12} />
            {saving ? 'Saving…' : 'Save'}
          </button>

          {saved && !saving && (
            <span style={{ fontSize: 11, color: '#a6e3a1', display: 'flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle size={11} /> Saved
            </span>
          )}
        </div>
      </div>

      {/* ── Main area: canvas + right panel ─────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ReactFlow canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={rfNodes}
            edges={STATIC_EDGES}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_e, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            nodesDraggable={false}
            nodesConnectable={false}
            panOnDrag
            zoomOnScroll
            style={{ background: 'var(--base)' }}
          >
            <Background color="var(--surface0)" gap={20} />
            <Controls style={{ background: 'var(--surface0)', border: '1px solid var(--surface1)' }} />
          </ReactFlow>
        </div>

        {/* Right panel — properties + LLM config */}
        <div style={{
          width: 320, borderLeft: '1px solid var(--surface0)',
          background: 'var(--mantle)', display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}>
          {selectedNode && selectedMeta ? (
            /* Selected node properties */
            <div style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: `color-mix(in srgb, ${selectedMeta.color} 20%, var(--surface0))`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selectedMeta.icon}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {selectedNode.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                    {selectedNode.id}
                  </div>
                </div>
              </div>

              {/* Runtime + internal badges */}
              <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: `color-mix(in srgb, ${selectedMeta.color} 20%, var(--surface1))`,
                  color: selectedMeta.color, fontWeight: 600,
                }}>
                  {selectedMeta.sub}
                </span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: 'color-mix(in srgb, #a6e3a1 15%, var(--surface1))',
                  color: '#a6e3a1', fontWeight: 600,
                }}>
                  {selectedNode.status}
                </span>
                {selectedNode.internal && (
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10,
                    background: 'var(--surface1)', color: 'var(--overlay0)',
                    fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <Lock size={9} /> internal
                  </span>
                )}
              </div>

              {/* Edit Capabilities button */}
              <button
                onClick={() => setCapsOpen(true)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: `1px solid ${selectedMeta.color}40`,
                  background: `color-mix(in srgb, ${selectedMeta.color} 10%, var(--surface0))`,
                  color: 'var(--text)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Settings size={13} />
                Edit Capabilities
                <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
              </button>

              {/* Actions */}
              {(nodeActions.length > 0 || selectedId === 'triv-wizard-agent') && (
                <div style={{ marginTop: 16 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--subtext0)',
                    letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 8,
                  }}>
                    Actions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {nodeActions.filter(a => !(selectedId === 'triv-wizard-agent' && a.id === 'run-task')).map(a => (
                      <button
                        key={a.id}
                        onClick={() => runAction(a.id)}
                        disabled={runningAction !== null}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '6px 10px', borderRadius: 6,
                          border: `1px solid ${selectedMeta!.color}30`,
                          background: actionResult?.actionId === a.id
                            ? actionResult.ok
                              ? 'color-mix(in srgb, #a6e3a1 10%, var(--surface0))'
                              : 'color-mix(in srgb, #f38ba8 10%, var(--surface0))'
                            : 'var(--surface0)',
                          color: 'var(--text)', fontSize: 11, cursor: runningAction ? 'wait' : 'pointer',
                          opacity: runningAction && runningAction !== a.id ? 0.5 : 1,
                          textAlign: 'left',
                        }}
                      >
                        {runningAction === a.id
                          ? <Loader size={11} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                          : <Play size={11} color={selectedMeta!.color} style={{ flexShrink: 0 }} />
                        }
                        <span style={{ fontWeight: 600 }}>{a.label}</span>
                      </button>
                    ))}

                    {/* List Topology Tools — injected as last action for the Agent node */}
                    {selectedId === 'triv-wizard-agent' && (
                      <button
                        onClick={openTopoTools}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '6px 10px', borderRadius: 6,
                          border: `1px solid ${selectedMeta!.color}30`,
                          background: 'var(--surface0)',
                          color: 'var(--text)', fontSize: 11, cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <Play size={11} color={selectedMeta!.color} style={{ flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>List Topology Tools</span>
                      </button>
                    )}
                  </div>

                  {/* Action output */}
                  {actionResult && (
                    <div style={{
                      marginTop: 10, padding: '8px 10px', borderRadius: 6,
                      background: 'var(--crust)', border: `1px solid ${actionResult.ok ? '#a6e3a130' : '#f38ba830'}`,
                      fontSize: 11, color: actionResult.ok ? 'var(--text)' : '#f38ba8',
                      fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'pre-wrap', maxHeight: 180,
                      overflowY: 'auto', wordBreak: 'break-word',
                    }}>
                      {actionResult.output ?? actionResult.error ?? (actionResult.ok ? 'OK' : 'Error')}
                    </div>
                  )}
                </div>
              )}

              {/* Instructions + Danger Area — only for the Agent node */}
              {selectedId === 'triv-wizard-agent' && config && (
                <>
                  <div style={{ marginTop: 20 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--subtext0)',
                      letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 10,
                    }}>
                      User Instructions
                    </div>
                    <span style={sLabel}>
                      Extra instructions
                      <span style={{ fontWeight: 400, color: 'var(--overlay0)', marginLeft: 4 }}>(injected per task)</span>
                    </span>
                    <textarea
                      value={config.instructions}
                      onChange={e => updateConfig({ instructions: e.target.value })}
                      placeholder="E.g.: Always use prefix 'lab-' for node IDs."
                      rows={5}
                      style={{ ...sInput, resize: 'vertical', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}
                    />
                  </div>

                  {/* Danger Area */}
                  <div style={{ marginTop: 20 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: '#f38ba8',
                      letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 4,
                    }}>
                      ⚠ Danger Area
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--overlay0)', margin: '0 0 10px', lineHeight: 1.5 }}>
                      Enable additional tool groups for the Wizard agent. Use with caution.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {([
                        { key: 'node_capabilities', label: 'Node Capabilities', desc: 'Read/write driver config for any node' },
                        { key: 'node_actions',      label: 'Node Actions',      desc: 'Execute driver commands on any node' },
                        { key: 'node_lifecycle',    label: 'Node Lifecycle',    desc: 'Start / stop / restart nodes' },
                        { key: 'network_ops',       label: 'Network Ops',       desc: 'Create, deploy and delete networks' },
                        { key: 'secrets',           label: 'Secrets',           desc: 'Write and delete secrets' },
                        { key: 'topology_ai_tools', label: 'Topology AI Tools', desc: 'Use AI-tool-enabled actions from topology nodes (e.g. container-status)' },
                      ] as { key: keyof CapabilityGroups; label: string; desc: string }[]).map(({ key, label, desc }) => {
                        const groups = config.capability_groups ?? {}
                        const enabled = groups[key] ?? false
                        return (
                          <label key={key} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
                            padding: '7px 10px', borderRadius: 6,
                            border: `1px solid ${enabled ? '#f38ba840' : 'var(--surface1)'}`,
                            background: enabled ? 'color-mix(in srgb, #f38ba8 8%, var(--surface0))' : 'var(--surface0)',
                          }}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={e => updateConfig({
                                capability_groups: { ...config.capability_groups, [key]: e.target.checked },
                              })}
                              style={{ marginTop: 2, accentColor: '#f38ba8', flexShrink: 0 }}
                            />
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: enabled ? '#f38ba8' : 'var(--text)' }}>{label}</div>
                              <div style={{ fontSize: 10, color: 'var(--overlay0)', marginTop: 1 }}>{desc}</div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* No selection placeholder */
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--overlay0)', fontSize: 12, gap: 8, padding: 20,
              textAlign: 'center',
            }}>
              <Settings size={24} />
              Click a node to view its properties
            </div>
          )}
        </div>
      </div>

      {/* ── CapabilitiesModal ──────────────────────────────────────── */}
      {capsOpen && selectedId && selectedNode && (
        <CapabilitiesModal
          node={{
            id: selectedNode.id,
            driver: 'generic',
            category: selectedNode.runtime ?? 'generic',
            runtime: selectedNode.runtime ?? null,
            parent: null,
            interfaces: [],
            properties: {},
          } as NodeDef}
          apiBase="/api/wizard/nodes"
          lockedDrivers={selectedNode.locked_drivers}
          onClose={() => { setCapsOpen(false); fetchAll() }}
          onRefresh={fetchAll}
        />
      )}

      {/* ── Topology Tools Modal ───────────────────────────────────── */}
      {topoToolsOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setTopoToolsOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 520, maxHeight: '70vh', borderRadius: 12,
              background: 'var(--mantle)', border: '1px solid var(--surface1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '14px 18px', borderBottom: '1px solid var(--surface0)',
              flexShrink: 0,
            }}>
              <List size={15} color="#f5c2e7" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
                Topology AI Tools
              </span>
              <button
                onClick={() => setTopoToolsOpen(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--overlay0)', padding: 2,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
              {topoToolsLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--subtext0)', fontSize: 12, padding: 16 }}>
                  <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
                </div>
              ) : topoTools.length === 0 ? (
                <div style={{ color: 'var(--overlay0)', fontSize: 12, padding: 16, textAlign: 'center' }}>
                  No AI-tool-enabled actions found in the topology.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {topoTools.map(node => (
                    <div key={node.node_id}>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: '#cba6f7',
                        marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <Bot size={13} />
                        {node.node_label}
                        <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--overlay0)' }}>
                          {node.node_id}
                        </span>
                      </div>

                      {node.drivers.map(drv => (
                        <div key={drv.driver_id} style={{ marginLeft: 12, marginBottom: 8 }}>
                          <div style={{
                            fontSize: 11, fontWeight: 600, color: '#f5c2e7',
                            marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5,
                          }}>
                            <Wrench size={10} />
                            {drv.driver_id}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginLeft: 16 }}>
                            {drv.actions.map(act => (
                              <div
                                key={act.id}
                                style={{
                                  fontSize: 11, color: 'var(--text)',
                                  padding: '4px 8px', borderRadius: 5,
                                  background: 'var(--surface0)',
                                  border: '1px solid var(--surface1)',
                                  display: 'flex', alignItems: 'center', gap: 6,
                                }}
                              >
                                <Play size={9} color="#a6e3a1" style={{ flexShrink: 0 }} />
                                <span style={{ fontWeight: 600 }}>{act.label}</span>
                                {act.label !== act.id && (
                                  <span style={{ fontSize: 10, color: 'var(--overlay0)' }}>({act.id})</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}

