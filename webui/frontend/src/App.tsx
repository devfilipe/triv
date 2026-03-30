/* triv WebUI — App: main multi-panel layout with Catppuccin dark theme */

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useAuth } from './AuthContext'
import LoginPage from './LoginPage'
import { apiFetch } from './apiFetch'
import {
  LayoutDashboard, Server, Network, Cpu, Activity,
  Trash2, ChevronLeft, ChevronRight, Zap, Wifi, Edit3, Monitor,
  FolderOpen, Layers, Folder, Play, Square, RefreshCw, Upload,
  Settings, Hammer, AlertCircle, CheckCircle, PenTool,
  Store, BrainCircuit, Github, Wand2, Building2,
} from 'lucide-react'
import TopologyCanvas from './TopologyCanvas'
import BuilderCanvas from './BuilderCanvas'
import DeviceCard from './DeviceCard'
import StatusPanel from './StatusPanel'
import ConnectivityPanel from './ConnectivityPanel'
import TopologyEditor from './TopologyEditor'
import AdhocDevicesPanel from './AdhocDevicesPanel'
import FloatingTerminal from './FloatingTerminal'
import FloatingWebPanel from './FloatingWebPanel'
import FloatingOutputPanel from './FloatingOutputPanel'
import FloatingJsonEditor from './FloatingJsonEditor'
import FloatingChatPanel from './FloatingChatPanel'
import FloatingTaskPanel from './FloatingTaskPanel'
import ProjectManager from './ProjectManager'
import OrgSelector from './OrgSelector'
import NodeDrivers from './NodeDrivers'
import NetworkManager from './NetworkManager'
import NetStats from './NetStats'
import AiCentral from './AiCentral'
import WizardConfig from './WizardConfig'
import FloatingWizardPanel from './FloatingWizardPanel'
import { useNodes, useSystemStatus, useTopology, useLinks, useNetworks, useDrivers, useConnectivity, useProjects, useTopologyActions, useDiscoveredLinks, useNetworkDefs, useNetworkCatalog, useNetworkTemplates, useOrgs } from './hooks'
import type { NodeDef, ActionDef, NetworkDefDef } from './types'

// Stable empty references — prevents infinite re-render loops in canvas components
// when topology hasn't loaded yet (topology === null → network_defs would be undefined,
// causing default param [] to create a new reference every render, triggering useEffect).
const EMPTY_NETWORK_DEFS: NetworkDefDef[] = []
const EMPTY_NETWORK_STATUSES: Record<string, any> = {}

type View = 'topology' | 'apps' | 'builder' | 'nodes' | 'editor' | 'adhoc' | 'connectivity' | 'drivers' | 'status' | 'net-manager' | 'net-stats' | 'ai' | 'wizard'

/* ── Slim nav rail: only Topology + Apps ─────────────────────── */
const NAV_ITEMS: { id: 'topology' | 'apps'; icon: React.FC<any>; label: string }[] = [
  { id: 'topology', icon: LayoutDashboard, label: 'Topology' },
  { id: 'apps',     icon: Store,           label: 'Apps' },
]

/* ── App launcher entries (shown on the Apps page) ───────────── */
type AppEntry = {
  id: View
  icon: React.FC<any>
  label: string
  description: string
  color: string            // accent colour from Catppuccin
  disabled?: boolean
  category: string
}

const APP_ENTRIES: AppEntry[] = [
  // Nodes
  { id: 'nodes',        icon: Server,    label: 'Nodes',          description: 'Browse & interact with all topology nodes',        color: '#89b4fa', category: 'Nodes' },
  { id: 'adhoc',        icon: Monitor,   label: 'Ad-hoc Devices', description: 'Manage ad-hoc / standalone devices',               color: '#89dceb', category: 'Nodes' },
  // Editor
  { id: 'builder',      icon: PenTool,   label: 'Builder',        description: 'Visual topology builder',                          color: '#cba6f7', category: 'Editor' },
  { id: 'editor',       icon: Edit3,     label: 'Editor',         description: 'Advanced topology editor (coming soon)',            color: '#9399b2', category: 'Editor', disabled: true },
  { id: 'drivers',      icon: Cpu,       label: 'Drivers',        description: 'Driver catalog: browse, edit & manage drivers',     color: '#f9e2af', category: 'Editor' },
  // Network
  { id: 'net-manager',  icon: Network,   label: 'Net Manager',    description: 'First-class network objects: bridges, VLANs, trunks',  color: '#89b4fa', category: 'Network' },
  { id: 'connectivity', icon: Wifi,      label: 'Connectivity',   description: 'End-to-end connectivity matrix',                   color: '#74c7ec', category: 'Network' },
  { id: 'net-stats',    icon: Activity,  label: 'Net Stats',      description: 'Live view of all network infrastructure elements',  color: '#74c7ec', category: 'Network' },
  // System
  { id: 'status',       icon: Activity,       label: 'Status',      description: 'System health & bridge statistics',              color: '#f38ba8', category: 'System' },
  // AI
  { id: 'ai',           icon: BrainCircuit,   label: 'AI Central',  description: 'Inventory and capability of AI/LLM resources',   color: '#cba6f7', category: 'AI' },
  { id: 'wizard',       icon: Wand2,          label: 'Wizard',      description: 'AI assistant — configure the built-in Wizard',    color: '#cba6f7', category: 'AI' },
]

