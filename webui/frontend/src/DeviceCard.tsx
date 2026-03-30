import { apiFetch } from './apiFetch'
/* triv WebUI — DeviceCard: single node info panel with driver-grouped actions */

import React, { useState, useMemo } from 'react'
import {
  Server, HardDrive, Cpu, CircuitBoard, Network, Globe,
  ArrowLeftRight, Monitor, Radio, Box, Terminal, Power,
  ChevronDown, ChevronRight, Play, Square, Wifi,
  RotateCcw, Clipboard, Upload, Settings, ExternalLink,
  Layers, Folder, Hammer, Activity,
  Trash2, PackagePlus, Pause, Info, Camera, PowerOff,
  Zap, ScrollText, Link, Unplug, Download,
} from 'lucide-react'

import { CATEGORY_META, RUNTIME_BADGE, STATE_COLOR, HEALTH_COLOR } from './types'
import type { NodeDef, ActionDef } from './types'

const ICON_MAP: Record<string, React.FC<any>> = {
  Server, HardDrive, Cpu, CircuitBoard, Network, Globe,
  ArrowLeftRight, Monitor, Radio, Box, Layers, Folder,
}

/* ── Icon resolver: maps action icon strings to lucide components ── */
const ACTION_ICON_MAP: Record<string, React.FC<any>> = {
  terminal:     Terminal,
  play:         Play,
  square:       Square,
  power:        Power,
  'power-off':  PowerOff,
  'refresh-cw': RotateCcw,
  restart:      RotateCcw,
  clipboard:    Clipboard,
  upload:       Upload,
  settings:     Settings,
  link:         ExternalLink,
  hammer:       Hammer,
  activity:     Activity,
  'file-text':  Activity,
  layers:       Layers,
  folder:       Folder,
  zap:          Zap,
  monitor:      Monitor,
  globe:        Globe,
  'external-link': ExternalLink,
  'trash-2':    Trash2,
  box:          PackagePlus,
  pause:        Pause,
  info:         Info,
  camera:       Camera,
  'hard-drive': HardDrive,
  'scroll-text': ScrollText,
  wifi:         Wifi,
  download:     Download,
}

/** Well-known lifecycle action ids with state-dependent visibility.
 *  These are rendered with special rules (only shown in certain states).
 *  Only applies to native-origin drivers that provide lifecycle management. */
const LIFECYCLE_IDS = new Set([
  // common
  'console', 'console-sh', 'console-bash', 'ssh', 'start',
  // VM
  'define', 'shutdown', 'reboot', 'destroy', 'reset',
  'suspend', 'resume', 'link-up', 'vm-info', 'screenshot',
  // container
  'create', 'stop', 'restart', 'rm', 'logs', 'container-status',
  'connect-network', 'disconnect-network',
])

/** Color palette for well-known action ids */
const ACTION_COLOR: Record<string, string> = {
  console:  'var(--blue)',
  ssh:      'var(--teal)',
  start:    'var(--green)',
  define:   'var(--mauve)',
  shutdown: 'var(--peach)',
  reboot:   'var(--peach)',
  destroy:  'var(--red)',
  reset:    'var(--red)',
  suspend:  'var(--yellow)',
  resume:   'var(--green)',
  'link-up':      'var(--teal)',
  'vm-info':    'var(--sapphire)',
  screenshot:   'var(--lavender)',
  create:   'var(--blue)',
  stop:     'var(--red)',
  restart:  'var(--peach)',
  rm:       'var(--red)',
  logs:     'var(--sapphire)',
  'container-status': 'var(--sapphire)',
  'connect-network': 'var(--teal)',
  'disconnect-network': 'var(--maroon)',
}

/** Known native lifecycle driver IDs */
const NATIVE_LIFECYCLE_DRIVERS = new Set([
  'generic-driver-libvirt', 'generic-driver-libvirt-python',
  'generic-driver-container', 'generic-driver-container-python',
  'generic-driver-app', 'generic-driver-app-python',
  'generic-driver-remote', 'generic-driver-remote-python',
])

