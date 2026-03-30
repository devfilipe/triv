import { apiFetch } from './apiFetch'
/* triv WebUI — NodeCapabilities: manage capabilities (env) files per node.
   Handles driver selection (from catalog), driver_args (schema-guided),
   action refs (from selected drivers), and health config.
   Actions are created/edited in the Drivers screen; here you only pick refs.   */

import React, { useCallback, useEffect, useState } from 'react'
import {
  Cpu, Monitor, Box, Shield, Zap, Plus, Trash2, Save,
  X, ChevronDown, ChevronRight, AlertTriangle, Loader2,
  FileJson, RefreshCw, Settings, Terminal, Play, Info, Activity,
  HardDrive, Layers, Package, Copy, Code, Search,
} from 'lucide-react'
import type { NodeDef, ActionDef } from './types'
import { CATEGORY_META, RUNTIME_BADGE } from './types'

/* ── Types ────────────────────────────────────────────────────────── */
interface DriverEntry {
  driver: string            // id of the driver from catalog
  driver_args: Record<string, any>
}

interface SchemaField {
  type: string; label: string; description: string
  required?: boolean; default?: any; placeholder?: string
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

/* ── Icon mapping ─────────────────────────────────────────────────── */
const ACTION_ICON: Record<string, React.FC<any>> = {
  terminal: Terminal, play: Play, info: Info, activity: Activity,
  'hard-drive': HardDrive, zap: Zap, settings: Settings, box: Box,
  shield: Shield, layers: Layers, package: Package,
}

/* ── Props ────────────────────────────────────────────────────────── */
interface Props { nodes: NodeDef[]; onRefresh: () => void; onNavigate?: (view: string) => void }

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

/* ── Main component ──────────────────────────────────────────────── */
export default function NodeCapabilities({ nodes, onRefresh, onNavigate }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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
  const [domainTemplates, setDomainTemplates] = useState<{name: string; path: string; source: string}[]>([])

  const runtimeNodes = nodes.filter(n => n.runtime)

  // Load driver catalog once
  useEffect(() => {
    apiFetch('/api/drivers/catalog').then(r => r.json()).then(setCatalog).catch(() => {})
    apiFetch('/api/templates/libvirt/domains').then(r => r.json()).then(setDomainTemplates).catch(() => {})
  }, [])

  // Load capabilities when node selected
  const loadCaps = useCallback(async (nodeId: string) => {
    setLoading(true); setError(''); setSuccess(''); setCollapsedDrivers(new Set())
    try {
      const res = await apiFetch(`/api/nodes/${nodeId}/capabilities`)
      if (!res.ok) throw new Error(await res.text())
      const data: CapabilitiesData = await res.json()
      setCaps(data)
      // Normalise: if backend still returns {name,...} convert to {driver,...}
      const drv = (data.drivers || []).map((d: any) => ({
        driver: d.driver ?? d.name ?? d.id ?? '',
        driver_args: d.driver_args ?? {},
      }))
      setDrivers(drv)
      // Normalise action refs: backend uses $ref/driver/origin, internal uses _ref/_driver/_origin
      // Enrich $ref actions with full metadata (label, icon, type, command, etc.) from the driver catalog
      const acts = (data.actions || []).map((a: any) => {
        if (a['$ref']) {
          const refId = a['$ref']
          const driverId = a.driver || ''
          const origin = a.origin || ''
          // Look up the full action definition in the catalog
          const cat = catalog.find((c: any) => c.id === driverId)
          const catalogAction = cat?.actions?.[refId]
          // Merge: catalog base + file overrides + internal fields
          return {
            ...(catalogAction || {}),
            ...a,
            _ref: `$ref:${refId}`,
            _driver: driverId,
            _origin: origin,
          }
        }
        return a
      })
      setActions(acts)
      setHealth(data.health || null)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [catalog])

  useEffect(() => { if (selectedNodeId) loadCaps(selectedNodeId) }, [selectedNodeId, loadCaps])

  // Init capabilities
  const handleInit = useCallback(async () => {
    if (!selectedNodeId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/nodes/${selectedNodeId}/capabilities/init`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) { setSuccess(data.created ? 'Capabilities file created!' : 'Already exists'); loadCaps(selectedNodeId); onRefresh() }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [selectedNodeId, loadCaps, onRefresh])

  // Save capabilities — new format: {drivers: [{driver, driver_args}], actions: [...]}
  const handleSave = useCallback(async () => {
    if (!selectedNodeId) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const actionsToSave = actions.map(a => {
        if (a._ref) {
          // Keep ref + driver tag + origin
          const out: any = { '$ref': a._ref.replace('$ref:', '') }
          if (a._driver) out.driver = a._driver
          if (a._origin) out.origin = a._origin
          return out
        }
        // Custom action: strip internal fields
        const { _ref, _driver, _origin, ...rest } = a
        return rest
      })
      const body: any = { drivers, actions: actionsToSave }
      if (health) body.health = health
      const res = await apiFetch(`/api/nodes/${selectedNodeId}/capabilities`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) { setSuccess(`Saved to ${data.env_file}`); onRefresh() }
      else setError(data.detail || 'Save failed')
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }, [selectedNodeId, drivers, actions, health, onRefresh])

  /* ── Driver helpers ────────────────────────────────────────── */
  const addDriver = (driverId: string) => {
    const cat = catalog.find(c => c.id === driverId)
    const defaultArgs: Record<string, any> = {}
    if (cat?.driver_args_schema) {
      for (const [k, v] of Object.entries(cat.driver_args_schema)) {
        defaultArgs[k] = v.default ?? ''
      }
    }
    setDrivers(prev => [...prev, { driver: driverId, driver_args: defaultArgs }])

    // Auto-import ALL actions from this driver into the capabilities
    if (cat?.actions) {
      const origin = cat.origin || 'native'
      const newActions = Object.keys(cat.actions)
        .filter(key => !actions.some(a => a._ref === `$ref:${key}` && a._driver === driverId))
        .map(key => ({ ...cat.actions[key], _ref: `$ref:${key}`, _driver: driverId, _origin: origin }))
      if (newActions.length > 0) {
        setActions(prev => [...prev, ...newActions])
      }
    }
  }

  const removeDriver = (idx: number) => {
    const removedId = drivers[idx]?.driver
    setDrivers(prev => prev.filter((_, i) => i !== idx))
    // Remove actions that belong to this driver
    if (removedId) {
      setActions(prev => prev.filter(a => a._driver !== removedId))
    }
  }

  const updateDriverArg = (dIdx: number, key: string, value: any) => {
    setDrivers(prev => prev.map((d, i) =>
      i === dIdx ? { ...d, driver_args: { ...d.driver_args, [key]: value } } : d,
    ))
  }

  /* ── Action helpers ────────────────────────────────────────── */
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

  const selectedNode = nodes.find(n => n.id === selectedNodeId)

  // Build current JSON preview
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

  // Get compatible drivers for current node runtime
  const nodeRuntime = selectedNode?.runtime ?? null
  const compatibleDrivers = catalog.filter(c => {
    if (!nodeRuntime) return true
    if (c.type === 'unknown') return true
    // AI/overlay drivers are compatible with any runtime
    if (c.type === 'ai-llm' || c.type === 'ai-agent' || c.type === 'ai-tool') return true
    if (nodeRuntime === 'libvirt' && c.type === 'libvirt') return true
    if ((nodeRuntime === 'docker' || nodeRuntime === 'podman') && c.type === 'container') return true
    if (nodeRuntime === 'app' && c.type === 'app') return true
    if (nodeRuntime === 'remote' && c.type === 'remote') return true
    return false
  })

  return (
    <div style={{ height: '100%', display: 'flex', fontFamily: 'var(--font-sans)' }}>
      {/* ── Left: Node list ──────────────────────────────────── */}
      <div style={{
        width: 240, minWidth: 240, borderRight: '1px solid var(--surface1)',
        background: 'var(--mantle)', overflowY: 'auto',
      }}>
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--surface0)',
          fontSize: 10, fontWeight: 700, color: 'var(--subtext0)',
          textTransform: 'uppercase', letterSpacing: '0.5px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Shield size={12} color="var(--mauve)" />
          Node Capabilities
        </div>

        {runtimeNodes.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--overlay0)', fontSize: 11 }}>
            No nodes with runtime found.<br />Add a VM or Container node first.
          </div>
        )}

        {runtimeNodes.map(node => {
          const meta = CATEGORY_META[node.category] ?? CATEGORY_META.generic
          const rtBadge = node.runtime ? RUNTIME_BADGE[node.runtime] : null
          const isSelected = node.id === selectedNodeId
          const shortId = (node.properties as any)?.short_id
          return (
            <div key={node.id} onClick={() => setSelectedNodeId(node.id)} style={{
              padding: '10px 14px', cursor: 'pointer',
              borderBottom: '1px solid var(--surface0)',
              background: isSelected ? 'var(--surface0)' : 'transparent',
              borderLeft: isSelected ? '3px solid var(--mauve)' : '3px solid transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6, background: `${meta.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {node.runtime === 'libvirt' ? <Cpu size={12} color={meta.color} /> :
                   node.runtime === 'docker' ? <Monitor size={12} color={meta.color} /> :
                   <Box size={12} color={meta.color} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    {(node.properties as any)?.label ?? node.vm_name ?? node.id}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                    {shortId && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'var(--surface1)', color: 'var(--overlay1)', fontFamily: 'var(--font-mono)' }}>{shortId}</span>}
                    {rtBadge && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: rtBadge.bg, color: rtBadge.color }}>{rtBadge.label}</span>}
                    {node.env ? <span style={{ fontSize: 8, color: '#a6e3a1' }}>● env</span> : <span style={{ fontSize: 8, color: 'var(--overlay0)' }}>○ no env</span>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {nodes.filter(n => !n.runtime).length > 0 && (
          <>
            <div style={{ padding: '8px 14px', fontSize: 9, fontWeight: 600, color: 'var(--overlay0)', textTransform: 'uppercase', borderBottom: '1px solid var(--surface0)' }}>
              Logical Nodes (no runtime)
            </div>
            {nodes.filter(n => !n.runtime).map(node => (
              <div key={node.id} onClick={() => setSelectedNodeId(node.id)} style={{
                padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid var(--surface0)',
                background: node.id === selectedNodeId ? 'var(--surface0)' : 'transparent', opacity: 0.6,
              }}>
                <div style={{ fontSize: 11, color: 'var(--subtext0)' }}>{(node.properties as any)?.label ?? node.id}</div>
              </div>
            ))}
          </>
        )}
        {onNavigate && (
          <div style={{ padding: 12 }}>
            <button onClick={() => onNavigate('drivers')}
              style={{ ...btn('#f9e2af'), width: '100%', justifyContent: 'center', fontSize: 10 }}>
              <Cpu size={11} /> Go to Drivers
            </button>
          </div>
        )}
      </div>

      {/* ── Right: Capabilities editor ───────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {!selectedNodeId ? (
          <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--overlay0)' }}>
            <Shield size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Node Capabilities</div>
            <div style={{ fontSize: 12 }}>Select a node to manage its drivers, actions, and health config.</div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--overlay0)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div style={{ maxWidth: 800 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>
                  {(selectedNode?.properties as any)?.label ?? selectedNodeId}
                </h3>
                <div style={{ fontSize: 11, color: 'var(--subtext0)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  {selectedNodeId}
                  {(selectedNode?.properties as any)?.short_id && (
                    <span style={{ marginLeft: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--surface1)', fontSize: 10 }}>
                      {(selectedNode?.properties as any)?.short_id}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              {!caps?.file_exists && (
                <button onClick={handleInit} style={btn('#a6e3a1', true)}><Plus size={12} /> Initialize</button>
              )}
              <button onClick={() => setShowJson(v => !v)} title="View JSON" style={btn(showJson ? '#cba6f7' : '#6c7086')}>
                <Code size={12} /> {showJson ? 'Hide JSON' : 'JSON'}
              </button>
              <button onClick={handleSave} disabled={saving} style={btn('#89b4fa', true)}>
                {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => loadCaps(selectedNodeId)} style={btn('#6c7086')}>
                <RefreshCw size={12} />
              </button>
            </div>

            {/* Messages */}
            {error && <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12, background: '#f38ba820', border: '1px solid #f38ba840', color: '#f38ba8', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {error}</div>}
            {success && <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12, background: '#a6e3a120', border: '1px solid #a6e3a140', color: '#a6e3a1', fontSize: 11 }}>✓ {success}</div>}

            {/* File info */}
            {caps && (
              <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 16, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 11, color: 'var(--subtext0)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileJson size={14} color="var(--mauve)" />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{caps.env_file}</span>
                <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, background: caps.file_exists ? '#a6e3a120' : '#f38ba820', color: caps.file_exists ? '#a6e3a1' : '#f38ba8' }}>{caps.file_exists ? 'exists' : 'not created'}</span>
              </div>
            )}

            {/* ── JSON Preview ─────────────────────────────────── */}
            {showJson && (
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--surface0)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Code size={14} color="var(--mauve)" />
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Generated JSON</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(jsonPreview); setSuccess('JSON copied!') }}
                    style={btn('#6c7086')}
                  ><Copy size={10} /> Copy</button>
                </div>
                <pre style={{
                  margin: 0, padding: 14, fontSize: 10, lineHeight: 1.6,
                  color: 'var(--text)', fontFamily: 'var(--font-mono)',
                  background: 'var(--crust)', overflowX: 'auto', maxHeight: 400,
                }}>{jsonPreview}</pre>
              </div>
            )}

            {/* ── Drivers Section ──────────────────────────────── */}
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
                          <div style={{ padding: '0 12px 12px 12px' }}>
                        {/* Schema-guided driver_args */}
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
                              ) : key === 'template' && domainTemplates.length > 0 ? (
                                /* Template picker for domain XML templates */
                                <>
                                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                    <select
                                      style={{ ...selectSt, flex: 1 }}
                                      value={drv.driver_args[key] ?? ''}
                                      onChange={e => updateDriverArg(dIdx, key, e.target.value)}
                                    >
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
                          /* Freeform key-value for drivers without schema */
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
                  {/* Action picker — show actions grouped by selected driver */}
                  {showAddAction && (
                    <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--blue)30' }}>
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
                          To create new actions, go to <b>Drivers</b> and edit the driver.
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
                    // Build ordered groups preserving original indices
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
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            marginBottom: 6, paddingLeft: 2,
                          }}>
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

            {/* ── Template Variables Reference ────────────────── */}
            <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 10, color: 'var(--subtext0)', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 6 }}>Template Variables Reference</div>
              <code style={{ fontSize: 9 }}>
                {'${vm_name}'} — resolved VM/container name<br />
                {'${node.id}'} — node ID · {'${node.properties.<key>}'} — node property<br />
                {'${iface.<id>.<field>}'} — interface attribute (e.g. {'${iface.mgmt.ip}'})<br />
                {'${env.<key>}'} — driver_args value · {'${json:env.<key>}'} — JSON-serialised<br />
                {'${project_dir}'} — absolute project directory · {'${project_id}'} — project identifier
              </code>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