export default function App() {
  const { token } = useAuth()
  if (!token) return <LoginPage />
  return <AppContent />
}

function AppContent() {
  const { user, logout } = useAuth()
  const [view, setView]                 = useState<View>('topology')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen]   = useState(true)
  const [terminalTarget, setTerminalTarget] = useState<{ type: 'console' | 'ssh'; target: string; user?: string; port?: number; password?: string } | null>(null)
  const [webPanel, setWebPanel] = useState<{ title: string; url: string } | null>(null)
  const [outputPanel, setOutputPanel] = useState<{ title: string; output: string; live?: boolean; minimized?: boolean } | null>(null)
  const appendOutput = (text: string) =>
    setOutputPanel(p => p ? { ...p, output: p.output + text } : null)
  const setOutputLive = (live: boolean) =>
    setOutputPanel(p => p ? { ...p, live } : null)
  const [chatPanel, setChatPanel]   = useState<{ nodeId: string; title: string } | null>(null)
  const [taskPanel, setTaskPanel]   = useState<{ nodeId: string; title: string } | null>(null)
  const [jsonEditor, setJsonEditor] = useState<{ title: string; content: string; filename: string } | null>(null)
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardEnabled, setWizardEnabled] = useState(false)
  const [wizardBusy, setWizardBusy] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // Data hooks
  const { data: nodes, refresh: refreshNodes } = useNodes()
  const { data: status }   = useSystemStatus()
  const { data: topology, refresh: refreshTopology } = useTopology()
  const { data: links, refresh: refreshLinks }       = useLinks()
  const { data: bridges }  = useNetworks()
  const { data: drivers, refresh: refreshDrivers }   = useDrivers()
  const connectivity       = useConnectivity()
  const projects           = useProjects()
  const topoActions        = useTopologyActions()
  const discovered         = useDiscoveredLinks()
  const networkDefs        = useNetworkDefs()
  const networkCatalog     = useNetworkCatalog()
  const networkTemplates   = useNetworkTemplates()
  const orgs               = useOrgs()
  const [showOrgSelector, setShowOrgSelector] = useState(false)

  useEffect(() => {
    if (!orgs.loading && orgs.data.orgs.length > 0 && !orgs.data.active_org) {
      setShowOrgSelector(true)
    }
  }, [orgs.loading, orgs.data.orgs.length, orgs.data.active_org])

  useEffect(() => {
    apiFetch('/api/wizard/status').then(r => r.json()).then(d => setWizardEnabled(!!d.enabled)).catch(() => {})
  }, [view])  // re-check when user navigates away from wizard config

  const selectedNode = nodes.find(n => n.id === selectedId) ?? null

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedParents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const nodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])

  const childrenByParent = useMemo(() => {
    const map: Record<string, NodeDef[]> = {}
    for (const n of nodes) {
      if (n.parent && nodeIds.has(n.parent)) {
        ;(map[n.parent] ??= []).push(n)
      }
    }
    return map
  }, [nodes, nodeIds])

  const rootNodes = useMemo(
    () => nodes.filter(n => !n.parent || !nodeIds.has(n.parent)),
    [nodes, nodeIds],
  )

  /** Refresh everything — called after a project switch. */
  const refreshAll = useCallback(() => {
    refreshNodes()
    refreshTopology()
    refreshLinks()
    refreshDrivers()
    projects.refresh()
    topoActions.refresh()
  }, [refreshNodes, refreshTopology, refreshLinks, refreshDrivers, projects.refresh, topoActions.refresh])

  /** Called after topology CRUD edits — reload backend then refresh all hooks. */
  function handleTopologyMutate() {
    apiFetch('/api/topology/reload', { method: 'POST' })
      .then(() => {
        refreshNodes()
        refreshTopology()
        refreshLinks()
      })
  }

  const [cleaningUp, setCleaningUp] = useState(false)
  const [forceProjectModal, setForceProjectModal] = useState(0)

  function handleCleanup() {
    if (!confirm(
      'Full cleanup — stop the entire topology?\n\n' +
      '• Stop & remove all VMs and containers\n' +
      '• Remove bridges, VLANs, Docker networks\n' +
      '• Clean temp files\n\n' +
      'The project will be deactivated.'
    )) return
    setCleaningUp(true)
    apiFetch('/api/cleanup', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.errors?.length) {
          console.warn('Cleanup errors:', data.errors)
        }
        // Refresh all data — projects.data.active will become ""
        // which triggers ProjectManager auto-open
        refreshAll()
      })
      .catch(err => console.error('Cleanup failed:', err))
      .finally(() => setCleaningUp(false))
  }

  return (
    <div style={{
      display: 'flex', height: '100vh',
      fontFamily: 'var(--font-sans)',
      background: 'var(--base)',
      color: 'var(--text)',
    }}>
      {/* ── Left navigation rail ─────────────────────────────────── */}
      <nav style={{
        width: 56, minWidth: 56,
        background: 'var(--crust)',
        borderRight: '1px solid var(--surface0)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', paddingTop: 8,
        gap: 2,
      }}>
        {/* Logo — click to go to Topology */}
        <button
          onClick={() => setView('topology')}
          title="triv — go to Topology"
          style={{
            width: 36, height: 36, borderRadius: 8, border: 'none',
            padding: 0, cursor: 'pointer', marginBottom: 12,
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src="/favicon.svg" alt="triv" width={32} height={32} style={{ borderRadius: 6 }} />
        </button>

        {NAV_ITEMS.map(item => {
          const active = view === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={item.label}
              style={{
                width: 40, height: 40, borderRadius: 8,
                border: 'none', cursor: 'pointer',
                background: active ? 'var(--surface0)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--overlay1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={18} />
            </button>
          )
        })}

        {/* GitHub */}
        <a
          href="https://github.com/devfilipe/triv"
          target="_blank"
          rel="noopener noreferrer"
          title="triv on GitHub"
          style={{
            width: 40, height: 40, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--overlay1)', textDecoration: 'none',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--overlay1)' }}
        >
          <Github size={18} />
        </a>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Wizard trigger */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              if (['builder', 'drivers', 'net-manager', 'nodes', 'topology'].includes(view)) {
                setWizardOpen(v => !v)
              } else {
                setView('wizard')
              }
            }}
            title={wizardEnabled ? 'Open Wizard' : 'Wizard (disabled — configure in Apps → Wizard)'}
            style={{
              width: 40, height: 40, borderRadius: 8,
              border: wizardOpen ? '1px solid #cba6f7' : '1px solid var(--surface1)',
              cursor: 'pointer',
              background: wizardOpen ? 'color-mix(in srgb, #cba6f7 20%, var(--surface0))' : 'transparent',
              color: wizardOpen ? '#cba6f7' : wizardEnabled ? '#cba6f7' : 'var(--overlay0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s ease',
              opacity: wizardEnabled ? 1 : 0.4,
            }}
          >
            <Wand2 size={17} />
          </button>
          {wizardBusy && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              width: 7, height: 7, borderRadius: '50%',
              background: '#a6e3a1',
              animation: 'wizardPulse 1.2s ease-in-out infinite',
              pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Org indicator / switcher */}
        <button
          onClick={() => setShowOrgSelector(true)}
          title={orgs.data.active_org ? `Org: ${orgs.data.orgs.find(o => o.id === orgs.data.active_org)?.name ?? orgs.data.active_org}` : 'Select Organization'}
          style={{
            width: 40, height: 40, borderRadius: 8,
            border: orgs.data.active_org ? '1px solid var(--surface1)' : '1px solid #f38ba830',
            cursor: 'pointer',
            background: 'transparent',
            color: orgs.data.active_org ? 'var(--overlay1)' : '#f38ba8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          <Building2 size={17} />
        </button>

        {/* Project manager */}
        <ProjectManager
          projects={projects.data.projects}
          activeId={projects.data.active}
          lastActiveId={projects.data.last_active}
          onActivate={projects.activate}
          onAdd={projects.addProject}
          onCreate={projects.createProject}
          onRemove={projects.removeProject}
          onCleanup={projects.cleanupProject}
          onScan={projects.scanDir}
          onBrowse={projects.browseDir}
          onGetDefaults={projects.getDefaults}
          onProjectChanged={refreshAll}
          forceOpen={forceProjectModal}
          onEditTopology={async () => {
            try {
              const res = await apiFetch('/api/topology/source')
              const data = await res.json()
              if (data.ok) {
                setJsonEditor({ title: 'Topology', content: data.content, filename: data.filename })
              }
            } catch {}
          }}
        />

        {/* Cleanup — only visible when a project is active */}
        {projects.data.active && (
        <button
          onClick={() => handleCleanup()}
          disabled={cleaningUp}
          title="Full cleanup — stop topology and deactivate project"
          style={{
            width: 40, height: 40, borderRadius: 8,
            border: 'none', cursor: cleaningUp ? 'wait' : 'pointer',
            background: cleaningUp ? 'var(--surface0)' : 'transparent',
            color: cleaningUp ? '#f9e2af' : 'var(--overlay1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 8,
            animation: cleaningUp ? 'pulse 1s infinite' : 'none',
          }}
        >
          <Trash2 size={16} />
        </button>
        )}

        {/* User avatar + logout */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <button
            onClick={() => setUserMenuOpen(v => !v)}
            title={user?.username ?? 'User'}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '1px solid var(--surface1)',
              cursor: 'pointer',
              background: userMenuOpen ? 'var(--surface1)' : 'var(--surface0)',
              color: '#cba6f7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700,
              transition: 'all 0.15s ease',
            }}
          >
            {(user?.username?.[0] ?? '?').toUpperCase()}
          </button>

          {userMenuOpen && (
            <>
              {/* Backdrop */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                onClick={() => setUserMenuOpen(false)}
              />
              {/* Dropdown */}
              <div style={{
                position: 'absolute', left: 44, bottom: 0, zIndex: 100,
                background: 'var(--mantle)',
                border: '1px solid var(--surface1)',
                borderRadius: 8,
                padding: '6px 0',
                minWidth: 160,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                <div style={{
                  padding: '6px 14px 8px',
                  color: 'var(--subtext0)', fontSize: 11,
                  borderBottom: '1px solid var(--surface0)',
                  marginBottom: 4,
                }}>
                  <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>
                    {user?.username}
                  </div>
                  <div style={{ textTransform: 'capitalize' }}>{user?.role}</div>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); logout() }}
                  style={{
                    width: '100%', padding: '7px 14px',
                    background: 'none', border: 'none',
                    color: '#f38ba8', fontSize: 13,
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface0)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* ── Main content area ────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!projects.data.active ? (
          /* ── No project active — full empty state ──────────────── */
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16,
            background: 'var(--base)',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'var(--surface0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FolderOpen size={28} color="var(--overlay1)" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                No project active
              </div>
              <div style={{ fontSize: 13, color: 'var(--subtext0)', maxWidth: 340, lineHeight: 1.5 }}>
                Select a project from the project manager to start visualizing and managing your topology.
              </div>
            </div>
            <button
              onClick={() => {
                // Trigger the ProjectManager modal — we find the ref by dispatching a custom event
                // Simpler: just use a state variable. But the ProjectManager is a child that owns
                // its own modal state. Workaround: set a flag that auto-opens it.
                setForceProjectModal(v => v + 1)
              }}
              style={{
                marginTop: 8, padding: '10px 24px', borderRadius: 8,
                border: 'none', cursor: 'pointer',
                background: 'var(--mauve)', color: 'var(--crust)',
                fontSize: 14, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <FolderOpen size={16} />
              Open Project Manager
            </button>
          </div>
        ) : (
        <>
        {/* Content view */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {view === 'topology' && (
            <TopologyCanvas
              nodes={nodes}
              links={links}
              selectedId={selectedId}
              onSelect={setSelectedId}
              collapsedParents={collapsedParents}
              onToggleCollapse={toggleCollapse}
              discoveredLinks={discovered.data.edges}
              discoveredHubs={discovered.data.nodes}
              networkDefs={topology?.network_defs ?? EMPTY_NETWORK_DEFS}
              networkStatuses={topology?.network_statuses ?? EMPTY_NETWORK_STATUSES}
            />
          )}
          {view === 'apps' && (
            <AppsLauncher onNavigate={(v: View) => setView(v)} />
          )}
          {view === 'builder' && (
            <BuilderCanvas
              nodes={nodes}
              links={links}
              onMutate={handleTopologyMutate}
              networkDefs={topology?.network_defs ?? EMPTY_NETWORK_DEFS}
              networkStatuses={topology?.network_statuses ?? EMPTY_NETWORK_STATUSES}
              catalog={networkCatalog.data}
              onRefreshNetworks={() => { networkDefs.refresh(); networkCatalog.refresh(); refreshTopology() }}
            />
          )}
          {view === 'nodes' && (
            <NodesView
              nodes={nodes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onConsole={name => setTerminalTarget({ type: 'console', target: name })}
              onOpenTerminal={t => setTerminalTarget(t)}
              onOpenWebPanel={(title, url) => setWebPanel({ title, url })}
              onShowOutput={(title, output, live) => setOutputPanel({ title, output, live })}
              onAppendOutput={appendOutput}
              onSetOutputLive={setOutputLive}
              onOpenChat={(nodeId, title) => setChatPanel({ nodeId, title })}
              onOpenTask={(nodeId, title) => setTaskPanel({ nodeId, title })}
              onRefresh={refreshNodes}
            />
          )}
          {view === 'editor' && (
            <TopologyEditor
              nodes={nodes}
              links={links}
              drivers={drivers.map(d => d.name)}
              onMutate={handleTopologyMutate}
            />
          )}
          {view === 'adhoc' && (
            <AdhocDevicesPanel
              onOpenTerminal={t => setTerminalTarget(t)}
            />
          )}
          {view === 'net-manager' && <NetworkManager networks={networkDefs.data} templates={networkTemplates.data} refresh={networkDefs.refresh} refreshCatalog={networkCatalog.refresh} />}
          {view === 'drivers' && <NodeDrivers onRefresh={refreshDrivers} onNavigate={(v: string) => setView(v as View)} />}
          {view === 'status' && <StatusPanel status={status} bridges={bridges} />}
          {view === 'connectivity' && <ConnectivityPanel data={connectivity.data} loading={connectivity.loading} onRefresh={connectivity.refresh} />}
          {view === 'net-stats' && <NetStats />}
          {view === 'ai' && <AiCentral />}
          {view === 'wizard' && <WizardConfig />}
        </div>

        {/* ── Right sidebar (detail / device cards) ───────────────── */}
        <div style={{
          width: sidebarOpen ? 320 : 0,
          minWidth: sidebarOpen ? 320 : 0,
          transition: 'width 0.2s ease, min-width 0.2s ease',
          overflow: 'hidden',
          borderLeft: '1px solid var(--surface0)',
          background: 'var(--base)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Sidebar header */}
          <div style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--surface0)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {/* Active project label */}
            {projects.data.active && (
              <div style={{
                fontSize: 10, color: 'var(--mauve)', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 4,
                letterSpacing: '0.3px',
              }}>
                <FolderOpen size={10} />
                {projects.data.projects.find(p => p.id === projects.data.active)?.name ?? projects.data.active}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={14} color="var(--mauve)" />
              <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Devices</span>
              <span style={{
                fontSize: 10, color: 'var(--subtext0)',
                padding: '2px 6px', borderRadius: 10,
                background: 'var(--surface0)',
              }}>
                {nodes.length}
              </span>
              <button
                onClick={handleTopologyMutate}
                title="Reload topology from disk"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--overlay1)', padding: 2, borderRadius: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {/* Topology-level actions bar */}
            {topoActions.actions.length > 0 && (
              <TopologyActionsBar
                actions={topoActions.actions}
                onExecute={topoActions.executeAction}
                onDiscover={discovered.discover}
                onClearDiscovered={discovered.clear}
              />
            )}
          </div>

          {/* Device cards list — tree layout */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
            {rootNodes.map(node => {
              const children = childrenByParent[node.id] ?? []
              const hasChildren = children.length > 0
              const isCollapsed = collapsedParents.has(node.id)
              return (
                <React.Fragment key={node.id}>
                  <DeviceCard
                    node={node}
                    selected={selectedId === node.id}
                    onSelect={() => setSelectedId(node.id)}
                    onConsole={() => setTerminalTarget({ type: 'console', target: node.vm_name ?? node.id })}
                    onOpenTerminal={t => setTerminalTarget(t)}
                    onOpenWebPanel={(title, url) => setWebPanel({ title, url })}
                    onShowOutput={(title, output, live) => setOutputPanel({ title, output, live })}
                    onAppendOutput={appendOutput}
                    onSetOutputLive={setOutputLive}
                    onOpenChat={(nodeId, title) => setChatPanel({ nodeId, title })}
                    onOpenTask={(nodeId, title) => setTaskPanel({ nodeId, title })}
                    onRefresh={refreshNodes}
                    hasChildren={hasChildren}

                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => toggleCollapse(node.id)}
                  />
                  {!isCollapsed && children.map(child => (
                    <DeviceCard
                      key={child.id}
                      node={child}
                      selected={selectedId === child.id}
                      onSelect={() => setSelectedId(child.id)}
                      onConsole={() => setTerminalTarget({ type: 'console', target: child.vm_name ?? child.id })}
                      onOpenTerminal={t => setTerminalTarget(t)}
                      onOpenWebPanel={(title, url) => setWebPanel({ title, url })}
                      onShowOutput={(title, output, live) => setOutputPanel({ title, output, live })}
                      onAppendOutput={appendOutput}
                      onSetOutputLive={setOutputLive}
                      onOpenChat={(nodeId, title) => setChatPanel({ nodeId, title })}
                      onOpenTask={(nodeId, title) => setTaskPanel({ nodeId, title })}
                      onRefresh={refreshNodes}
                      indent
                    />
                  ))}
                </React.Fragment>
              )
            })}
            {nodes.length === 0 && (
              <div style={{
                padding: 20, textAlign: 'center',
                color: 'var(--subtext0)', fontSize: 12,
              }}>
                No nodes found. Load a topology.
              </div>
            )}
          </div>
        </div>


        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            position: 'absolute', right: sidebarOpen ? 320 : 0, top: '50%',
            transform: 'translateY(-50%)',
            width: 20, height: 48, borderRadius: '4px 0 0 4px',
            background: 'var(--surface0)', border: '1px solid var(--surface1)',
            borderRight: 'none', cursor: 'pointer',
            color: 'var(--overlay1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, transition: 'right 0.2s ease',
          }}
        >
          {sidebarOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
        </>
        )}
      </div>

      {/* ── Floating terminal ─────────────────────────────────────── */}
      {terminalTarget && (
        <FloatingTerminal
          key={`${terminalTarget.type}-${terminalTarget.target}`}
          type={terminalTarget.type}
          target={terminalTarget.target}
          user={terminalTarget.user}
          port={terminalTarget.port}
          password={terminalTarget.password}
          onClose={() => setTerminalTarget(null)}
        />
      )}

      {/* ── Floating web panel ────────────────────────────────────── */}
      {webPanel && (
        <FloatingWebPanel
          key={`${webPanel.title}-${webPanel.url}`}
          title={webPanel.title}
          url={webPanel.url}
          onClose={() => setWebPanel(null)}
        />
      )}

      {/* ── Floating output panel (exec-output results) ───────────── */}
      {outputPanel && (
        <FloatingOutputPanel
          key={`${outputPanel.title}`}
          title={outputPanel.title}
          output={outputPanel.output}
          live={outputPanel.live}
          minimized={outputPanel.minimized}
          onMinimize={() => setOutputPanel(p => p ? { ...p, minimized: !p.minimized } : null)}
          onClose={() => setOutputPanel(null)}
        />
      )}

      {/* ── Floating interactive chat panel (LLM nodes) ───────────── */}
      {chatPanel && (
        <FloatingChatPanel
          key={chatPanel.nodeId}
          nodeId={chatPanel.nodeId}
          title={chatPanel.title}
          onClose={() => setChatPanel(null)}
        />
      )}

      {/* ── Floating task panel (Agent nodes) ────────────────────── */}
      {taskPanel && (
        <FloatingTaskPanel
          key={taskPanel.nodeId}
          nodeId={taskPanel.nodeId}
          title={taskPanel.title}
          onClose={() => setTaskPanel(null)}
        />
      )}

      {/* ── Floating Wizard panel ─────────────────────────────────── */}
      {wizardOpen && (
        <FloatingWizardPanel
          context={
            view === 'builder' || view === 'topology' || view === 'nodes'
              ? JSON.stringify(topology ?? {})
              : view === 'net-manager'
              ? JSON.stringify({ network_defs: topology?.network_defs ?? [] })
              : view === 'drivers'
              ? JSON.stringify({ drivers: drivers.map(d => ({ name: d.name, label: d.label, vendor: d.vendor })) })
              : JSON.stringify(topology ?? {})
          }
          contextLabel={
            view === 'builder'     ? 'Builder'
            : view === 'topology'  ? 'Topology'
            : view === 'nodes'     ? 'Nodes'
            : view === 'net-manager' ? 'Network Manager'
            : view === 'drivers'   ? 'Drivers'
            : 'Topology'
          }
          onClose={() => setWizardOpen(false)}
          onOpenConfig={() => { setWizardOpen(false); setView('wizard') }}
          onBusyChange={setWizardBusy}
        />
      )}

      {/* ── Floating JSON editor (topology source) ───────────────── */}
      {jsonEditor && (
        <FloatingJsonEditor
          title={jsonEditor.title}
          content={jsonEditor.content}
          filename={jsonEditor.filename}
          onSave={async (content) => {
            const res = await apiFetch('/api/topology/source', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            })
            return res.json()
          }}
          onClose={() => setJsonEditor(null)}
          onReload={refreshAll}
        />
      )}

      {/* ── Org selector overlay ──────────────────────────────────── */}
      {showOrgSelector && (
        <OrgSelector
          orgs={orgs.data.orgs}
          activeOrgId={orgs.data.active_org}
          onActivate={async (id) => {
            await orgs.activate(id)
            projects.refresh()
            setShowOrgSelector(false)
          }}
          onCreate={orgs.createOrg}
          onSkip={() => setShowOrgSelector(false)}
        />
      )}

      <style>{`@keyframes wizardPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }`}</style>
    </div>
  )
}

/* ── Nodes grid view ─────────────────────────────────────────────── */
function NodesView({ nodes, selectedId, onSelect, onConsole, onOpenTerminal, onOpenWebPanel, onShowOutput, onAppendOutput, onSetOutputLive, onOpenChat, onOpenTask, onRefresh }: {
  nodes: NodeDef[]; selectedId: string | null
  onSelect: (id: string) => void; onConsole: (name: string) => void
  onOpenTerminal: (t: { type: 'console' | 'ssh'; target: string; user?: string; port?: number; password?: string }) => void
  onOpenWebPanel: (title: string, url: string) => void
  onShowOutput: (title: string, output: string, live?: boolean) => void
  onAppendOutput: (text: string) => void
  onSetOutputLive: (live: boolean) => void
  onOpenChat: (nodeId: string, title: string) => void
  onOpenTask: (nodeId: string, title: string) => void
  onRefresh: () => void
}) {
  // Group by category
  const grouped = nodes.reduce<Record<string, NodeDef[]>>((acc, n) => {
    const cat = n.category ?? 'generic'
    ;(acc[cat] ??= []).push(n)
    return acc
  }, {})

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      <h2 style={{
        fontSize: 16, fontWeight: 700, color: 'var(--text)',
        margin: '0 0 16px 0',
      }}>
        All Nodes
      </h2>
      {Object.entries(grouped).map(([cat, catNodes]) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--subtext0)',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            marginBottom: 8, paddingLeft: 4,
          }}>
            {cat} ({catNodes.length})
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 8,
          }}>
            {catNodes.map(node => (
              <DeviceCard
                key={node.id}
                node={node}
                selected={selectedId === node.id}
                onSelect={() => onSelect(node.id)}
                onConsole={() => onConsole(node.vm_name ?? node.id)}
                onOpenTerminal={onOpenTerminal}
                onOpenWebPanel={onOpenWebPanel}
                onShowOutput={onShowOutput}
                onAppendOutput={onAppendOutput}
                onSetOutputLive={onSetOutputLive}
                onOpenChat={onOpenChat}
                onOpenTask={onOpenTask}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Topology-level actions bar ──────────────────────────────────── */
const TOPO_ACTION_ICON_MAP: Record<string, React.FC<any>> = {
  play: Play, square: Square, 'refresh-cw': RefreshCw, upload: Upload,
  settings: Settings, hammer: Hammer, trash: AlertCircle, zap: Activity,
  'check-circle': CheckCircle, activity: Activity, layers: Layers, folder: Folder,
}

function TopologyActionsBar({ actions, onExecute, onDiscover, onClearDiscovered }: {
  actions: ActionDef[]
  onExecute: (id: string) => Promise<any>
  onDiscover?: () => Promise<{ nodes: any[]; edges: any[] }>
  onClearDiscovered?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  async function run(action: ActionDef) {
    if (action.confirm && !window.confirm(action.confirm)) return
    setBusy(action.id)
    setLastResult(null)
    try {
      // discover-networks: fetch live data and overlay on canvas
      if (action.id === 'discover-networks' && onDiscover) {
        const result = await onDiscover()
        const total = (result.nodes?.length ?? 0) + (result.edges?.length ?? 0)
        setLastResult(total > 0
          ? `✓ Found ${result.edges?.length ?? 0} link(s), ${result.nodes?.length ?? 0} hub(s)`
          : '✓ No new networks discovered')
        setTimeout(() => setLastResult(null), 5000)
        return
      }
      const res = await onExecute(action.id)
      if (!res.ok && res.error) {
        setLastResult(`✗ ${res.error}`)
      } else if (res.stderr && !res.ok) {
        setLastResult(`✗ ${res.stderr.trim().slice(0, 120)}`)
      } else {
        setLastResult(`✓ ${action.label}`)
      }
      setTimeout(() => setLastResult(null), 4000)
    } catch (e: any) {
      setLastResult(`✗ ${e.message}`)
      setTimeout(() => setLastResult(null), 4000)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 600, color: 'var(--subtext0)',
        textTransform: 'uppercase', letterSpacing: '0.4px',
        marginBottom: 4,
      }}>
        Project Actions
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {actions.map(action => {
          const Icon = TOPO_ACTION_ICON_MAP[action.icon ?? 'zap'] ?? Activity
          const isRunning = busy === action.id
          return (
            <button
              key={action.id}
              onClick={() => run(action)}
              disabled={!!busy}
              title={action.label}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', fontSize: 10, borderRadius: 4,
                background: isRunning ? 'var(--mauve)20' : 'var(--surface0)',
                color: isRunning ? 'var(--mauve)' : 'var(--subtext1)',
                border: '1px solid var(--surface1)',
                cursor: busy ? 'wait' : 'pointer', fontWeight: 500,
                opacity: busy && !isRunning ? 0.5 : 1,
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={10} />
              {action.label}
            </button>
          )
        })}
      </div>
      {lastResult && (
        <div style={{
          marginTop: 4, fontSize: 9, display: 'flex', alignItems: 'center', gap: 6,
          color: lastResult.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          fontFamily: 'var(--font-mono)',
        }}>
          <span>{lastResult}</span>
          {!lastResult.startsWith('✗') && onClearDiscovered && (
            <button
              onClick={onClearDiscovered}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 9, color: 'var(--overlay0)', padding: 0,
              }}
            >
              [clear]
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Apps launcher (grid of app icons) ────────────────────────────── */
function AppsLauncher({ onNavigate }: { onNavigate: (v: View) => void }) {
  const CATEGORY_ORDER = ['Editor', 'AI', 'Network', 'Nodes', 'System']
  const allCategories = [...new Set(APP_ENTRIES.map(e => e.category))]
  const categories = [
    ...CATEGORY_ORDER.filter(c => allCategories.includes(c)),
    ...allCategories.filter(c => !CATEGORY_ORDER.includes(c)),
  ]
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div style={{ padding: '32px 40px', overflowY: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{
          fontSize: 22, fontWeight: 700, color: 'var(--text)',
          margin: '0 0 4px 0',
        }}>
          Apps
        </h2>
        <p style={{ fontSize: 13, color: 'var(--subtext0)', margin: '0 0 28px 0' }}>
          Tools and panels for managing your topology environment.
        </p>

        {categories.map(cat => {
          const entries = APP_ENTRIES.filter(e => e.category === cat)
          return (
            <div key={cat} style={{ marginBottom: 28 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--subtext0)',
                textTransform: 'uppercase', letterSpacing: '0.6px',
                marginBottom: 12, paddingLeft: 2,
              }}>
                {cat}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
              }}>
                {entries.map(app => {
                  const Icon = app.icon
                  const disabled = !!app.disabled
                  const isHovered = hovered === app.id && !disabled
                  return (
                    <button
                      key={app.id}
                      onClick={() => !disabled && onNavigate(app.id)}
                      onMouseEnter={() => setHovered(app.id)}
                      onMouseLeave={() => setHovered(null)}
                      style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 10,
                        padding: '20px 16px 16px',
                        borderRadius: 14,
                        background: isHovered ? 'var(--surface0)' : 'var(--mantle)',
                        border: `1px solid ${isHovered ? 'var(--surface1)' : 'transparent'}`,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.4 : 1,
                        transition: 'all 0.2s ease',
                        transform: isHovered ? 'translateY(-2px)' : 'none',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: `${app.color}15`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        boxShadow: isHovered ? `0 4px 16px ${app.color}20` : 'none',
                      }}>
                        <Icon size={24} color={app.color} />
                      </div>
                      <div>
                        <div style={{
                          fontSize: 13, fontWeight: 600,
                          color: 'var(--text)', marginBottom: 3,
                        }}>
                          {app.label}
                        </div>
                        <div style={{
                          fontSize: 10, color: 'var(--subtext0)',
                          lineHeight: 1.4,
                        }}>
                          {app.description}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