function resolveActionIcon(action: ActionDef): React.FC<any> {
  if (action.icon && ACTION_ICON_MAP[action.icon]) return ACTION_ICON_MAP[action.icon]
  switch (action.id) {
    case 'console':   return Terminal
    case 'ssh':       return Terminal
    case 'start':     return Play
    case 'define':    return HardDrive
    case 'create':    return PackagePlus
    case 'stop':      return Square
    case 'shutdown':  return PowerOff
    case 'destroy':   return Zap
    case 'restart':   return RotateCcw
    case 'reboot':    return RotateCcw
    case 'reset':     return Zap
    case 'suspend':   return Pause
    case 'resume':    return Play
    case 'rm':        return Trash2
    case 'link-up':   return Link
    case 'vm-info':   return Info
    case 'screenshot': return Camera
    case 'logs':      return ScrollText
    case 'container-status': return Info
    case 'connect-network':  return Network
    case 'disconnect-network': return Unplug
    default:          return Play
  }
}

function resolveActionColor(action: ActionDef): string {
  return ACTION_COLOR[action.id] ?? 'var(--mauve)'
}

/** Check if a native lifecycle action should be visible given node state */
function isLifecycleActionVisible(
  id: string, running: boolean, stopped: boolean,
  isContainer: boolean, containerExists: boolean, isVM: boolean,
  state: string | undefined,
  isRemote: boolean,
): boolean {
  // Remote nodes: ssh and reboot are always available regardless of reported state
  if (isRemote && (id === 'ssh' || id === 'reboot')) return true
  // Container-only
  if (id === 'create' && (!isContainer || containerExists)) return false
  if (id === 'rm' && (!containerExists || running)) return false
  if (id === 'logs' && !running) return false
  if (id === 'container-status' && !containerExists) return false
  if (id === 'connect-network' && !running) return false
  if (id === 'disconnect-network' && !running) return false
  // VM-only
  if (id === 'define' && running) return false
  if (id === 'shutdown' && !running) return false
  if (id === 'destroy' && !running) return false
  if (id === 'reset' && !running) return false
  if (id === 'suspend' && !running) return false
  if (id === 'resume' && state !== 'paused') return false
  if (id === 'link-up' && !running) return false
  if (id === 'vm-info' && !isVM) return false
  if (id === 'screenshot' && !running) return false
  // Common
  if (id === 'start' && !stopped && state !== 'created') return false
  if ((id === 'console' || id === 'console-sh' || id === 'console-bash' || id === 'ssh') && !running) return false
  if ((id === 'stop' || id === 'restart' || id === 'reboot') && !running) return false
  return true
}

/* ── Driver group type for organized rendering ─────────────────── */
interface DriverGroup {
  driverId: string      // e.g. 'generic-driver-container'
  label: string         // display label (from driver or fallback)
  isNativeLifecycle: boolean
  actions: ActionDef[]
}

interface Props {
  node: NodeDef
  selected: boolean
  onSelect: () => void
  onConsole: () => void
  onOpenTerminal: (t: { type: 'console' | 'ssh'; target: string; user?: string; port?: number; password?: string }) => void
  onOpenWebPanel: (title: string, url: string) => void
  onShowOutput: (title: string, output: string, live?: boolean) => void
  onAppendOutput?: (text: string) => void
  onSetOutputLive?: (live: boolean) => void
  onOpenChat: (nodeId: string, title: string) => void
  onOpenTask: (nodeId: string, title: string) => void
  onRefresh: () => void
  hasChildren?: boolean
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  indent?: boolean
}

