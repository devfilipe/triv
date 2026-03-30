import { apiFetch } from './apiFetch'
/* triv WebUI — NetworkManager: v2 first-class network management panel
 *
 * Driver-style two-panel layout:
 *   Left panel (260px) — Built-In Templates, Instances
 *   Right panel         — Detail view for selected template or instance
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Network, Plus, Trash2, Play, Square, Monitor, MonitorOff,
  Globe, GlobeOff as Globe2, ChevronDown, ChevronRight, Info,
  Edit3, HelpCircle, Save, Box, Cloud,
  RefreshCw, Loader2, Package,
} from 'lucide-react'
import type { NetworkDefData, NetworkTemplate } from './hooks'

// ── Constants ────────────────────────────────────────────────────────

const NET_TYPE_COLORS: Record<string, string> = {
  bridge:       '#89b4fa',
  'vlan-bridge': '#a6e3a1',
  p2p:          '#f9e2af',
  trunk:        '#cba6f7',
  docker:       '#f38ba8',
}

const NET_TYPE_LABELS: Record<string, string> = {
  bridge:       'Bridge',
  'vlan-bridge': 'VLAN Bridge',
  p2p:          'Point-to-Point',
  trunk:        'Trunk',
  docker:       'Docker',
}

// ── Help tooltips ────────────────────────────────────────────────────

const HELP: Record<string, string> = {
  bridge: 'Linux bridge name. Auto-generated if left blank. Must be ≤ 15 chars (kernel limit).',
  type: 'Network type.\n\n• bridge — simple L2 bridge\n• vlan-bridge — 802.1Q VLAN on a parent bridge\n• p2p — point-to-point link between two nodes\n• trunk — multi-VLAN trunk (advanced)\n• docker — Docker-managed network with bridge attachment',
  vlan: 'VLAN ID (1–4094). Required for vlan-bridge and trunk types.',
  subnet: 'IPv4 CIDR subnet for the bridge, e.g. 10.0.1.0/24.\nUsed by DHCP and host-access features.',
  stp: 'Spanning Tree Protocol. Enable to prevent L2 loops when multiple bridges are interconnected.',
  vlan_filtering: 'VLAN-aware bridge filtering. Allows per-port VLAN assignment inside a single bridge.',
  host_access: 'Assign an IP to the host\'s bridge interface so the host can reach VMs on this network.\nUseful for SSH access, management, or running services.',
  internet: 'Enable IP masquerading (NAT) so VMs on this network can reach the internet through the host.\nRequires host-access to be configured.',
  docker: 'Create a Docker network attached to this bridge. Containers connected to this Docker network will share L2 with the VMs.',

}

// ── Styles (matching NodeDrivers) ────────────────────────────────────

const btn = (color: string, filled = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', border: 'none', transition: 'all 0.15s',
  background: filled ? `${color}` : `${color}18`,
  color: filled ? '#1e1e2e' : color,
})

const card: React.CSSProperties = {
  borderRadius: 10, border: '1px solid var(--surface1)',
  background: 'var(--mantle)', overflow: 'hidden',
}

const sectionHdr: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
  borderBottom: '1px solid var(--surface0)',
  fontSize: 12, color: 'var(--text)',
}

const inputSt: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--surface2)', background: 'var(--surface0)',
  color: 'var(--text)', fontSize: 12, outline: 'none',
  fontFamily: 'inherit',
}

const selectSt: React.CSSProperties = {
  ...inputSt, cursor: 'pointer',
}

const labelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--subtext0)',
  textTransform: 'uppercase' as const, letterSpacing: '0.3px',
  marginBottom: 3, display: 'block',
}

// ── Help Icon ────────────────────────────────────────────────────────

function HelpIcon({ topic }: { topic: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!show) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [show])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <HelpCircle
        size={12}
        color="var(--overlay1)"
        style={{ cursor: 'pointer', marginLeft: 3 }}
        onClick={e => { e.stopPropagation(); setShow(s => !s) }}
      />
      {show && HELP[topic] && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, padding: '8px 12px', borderRadius: 8,
          background: 'var(--crust)', border: '1px solid var(--surface1)',
          color: 'var(--subtext1)', fontSize: 11, lineHeight: 1.5,
          whiteSpace: 'pre-wrap', width: 260, zIndex: 100,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          {HELP[topic]}
        </div>
      )}
    </span>
  )
}

// ── Form types & utils ───────────────────────────────────────────────

interface FormData {
  name: string
  type: 'bridge' | 'vlan-bridge' | 'p2p' | 'trunk' | 'docker'
  bridge: string
  description: string
  vlan: string
  parent_network: string
  subnet: string
  gateway: string
  stp: boolean
  vlan_filtering: boolean
  host_ip: string
  host_prefix: string
  internet_enabled: boolean
  docker_enabled: boolean
  docker_subnet: string
  docker_gateway: string
}

const EMPTY_FORM: FormData = {
  name: '', type: 'bridge', bridge: '', description: '',
  vlan: '', parent_network: '', subnet: '', gateway: '',
  stp: true, vlan_filtering: false,
  host_ip: '', host_prefix: '',
  internet_enabled: false,
  docker_enabled: false, docker_subnet: '', docker_gateway: '',
}

function formFromNet(net: NetworkDefData): FormData {
  return {
    name: net.label || net.id,
    type: net.type,
    bridge: net.bridge || '',
    description: net.description || '',
    vlan: net.vlan != null ? String(net.vlan) : '',
    parent_network: net.parent_network || '',
    subnet: net.subnet || '',
    gateway: net.gateway || '',
    stp: net.stp ?? true,
    vlan_filtering: net.vlan_filtering ?? false,
    host_ip: net.host?.ip || '',
    host_prefix: net.host?.prefix != null ? String(net.host.prefix) : '',
    internet_enabled: net.internet?.enabled ?? false,
    docker_enabled: net.docker?.enabled ?? false,
    docker_subnet: net.docker?.subnet || '',
    docker_gateway: net.docker?.gateway || '',
  }
}

function formToPayload(f: FormData) {
  const slug = f.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const id = slug || `${f.type}-${Math.random().toString(36).slice(2, 6)}`
  const p: any = {
    id,
    label: f.name,
    type: f.type,
    description: f.description,
    stp: f.stp,
    vlan_filtering: f.vlan_filtering,
  }
  if (f.bridge) p.bridge = f.bridge
  if (f.vlan) p.vlan = parseInt(f.vlan, 10)
  if (f.parent_network) p.parent_network = f.parent_network
  if (f.subnet) p.subnet = f.subnet
  if (f.gateway) p.gateway = f.gateway
  if (f.host_ip || f.host_prefix) {
    p.host = {}
    if (f.host_ip) p.host.ip = f.host_ip
    if (f.host_prefix) p.host.prefix = parseInt(f.host_prefix, 10)
  }
  if (f.internet_enabled) {
    p.internet = { enabled: true }
  }
  if (f.docker_enabled) {
    p.docker = { enabled: true }
    if (f.docker_subnet) p.docker.subnet = f.docker_subnet
    if (f.docker_gateway) p.docker.gateway = f.docker_gateway
  }
  return p
}

// ── Network Form Modal ───────────────────────────────────────────────

function NetworkFormModal({ initial, editing, allNets, onClose, onSaved }: {
  initial: FormData & { _network_id?: string }
  editing: boolean
  allNets: NetworkDefData[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setFormState] = useState<FormData>({ ...initial })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof FormData, v: any) => setFormState(f => ({ ...f, [k]: v }))

  const showVlan = ['vlan-bridge', 'trunk'].includes(form.type)
  const showDocker = form.type !== 'p2p'

  const parentOptions = allNets.filter(n => n.type === 'bridge')

  const handleSave = async () => {
    setSaving(true); setError('')
    const payload = formToPayload(form)
    try {
      const url = editing && initial._network_id
        ? `/api/v2/networks/${initial._network_id}`
        : '/api/v2/networks'
      const res = await apiFetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let msg = `Error ${res.status}`
        try { const d = await res.json(); msg = d.detail || msg } catch { /* non-JSON body */ }
        setError(msg); return
      }
      onSaved()
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const rowStyle: React.CSSProperties = { marginBottom: 10 }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--subtext0)',
    marginBottom: 3, display: 'block',
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 8,
    border: '1px solid var(--surface2)', background: 'var(--surface0)',
    color: 'var(--text)', fontSize: 12, outline: 'none',
  }
  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--base)', borderRadius: 14,
        border: '1px solid var(--surface1)',
        padding: 24, width: 480, maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={18} color="#89b4fa" />
          {editing ? 'Edit Network' : 'Create Network'}
        </h3>

        <div style={rowStyle}>
          <div style={labelStyle}>Name / Label <HelpIcon topic="bridge" /></div>
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="my-network" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, ...rowStyle }}>
          <div>
            <div style={labelStyle}>Type <HelpIcon topic="type" /></div>
            <select style={selectStyle} value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="bridge">Bridge</option>
              <option value="vlan-bridge">VLAN Bridge</option>
              <option value="p2p">Point-to-Point</option>
              <option value="trunk">Trunk</option>
              <option value="docker">Docker</option>
            </select>
          </div>
          <div>
            <div style={labelStyle}>Bridge Name</div>
            <input style={inputStyle} value={form.bridge}
              onChange={e => set('bridge', e.target.value)} placeholder="(auto)" />
          </div>
        </div>

        <div style={rowStyle}>
          <div style={labelStyle}>Description</div>
          <input style={inputStyle} value={form.description}
            onChange={e => set('description', e.target.value)} placeholder="Optional description" />
        </div>

        {showVlan && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, ...rowStyle }}>
            <div>
              <div style={labelStyle}>Parent Network</div>
              <select style={selectStyle} value={form.parent_network}
                onChange={e => set('parent_network', e.target.value)}>
                <option value="">(none)</option>
                {parentOptions.map(n => (
                  <option key={n.network_id} value={n.network_id}>{n.label || n.id}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>VLAN <HelpIcon topic="vlan" /></div>
              <input style={inputStyle} type="number" min={1} max={4094}
                value={form.vlan} onChange={e => set('vlan', e.target.value)} placeholder="100" />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, ...rowStyle }}>
          <div>
            <div style={labelStyle}>Subnet <HelpIcon topic="subnet" /></div>
            <input style={inputStyle} value={form.subnet}
              onChange={e => set('subnet', e.target.value)} placeholder="10.0.1.0/24" />
          </div>
          <div>
            <div style={labelStyle}>Gateway</div>
            <input style={inputStyle} value={form.gateway}
              onChange={e => set('gateway', e.target.value)} placeholder="10.0.1.1" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', ...rowStyle }}>
          <ToggleChip label="STP" help="stp" checked={form.stp} onChange={v => set('stp', v)} />
          <ToggleChip label="VLAN Filter" help="vlan_filtering" checked={form.vlan_filtering}
            onChange={v => set('vlan_filtering', v)} />
        </div>

        <div style={{
          borderRadius: 10, border: '1px solid var(--surface1)',
          padding: 12, marginBottom: 12, background: 'var(--mantle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Monitor size={14} color="var(--subtext0)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Host Access</span>
            <HelpIcon topic="host_access" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div>
              <div style={labelStyle}>Host IP</div>
              <input style={inputStyle} value={form.host_ip}
                onChange={e => set('host_ip', e.target.value)} placeholder="10.0.1.1" />
            </div>
            <div>
              <div style={labelStyle}>Prefix</div>
              <input style={inputStyle} type="number" value={form.host_prefix}
                onChange={e => set('host_prefix', e.target.value)} placeholder="24" />
            </div>
          </div>
        </div>

        <div style={{
          borderRadius: 10, border: '1px solid var(--surface1)',
          padding: 12, marginBottom: 12, background: 'var(--mantle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Globe size={14} color="var(--subtext0)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Internet / NAT</span>
            <HelpIcon topic="internet" />
            <div style={{ flex: 1 }} />
            <ToggleSwitch checked={form.internet_enabled} onChange={v => set('internet_enabled', v)} />
          </div>
        </div>

        {showDocker && (
          <div style={{
            borderRadius: 10, border: '1px solid var(--surface1)',
            padding: 12, marginBottom: 12, background: 'var(--mantle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: form.docker_enabled ? 8 : 0 }}>
              <Box size={14} color="var(--subtext0)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Docker Network</span>
              <HelpIcon topic="docker" />
              <div style={{ flex: 1 }} />
              <ToggleSwitch checked={form.docker_enabled} onChange={v => set('docker_enabled', v)} />
            </div>
            {form.docker_enabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={labelStyle}>Docker Subnet</div>
                  <input style={inputStyle} value={form.docker_subnet}
                    onChange={e => set('docker_subnet', e.target.value)} placeholder="172.20.0.0/24" />
                </div>
                <div>
                  <div style={labelStyle}>Docker Gateway</div>
                  <input style={inputStyle} value={form.docker_gateway}
                    onChange={e => set('docker_gateway', e.target.value)} placeholder="172.20.0.1" />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{
            background: '#f38ba822', color: '#f38ba8', padding: '8px 12px',
            borderRadius: 8, fontSize: 12, marginBottom: 10,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid var(--surface2)',
            background: 'transparent', color: 'var(--subtext0)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: '#89b4fa', color: '#1e1e2e', fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer', fontSize: 13,
            opacity: saving ? 0.6 : 1,
          }}>
            <Save size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            {editing ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toggle components ────────────────────────────────────────────────

function ToggleChip({ label, help, checked, onChange }: {
  label: string; help: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      cursor: 'pointer', fontSize: 12, color: 'var(--subtext1)',
      userSelect: 'none',
    }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: '#89b4fa' }} />
      {label}
      <HelpIcon topic={help} />
    </label>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
        background: checked ? '#89b4fa' : 'var(--surface2)',
        position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2,
        left: checked ? 18 : 2, transition: 'left 0.2s',
      }} />
    </div>
  )
}

// ── Selection types ──────────────────────────────────────────────────

type Selection =
  | { kind: 'template'; id: string }
  | { kind: 'instance'; id: string }

// ── Left panel list item ─────────────────────────────────────────────

function NetListItem({ label, sublabel, color, isSelected, badge, badgeColor, onClick }: {
  label: string; sublabel?: string; color: string; isSelected: boolean; badge?: string; badgeColor?: string; onClick: () => void
}) {
  const bc = badgeColor || color
  return (
    <div onClick={onClick} style={{
      padding: '10px 14px', cursor: 'pointer',
      borderBottom: '1px solid var(--surface0)',
      background: isSelected ? 'var(--surface0)' : 'transparent',
      borderLeft: isSelected ? `3px solid ${color}` : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 24, borderRadius: 3, background: color }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          {sublabel && (
            <div style={{ fontSize: 9, color: 'var(--subtext0)', marginTop: 1 }}>{sublabel}</div>
          )}
        </div>
        {badge && (
          <span style={{
            fontSize: 8, padding: '1px 5px', borderRadius: 3,
            background: `${bc}20`, color: bc,
            fontFamily: 'var(--font-mono)', fontWeight: 600,
          }}>{badge}</span>
        )}
      </div>
    </div>
  )
}

// ── Main Panel ───────────────────────────────────────────────────────

interface Props {
  networks: NetworkDefData[]
  templates: NetworkTemplate[]
  refresh: () => void
  refreshCatalog: () => void
}

export default function NetworkManager({ networks, templates, refresh, refreshCatalog }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [modal, setModal] = useState<{ initial: FormData; editing: boolean; netId?: string } | null>(null)
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set())
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const refreshAll = useCallback(() => {
    refresh()
    refreshCatalog()
  }, [refresh, refreshCatalog])

  const toggleLane = (lane: string) => {
    setCollapsedLanes(prev => {
      const next = new Set(prev)
      if (next.has(lane)) next.delete(lane); else next.add(lane)
      return next
    })
  }

  // Resolve selection to data
  const selectedTemplate = selection?.kind === 'template'
    ? templates.find(t => t.id === selection.id) : null
  const selectedInstance = selection?.kind === 'instance'
    ? networks.find(n => n.network_id === selection.id) : null

  // ── Instance actions ──
  const runAction = useCallback(async (netId: string, action: string) => {
    setBusyAction(`${netId}:${action}`)
    try {
      await apiFetch(`/api/v2/networks/${netId}/${action}`, { method: 'POST' })
      setTimeout(refreshAll, 400)
    } finally {
      setTimeout(() => setBusyAction(null), 600)
    }
  }, [refreshAll])

  const handleCreate = (tmpl?: NetworkTemplate) => {
    const initial: FormData = tmpl
      ? {
          ...EMPTY_FORM,
          type: tmpl.type as FormData['type'],
          description: tmpl.description,
          stp: tmpl.stp ?? EMPTY_FORM.stp,
          vlan_filtering: tmpl.vlan_filtering ?? EMPTY_FORM.vlan_filtering,
        }
      : EMPTY_FORM
    setModal({ initial, editing: false })
  }

  const handleEdit = (net: NetworkDefData) => {
    const f = formFromNet(net)
    setModal({ initial: f, editing: true, netId: net.network_id })
  }

  const handleDelete = async (net: NetworkDefData) => {
    if (!confirm(`Delete network "${net.label || net.id}"?\n\nThis will undeploy (if deployed) and remove the network definition.`)) return
    setDeleting(net.network_id)
    try {
      await apiFetch(`/api/v2/networks/${net.network_id}`, { method: 'DELETE' })
      setTimeout(() => {
        refreshAll()
        setSelection(null)
      }, 400)
    } finally {
      setTimeout(() => setDeleting(null), 600)
    }
  }

  const instanceCount = networks.length
  const deployedCount = networks.filter(n => n.status?.deployed).length

  return (
    <div style={{ height: '100%', display: 'flex', fontFamily: 'var(--font-sans)' }}>
      {/* ── Left: sidebar list ───────────────────────────────── */}
      <div style={{
        width: 260, minWidth: 260, borderRight: '1px solid var(--surface1)',
        background: 'var(--mantle)', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--surface0)',
          fontSize: 10, fontWeight: 700, color: 'var(--subtext0)',
          textTransform: 'uppercase', letterSpacing: '0.5px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Network size={12} color="#89b4fa" />
          Network Catalog
          <div style={{ flex: 1 }} />
          <button onClick={refreshAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)' }}><RefreshCw size={10} /></button>
        </div>

        {/* ── Built-In Templates ─────────────────────────────── */}
        <div style={{
          padding: '8px 14px', fontSize: 9, fontWeight: 700, color: '#89b4fa',
          textTransform: 'uppercase', letterSpacing: '0.4px',
          borderBottom: '1px solid var(--surface0)', background: 'var(--crust)',
          display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none',
        }} onClick={() => toggleLane('built-in')}>
          {collapsedLanes.has('built-in') ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <Cloud size={10} color="#89b4fa" /> Built-In Templates
          <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--overlay0)', marginLeft: 'auto' }}>{templates.length}</span>
        </div>
        {!collapsedLanes.has('built-in') && templates.map(tmpl => (
          <NetListItem
            key={tmpl.id}
            label={tmpl.label}
            sublabel={tmpl.description}
            color={tmpl.color}
            badge={tmpl.type}
            isSelected={selection?.kind === 'template' && selection.id === tmpl.id}
            onClick={() => setSelection({ kind: 'template', id: tmpl.id })}
          />
        ))}

        {/* ── Instances (created networks) ────────────────── */}
        <div style={{
          padding: '8px 14px', fontSize: 9, fontWeight: 700, color: '#a6e3a1',
          textTransform: 'uppercase', letterSpacing: '0.4px',
          borderBottom: '1px solid var(--surface0)', background: 'var(--crust)',
          display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none',
          marginTop: 2,
        }} onClick={() => toggleLane('instances')}>
          {collapsedLanes.has('instances') ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <Package size={10} color="#a6e3a1" /> Instances
          <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--overlay0)', marginLeft: 'auto' }}>{instanceCount}</span>
        </div>
        {!collapsedLanes.has('instances') && (
          networks.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 10, color: 'var(--overlay0)', fontStyle: 'italic' }}>
              No instances yet — create one from a template above
            </div>
          ) : (
            networks.map(net => {
              const deployed = net.status?.deployed
              const bridgeState = net.status?.bridge_state || 'unknown'
              const isUp = bridgeState === 'up'
              const badge = !deployed ? 'NOT DEPLOYED' : isUp ? 'UP' : 'DOWN'
              const badgeColor = !deployed ? '#6c7086' : isUp ? '#a6e3a1' : '#fab387'
              const color = NET_TYPE_COLORS[net.type] || '#89b4fa'
              return (
                <NetListItem
                  key={net.network_id}
                  label={net.label || net.id}
                  sublabel={`${NET_TYPE_LABELS[net.type] || net.type}${deployed ? ' · deployed' : ''}`}
                  color={color}
                  badge={badge}
                  badgeColor={badgeColor}
                  isSelected={selection?.kind === 'instance' && selection.id === net.network_id}
                  onClick={() => setSelection({ kind: 'instance', id: net.network_id })}
                />
              )
            })
          )
        )}

        {/* Create new button */}
        <div style={{ padding: 12 }}>
          <button onClick={() => handleCreate()}
            style={{ ...btn('#89b4fa', true), width: '100%', justifyContent: 'center' }}>
            <Plus size={12} /> New Network
          </button>
        </div>
      </div>

      {/* ── Right: Detail panel ──────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

        {/* ── Template detail ──────────────────────────────── */}
        {selectedTemplate ? (
          <div style={{ maxWidth: 700 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${selectedTemplate.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Cloud size={20} color={selectedTemplate.color} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{selectedTemplate.label}</h3>
                <div style={{ fontSize: 11, color: 'var(--subtext0)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>Built-In Template</span>
                  <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: `${selectedTemplate.color}20`, color: selectedTemplate.color }}>{selectedTemplate.type}</span>
                </div>
              </div>
              <button onClick={() => handleCreate(selectedTemplate)} style={btn('#89b4fa', true)}>
                <Plus size={12} /> Create Instance
              </button>
            </div>

            {/* Info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                ['Type', selectedTemplate.type],
                ['STP', selectedTemplate.stp ? 'Yes' : 'No'],
                ['VLAN Filter', selectedTemplate.vlan_filtering ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface0)', border: '1px solid var(--surface1)' }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--subtext0)', textTransform: 'uppercase', marginBottom: 1 }}>{k}</div>
                  <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Description */}
            <div style={{ ...card, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--subtext0)', textTransform: 'uppercase', marginBottom: 6 }}>Description</div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{selectedTemplate.description}</div>
            </div>

            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)', fontSize: 10, color: 'var(--subtext0)' }}>
              <b>Usage:</b> Click <b>Create Instance</b> to create a new network from this template.
              The instance will appear under <b>Instances</b> and can then be deployed on the host.
            </div>
          </div>

        /* ── Instance detail ───────────────────────────────── */
        ) : selectedInstance ? (
          <InstanceDetail
            net={selectedInstance}
            allNets={networks}
            busyAction={busyAction}
            deleting={deleting}
            onDeploy={() => runAction(selectedInstance.network_id, 'deploy')}
            onUndeploy={() => runAction(selectedInstance.network_id, 'undeploy')}
            onHostJoin={() => runAction(selectedInstance.network_id, 'host-join')}
            onHostLeave={() => runAction(selectedInstance.network_id, 'host-leave')}
            onInternetConnect={() => runAction(selectedInstance.network_id, 'internet-connect')}
            onInternetDisconnect={() => runAction(selectedInstance.network_id, 'internet-disconnect')}
            onEdit={() => handleEdit(selectedInstance)}
            onDelete={() => handleDelete(selectedInstance)}
          />

        /* ── Empty state ───────────────────────────────────── */
        ) : (
          <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--overlay0)' }}>
            <Network size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Network Manager</div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>Select a template or instance to view details.</div>
            <button onClick={() => handleCreate()} style={btn('#89b4fa', true)}>
              <Plus size={12} /> New Network
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <NetworkFormModal
          initial={modal.editing ? { ...modal.initial, _network_id: modal.netId } as any : modal.initial}
          editing={modal.editing}
          allNets={networks}
          onClose={() => setModal(null)}
          onSaved={refreshAll}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Instance Detail (sub-component) ──────────────────────────────────

function InstanceDetail({ net, allNets, busyAction, deleting, onDeploy, onUndeploy, onHostJoin, onHostLeave, onInternetConnect, onInternetDisconnect, onEdit, onDelete }: {
  net: NetworkDefData
  allNets: NetworkDefData[]
  busyAction: string | null
  deleting: string | null
  onDeploy: () => void
  onUndeploy: () => void
  onHostJoin: () => void
  onHostLeave: () => void
  onInternetConnect: () => void
  onInternetDisconnect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const deployed = net.status?.deployed
  const hostJoined = net.status?.host_joined
  const internetActive = net.status?.internet_active
  const dockerExists = net.status?.docker_exists
  const color = NET_TYPE_COLORS[net.type] || '#89b4fa'
  const isBusy = (action: string) => busyAction === `${net.network_id}:${action}`
  const isDeleting = deleting === net.network_id

  return (
    <div style={{ maxWidth: 700 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Network size={20} color={color} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{net.label || net.id}</h3>
          <div style={{ fontSize: 11, color: 'var(--subtext0)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{NET_TYPE_LABELS[net.type] || net.type}</span>
            <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: `${color}20`, color }}>{net.type}</span>
            <span style={{
              padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700,
              background: deployed ? '#a6e3a120' : '#f38ba820',
              color: deployed ? '#a6e3a1' : '#f38ba8',
            }}>
              {deployed ? 'DEPLOYED' : 'NOT DEPLOYED'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onEdit} style={btn('#89b4fa')} title="Edit network"><Edit3 size={12} /> Edit</button>
          <button onClick={onDelete} disabled={isDeleting} style={{ ...btn('#f38ba8'), opacity: isDeleting ? 0.5 : 1 }} title="Delete network">
            {isDeleting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={12} />} Delete
          </button>
        </div>
      </div>

      {/* Info grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          ['Network ID', net.network_id],
          ['Type', NET_TYPE_LABELS[net.type] || net.type],
          ['Bridge', net.bridge || '(auto)'],
          ...(net.vlan != null ? [['VLAN', String(net.vlan)]] : []),
          ['Subnet', net.subnet || '—'],
          ['Gateway', net.gateway || '—'],
          ['STP', net.stp ? 'Yes' : 'No'],
          ['VLAN Filter', net.vlan_filtering ? 'Yes' : 'No'],
          ...(net.host?.ip ? [['Host IP', `${net.host.ip}/${net.host?.prefix || ''}`]] : []),
          ['Internet', net.internet?.enabled ? 'Yes' : 'No'],
          ['Docker', net.docker?.enabled ? 'Yes' : 'No'],
          ...(net.parent_network ? [['Parent', net.parent_network]] : []),
        ].map(([k, v]) => (
          <div key={k} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface0)', border: '1px solid var(--surface1)' }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--subtext0)', textTransform: 'uppercase', marginBottom: 1 }}>{k}</div>
            <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</div>
          </div>
        ))}
      </div>

      {net.description && (
        <div style={{ ...card, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--subtext0)', textTransform: 'uppercase', marginBottom: 6 }}>Description</div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{net.description}</div>
        </div>
      )}

      {/* ── Lifecycle Actions ────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={sectionHdr}>
          <Play size={14} color="#a6e3a1" />
          <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Lifecycle Actions</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Deploy / Undeploy */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Deploy / Undeploy</div>
              <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                {deployed ? 'Network is deployed on the host' : 'Deploy network infrastructure on the host'}
              </div>
            </div>
            {deployed ? (
              <button onClick={onUndeploy} disabled={isBusy('undeploy')} style={{ ...btn('#f38ba8', true), opacity: isBusy('undeploy') ? 0.5 : 1 }}>
                {isBusy('undeploy') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Square size={12} />} Undeploy
              </button>
            ) : (
              <button onClick={onDeploy} disabled={isBusy('deploy')} style={{ ...btn('#a6e3a1', true), opacity: isBusy('deploy') ? 0.5 : 1 }}>
                {isBusy('deploy') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={12} />} Deploy
              </button>
            )}
          </div>

          {/* Host Join / Leave */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)', opacity: deployed ? 1 : 0.5 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                Host Access <HelpIcon topic="host_access" />
              </div>
              <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                {hostJoined ? 'Host is connected to this network' : 'Connect host to this network for management'}
              </div>
            </div>
            {deployed && (
              hostJoined ? (
                <button onClick={onHostLeave} disabled={isBusy('host-leave')} style={{ ...btn('#f9e2af'), opacity: isBusy('host-leave') ? 0.5 : 1 }}>
                  {isBusy('host-leave') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <MonitorOff size={12} />} Leave
                </button>
              ) : (
                <button onClick={onHostJoin} disabled={isBusy('host-join')} style={{ ...btn('#89b4fa', true), opacity: isBusy('host-join') ? 0.5 : 1 }}>
                  {isBusy('host-join') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Monitor size={12} />} Join
                </button>
              )
            )}
          </div>

          {/* Internet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)', opacity: deployed ? 1 : 0.5 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                Internet / NAT <HelpIcon topic="internet" />
              </div>
              <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>
                {internetActive ? 'NAT masquerade is active' : 'Enable NAT for internet access'}
              </div>
            </div>
            {deployed && (
              internetActive ? (
                <button onClick={onInternetDisconnect} disabled={isBusy('internet-disconnect')} style={{ ...btn('#f9e2af'), opacity: isBusy('internet-disconnect') ? 0.5 : 1 }}>
                  {isBusy('internet-disconnect') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe2 size={12} />} Disconnect
                </button>
              ) : (
                <button onClick={onInternetConnect} disabled={isBusy('internet-connect')} style={{ ...btn('#a6e3a1', true), opacity: isBusy('internet-connect') ? 0.5 : 1 }}>
                  {isBusy('internet-connect') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe size={12} />} Connect
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Status ───────────────────────────────────────────── */}
      {net.status && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={sectionHdr}>
            <Info size={14} color="#89b4fa" />
            <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>Live Status</span>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['Bridge State', net.status.bridge_state || '—'],
                ['Deployed', net.status.deployed ? 'Yes' : 'No'],
                ['Host Joined', net.status.host_joined ? 'Yes' : 'No'],
                ['Internet Active', net.status.internet_active ? 'Yes' : 'No'],
                ['Docker Exists', net.status.docker_exists ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--surface0)', fontSize: 11 }}>
                  <span style={{ color: 'var(--subtext0)', fontWeight: 600 }}>{k}</span>
                  <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
