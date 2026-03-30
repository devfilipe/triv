import { apiFetch } from './apiFetch'
/* triv WebUI — NodeDrivers: browse all drivers (json-driver + py-driver) from catalog,
   view details, edit driver_args_schema, create/edit actions.
   - json-driver: actions are JSON objects, editable inline.
   - py-driver:   actions are Python methods (action_*), editable via code editor.
   Commands are consolidated into Actions for py-drivers.                              */

import React, { useCallback, useEffect, useState } from 'react'
import {
  Cpu, Package, Plus, Loader2, AlertTriangle, Copy, CheckCircle,
  ExternalLink, FileCode, ChevronRight, Info, Code, HardDrive,
  Zap, FileJson, ChevronDown, Settings, Terminal, RefreshCw, Store,
  Trash2, Save, Edit3, X, Shield,
} from 'lucide-react'

/* ── Types ────────────────────────────────────────────────────────── */
interface SchemaField {
  type: string; label: string; description: string
  required?: boolean; default?: any; placeholder?: string
}
interface CatalogDriver {
  id: string; kind: 'json-driver' | 'py-driver'
  type: string; label: string; vendor: string; version: string
  description?: string
  accent_color: string
  driver_args_schema: Record<string, SchemaField>
  actions: Record<string, any>
  source?: string
  origin?: string
}

/* ── Props ────────────────────────────────────────────────────────── */
interface Props { onRefresh: () => void; onNavigate?: (view: string) => void }

/* ── Available icon options (all renderable by triv) ─────────────── */
const AVAILABLE_ICONS = [
  { value: 'terminal',      label: '⬛ terminal' },
  { value: 'play',          label: '▶ play' },
  { value: 'square',        label: '⏹ square' },
  { value: 'power',         label: '⏻ power' },
  { value: 'power-off',     label: '⏻ power-off' },
  { value: 'refresh-cw',    label: '↻ refresh-cw' },
  { value: 'restart',       label: '↻ restart' },
  { value: 'clipboard',     label: '📋 clipboard' },
  { value: 'upload',        label: '⬆ upload' },
  { value: 'settings',      label: '⚙ settings' },
  { value: 'link',          label: '🔗 link' },
  { value: 'external-link', label: '↗ external-link' },
  { value: 'hammer',        label: '🔨 hammer' },
  { value: 'activity',      label: '📈 activity' },
  { value: 'file-text',     label: '📄 file-text' },
  { value: 'layers',        label: '▤ layers' },
  { value: 'folder',        label: '📁 folder' },
  { value: 'zap',           label: '⚡ zap' },
  { value: 'monitor',       label: '🖥 monitor' },
  { value: 'globe',         label: '🌐 globe' },
  { value: 'trash-2',       label: '🗑 trash-2' },
  { value: 'box',           label: '📦 box' },
  { value: 'pause',         label: '⏸ pause' },
  { value: 'info',          label: 'ℹ info' },
  { value: 'camera',        label: '📷 camera' },
  { value: 'hard-drive',    label: '💾 hard-drive' },
  { value: 'scroll-text',   label: '📜 scroll-text' },
  { value: 'shield',        label: '🛡 shield' },
  { value: 'package',       label: '📦 package' },
]

/* ── Action types with descriptions ─────────────────────────────── */
const ACTION_TYPES: { value: string; label: string; tooltip: string }[] = [
  {
    value: 'exec',
    label: 'Execute',
    tooltip: 'Run a shell command silently. Result shown as success/failure. Use for fire-and-forget operations (start, stop, reboot).',
  },
  {
    value: 'exec-output',
    label: 'Exec + Output',
    tooltip: 'Run a shell command and display stdout/stderr in an output panel. Use for status checks, logs, or any command whose output matters.',
  },
  {
    value: 'exec-with-data',
    label: 'Exec + Data',
    tooltip: 'Run a shell command with a user-provided payload (JSON or text). The data is injected as a variable or passed via stdin.',
  },
  {
    value: 'console',
    label: 'Console',
    tooltip: 'Open an interactive terminal. Requires "command" (e.g. "docker exec -it ${vm_name} bash"). For SSH consoles, also set "host", "user" and "port" fields.',
  },
  {
    value: 'driver-command',
    label: 'Driver Command',
    tooltip: 'Delegate execution to a Python driver method. Set "driver" to the Python driver id (e.g. "generic-driver-container-python") and "command" to the shell equivalent for transparency.',
  },
  {
    value: 'link',
    label: 'Open URL',
    tooltip: 'Open a URL in a new browser tab. Requires "url" field. Supports ${vm_name} and ${env.*} variables.',
  },
  {
    value: 'webui',
    label: 'WebUI Panel',
    tooltip: 'Open a URL in an embedded side panel inside triv. Useful for exposing a device management UI directly in the topology.',
  },
  {
    value: 'tool',
    label: 'AI Tool',
    tooltip: 'Expose this action as a callable tool for Agent nodes. Declare tool_args so the LLM knows what parameters to pass.',
  },
]