export default function DeviceCard({
  node, selected, onSelect, onConsole, onOpenTerminal, onOpenWebPanel, onShowOutput, onAppendOutput, onSetOutputLive, onOpenChat, onOpenTask, onRefresh,
  hasChildren, isCollapsed, onToggleCollapse, indent,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const meta = CATEGORY_META[node.category] ?? CATEGORY_META.generic
  const Icon = ICON_MAP[meta.icon] ?? Box
  const stateColor = STATE_COLOR[node.state ?? 'undefined'] ?? '#585b70'
  const runtime = node.runtime ? RUNTIME_BADGE[node.runtime] : null
  const running = node.state === 'running' || node.state === 'online'
  const stopped = node.state === 'shut off' || node.state === 'offline' || node.state === 'exited' || node.state === 'dead'
  const isContainer = node.runtime === 'docker' || node.runtime === 'podman'
  const isVM = node.runtime === 'libvirt'
  const isRemote = node.runtime === 'remote'
  const containerExists = isContainer && node.state !== 'undefined' && node.state !== 'unavailable'
  const accent = node.driver_meta?.accent_color ?? meta.color

  const isGroupLike = node.category === 'cluster' || node.category === 'group'
  const actions = node.actions ?? []

  /* ── Built-in checks ── */
  const hasEnvStart   = actions.some(a => a.id === 'start')
  const hasEnvStop    = actions.some(a => a.id === 'stop')
  const hasEnvRestart = actions.some(a => a.id === 'restart' || a.id === 'reboot')
  const hasEnvConsole = actions.some(a => a.id === 'console')

  const health = node.health
  const healthColor = health?.status ? (HEALTH_COLOR[health.status] ?? HEALTH_COLOR.unknown) : null
  const showHealth = health && health.status && health.status !== 'none'

  /* ── Group actions by driver ────────────────────────── */
  const driverGroups: DriverGroup[] = useMemo(() => {
    const groupMap = new Map<string, DriverGroup>()
    const groups: DriverGroup[] = []
    for (const action of actions) {
      const driverId = action.driver || ''
      if (!groupMap.has(driverId)) {
        const isNative = action.origin === 'native' || NATIVE_LIFECYCLE_DRIVERS.has(driverId)
        // A group is "native lifecycle" if it comes from a known native driver,
        // OR if the group has no driver but all actions are lifecycle IDs
        const group: DriverGroup = {
          driverId,
          label: driverId || 'Actions',
          isNativeLifecycle: isNative && LIFECYCLE_IDS.has(action.id),
          actions: [],
        }
        groupMap.set(driverId, group)
        groups.push(group)
      }
      const g = groupMap.get(driverId)!
      // If any action in the group is a native lifecycle action, mark the group
      if ((action.origin === 'native' || NATIVE_LIFECYCLE_DRIVERS.has(driverId)) && LIFECYCLE_IDS.has(action.id)) {
        g.isNativeLifecycle = true
      }
      // For ungrouped actions (no driver), detect lifecycle by ID pattern
      if (!driverId && LIFECYCLE_IDS.has(action.id) && node.runtime) {
        g.isNativeLifecycle = true
      }
      g.actions.push(action)
    }
    // Assign friendly labels: attempt driver id cleanup
    for (const g of groups) {
      if (!g.driverId) { g.label = 'Actions'; continue }
      // Prettify: "generic-driver-container" → "Generic Container"
      g.label = g.driverId
        .replace(/^generic-driver-/, 'Generic ')
        .replace(/^generic-/, 'Generic ')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
    }
    return groups
  }, [actions])

  /* ── Toggle a group collapse ── */
  const toggleGroup = (driverId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(driverId)) next.delete(driverId); else next.add(driverId)
      return next
    })
  }

  async function runBuiltinAction(verb: 'start' | 'stop' | 'restart') {
    setBusy(verb)
    try {
      await apiFetch(`/api/nodes/${node.id}/${verb}`, { method: 'POST' })
      setTimeout(onRefresh, 600)
    } finally {
      setBusy(null)
    }
  }

  async function executeAction(action: ActionDef) {
    if (action.confirm && !window.confirm(action.confirm)) return

    if (action.type === 'console') {
      if (action.host) {
        onOpenTerminal({ type: 'ssh', target: action.host, user: action.user, port: action.port, password: action.password })
      } else {
        onConsole()
      }
      return
    }
    if (action.type === 'ssh') {
      const target = action.host ?? node.vm_name ?? node.id
      onOpenTerminal({ type: 'ssh', target, user: action.user, port: action.port, password: action.password })
      return
    }
    if (action.type === 'link' && action.url) {
      window.open(action.url, '_blank')
      return
    }
    if (action.type === 'webui' && action.url) {
      onOpenWebPanel(action.label, action.url)
      return
    }
    if (action.id === 'chat') {
      const chatTitle = `Chat — ${node.label ?? node.vm_name ?? node.id}`
      onOpenChat(node.id, chatTitle)
      return
    }
    if (action.id === 'run-task') {
      const taskTitle = `Run Task — ${node.label ?? node.vm_name ?? node.id}`
      onOpenTask(node.id, taskTitle)
      return
    }

    // Streaming path for long-running actions
    const STREAMING_ACTIONS: Record<string, string> = {
      'create-container': 'Create Container',
      'pull-model': 'Pull Model',
    }
    if (action.id in STREAMING_ACTIONS && onAppendOutput && onSetOutputLive) {
      const panelTitle = `${STREAMING_ACTIONS[action.id]} — ${node.label ?? node.vm_name ?? node.id}`
      onShowOutput(panelTitle, '', true)
      setBusy(action.id)
      try {
        const res = await apiFetch(`/api/nodes/${node.id}/action/${action.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!res.ok || !res.body) {
          const text = await res.text()
          onAppendOutput(`Error: ${text || res.statusText}\n`)
          onSetOutputLive(false)
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            for (const line of part.split('\n')) {
              if (!line.startsWith('data: ')) continue
              const content = line.slice(6)
              if (content.startsWith('ok:') || content.startsWith('error:')) {
                if (content.startsWith('error:')) {
                  onAppendOutput(`\nFailed: ${content.slice(6)}\n`)
                }
                onSetOutputLive(false)
              } else {
                onAppendOutput(content + '\n')
              }
            }
          }
        }
        onSetOutputLive(false)
        setTimeout(onRefresh, 600)
      } catch (err: any) {
        onAppendOutput(`\nConnection error: ${err.message}\n`)
        onSetOutputLive(false)
      } finally {
        setBusy(null)
      }
      return
    }

    setBusy(action.id)
    try {
      const res = await apiFetch(`/api/nodes/${node.id}/action/${action.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      // Check both HTTP status and the application-level ok flag
      const failed = !res.ok || data.ok === false
      if (failed) {
        const parts: string[] = []
        if (data.detail) parts.push(data.detail)
        if (data.error)  parts.push(data.error)
        if (data.output) parts.push(data.output)
        if (data.stderr) parts.push(data.stderr)
        if (data.stdout) parts.push(data.stdout)
        const errMsg = parts.join('\n').trim() || res.statusText
        const panelTitle = `${action.label} — ${node.label ?? node.vm_name ?? node.id} [FAILED]`
        onShowOutput(panelTitle, errMsg)
      } else {
        const isPanel = action.type === 'exec-output' || action.type === 'define-vm'
          || action.id === 'create-container' || action.id === 'connect-network'
          || action.id === 'disconnect-network' || action.id === 'remove-container'
          || action.type === 'vm-destroy-clean'
          || data.output_type === 'panel'
        const lines: string[] = []
        if (data.output)  lines.push(data.output)
        if (data.detail)  lines.push(data.detail)
        if (data.stdout)  lines.push(data.stdout)
        if (data.stderr)  lines.push(data.stderr)
        // For define-vm: append a summary of what was created
        if (action.type === 'define-vm' && data.vm_name) {
          lines.push(`\nVM:      ${data.vm_name}`)
          lines.push(`Overlay: ${data.overlay ?? '—'}`)
          if (data.interfaces) {
            lines.push('Interfaces:')
            for (const [id, info] of Object.entries(data.interfaces as Record<string, any>)) {
              lines.push(`  ${id}  bridge=${info.bridge}  mac=${info.mac}`)
            }
          }
        }
        const msg = lines.join('\n').trim()
        if (isPanel) {
          const panelTitle = `${action.label} — ${node.label ?? node.vm_name ?? node.id}`
          onShowOutput(panelTitle, msg || '(no output)')
        } else if (msg) {
          alert(msg)
        }
      }
      setTimeout(onRefresh, 600)
    } catch (err: any) {
      alert(`Action error: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  /** Render a single action button */
  function renderActionBtn(action: ActionDef) {
    const AIcon = resolveActionIcon(action)
    const color = resolveActionColor(action)
    return (
      <ActionBtn
        key={action.id}
        icon={<AIcon size={11} />}
        label={action.label}
        loading={busy === action.id}
        onClick={e => { e.stopPropagation(); executeAction(action) }}
        color={color}
      />
    )
  }

  /** Filter native lifecycle actions based on current state */
  function filterLifecycleActions(groupActions: ActionDef[]): ActionDef[] {
    return groupActions.filter(a =>
      !LIFECYCLE_IDS.has(a.id) ||
      isLifecycleActionVisible(a.id, running, stopped, isContainer, containerExists, isVM, node.state, isRemote)
    )
  }

  /** Has any visible actions in a lifecycle group? */
  function groupHasVisibleActions(group: DriverGroup): boolean {
    if (!group.isNativeLifecycle) return group.actions.length > 0
    return filterLifecycleActions(group.actions).length > 0
  }

  return (
    <div
      onClick={onSelect}
      className="device-card"
      style={{
        margin: indent ? '2px 0 2px 16px' : '4px 0',
        padding: '10px 12px',
        borderRadius: 8,
        cursor: 'pointer',
        border: selected ? `2px solid ${accent}` : '1px solid var(--surface1)',
        borderLeft: indent && !selected ? '2px solid var(--surface1)' : undefined,
        background: selected ? 'var(--surface0)' : 'var(--mantle)',
        transition: 'all 0.15s ease',
      }}
    >
      {/* ── Header row ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {hasChildren && (
          <button
            onClick={e => { e.stopPropagation(); onToggleCollapse?.() }}
            title={isCollapsed ? 'Expand children' : 'Collapse children'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, color: 'var(--subtext0)', flexShrink: 0,
              display: 'flex', alignItems: 'center', borderRadius: 3,
            }}
          >
            <ChevronDown
              size={12}
              style={{
                transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            />
          </button>
        )}
        <div style={{
          width: 32, height: 32, borderRadius: 6,
          background: `${accent}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={16} color={accent} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="truncate" style={{
              fontWeight: 600, fontSize: 13, color: 'var(--text)',
            }}>
              {node.label ?? node.vm_name ?? node.id}
            </span>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: stateColor, flexShrink: 0,
            }} title={`State: ${node.state ?? 'unknown'}`} />
            {node.properties?.short_id && (
              <span style={{
                fontSize: 10, color: 'var(--overlay0)',
                fontFamily: 'var(--font-mono)', marginLeft: 'auto',
                flexShrink: 0,
              }}>
                {node.properties.short_id}
              </span>
            )}
            {showHealth && healthColor && (
              <div
                title={`Health: ${health!.status}${health!.error ? ` — ${health!.error}` : ''}`}
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  border: `2px solid ${healthColor}`,
                  background: health!.status === 'healthy' ? healthColor : 'transparent',
                  flexShrink: 0,
                }}
              />
            )}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginTop: 2,
          }}>
            <span style={{ fontSize: 10, color: 'var(--subtext0)' }}>
              {meta.label}
            </span>
            {node.driver_meta && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: `${accent}20`, color: accent,
                fontWeight: 500,
              }}>
                {node.driver_meta.vendor}
              </span>
            )}
            {runtime && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: runtime.bg, color: runtime.color,
                fontWeight: 500,
              }}>
                {runtime.label}
              </span>
            )}
          </div>
        </div>

        <span style={{
          fontSize: 10, color: stateColor, fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          {node.state ?? '—'}
        </span>
      </div>

      {/* ── Built-in actions (for nodes with no env-defined lifecycle) ── */}
      {node.runtime && !isGroupLike && !hasEnvStart && !hasEnvConsole && !hasEnvStop && !hasEnvRestart && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {(stopped || (isContainer && node.state === 'created')) && (
            <ActionBtn icon={<Play size={11} />} label="Start" loading={busy === 'start'}
              onClick={e => { e.stopPropagation(); runBuiltinAction('start') }} color="var(--green)" />
          )}
          {running && (
            <ActionBtn icon={<Terminal size={11} />} label="Console"
              onClick={e => { e.stopPropagation(); onConsole() }} color="var(--blue)" />
          )}
          {running && (
            <ActionBtn icon={<RotateCcw size={11} />} label="Restart" loading={busy === 'restart'}
              onClick={e => { e.stopPropagation(); runBuiltinAction('restart') }} color="var(--peach)" />
          )}
          {running && (
            <ActionBtn icon={<Square size={11} />} label="Stop" loading={busy === 'stop'}
              onClick={e => { e.stopPropagation(); runBuiltinAction('stop') }} color="var(--red)" />
          )}
        </div>
      )}

      {/* ── Driver-grouped actions ─────────────────────── */}
      {driverGroups.length > 0 && !isGroupLike && (
        <div style={{ marginTop: 6 }}>
          {driverGroups.map(group => {
            if (!groupHasVisibleActions(group)) return null
            const isCollapsedGroup = collapsedGroups.has(group.driverId)
            const visibleActions = group.isNativeLifecycle
              ? filterLifecycleActions(group.actions)
              : group.actions
            return (
              <div key={group.driverId || '_ungrouped'} style={{ marginTop: 4 }}>
                {/* Group header */}
                <button
                  onClick={e => { e.stopPropagation(); toggleGroup(group.driverId) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    padding: '3px 4px', background: 'none', border: 'none',
                    cursor: 'pointer', borderRadius: 4,
                  }}
                  title={`${group.label} (${visibleActions.length} action${visibleActions.length !== 1 ? 's' : ''})`}
                >
                  <ChevronDown size={9} color="var(--overlay0)"
                    style={{ transform: isCollapsedGroup ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}
                  />
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: 'var(--overlay1)',
                    textTransform: 'uppercase', letterSpacing: '0.3px',
                  }}>
                    {group.label}
                  </span>
                  <span style={{ fontSize: 8, color: 'var(--overlay0)' }}>
                    ({visibleActions.length})
                  </span>
                </button>
                {/* Action buttons */}
                {!isCollapsedGroup && (
                  <div style={{
                    display: 'flex', gap: 4, flexWrap: 'wrap',
                    alignItems: 'center',
                    paddingTop: 2,
                    paddingLeft: 4,
                  }}>
                    {visibleActions.map(action => renderActionBtn(action))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Expandable interfaces section ──────────────── */}
      {node.interfaces && node.interfaces.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={e => { e.stopPropagation(); setExpanded(!expanded) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--subtext0)', fontSize: 10, display: 'flex',
              alignItems: 'center', gap: 3, padding: 0,
            }}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {node.interfaces.length} interface{node.interfaces.length > 1 ? 's' : ''}
          </button>
          {expanded && (
            <div style={{
              marginTop: 4, paddingLeft: 8,
              borderLeft: `2px solid var(--surface1)`,
            }}>
              {node.interfaces.map(iface => (
                <div key={iface.id} style={{
                  fontSize: 10, color: 'var(--subtext1)',
                  padding: '2px 0', display: 'flex', gap: 6,
                  alignItems: 'center',
                }}>
                  <Wifi size={9} color="var(--overlay1)" />
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                    {iface.label ?? iface.id}
                  </span>
                  <span>{iface.type}</span>
                  {iface.direction && (
                    <span style={{
                      fontSize: 8, padding: '0 3px', borderRadius: 2,
                      background: 'var(--surface1)', color: 'var(--subtext0)',
                    }}>
                      {iface.direction}
                    </span>
                  )}
                  {iface.ip && (
                    <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                      {iface.ip}
                    </span>
                  )}
                  {iface.vlan !== undefined && (
                    <span style={{ color: 'var(--peach)' }}>
                      VLAN {iface.vlan}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Small action button ──────────────────────────────────────────── */
function ActionBtn({ icon, label, onClick, color, loading }: {
  icon: React.ReactNode; label: string
  onClick: (e: React.MouseEvent) => void; color: string
  loading?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={!!loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', fontSize: 10, borderRadius: 4,
        background: `${color}15`, color,
        border: `1px solid ${color}30`,
        cursor: loading ? 'wait' : 'pointer', fontWeight: 500,
        transition: 'all 0.15s ease',
        opacity: loading ? 0.6 : 1,
      }}
      onMouseEnter={e => {
        if (!loading) (e.currentTarget as HTMLElement).style.background = `${color}30`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = `${color}15`
      }}
    >
      {icon} {label}
    </button>
  )
}