/* ── Custom type select with per-option tooltips ─────────────────── */
function TypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [hovered, setHovered] = React.useState<string | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)
  const selected = ACTION_TYPES.find(t => t.value === value) ?? ACTION_TYPES[0]

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const hoveredItem = ACTION_TYPES.find(t => t.value === hovered)

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '6px 10px', borderRadius: 6, boxSizing: 'border-box',
          border: '1px solid var(--surface1)', background: 'var(--surface0)',
          color: 'var(--text)', fontSize: 10, fontFamily: 'var(--font-mono)',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <span>{selected.label}</span>
        <ChevronDown size={10} style={{ opacity: 0.5, flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000, marginTop: 2,
          background: 'var(--mantle)', border: '1px solid var(--surface1)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: '100%', width: 220,
        }}>
          {hoveredItem && (
            <div style={{
              padding: '6px 10px', fontSize: 9, color: 'var(--subtext0)',
              borderBottom: '1px solid var(--surface0)', lineHeight: 1.4,
              fontFamily: 'var(--font-mono)',
            }}>
              {hoveredItem.tooltip}
            </div>
          )}
          {ACTION_TYPES.map(t => (
            <div
              key={t.value}
              onMouseEnter={() => setHovered(t.value)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { onChange(t.value); setOpen(false) }}
              style={{
                padding: '6px 10px', fontSize: 10, cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                background: t.value === value ? 'var(--surface0)' : hovered === t.value ? 'var(--surface1)' : 'transparent',
                color: t.value === value ? 'var(--blue)' : 'var(--text)',
              }}
            >
              {t.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
const codeSt: React.CSSProperties = {
  width: '100%', minHeight: 160, padding: '10px 12px', borderRadius: 6,
  border: '1px solid var(--surface1)', background: 'var(--crust)',
  color: 'var(--green)', fontSize: 11, fontFamily: 'var(--font-mono)',
  outline: 'none', boxSizing: 'border-box', resize: 'vertical',
  lineHeight: 1.6, tabSize: 4,
}

/* ── Schema field type options ───────────────────────────────────── */
const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array']

/* ── Main component ──────────────────────────────────────────────── */
export default function NodeDrivers({ onRefresh, onNavigate }: Props) {
  const [catalog, setCatalog] = useState<CatalogDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [showScaffold, setShowScaffold] = useState(false)
  const [scaffoldForm, setScaffoldForm] = useState({
    name: '', vendor: '', label: '', accent_color: '#89b4fa',
    kind: 'json-driver' as 'py-driver' | 'json-driver',
    driver_type: 'unknown',
  })
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; path?: string; detail?: string; class_name?: string; kind?: string } | null>(null)
  const [error, setError] = useState('')
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)

  // Sections
  const [showSchema, setShowSchema] = useState(true)
  const [showActions, setShowActions] = useState(true)
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set())

  // Sidebar collapse
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set())
  const toggleLane = (lane: string) => setCollapsedLanes(prev => {
    const next = new Set(prev)
    if (next.has(lane)) next.delete(lane); else next.add(lane)
    return next
  })

  // ── Schema editing state ──────────────────────────────────────
  const [editingSchema, setEditingSchema] = useState(false)
  const [draftSchema, setDraftSchema] = useState<Record<string, SchemaField>>({})
  const [savingSchema, setSavingSchema] = useState(false)
  const [schemaMsg, setSchemaMsg] = useState('')

  // ── JSON-driver action editing state ──────────────────────────
  const [editingActions, setEditingActions] = useState(false)
  const [draftActions, setDraftActions] = useState<Record<string, any>>({})
  const [savingActions, setSavingActions] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  // ── Py-driver action editing state ────────────────────────────
  const [editingPyAction, setEditingPyAction] = useState<string | null>(null)
  const [pyActionSource, setPyActionSource] = useState('')
  const [savingPyAction, setSavingPyAction] = useState(false)
  const [pyActionMsg, setPyActionMsg] = useState('')
  const [showNewPyAction, setShowNewPyAction] = useState(false)
  const [newPyActionName, setNewPyActionName] = useState('')

  // Fetch catalog
  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/drivers/catalog')
      if (res.ok) setCatalog(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchCatalog() }, [fetchCatalog])

  const handleScaffold = useCallback(async () => {
    setCreating(true); setError(''); setResult(null)
    try {
      const res = await apiFetch('/api/drivers/scaffold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scaffoldForm),
      })
      const data = await res.json()
      if (res.ok && data.ok) { setResult(data); fetchCatalog(); onRefresh() }
      else setError(data.detail || 'Failed to create driver')
    } catch (e: any) { setError(e.message) }
    finally { setCreating(false) }
  }, [scaffoldForm, fetchCatalog, onRefresh])

  const drv = catalog.find(c => c.id === selectedDriver)
  const isVendorJson = drv?.kind === 'json-driver' && drv?.origin?.startsWith('vendor:')
  const isVendorPy = drv?.kind === 'py-driver' && drv?.origin?.startsWith('vendor:')
  const isEditable = isVendorJson || isVendorPy

  // Split catalog
  const nativeDrivers = catalog.filter(c => !c.origin || c.origin === 'native')
  const vendorDrivers = catalog.filter(c => c.origin?.startsWith('vendor:'))
  const vendorGroups: Record<string, CatalogDriver[]> = {}
  for (const d of vendorDrivers) {
    const vname = d.origin!.replace('vendor:', '')
    if (!vendorGroups[vname]) vendorGroups[vname] = []
    vendorGroups[vname].push(d)
  }

  const renderItem = (cat: CatalogDriver) => (
    <DriverListItem key={cat.id} cat={cat} isSelected={cat.id === selectedDriver}
      onClick={() => {
        setSelectedDriver(cat.id); setShowScaffold(false)
        setExpandedActions(new Set()); setEditingActions(false)
        setEditingSchema(false); setEditingPyAction(null)
        setActionMsg(''); setSchemaMsg(''); setPyActionMsg('')
      }} />
  )

  /* ── Schema editing helpers ────────────────────────────────── */
  const startSchemaEditing = () => {
    if (!drv) return
    setDraftSchema(JSON.parse(JSON.stringify(drv.driver_args_schema)))
    setEditingSchema(true)
    setSchemaMsg('')
  }
  const cancelSchemaEditing = () => { setEditingSchema(false); setDraftSchema({}); setSchemaMsg('') }

  const addSchemaField = () => {
    const key = `field-${Object.keys(draftSchema).length + 1}`
    setDraftSchema(prev => ({
      ...prev,
      [key]: { type: 'string', label: '', description: '', required: false, default: '' },
    }))
  }

  const updateSchemaField = (key: string, prop: string, value: any) => {
    setDraftSchema(prev => ({
      ...prev,
      [key]: { ...prev[key], [prop]: value },
    }))
  }

  const renameSchemaKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey || draftSchema[newKey]) return
    setDraftSchema(prev => {
      const next: Record<string, SchemaField> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (k === oldKey) next[newKey] = v; else next[k] = v
      }
      return next
    })
  }

  const removeSchemaField = (key: string) => {
    setDraftSchema(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  const saveSchema = async () => {
    if (!drv) return
    setSavingSchema(true); setSchemaMsg('')
    try {
      const res = await apiFetch(`/api/drivers/catalog/${drv.id}/schema`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: draftSchema }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setSchemaMsg(`Saved ${data.field_count} fields`)
        setEditingSchema(false)
        fetchCatalog()
      } else { setSchemaMsg(`Error: ${data.detail || 'Save failed'}`) }
    } catch (e: any) { setSchemaMsg(`Error: ${e.message}`) }
    finally { setSavingSchema(false) }
  }

  /* ── JSON-driver action editing helpers ────────────────────── */
  const startEditing = () => {
    if (!drv) return
    setDraftActions(JSON.parse(JSON.stringify(drv.actions)))
    setEditingActions(true); setActionMsg('')
  }
  const cancelEditing = () => { setEditingActions(false); setDraftActions({}); setActionMsg('') }

  const addNewAction = () => {
    const key = `action-${Object.keys(draftActions).length + 1}`
    setDraftActions(prev => ({
      ...prev,
      [key]: { id: key, label: 'New Action', type: 'exec', icon: 'terminal', command: '' },
    }))
  }

  const updateDraftAction = (key: string, field: string, value: any) => {
    setDraftActions(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  const removeDraftAction = (key: string) => {
    setDraftActions(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  const renameDraftActionKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey || draftActions[newKey]) return
    setDraftActions(prev => {
      const next: Record<string, any> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (k === oldKey) next[newKey] = v; else next[k] = v
      }
      return next
    })
  }

  const saveActions = async () => {
    if (!drv) return
    setSavingActions(true); setActionMsg('')
    try {
      const res = await apiFetch(`/api/drivers/catalog/${drv.id}/actions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: draftActions }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setActionMsg(`Saved ${data.action_count} actions`)
        setEditingActions(false); fetchCatalog()
      } else { setActionMsg(`Error: ${data.detail || 'Save failed'}`) }
    } catch (e: any) { setActionMsg(`Error: ${e.message}`) }
    finally { setSavingActions(false) }
  }

  /* ── Py-driver action editing helpers ──────────────────────── */
  const loadPyAction = async (actionName: string) => {
    if (!drv) return
    setPyActionMsg('')
    try {
      const res = await apiFetch(`/api/drivers/catalog/${drv.id}/actions/${actionName}`)
      const data = await res.json()
      if (data.ok) {
        setPyActionSource(data.source)
        setEditingPyAction(actionName)
      } else { setPyActionMsg(`Error: ${data.detail || 'Load failed'}`) }
    } catch (e: any) { setPyActionMsg(`Error: ${e.message}`) }
  }

  const savePyAction = async () => {
    if (!drv || !editingPyAction) return
    setSavingPyAction(true); setPyActionMsg('')
    try {
      const res = await apiFetch(`/api/drivers/catalog/${drv.id}/actions/${editingPyAction}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: pyActionSource }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setPyActionMsg(`Saved method ${data.method_name}`)
        setEditingPyAction(null); fetchCatalog()
      } else { setPyActionMsg(`Error: ${data.detail || 'Save failed'}`) }
    } catch (e: any) { setPyActionMsg(`Error: ${e.message}`) }
    finally { setSavingPyAction(false) }
  }

  const createNewPyAction = async () => {
    if (!drv || !newPyActionName.trim()) return
    const name = newPyActionName.trim().replace(/\s+/g, '-').toLowerCase()
    await loadPyAction(name)
    setShowNewPyAction(false)
    setNewPyActionName('')
  }

  const deleteAction = async (actionName: string) => {
    if (!drv) return
    // Check usage first
    try {
      const usageRes = await apiFetch(`/api/drivers/catalog/${drv.id}/usage?action=${encodeURIComponent(actionName)}`)
      const usageData = await usageRes.json()
      if (usageData.count > 0) {
        const nodeList = usageData.usages.flatMap((u: any) => u.node_ids || [])
        const uniqueNodes = [...new Set(nodeList)] as string[]
        const msg = `Action "${actionName}" is used by ${usageData.count} capabilities file(s):\n\n` +
          usageData.usages.map((u: any) => `  • ${u.file} (nodes: ${(u.node_ids || []).join(', ') || 'unknown'})`).join('\n') +
          `\n\nDelete anyway? The action will also be removed from ${uniqueNodes.length} node(s) capabilities.`
        if (!confirm(msg)) return
      } else {
        if (!confirm(`Delete action "${actionName}" from driver "${drv.id}"?`)) return
      }
    } catch { /* if usage check fails, still allow with basic confirm */
      if (!confirm(`Delete action "${actionName}" from driver "${drv.id}"?`)) return
    }
    // Proceed with delete (?force=true to skip server-side usage block)
    try {
      const res = await apiFetch(`/api/drivers/catalog/${drv.id}/actions/${actionName}?force=true`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok && data.ok) {
        const cleaned = data.cleaned_capabilities?.length || 0
        const extra = cleaned > 0 ? ` — cleaned from ${cleaned} capabilities file(s)` : ''
        setPyActionMsg(`Removed action "${actionName}" (${data.kind})${extra}`)
        if (editingPyAction === actionName) setEditingPyAction(null)
        fetchCatalog()
      } else { setPyActionMsg(`Error: ${data.detail || 'Delete failed'}`) }
    } catch (e: any) { setPyActionMsg(`Error: ${e.message}`) }
  }

  const deleteDriver = async () => {
    if (!drv) return
    // Check usage first
    try {
      const usageRes = await apiFetch(`/api/drivers/catalog/${drv.id}/usage`)
      const usageData = await usageRes.json()
      if (usageData.count > 0) {
        const nodeList = usageData.usages.flatMap((u: any) => u.node_ids || [])
        const uniqueNodes = [...new Set(nodeList)] as string[]
        const msg = `⚠️ Driver "${drv.label || drv.id}" is used by ${usageData.count} capabilities file(s):\n\n` +
          usageData.usages.map((u: any) => `  • ${u.file} (${u.driver_refs} driver ref, ${u.action_refs} action refs) — nodes: ${(u.node_ids || []).join(', ') || 'unknown'}`).join('\n') +
          `\n\nAffected nodes: ${uniqueNodes.join(', ')}\n\n` +
          `Delete this driver anyway? Nodes will lose access to its actions.`
        if (!confirm(msg)) return
      } else {
        if (!confirm(`Delete driver "${drv.label || drv.id}"? This will remove the driver file permanently.`)) return
      }
    } catch {
      if (!confirm(`Delete driver "${drv.label || drv.id}"? This will remove the driver file permanently.`)) return
    }
    // Proceed with delete
    try {
      const res = await apiFetch(`/api/drivers/catalog/${drv.id}?force=true`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok && data.ok) {
        setSelectedDriver(null)
        fetchCatalog()
      } else { setError(data.detail || 'Delete failed') }
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div style={{ height: '100%', display: 'flex', fontFamily: 'var(--font-sans)' }}>
      {/* ── Left: Driver list ────────────────────────────────── */}
      <div style={{
        width: 260, minWidth: 260, borderRight: '1px solid var(--surface1)',
        background: 'var(--mantle)', overflowY: 'auto',
      }}>
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--surface0)',
          fontSize: 10, fontWeight: 700, color: 'var(--subtext0)',
          textTransform: 'uppercase', letterSpacing: '0.5px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Cpu size={12} color="var(--peach)" />
          Driver Catalog
          <div style={{ flex: 1 }} />
          <button onClick={fetchCatalog} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)' }}><RefreshCw size={10} /></button>
        </div>

        {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--overlay0)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /></div>}

        {/* Native Drivers */}
        {nativeDrivers.length > 0 && (
          <>
            <div style={{ padding: '8px 14px', fontSize: 9, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid var(--surface0)', background: 'var(--crust)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Cpu size={10} color="var(--blue)" /> Native Drivers
              <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--overlay0)', marginLeft: 'auto' }}>{nativeDrivers.length}</span>
            </div>
            {nativeDrivers.filter(c => c.kind === 'json-driver').length > 0 && (
              <>
                <div onClick={() => toggleLane('native-json')} style={{ padding: '4px 14px 4px 18px', fontSize: 8, fontWeight: 600, color: 'var(--overlay0)', textTransform: 'uppercase', borderBottom: '1px solid var(--surface0)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
                  {collapsedLanes.has('native-json') ? <ChevronRight size={8} /> : <ChevronDown size={8} />}
                  <FileJson size={8} /> JSON
                  <span style={{ fontSize: 7, color: 'var(--overlay0)', marginLeft: 'auto' }}>{nativeDrivers.filter(c => c.kind === 'json-driver').length}</span>
                </div>
                {!collapsedLanes.has('native-json') && nativeDrivers.filter(c => c.kind === 'json-driver').map(renderItem)}
              </>
            )}
            {nativeDrivers.filter(c => c.kind === 'py-driver').length > 0 && (
              <>
                <div onClick={() => toggleLane('native-py')} style={{ padding: '4px 14px 4px 18px', fontSize: 8, fontWeight: 600, color: 'var(--overlay0)', textTransform: 'uppercase', borderBottom: '1px solid var(--surface0)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
                  {collapsedLanes.has('native-py') ? <ChevronRight size={8} /> : <ChevronDown size={8} />}
                  <Code size={8} /> Python
                  <span style={{ fontSize: 7, color: 'var(--overlay0)', marginLeft: 'auto' }}>{nativeDrivers.filter(c => c.kind === 'py-driver').length}</span>
                </div>
                {!collapsedLanes.has('native-py') && nativeDrivers.filter(c => c.kind === 'py-driver').map(renderItem)}
              </>
            )}
          </>
        )}

        {/* Vendor Drivers */}
        {vendorDrivers.length > 0 && (
          <>
            <div style={{ padding: '8px 14px', fontSize: 9, fontWeight: 700, color: 'var(--peach)', textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid var(--surface0)', background: 'var(--crust)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <Store size={10} color="var(--peach)" /> Vendor Drivers
              <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--overlay0)', marginLeft: 'auto' }}>{vendorDrivers.length}</span>
            </div>
            {Object.entries(vendorGroups).map(([vname, drivers]) => (
              <React.Fragment key={vname}>
                <div onClick={() => toggleLane(`vendor-${vname}`)} style={{ padding: '4px 14px 4px 18px', fontSize: 8, fontWeight: 600, color: 'var(--peach)', textTransform: 'uppercase', borderBottom: '1px solid var(--surface0)', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: '0.3px', cursor: 'pointer', userSelect: 'none' }}>
                  {collapsedLanes.has(`vendor-${vname}`) ? <ChevronRight size={8} /> : <ChevronDown size={8} />}
                  <Package size={8} /> {vname}
                  <span style={{ fontSize: 7, fontWeight: 400, color: 'var(--overlay0)', marginLeft: 'auto' }}>{drivers.length} · ~/.triv</span>
                </div>
                {!collapsedLanes.has(`vendor-${vname}`) && drivers.map(renderItem)}
              </React.Fragment>
            ))}
          </>
        )}

        <div style={{ padding: 12 }}>
          <button onClick={() => { setShowScaffold(true); setSelectedDriver(null); setEditingActions(false); setEditingSchema(false) }}
            style={{ ...btn('#a6e3a1', true), width: '100%', justifyContent: 'center' }}>
            <Plus size={12} /> Create New Driver
          </button>
        </div>
      </div>

      {/* ── Right: Detail / Scaffold ─────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {showScaffold ? (
          <ScaffoldForm
            form={scaffoldForm} setForm={setScaffoldForm}
            creating={creating} error={error} result={result}
            onScaffold={handleScaffold}
            onBack={() => { setShowScaffold(false); setResult(null); setError('') }}
          />
        ) : drv ? (
          <div style={{ maxWidth: 700 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${drv.accent_color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {drv.kind === 'json-driver' ? <FileJson size={20} color={drv.accent_color} /> : <Package size={20} color={drv.accent_color} />}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{drv.label || drv.id}</h3>
                <div style={{ fontSize: 11, color: 'var(--subtext0)', display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                  <span>{drv.vendor} · v{drv.version}</span>
                  <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: drv.kind === 'json-driver' ? '#89b4fa20' : '#a6e3a120', color: drv.kind === 'json-driver' ? '#89b4fa' : '#a6e3a1' }}>{drv.kind}</span>
                  <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 8, background: 'var(--surface1)', color: 'var(--overlay1)' }}>{drv.type}</span>
                </div>
                {drv.description && (
                  <div style={{ fontSize: 11, color: 'var(--subtext0)', marginTop: 5, lineHeight: 1.5 }}>
                    {drv.description}
                  </div>
                )}
              </div>
              {isEditable && (
                <button onClick={deleteDriver}
                  style={{ ...btn('#f38ba8'), padding: '5px 10px', fontSize: 10 }}
                  title="Delete this vendor driver">
                  <Trash2 size={12} /> Delete Driver
                </button>
              )}
            </div>

            {/* Info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                ['ID', drv.id], ['Type', drv.type], ['Kind', drv.kind],
                ['Vendor', drv.vendor], ['Version', drv.version],
                ['Origin', drv.origin?.startsWith('vendor:') ? drv.origin.replace('vendor:', '\u{1F3ED} ') : '\u{1F527} native'],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface0)', border: '1px solid var(--surface1)' }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--subtext0)', textTransform: 'uppercase', marginBottom: 1 }}>{k}</div>
                  <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Source file (py-driver only) */}
            {drv.source && (
              <div style={{ padding: '6px 12px', borderRadius: 6, marginBottom: 16, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 10, color: 'var(--subtext0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileCode size={12} color="var(--green)" />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{drv.source}</span>
              </div>
            )}

            {/* ── Driver Args Schema ─────────────────────────── */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={sectionHdr} onClick={() => setShowSchema(s => !s)}>
                {showSchema ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Settings size={14} color="var(--blue)" />
                <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Driver Args Schema ({editingSchema ? Object.keys(draftSchema).length : Object.keys(drv.driver_args_schema).length})</span>
                {isEditable && !editingSchema && (
                  <button onClick={e => { e.stopPropagation(); startSchemaEditing() }} style={{ ...btn('#89b4fa'), padding: '3px 8px', fontSize: 9 }}><Edit3 size={10} /> Edit Schema</button>
                )}
                {editingSchema && (
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button onClick={addSchemaField} style={{ ...btn('#a6e3a1'), padding: '3px 8px', fontSize: 9 }}><Plus size={10} /> Field</button>
                    <button onClick={saveSchema} disabled={savingSchema} style={{ ...btn('#89b4fa', true), padding: '3px 8px', fontSize: 9 }}>
                      {savingSchema ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={10} />} Save
                    </button>
                    <button onClick={cancelSchemaEditing} style={{ ...btn('#6c7086'), padding: '3px 8px', fontSize: 9 }}><X size={10} /> Cancel</button>
                  </div>
                )}
              </div>
              {showSchema && (
                <div style={{ padding: 14 }}>
                  {schemaMsg && (
                    <div style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 10, fontSize: 11,
                      background: schemaMsg.startsWith('Saved') ? '#a6e3a120' : '#f38ba820',
                      color: schemaMsg.startsWith('Saved') ? '#a6e3a1' : '#f38ba8',
                      border: `1px solid ${schemaMsg.startsWith('Saved') ? '#a6e3a1' : '#f38ba8'}40`,
                    }}>{schemaMsg}</div>
                  )}

                  {editingSchema ? (
                    <>
                      {Object.keys(draftSchema).length === 0 && (
                        <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 12 }}>
                          No fields. Click <b>+ Field</b> to add one.
                        </div>
                      )}
                      {Object.entries(draftSchema).map(([key, field]) => (
                        <SchemaFieldEditor key={key} fieldKey={key} field={field}
                          onUpdate={(p, v) => updateSchemaField(key, p, v)}
                          onRemove={() => removeSchemaField(key)}
                          onRenameKey={nk => renameSchemaKey(key, nk)} />
                      ))}
                    </>
                  ) : (
                    <>
                      {Object.keys(drv.driver_args_schema).length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 12 }}>
                          No schema defined.
                          {isEditable && <><br /><span style={{ fontSize: 10 }}>Click <b>Edit Schema</b> to define fields.</span></>}
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                          <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--surface1)' }}>
                              <th style={{ padding: '4px 8px', color: 'var(--subtext0)', fontWeight: 700 }}>Field</th>
                              <th style={{ padding: '4px 8px', color: 'var(--subtext0)', fontWeight: 700 }}>Type</th>
                              <th style={{ padding: '4px 8px', color: 'var(--subtext0)', fontWeight: 700 }}>Req</th>
                              <th style={{ padding: '4px 8px', color: 'var(--subtext0)', fontWeight: 700 }}>Default</th>
                              <th style={{ padding: '4px 8px', color: 'var(--subtext0)', fontWeight: 700 }}>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(drv.driver_args_schema).map(([key, field]) => (
                              <tr key={key} style={{ borderBottom: '1px solid var(--surface0)' }}>
                                <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600 }}>{field.label || key}</td>
                                <td style={{ padding: '4px 8px', color: 'var(--mauve)', fontFamily: 'var(--font-mono)' }}>{field.type}</td>
                                <td style={{ padding: '4px 8px', color: field.required ? '#f38ba8' : 'var(--overlay0)' }}>{field.required ? '\u2713' : ''}</td>
                                <td style={{ padding: '4px 8px', color: 'var(--overlay1)', fontFamily: 'var(--font-mono)' }}>{field.default !== undefined ? String(field.default) : '\u2014'}</td>
                                <td style={{ padding: '4px 8px', color: 'var(--subtext0)' }}>{field.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Actions ────────────────────────────────────── */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={sectionHdr} onClick={() => setShowActions(s => !s)}>
                {showActions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Zap size={14} color="var(--yellow)" />
                <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>
                  Actions ({editingActions ? Object.keys(draftActions).length : Object.keys(drv.actions).length})
                </span>
                {/* JSON-driver edit button */}
                {isVendorJson && !editingActions && (
                  <button onClick={e => { e.stopPropagation(); startEditing() }} style={{ ...btn('#f9e2af'), padding: '3px 8px', fontSize: 9 }}><Edit3 size={10} /> Edit Actions</button>
                )}
                {editingActions && (
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button onClick={addNewAction} style={{ ...btn('#a6e3a1'), padding: '3px 8px', fontSize: 9 }}><Plus size={10} /> Add</button>
                    <button onClick={saveActions} disabled={savingActions} style={{ ...btn('#89b4fa', true), padding: '3px 8px', fontSize: 9 }}>
                      {savingActions ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={10} />} Save
                    </button>
                    <button onClick={cancelEditing} style={{ ...btn('#6c7086'), padding: '3px 8px', fontSize: 9 }}><X size={10} /> Cancel</button>
                  </div>
                )}
                {/* Py-driver: new action button */}
                {isVendorPy && !editingPyAction && (
                  <button onClick={e => { e.stopPropagation(); setShowNewPyAction(true) }} style={{ ...btn('#a6e3a1'), padding: '3px 8px', fontSize: 9 }}><Plus size={10} /> New Action</button>
                )}
              </div>
              {showActions && (
                <div style={{ padding: 14 }}>
                  {actionMsg && (
                    <div style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 10, fontSize: 11,
                      background: actionMsg.startsWith('Saved') ? '#a6e3a120' : '#f38ba820',
                      color: actionMsg.startsWith('Saved') ? '#a6e3a1' : '#f38ba8',
                      border: `1px solid ${actionMsg.startsWith('Saved') ? '#a6e3a1' : '#f38ba8'}40`,
                    }}>{actionMsg}</div>
                  )}
                  {pyActionMsg && (
                    <div style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 10, fontSize: 11,
                      background: pyActionMsg.startsWith('Saved') || pyActionMsg.startsWith('Removed') ? '#a6e3a120' : '#f38ba820',
                      color: pyActionMsg.startsWith('Saved') || pyActionMsg.startsWith('Removed') ? '#a6e3a1' : '#f38ba8',
                      border: `1px solid ${pyActionMsg.startsWith('Saved') || pyActionMsg.startsWith('Removed') ? '#a6e3a1' : '#f38ba8'}40`,
                    }}>{pyActionMsg}</div>
                  )}

                  {/* New py-action input */}
                  {showNewPyAction && isVendorPy && (
                    <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--surface0)', border: '1px solid #a6e3a140', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--subtext0)', whiteSpace: 'nowrap' }}>Action name:</label>
                      <input style={{ ...inputSt, flex: 1, fontSize: 11 }} value={newPyActionName}
                        onChange={e => setNewPyActionName(e.target.value)}
                        placeholder="e.g. configure-network" autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') createNewPyAction() }} />
                      <button onClick={createNewPyAction} disabled={!newPyActionName.trim()}
                        style={{ ...btn('#a6e3a1', true), padding: '4px 10px', fontSize: 10, opacity: newPyActionName.trim() ? 1 : 0.5 }}>
                        <Plus size={10} /> Create
                      </button>
                      <button onClick={() => { setShowNewPyAction(false); setNewPyActionName('') }}
                        style={{ ...btn('#6c7086'), padding: '4px 8px', fontSize: 10 }}><X size={10} /></button>
                    </div>
                  )}

                  {/* Py-action code editor */}
                  {editingPyAction && isVendorPy && (
                    <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--surface0)', border: '1px solid #a6e3a140' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <Code size={14} color="#a6e3a1" />
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
                          action_{editingPyAction.replace(/-/g, '_')}
                        </span>
                        <button onClick={savePyAction} disabled={savingPyAction}
                          style={{ ...btn('#89b4fa', true), padding: '4px 10px', fontSize: 10 }}>
                          {savingPyAction ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={10} />} Save
                        </button>
                        <button onClick={() => setEditingPyAction(null)}
                          style={{ ...btn('#6c7086'), padding: '4px 8px', fontSize: 10 }}><X size={10} /> Close</button>
                      </div>
                      <div style={{ padding: '6px 10px', borderRadius: 4, marginBottom: 8, background: 'var(--crust)', fontSize: 9, color: 'var(--subtext0)', lineHeight: 1.6 }}>
                        All actions receive <code style={{ color: 'var(--blue)' }}>self</code> and{' '}
                        <code style={{ color: 'var(--blue)' }}>driver_args: dict</code> — the resolved driver_args from the capabilities file.
                        Return a dict with <code style={{ color: 'var(--green)' }}>{`{"ok": True, ...}`}</code>.
                      </div>
                      <textarea
                        style={codeSt}
                        value={pyActionSource}
                        onChange={e => setPyActionSource(e.target.value)}
                        spellCheck={false}
                        onKeyDown={e => {
                          if (e.key === 'Tab') {
                            e.preventDefault()
                            const ta = e.target as HTMLTextAreaElement
                            const start = ta.selectionStart
                            const end = ta.selectionEnd
                            const val = ta.value
                            setPyActionSource(val.substring(0, start) + '    ' + val.substring(end))
                            setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 4 }, 0)
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* JSON-driver: editing mode */}
                  {editingActions && isVendorJson ? (
                    <>
                      {Object.keys(draftActions).length === 0 && (
                        <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 12 }}>
                          No actions. Click <b>+ Add</b> to create one.
                        </div>
                      )}
                      {Object.entries(draftActions).map(([key, act]: [string, any]) => (
                        <ActionEditor key={key} actionKey={key} act={act}
                          onUpdate={(f, v) => updateDraftAction(key, f, v)}
                          onRemove={() => removeDraftAction(key)}
                          onRenameKey={nk => renameDraftActionKey(key, nk)} />
                      ))}
                    </>
                  ) : (
                    /* Read-only action list (both json-driver and py-driver) */
                    <>
                      {Object.keys(drv.actions).length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--overlay0)', textAlign: 'center', padding: 12 }}>
                          No actions defined.
                          {isVendorJson && <><br /><span style={{ fontSize: 10 }}>Click <b>Edit Actions</b> to add actions.</span></>}
                          {isVendorPy && <><br /><span style={{ fontSize: 10 }}>Click <b>+ New Action</b> to create a Python action method.</span></>}
                        </div>
                      ) : (
                        Object.entries(drv.actions).map(([refId, act]: [string, any]) => {
                          const isExpanded = expandedActions.has(refId)
                          const isPyAction = act.type === 'py-command' || act.type === 'py-action'
                          const toggleExpand = () => setExpandedActions(prev => {
                            const next = new Set(prev)
                            if (next.has(refId)) next.delete(refId); else next.add(refId)
                            return next
                          })
                          return (
                            <div key={refId} style={{ marginBottom: 4, borderRadius: 6, background: 'var(--surface0)', overflow: 'hidden' }}>
                              <div onClick={toggleExpand} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer' }}>
                                {isExpanded ? <ChevronDown size={10} color="var(--overlay1)" /> : <ChevronRight size={10} color="var(--overlay1)" />}
                                {isPyAction ? <Code size={10} color="#a6e3a1" /> : <Terminal size={10} color={drv.accent_color} />}
                                <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--text)', flex: 1 }}>{act.label || refId}</span>
                                <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: isPyAction ? '#a6e3a120' : 'var(--surface1)', color: isPyAction ? '#a6e3a1' : 'var(--overlay1)', fontFamily: 'var(--font-mono)' }}>{act.type}</span>
                                <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#89b4fa20', color: '#89b4fa', fontFamily: 'var(--font-mono)' }}>{refId}</span>
                                {isVendorPy && (
                                  <button onClick={e => { e.stopPropagation(); loadPyAction(refId) }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a6e3a1', padding: '0 2px' }}
                                    title="Edit action code"><Edit3 size={11} /></button>
                                )}
                                {isEditable && (
                                  <button onClick={e => { e.stopPropagation(); deleteAction(refId) }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f38ba8', padding: '0 2px' }}
                                    title="Delete action"><Trash2 size={11} /></button>
                                )}
                              </div>
                              {isExpanded && (
                                <div style={{ padding: '6px 12px 10px 30px', borderTop: '1px solid var(--surface1)', fontSize: 10, lineHeight: 1.8 }}>
                                  {act.id && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>id:</span> <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--mauve)' }}>{act.id}</span></div>}
                                  {act.description && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>description:</span> <span style={{ color: 'var(--text)' }}>{act.description}</span></div>}
                                  {act.icon && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>icon:</span> <span style={{ color: 'var(--text)' }}>{act.icon}</span></div>}
                                  {act.command && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>command:</span> <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'var(--crust)' }}>{act.command}</code></div>}
                                  {act.confirm && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>confirm:</span> <span style={{ color: 'var(--yellow)', fontSize: 9 }}>{act.confirm}</span></div>}
                                  {act.host && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>host:</span> <span style={{ color: 'var(--text)' }}>{act.host}</span></div>}
                                  {act.url && <div><span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>url:</span> <span style={{ color: 'var(--blue)' }}>{act.url}</span></div>}
                                  {isPyAction && (
                                    <div style={{ marginTop: 4 }}>
                                      <span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>method:</span>{' '}
                                      <code style={{ fontFamily: 'var(--font-mono)', color: '#a6e3a1', fontSize: 9 }}>action_{refId.replace(/-/g, '_')}(self, driver_args)</code>
                                    </div>
                                  )}
                                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>ai_tool_enabled:</span>
                                    <span style={{
                                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                                      background: act.ai_tool_enabled ? '#a6e3a120' : 'var(--surface1)',
                                      color: act.ai_tool_enabled ? '#a6e3a1' : 'var(--overlay0)',
                                    }}>{act.ai_tool_enabled ? 'true' : 'false'}</span>
                                  </div>
                                  {act.ai_tool_enabled && act.tool_args && (
                                    <div style={{ marginTop: 4 }}>
                                      <span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>tool_args:</span>
                                      <pre style={{ margin: '2px 0 0 0', padding: '4px 8px', borderRadius: 4, background: 'var(--crust)', color: 'var(--blue)', fontSize: 9, fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
                                        {JSON.stringify(act.tool_args, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Usage hint */}
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 10, color: 'var(--subtext0)' }}>
              <b>Usage:</b> In Node Capabilities, add <code style={{ color: 'var(--mauve)' }}>"{drv.id}"</code> as a driver, fill its driver_args, and pick actions from it.
            </div>
          </div>
        ) : (
          /* Empty state */
          <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--overlay0)' }}>
            <Cpu size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Driver Catalog</div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>Select a driver to view its schema and actions.</div>
            <button onClick={() => setShowScaffold(true)} style={btn('#a6e3a1', true)}><Plus size={12} /> Create New Driver</button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

/* ── Schema field editor (sub-component) ──────────────────────────── */
function SchemaFieldEditor({ fieldKey, field, onUpdate, onRemove, onRenameKey }: {
  fieldKey: string; field: SchemaField
  onUpdate: (prop: string, value: any) => void
  onRemove: () => void
  onRenameKey: (newKey: string) => void
}) {
  const [keyDraft, setKeyDraft] = useState(fieldKey)
  return (
    <div style={{ marginBottom: 10, padding: 12, borderRadius: 8, background: 'var(--surface0)', border: '1px solid #89b4fa40' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Settings size={12} color="#89b4fa" />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1, fontFamily: 'var(--font-mono)' }}>{fieldKey}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f38ba8', padding: '0 2px' }}><Trash2 size={12} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Key</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onBlur={() => { if (keyDraft.trim() && keyDraft !== fieldKey) onRenameKey(keyDraft.trim()) }} />
          </div>
          <div style={{ width: 100 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Type</label>
            <select style={{ ...selectSt, fontSize: 10 }} value={field.type} onChange={e => onUpdate('type', e.target.value)}>
              {SCHEMA_FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Label</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={field.label || ''} onChange={e => onUpdate('label', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 2 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Description</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={field.description || ''} onChange={e => onUpdate('description', e.target.value)} />
          </div>
          <div style={{ width: 100 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Default</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={field.default !== undefined ? String(field.default) : ''}
              onChange={e => onUpdate('default', e.target.value)} />
          </div>
          <div style={{ width: 50, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Req</label>
            <input type="checkbox" checked={!!field.required} onChange={e => onUpdate('required', e.target.checked)}
              style={{ marginTop: 4, cursor: 'pointer' }} />
          </div>
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 8 }}>Placeholder</label>
          <input style={{ ...inputSt, fontSize: 10 }} value={field.placeholder || ''} onChange={e => onUpdate('placeholder', e.target.value)} />
        </div>
      </div>
    </div>
  )
}

/* ── Action editor row for json-driver (sub-component) ────────────── */
function ActionEditor({ actionKey, act, onUpdate, onRemove, onRenameKey }: {
  actionKey: string; act: any
  onUpdate: (field: string, value: any) => void
  onRemove: () => void
  onRenameKey: (newKey: string) => void
}) {
  const [keyDraft, setKeyDraft] = useState(actionKey)
  return (
    <div style={{ marginBottom: 10, padding: 12, borderRadius: 8, background: 'var(--surface0)', border: '1px solid #f9e2af40' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Zap size={12} color="#f9e2af" />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{act.label || actionKey}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f38ba8', padding: '0 2px' }}><Trash2 size={12} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Action Key</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onBlur={() => { if (keyDraft.trim() && keyDraft !== actionKey) onRenameKey(keyDraft.trim()) }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>ID</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={act.id || ''} onChange={e => onUpdate('id', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Label</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={act.label || ''} onChange={e => onUpdate('label', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 140 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Type</label>
            <TypeSelect value={act.type || 'exec'} onChange={v => onUpdate('type', v)} />
          </div>
          <div style={{ width: 140 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Icon</label>
            <select style={{ ...selectSt, fontSize: 10 }} value={act.icon || 'terminal'} onChange={e => onUpdate('icon', e.target.value)}>
              {AVAILABLE_ICONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelSt, fontSize: 8 }}>Confirm Prompt</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={act.confirm || ''} onChange={e => onUpdate('confirm', e.target.value)} placeholder="(optional)" />
          </div>
        </div>
        {['exec', 'exec-output', 'console', 'exec-with-data', 'tool'].includes(act.type) && (
          <div>
            <label style={{ ...labelSt, fontSize: 8 }}>Command</label>
            <input style={{ ...inputSt, fontSize: 10 }} value={act.command || ''} onChange={e => onUpdate('command', e.target.value)} placeholder={'e.g. docker exec -it ${vm_name} bash'} />
          </div>
        )}
        <div style={{ marginTop: 2 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={!!act.ai_tool_enabled} onChange={e => onUpdate('ai_tool_enabled', e.target.checked)} style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>AI Tool</span>
            <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>— expose to Agent nodes as a callable tool</span>
          </label>
        </div>
        {act.ai_tool_enabled && (
          <div>
            <label style={{ ...labelSt, fontSize: 8 }}>
              Tool Description
              <span style={{ fontWeight: 400, color: 'var(--subtext0)', marginLeft: 4 }}>— the agent reads this to decide when to call this action</span>
            </label>
            <input
              style={{ ...inputSt, fontSize: 10 }}
              value={act.description || ''}
              onChange={e => onUpdate('description', e.target.value)}
              placeholder="Returns the current CPU and memory usage of this node"
            />
          </div>
        )}
        {act.ai_tool_enabled && (
          <div>
            <label style={{ ...labelSt, fontSize: 8 }}>
              Tool Args
              <span style={{ fontWeight: 400, color: 'var(--subtext0)', marginLeft: 4 }}>— typed parameters the LLM can pass (leave empty for none)</span>
            </label>
            <textarea
              style={{ ...inputSt, fontSize: 10, fontFamily: 'var(--font-mono)', minHeight: 80, resize: 'vertical' }}
              value={typeof act.tool_args === 'object' ? JSON.stringify(act.tool_args, null, 2) : (act.tool_args || '')}
              onChange={e => {
                try { onUpdate('tool_args', JSON.parse(e.target.value)) }
                catch { onUpdate('tool_args', e.target.value) }
              }}
              placeholder={'{\n  "interface": { "type": "string", "description": "Interface name", "required": true },\n  "state":     { "type": "string", "enum": ["up", "down"] }\n}'}
            />
          </div>
        )}
        {act.type === 'ssh' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 2 }}><label style={{ ...labelSt, fontSize: 8 }}>Host</label><input style={{ ...inputSt, fontSize: 10 }} value={act.host || ''} onChange={e => onUpdate('host', e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={{ ...labelSt, fontSize: 8 }}>User</label><input style={{ ...inputSt, fontSize: 10 }} value={act.user || 'root'} onChange={e => onUpdate('user', e.target.value)} /></div>
            <div style={{ width: 60 }}><label style={{ ...labelSt, fontSize: 8 }}>Port</label><input style={{ ...inputSt, fontSize: 10 }} type="number" value={act.port || 22} onChange={e => onUpdate('port', parseInt(e.target.value) || 22)} /></div>
          </div>
        )}
        {['link', 'webui'].includes(act.type) && (
          <div><label style={{ ...labelSt, fontSize: 8 }}>URL</label><input style={{ ...inputSt, fontSize: 10 }} value={act.url || ''} onChange={e => onUpdate('url', e.target.value)} placeholder={'e.g. http://${iface.mgmt.ip}:8080'} /></div>
        )}
      </div>
    </div>
  )
}

/* ── Scaffold form (sub-component) ────────────────────────────────── */
function ScaffoldForm({ form, setForm, creating, error, result, onScaffold, onBack }: {
  form: any; setForm: (fn: (f: any) => any) => void
  creating: boolean; error: string; result: any
  onScaffold: () => void; onBack: () => void
}) {
  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <FileCode size={18} color="var(--green)" />
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Create Driver Blueprint</h3>
      </div>

      <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 11, color: 'var(--subtext0)', lineHeight: 1.6 }}>
        <Info size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        Creates a driver file in <code>~/.triv/vendors/&lt;vendor&gt;/drivers/</code>.
        Choose <b>JSON Driver</b> for simple action sets or <b>Python Driver</b> for
        full VM/container lifecycle control.
      </div>

      <div style={{ ...card, padding: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Kind selector */}
          <div>
            <label style={labelSt}>Driver Kind *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['json-driver', 'py-driver'] as const).map(k => (
                <button key={k} onClick={() => setForm((f: any) => ({ ...f, kind: k }))}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: form.kind === k ? `2px solid ${k === 'json-driver' ? '#89b4fa' : '#a6e3a1'}` : '2px solid var(--surface1)',
                    background: form.kind === k ? `${k === 'json-driver' ? '#89b4fa' : '#a6e3a1'}15` : 'var(--surface0)',
                    color: 'var(--text)', textAlign: 'left' as const,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {k === 'json-driver' ? <FileJson size={14} color="#89b4fa" /> : <Code size={14} color="#a6e3a1" />}
                    <span style={{ fontSize: 12, fontWeight: 700, color: k === 'json-driver' ? '#89b4fa' : '#a6e3a1' }}>
                      {k === 'json-driver' ? 'JSON Driver' : 'Python Driver'}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--subtext0)', lineHeight: 1.5 }}>
                    {k === 'json-driver'
                      ? 'Action definitions in JSON. Good for simple action sets.'
                      : 'Python class inheriting DriverBase. Full lifecycle control.'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelSt}>Driver Name *</label>
            <input style={inputSt} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. my-custom-device" />
            <div style={{ fontSize: 9, color: 'var(--overlay0)', marginTop: 2 }}>Alphanumeric + hyphens/underscores.</div>
          </div>
          <div><label style={labelSt}>Vendor</label><input style={inputSt} value={form.vendor} onChange={e => setForm((f: any) => ({ ...f, vendor: e.target.value }))} placeholder="e.g. ACME Corp" /></div>
          <div><label style={labelSt}>Display Label</label><input style={inputSt} value={form.label} onChange={e => setForm((f: any) => ({ ...f, label: e.target.value }))} placeholder="e.g. My Custom Device" /></div>

          {form.kind === 'json-driver' && (
            <div>
              <label style={labelSt}>Driver Type</label>
              <select style={selectSt} value={form.driver_type} onChange={e => setForm((f: any) => ({ ...f, driver_type: e.target.value }))}>
                <option value="unknown">unknown</option>
                <option value="libvirt">libvirt</option>
                <option value="container">container</option>
                <option value="app">app</option>
                <option value="remote">remote</option>
                <option value="ai-llm">ai-llm</option>
                <option value="ai-agent">ai-agent</option>
                <option value="ai-tool">ai-tool</option>
              </select>
            </div>
          )}

          <div>
            <label style={labelSt}>Accent Color</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={form.accent_color} onChange={e => setForm((f: any) => ({ ...f, accent_color: e.target.value }))} style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid var(--surface1)', cursor: 'pointer' }} />
              <input style={{ ...inputSt, width: 120 }} value={form.accent_color} onChange={e => setForm((f: any) => ({ ...f, accent_color: e.target.value }))} />
            </div>
          </div>

          {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#f38ba820', border: '1px solid #f38ba840', color: '#f38ba8', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {error}</div>}
          {result?.ok && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#a6e3a120', border: '1px solid #a6e3a140', fontSize: 11, lineHeight: 1.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><CheckCircle size={14} color="#a6e3a1" /><span style={{ fontWeight: 700, color: '#a6e3a1' }}>Driver created!</span></div>
              <div style={{ color: 'var(--subtext0)' }}>
                Kind: <code style={{ color: 'var(--blue)' }}>{result.kind}</code><br />
                File: <code style={{ color: 'var(--mauve)' }}>{result.path}</code><br />
                {result.class_name && <>Class: <code style={{ color: 'var(--mauve)' }}>{result.class_name}</code><br /></>}
                <span style={{ fontSize: 10 }}>{result.detail}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onScaffold} disabled={creating || !form.name} style={{ ...btn('#a6e3a1', true), opacity: creating || !form.name ? 0.5 : 1 }}>
              {creating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={12} />}
              {creating ? 'Creating...' : 'Create Driver'}
            </button>
            <button onClick={onBack} style={btn('#6c7086')}>Back to Drivers</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Driver list item (sub-component) ─────────────────────────────── */
function DriverListItem({ cat, isSelected, onClick }: { cat: CatalogDriver; isSelected: boolean; onClick: () => void }) {
  const actCount = Object.keys(cat.actions).length
  return (
    <div onClick={onClick} style={{
      padding: '10px 14px', cursor: 'pointer',
      borderBottom: '1px solid var(--surface0)',
      background: isSelected ? 'var(--surface0)' : 'transparent',
      borderLeft: isSelected ? `3px solid ${cat.accent_color}` : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 24, borderRadius: 3, background: cat.accent_color }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{cat.label || cat.id}</div>
          <div style={{ fontSize: 9, color: 'var(--subtext0)', display: 'flex', gap: 4, alignItems: 'center', marginTop: 1 }}>
            {cat.vendor} · v{cat.version}
            <span style={{ padding: '0 3px', borderRadius: 2, fontSize: 7, background: `${cat.accent_color}20`, color: cat.accent_color }}>{cat.type}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--surface1)', color: 'var(--overlay1)', fontFamily: 'var(--font-mono)' }}>{actCount} act</span>
          <span style={{ fontSize: 7, color: 'var(--overlay0)' }}>{Object.keys(cat.driver_args_schema).length} args</span>
        </div>
      </div>
    </div>
  )
}
