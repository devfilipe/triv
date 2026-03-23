/* triv WebUI — TopologyCanvas: React Flow powered multi-vendor topology
   with edge tooltips, medium-based styling, and link visibility filter. */

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node as RFNode, type Edge as RFEdge,
  type NodeChange, type EdgeMouseHandler,
  applyNodeChanges,
  MarkerType,
  Panel,
  BaseEdge, getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Server, HardDrive, Cpu, CircuitBoard, Network, Globe,
  ArrowLeftRight, Monitor, Radio, Box, Maximize2, Minimize2,
  RotateCcw, Eye, EyeOff, Cable, Wifi, GitBranch, Layers,
  ChevronRight, GripVertical, Folder, Cloud, Focus, Link2,
} from 'lucide-react'
import type { NodeDef, LinkDef, NetworkDefDef } from './types'
import { CATEGORY_META, STATE_COLOR, RUNTIME_BADGE } from './types'
import NetworkNode from './NetworkNode'

const networkNodeTypes = { networkNode: NetworkNode }

const ICON_MAP: Record<string, React.FC<any>> = {
  Server, HardDrive, Cpu, CircuitBoard, Network, Globe,
  ArrowLeftRight, Monitor, Radio, Box, Layers, Folder,
}

const NET_TYPE_COLOR: Record<string, string> = {
  bridge:        '#89b4fa',
  docker:        '#94e2d5',
  trunk:         '#cba6f7',
  'vlan-bridge': '#fab387',
  p2p:           '#a6e3a1',
}

/* ── DraggablePanel: floating, repositionable filter panel ────────── */

/* Shared filter-panel style helpers */
function showHideBtnStyle(color: string): React.CSSProperties {
  return {
    flex: 1, padding: '2px 0', borderRadius: 3,
    border: 'none', cursor: 'pointer', fontSize: 9,
    background: 'transparent', color, fontWeight: 600,
  }
}

function filterRowStyle(visible: boolean, color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${visible ? color + '35' : 'var(--surface1)'}`,
    background: visible ? `${color}12` : 'transparent',
    color: visible ? color : 'var(--overlay0)',
    fontWeight: 500, fontSize: 10,
    transition: 'all 0.15s ease',
    opacity: visible ? 1 : 0.45,
    width: '100%', textAlign: 'left',
  }
}

function filterBadgeStyle(visible: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 8, padding: '0 4px',
    borderRadius: 6, background: visible ? `${color}20` : 'var(--surface1)',
  }
}

function DraggablePanel({
  defaultX, defaultY, children,
}: {
  defaultX: number; defaultY: number
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: defaultX, y: defaultY })
  const dragging = useRef(false)
  const offset = useRef({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the grip handle (data-drag="true")
    const target = e.target as HTMLElement
    if (!target.closest('[data-drag="true"]')) return
    e.preventDefault()
    dragging.current = true
    const rect = panelRef.current!.getBoundingClientRect()
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const parent = panelRef.current!.parentElement!
      const pr = parent.getBoundingClientRect()
      const nx = Math.max(0, Math.min(ev.clientX - pr.left - offset.current.x, pr.width - 60))
      const ny = Math.max(0, Math.min(ev.clientY - pr.top - offset.current.y, pr.height - 40))
      setPos({ x: nx, y: ny })
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div
      ref={panelRef}
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute', left: pos.x, top: pos.y,
        zIndex: 5, minWidth: 130,
      }}
    >
      {children}
    </div>
  )
}

interface Props {
  nodes: NodeDef[]
  links: LinkDef[]
  selectedId: string | null
  onSelect: (id: string) => void
  collapsedParents?: Set<string>
  onToggleCollapse?: (id: string) => void
  discoveredLinks?: LinkDef[]
  discoveredHubs?: NodeDef[]
  networkDefs?: NetworkDefDef[]
  networkStatuses?: Record<string, any>
}

/* ── Medium group helpers ─────────────────────────────────────────── */
type MediumGroup = 'physical' | 'wireless' | 'logical'

function inferMediumGroup(link: LinkDef): MediumGroup {
  if (link.medium_group) return link.medium_group
  const med = link.medium ?? ''
  if (['wifi', 'bluetooth', 'zigbee', 'lorawan'].includes(med)) return 'wireless'
  if (['logical'].includes(med) || link.type === 'logical' || link.type === 'backplane') return 'logical'
  return 'physical'
}

const MEDIUM_GROUP_META: Record<MediumGroup, { label: string; icon: React.FC<any>; color: string }> = {
  physical: { label: 'Physical', icon: Cable, color: '#89b4fa' },
  wireless: { label: 'Wireless', icon: Wifi, color: '#f5c2e7' },
  logical:  { label: 'Logical',  icon: GitBranch, color: '#6c7086' },
}

/* ── Auto-layout ─────────────────────────────────────────────────── */
function layoutNodes(nodes: NodeDef[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const ids = new Set(nodes.map(n => n.id))
  const roots = nodes.filter(n => !n.parent || !ids.has(n.parent))
  const children = nodes.filter(n => n.parent && ids.has(n.parent))

  const COL_GAP = 280, ROW_GAP = 160
  const COLS = Math.max(1, Math.ceil(Math.sqrt(roots.length)))

  roots.forEach((node, i) => {
    positions.set(node.id, {
      x: (i % COLS) * COL_GAP + 40,
      y: Math.floor(i / COLS) * ROW_GAP + 40,
    })
  })

  const parentCount: Record<string, number> = {}
  children.forEach(child => {
    if (!child.parent) return
    const c = parentCount[child.parent] ?? 0
    const pp = positions.get(child.parent) ?? { x: 40, y: 40 }
    positions.set(child.id, {
      x: pp.x + (c % 3) * 240,
      y: pp.y + Math.floor(c / 3) * 140 + 100,
    })
    parentCount[child.parent] = c + 1
  })

  let fx = 40
  nodes.forEach(n => {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: fx, y: 500 })
      fx += 240
    }
  })

  return positions
}

/* ── Node label renderer ─────────────────────────────────────────── */
function renderNodeLabel(
  node: NodeDef,
  hasChildren: boolean,
  isCollapsed: boolean,
  onToggle: (() => void) | null,
) {
  const meta = CATEGORY_META[node.category] ?? CATEGORY_META.generic
  const Icon = ICON_MAP[meta.icon] ?? Box
  const stateColor = STATE_COLOR[node.state ?? 'undefined'] ?? '#585b70'
  const accent = node.driver_meta?.accent_color ?? meta.color
  const runtime = node.runtime ? RUNTIME_BADGE[node.runtime] : null

  return (
    <div style={{
      padding: '8px 12px', minWidth: 150, textAlign: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: `${accent}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} color={accent} />
        </div>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: stateColor,
          boxShadow: node.state === 'running' ? `0 0 6px ${stateColor}` : 'none',
        }} />
      </div>
      <div style={{
        fontWeight: 600, fontSize: 12, color: 'var(--text)',
        marginTop: 4, lineHeight: 1.2,
      }}>
        {node.label ?? node.vm_name ?? node.id}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 4, marginTop: 3, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 9, color: 'var(--subtext0)',
          textTransform: 'uppercase', letterSpacing: '0.3px',
        }}>
          {meta.label}
        </span>
        {runtime && (
          <span style={{
            fontSize: 8, padding: '1px 4px', borderRadius: 3,
            background: runtime.bg, color: runtime.color, fontWeight: 500,
          }}>
            {runtime.label}
          </span>
        )}
      </div>
      {node.driver_meta && (
        <div style={{ fontSize: 8, marginTop: 2, color: accent, fontWeight: 500, opacity: 0.8 }}>
          {node.driver_meta.vendor}
        </div>
      )}
      {node.interfaces && node.interfaces.length > 0 && (
        <div style={{ fontSize: 8, color: 'var(--overlay1)', marginTop: 2 }}>
          {node.interfaces.length} iface{node.interfaces.length > 1 ? 's' : ''}
        </div>
      )}
      {/* Collapse / expand toggle — only for parent nodes */}
      {hasChildren && onToggle && (
        <button
          onMouseDown={e => { e.stopPropagation() }}
          onClick={e => { e.stopPropagation(); onToggle() }}
          title={isCollapsed ? 'Show children' : 'Hide children'}
          style={{
            marginTop: 6,
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600,
            cursor: 'pointer', border: `1px solid ${accent}30`,
            background: isCollapsed ? `${accent}25` : `${accent}10`,
            color: isCollapsed ? accent : 'var(--subtext0)',
            transition: 'all 0.15s ease',
          }}
        >
          <ChevronRight
            size={10}
            style={{
              transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: 'transform 0.15s ease',
            }}
          />
          {isCollapsed ? 'Show' : 'Hide'}
        </button>
      )}
    </div>
  )
}

/* ── Edge colour / style by type and medium ──────────────────────── */
function edgeColor(link: LinkDef): string {
  switch (link.type) {
    case 'cascade':    return '#89b4fa'
    case 'management': return '#f9e2af'
    case 'backplane':  return '#cba6f7'
    case 'logical':    return '#585b70'
    case 'wireless':   return '#f5c2e7'
    case 'fiber':      return '#94e2d5'
    default:           return '#6c7086'
  }
}

function edgeStrokeDasharray(link: LinkDef): string | undefined {
  const group = inferMediumGroup(link)
  if (group === 'wireless') return '6 4'
  if (group === 'logical') return '3 3'
  return undefined  // solid for physical
}

function edgeStrokeWidth(link: LinkDef): number {
  if (link.type === 'cascade') return 2
  if (link.type === 'management') return 1.8
  return 1.5
}

/* ── Node style helper ────────────────────────────────────────────── */
function nodeStyle(node: NodeDef, selectedId: string | null): React.CSSProperties {
  const meta = CATEGORY_META[node.category] ?? CATEGORY_META.generic
  const accent = node.driver_meta?.accent_color ?? meta.color
  const stateColor = STATE_COLOR[node.state ?? 'undefined'] ?? '#585b70'
  const isSel = selectedId === node.id
  const isLogical = !node.runtime

  return {
    border: isSel ? `2px solid ${accent}` : `1px solid ${stateColor}40`,
    borderRadius: 10,
    background: isLogical ? 'var(--surface0)' : 'var(--mantle)',
    boxShadow: isSel ? `0 0 12px ${accent}40` : '0 2px 8px rgba(0,0,0,0.2)',
    cursor: 'grab',
    opacity: isLogical ? 0.7 : 1,
    padding: 0,
    transition: 'box-shadow 0.2s ease, border 0.2s ease',
  }
}

/* ── Build a ReactFlow node from a NodeDef ────────────────────────── */
function buildRfNode(
  node: NodeDef,
  position: { x: number; y: number },
  selectedId: string | null,
  hasChildren: boolean,
  isCollapsed: boolean,
  onToggle: (() => void) | null,
): RFNode {
  return {
    id: node.id,
    position,
    data: { label: renderNodeLabel(node, hasChildren, isCollapsed, onToggle) },
    style: nodeStyle(node, selectedId),
    draggable: true,
  }
}

/* ── Position persistence helpers ─────────────────────────────────── */
const STORAGE_PREFIX = 'triv-canvas-positions-'

function loadSavedPositions(topoKey: string): Map<string, { x: number; y: number }> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + topoKey)
    if (!raw) return null
    const obj = JSON.parse(raw) as Record<string, { x: number; y: number }>
    return new Map(Object.entries(obj))
  } catch { return null }
}

function savePositions(topoKey: string, positions: Map<string, { x: number; y: number }>) {
  const obj: Record<string, { x: number; y: number }> = {}
  positions.forEach((v, k) => { obj[k] = v })
  localStorage.setItem(STORAGE_PREFIX + topoKey, JSON.stringify(obj))
}

/* ── Edge tooltip component ───────────────────────────────────────── */
function EdgeTooltip({ link, x, y }: { link: LinkDef; x: number; y: number }) {
  const src = link.source
  const tgt = link.target
  const group = inferMediumGroup(link)
  const groupMeta = MEDIUM_GROUP_META[group]
  const GroupIcon = groupMeta.icon

  return (
    <div style={{
      position: 'fixed', left: x + 12, top: y - 8,
      zIndex: 9999, pointerEvents: 'none',
      background: 'var(--surface0)', border: '1px solid var(--surface1)',
      borderRadius: 8, padding: '10px 14px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      minWidth: 220, maxWidth: 360,
      fontFamily: 'var(--font-sans)', fontSize: 11,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>
          {link.label ?? link.id}
        </span>
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 3,
          background: `${edgeColor(link)}25`, color: edgeColor(link),
          fontWeight: 600, textTransform: 'uppercase',
        }}>{link.type}</span>
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 3,
          background: `${groupMeta.color}20`, color: groupMeta.color,
          fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 2,
        }}>
          <GroupIcon size={8} /> {groupMeta.label}
        </span>
      </div>

      {/* Source endpoint */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
        borderBottom: '1px solid var(--surface1)',
      }}>
        <span style={{
          fontSize: 9, color: 'var(--subtext0)', width: 40, textAlign: 'right',
          fontWeight: 600,
        }}>SRC</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          padding: '1px 5px', borderRadius: 3, background: 'var(--surface1)',
          color: 'var(--text)',
        }}>
          {src.node}
        </span>
        <span style={{ color: 'var(--overlay1)' }}>:</span>
        <span style={{ color: 'var(--blue)', fontWeight: 500 }}>
          {src.interface_label ?? src.interface}
        </span>
        {src.interface_type && (
          <span style={{
            fontSize: 8, padding: '0 4px', borderRadius: 2,
            background: 'var(--surface1)', color: 'var(--subtext0)',
          }}>{src.interface_type}</span>
        )}
        {src.interface_ip && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--green)',
          }}>{src.interface_ip}</span>
        )}
      </div>

      {/* Target endpoint */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
      }}>
        <span style={{
          fontSize: 9, color: 'var(--subtext0)', width: 40, textAlign: 'right',
          fontWeight: 600,
        }}>TGT</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          padding: '1px 5px', borderRadius: 3, background: 'var(--surface1)',
          color: 'var(--text)',
        }}>
          {tgt.node}
        </span>
        <span style={{ color: 'var(--overlay1)' }}>:</span>
        <span style={{ color: 'var(--blue)', fontWeight: 500 }}>
          {tgt.interface_label ?? tgt.interface}
        </span>
        {tgt.interface_type && (
          <span style={{
            fontSize: 8, padding: '0 4px', borderRadius: 2,
            background: 'var(--surface1)', color: 'var(--subtext0)',
          }}>{tgt.interface_type}</span>
        )}
        {tgt.interface_ip && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--green)',
          }}>{tgt.interface_ip}</span>
        )}
      </div>

      {/* Network info */}
      {(link.bridge || link.network?.docker_network) && (
        <div style={{
          marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--surface1)',
          display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 9,
          color: 'var(--subtext0)',
        }}>
          {link.bridge && (
            <span>Bridge: <b style={{ color: 'var(--text)' }}>{link.bridge}</b>
              {link.bridge_state && (
                <span style={{
                  marginLeft: 4, color: link.bridge_state === 'up' ? 'var(--green)' : 'var(--red)',
                }}>({link.bridge_state})</span>
              )}
            </span>
          )}
          {link.network?.docker_network && (
            <span>Docker: <b style={{ color: 'var(--text)' }}>{link.network.docker_network}</b></span>
          )}
          {link.network?.vlan != null && (
            <span>VLAN: <b style={{ color: 'var(--peach)' }}>{link.network.vlan}</b></span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────── */
export default function TopologyCanvas({ nodes: apiNodes, links, selectedId, onSelect, collapsedParents, onToggleCollapse, discoveredLinks = [], discoveredHubs = [], networkDefs = [], networkStatuses = {} }: Props) {
  const [fullscreen, setFullscreen] = useState(false)
  const [rfNodes, setRfNodes] = useState<RFNode[]>([])
  const prevIdsRef = useRef<string>('')

  // Edge hover state
  const [hoveredEdge, setHoveredEdge] = useState<{ link: LinkDef; x: number; y: number } | null>(null)

  // Link visibility filter by medium group (kept for link edges)
  const [visibleGroups, setVisibleGroups] = useState<Record<MediumGroup, boolean>>({
    physical: true, wireless: true, logical: true,
  })

  // Network visibility filter: showLinks + focus per network
  type NetFilter = { showLinks: boolean; focus: boolean }
  const [netFilters, setNetFilters] = useState<Record<string, NetFilter>>({})
  const [showNetFilter, setShowNetFilter] = useState(false)

  // Initialize netFilters when networkDefs change
  useEffect(() => {
    if (!networkDefs || networkDefs.length === 0) return
    setNetFilters(prev => {
      let changed = false
      const next = { ...prev }
      for (const nd of networkDefs) {
        if (!next[nd.network_id]) {
          next[nd.network_id] = { showLinks: true, focus: false }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [networkDefs])

  const toggleNetShowLinks = useCallback((netId: string) => {
    setNetFilters(prev => ({
      ...prev,
      [netId]: { ...prev[netId], showLinks: !prev[netId]?.showLinks },
    }))
  }, [])

  const toggleNetFocus = useCallback((netId: string) => {
    setNetFilters(prev => ({
      ...prev,
      [netId]: { ...prev[netId], focus: !prev[netId]?.focus },
    }))
  }, [])

  const toggleAllNetShowLinks = useCallback((visible: boolean) => {
    setNetFilters(prev => {
      const next: Record<string, NetFilter> = {}
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, showLinks: visible }
      return next
    })
  }, [])

  const clearAllNetFocus = useCallback(() => {
    setNetFilters(prev => {
      const next: Record<string, NetFilter> = {}
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, focus: false }
      return next
    })
  }, [])

  // Compute set of focused network IDs and member node IDs for focus filtering
  const focusedNetIds = useMemo(() => {
    return new Set(
      Object.entries(netFilters)
        .filter(([, f]) => f.focus)
        .map(([id]) => id)
    )
  }, [netFilters])

  const focusMemberNodeIds = useMemo(() => {
    if (focusedNetIds.size === 0) return null // null = no focus active
    const members = new Set<string>()
    for (const node of apiNodes) {
      for (const ifc of (node.interfaces ?? [])) {
        for (const netId of (ifc.networks ?? [])) {
          if (focusedNetIds.has(netId)) {
            members.add(node.id)
          }
        }
      }
    }
    return members
  }, [focusedNetIds, apiNodes])

  const [showLinkFilter, setShowLinkFilter] = useState(false)

  const toggleGroup = useCallback((g: MediumGroup) => {
    setVisibleGroups(prev => ({ ...prev, [g]: !prev[g] }))
  }, [])

  const toggleAllGroups = useCallback((visible: boolean) => {
    setVisibleGroups({ physical: visible, wireless: visible, logical: visible })
  }, [])

  // Device category visibility filter
  const [visibleCategories, setVisibleCategories] = useState<Record<string, boolean>>({})
  const [showCategoryFilter, setShowCategoryFilter] = useState(false)

  // Discover all categories present in the topology.
  // Use a stable string key so categoryCounts reference only changes when
  // categories actually change (not on every 4 s poll with same content).
  const categoryKey = useMemo(
    () => [...new Set(apiNodes.map(n => n.category ?? 'generic'))].sort().join(','),
    [apiNodes],
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const n of apiNodes) {
      const cat = n.category ?? 'generic'
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKey])  // Only recompute when categories actually change

  // Initialize visibleCategories when new categories appear (never reset existing ones).
  useEffect(() => {
    setVisibleCategories(prev => {
      const newCats = Object.keys(categoryCounts).filter(cat => prev[cat] === undefined)
      if (newCats.length === 0) return prev  // stable reference if nothing new
      const next = { ...prev }
      for (const cat of newCats) next[cat] = true
      return next
    })
  }, [categoryCounts])

  const toggleCategory = useCallback((cat: string) => {
    setVisibleCategories(prev => ({ ...prev, [cat]: !prev[cat] }))
  }, [])

  const toggleAllCategories = useCallback((visible: boolean) => {
    setVisibleCategories(prev => {
      const next: Record<string, boolean> = {}
      for (const cat of Object.keys(prev)) next[cat] = visible
      return next
    })
  }, [])

  // Merge discovered hubs into the node list (always visible, no parent)
  const allNodes = useMemo(() => {
    if (discoveredHubs.length === 0) return apiNodes
    const existingIds = new Set(apiNodes.map(n => n.id))
    const newHubs = discoveredHubs.filter(h => !existingIds.has(h.id))
    return [...apiNodes, ...newHubs]
  }, [apiNodes, discoveredHubs])

  // Filter nodes by visible categories, collapsed parents, and network focus
  const filteredNodes = useMemo(() => {
    return allNodes.filter(n => {
      if ((n as any).discovered) return true  // always show discovered hubs
      const cat = n.category ?? 'generic'
      if (visibleCategories[cat] === false) return false
      if (n.parent && collapsedParents?.has(n.parent)) return false
      // If any network has focus, only show member nodes
      if (focusMemberNodeIds && !focusMemberNodeIds.has(n.id)) return false
      return true
    })
  }, [allNodes, visibleCategories, collapsedParents, focusMemberNodeIds])

  const hiddenNodeIds = useMemo(() => {
    const visible = new Set(filteredNodes.map(n => n.id))
    return new Set(allNodes.filter(n => !visible.has(n.id)).map(n => n.id))
  }, [allNodes, filteredNodes])

  // Stable topology key for position persistence
  const topoKey = useMemo(() => {
    const ids = apiNodes.map(n => n.id).sort().join(',')
    return ids.slice(0, 100)
  }, [apiNodes])

  // Set of node IDs that have at least one child in the topology
  const parentIds = useMemo(() => {
    const ids = new Set(allNodes.map(n => n.id))
    const parents = new Set<string>()
    for (const n of allNodes) {
      if (n.parent && ids.has(n.parent)) parents.add(n.parent)
    }
    return parents
  }, [allNodes])

  // Build/update RF nodes when topology structure or node data changes.
  // selectedId is intentionally NOT in the dependency array — selection
  // styling is applied inline without triggering a full position rebuild.
  useEffect(() => {
    const idsKey = filteredNodes.map(n => n.id).sort().join(',')
    const nodeIdsChanged = idsKey !== prevIdsRef.current

    // Guard: never replace a populated canvas with an empty set.
    // A transient empty filteredNodes (e.g. failed poll) must not wipe state.
    if (idsKey === '' && prevIdsRef.current !== '') return

    prevIdsRef.current = idsKey

    const autoPositions = layoutNodes(allNodes) // layout all, so positions are stable
    const saved = loadSavedPositions(topoKey)

    const mkNode = (node: NodeDef, pos: { x: number; y: number }) => {
      const hasChildren = parentIds.has(node.id)
      const isCollapsed = collapsedParents?.has(node.id) ?? false
      const onToggle = hasChildren && onToggleCollapse ? () => onToggleCollapse(node.id) : null
      return buildRfNode(node, pos, selectedId, hasChildren, isCollapsed, onToggle)
    }

    setRfNodes(prev => {
      // Preserve existing network node positions across device-node rebuilds
      const prevNetNodes = prev.filter(n => n.type === 'networkNode')

      let deviceNodes: ReturnType<typeof buildRfNode>[]
      if (nodeIdsChanged || prev.length === 0) {
        deviceNodes = filteredNodes.map(node => {
          const savedPos = saved?.get(node.id)
          const autoPos = autoPositions.get(node.id) ?? { x: 0, y: 0 }
          return mkNode(node, savedPos ?? autoPos)
        })
      } else {
        const posMap = new Map(prev.filter(n => n.type !== 'networkNode').map(n => [n.id, n.position]))
        deviceNodes = filteredNodes.map(node => {
          const pos = posMap.get(node.id) ?? autoPositions.get(node.id) ?? { x: 0, y: 0 }
          return mkNode(node, pos)
        })
      }

      // Compute auto-Y for network nodes (below all device nodes)
      const maxY = deviceNodes.reduce((m, n) => Math.max(m, (n.position?.y ?? 0) + 120), 40)

      // Build network nodes — filter by focus, prefer existing pos
      const filteredNetDefs = (networkDefs ?? []).filter(nd => {
        if (focusedNetIds.size === 0) return true
        return focusedNetIds.has(nd.network_id)
      })
      const netNodes = filteredNetDefs.map((nd, i) => {
        const netId = `net-${nd.network_id || nd.id}`
        const existingPos = prevNetNodes.find(n => n.id === netId)?.position
        const savedPos = saved?.get(netId)
        const storedPos = nd.position && (nd.position.x !== 0 || nd.position.y !== 0) ? nd.position : undefined
        const autoPos = { x: 40 + i * 240, y: maxY + 80 }
        return {
          id: netId,
          type: 'networkNode',
          position: existingPos ?? savedPos ?? storedPos ?? autoPos,
          draggable: true,
          data: { nd, status: networkStatuses[nd.network_id] },
        }
      })

      return [...deviceNodes, ...netNodes]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes, topoKey, collapsedParents, parentIds, networkDefs, networkStatuses, focusedNetIds])

  // Handle drag + selection changes
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes(prev => {
      const next = applyNodeChanges(changes, prev)
      const hasDragStop = changes.some(c => c.type === 'position' && !c.dragging)
      if (hasDragStop) {
        const posMap = new Map<string, { x: number; y: number }>()
        next.forEach(n => posMap.set(n.id, n.position))
        savePositions(topoKey, posMap)
      }
      return next
    })
  }, [topoKey])

  // Reset layout
  const resetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_PREFIX + topoKey)
    const autoPositions = layoutNodes(filteredNodes)
    setRfNodes(prev => prev.map(rfn => {
      const pos = autoPositions.get(rfn.id) ?? { x: 0, y: 0 }
      return { ...rfn, position: pos }
    }))
  }, [filteredNodes, topoKey])

  // Build edges with filtering (medium group + hidden nodes + network membership)
  const { rfEdges, linkIndex } = useMemo(() => {
    const idx = new Map<string, LinkDef>()
    const edges: RFEdge[] = []

    const addLink = (link: LinkDef, isDiscovered: boolean) => {
      idx.set(link.id, link)
      if (!isDiscovered) {
        const group = inferMediumGroup(link)
        if (!visibleGroups[group]) return
      }
      if (hiddenNodeIds.has(link.source.node) || hiddenNodeIds.has(link.target.node)) return

      const color = isDiscovered ? '#f9e2af' : edgeColor(link)
      edges.push({
        id: link.id,
        source: link.source.node,
        target: link.target.node,
        label: link.label ?? link.id,
        labelStyle: {
          fontSize: 9, fontWeight: 500,
          fill: isDiscovered ? '#f9e2af' : 'var(--subtext0)',
          fontFamily: 'var(--font-sans)',
        },
        labelBgStyle: { fill: 'var(--base)', fillOpacity: 0.85 },
        labelBgPadding: [4, 2] as [number, number],
        style: {
          stroke: color,
          strokeWidth: isDiscovered ? 1.5 : edgeStrokeWidth(link),
          strokeDasharray: isDiscovered ? '5 3' : edgeStrokeDasharray(link),
          opacity: isDiscovered ? 0.75 : 1,
        },
        animated: false,
        markerEnd: undefined,
      })
    }

    for (const link of links) addLink(link, false)
    for (const link of discoveredLinks) addLink({ ...link, discovered: true }, true)

    // Network-membership edges: interface.networks[] → network node
    const visibleNodeSet = new Set(filteredNodes.map(n => n.id))
    for (const node of filteredNodes) {
      for (const ifc of (node.interfaces ?? [])) {
        for (const netId of (ifc.networks ?? [])) {
          const filter = netFilters[netId]
          if (!filter?.showLinks) continue
          const nd = (networkDefs ?? []).find(n => n.network_id === netId)
          if (!nd) continue
          // When focus is active for other networks, only show if this net's node is present
          const netNodeId = `net-${netId}`
          // If focus-filtering is active and this network isn't focused, skip unless no focus is set for this net
          if (focusedNetIds.size > 0 && !focusedNetIds.has(netId)) continue
          const color = NET_TYPE_COLOR[nd.type] ?? '#6c7086'
          edges.push({
            id: `net-edge-${node.id}-${ifc.id}-${netId}`,
            source: node.id,
            target: netNodeId,
            label: ifc.label ?? ifc.id,
            labelStyle: { fontSize: 8, fontWeight: 500, fill: color, fontFamily: 'var(--font-sans)' },
            labelBgStyle: { fill: 'var(--base)', fillOpacity: 0.85 },
            labelBgPadding: [3, 1] as [number, number],
            style: { stroke: color, strokeWidth: 1.5, strokeDasharray: '4 3' },
            animated: false,
            markerEnd: undefined,
          })
        }
      }
    }

    return { rfEdges: edges, linkIndex: idx }
  }, [links, discoveredLinks, visibleGroups, hiddenNodeIds, filteredNodes, netFilters, networkDefs, focusedNetIds])

  // Edge hover handlers
  const onEdgeMouseEnter: EdgeMouseHandler = useCallback((event, edge) => {
    const link = linkIndex.get(edge.id)
    if (link) {
      setHoveredEdge({ link, x: event.clientX, y: event.clientY })
    }
  }, [linkIndex])

  const onEdgeMouseMove: EdgeMouseHandler = useCallback((event) => {
    setHoveredEdge(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : null)
  }, [])

  const onEdgeMouseLeave: EdgeMouseHandler = useCallback(() => {
    setHoveredEdge(null)
  }, [])

  const onNodeClick = useCallback((_: any, node: RFNode) => onSelect(node.id), [onSelect])

  // Count links per group for the filter panel
  const groupCounts = useMemo(() => {
    const counts: Record<MediumGroup, number> = { physical: 0, wireless: 0, logical: 0 }
    for (const link of links) {
      counts[inferMediumGroup(link)]++
    }
    return counts
  }, [links])

  const visibleLinkCount = useMemo(() => {
    return Object.entries(groupCounts).reduce((sum, [g, c]) =>
      sum + (visibleGroups[g as MediumGroup] ? c : 0), 0)
  }, [groupCounts, visibleGroups])

  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 8000, background: 'var(--base)' }
    : { height: '100%', width: '100%' }

  return (
    <div style={containerStyle}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseMove={onEdgeMouseMove}
        onEdgeMouseLeave={onEdgeMouseLeave}
        nodeTypes={networkNodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'var(--crust)' }}
      >
        <Background color="var(--surface0)" gap={20} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: 'var(--surface0)', borderRadius: 8,
            border: '1px solid var(--surface1)',
          }}
        />
        <MiniMap
          nodeColor={n => {
            const nd = apiNodes.find(nn => nn.id === n.id)
            return STATE_COLOR[nd?.state ?? 'undefined'] ?? '#585b70'
          }}
          maskColor="rgba(17,17,27,0.7)"
          style={{
            background: 'var(--mantle)', borderRadius: 8,
            border: '1px solid var(--surface1)',
          }}
        />

        {/* Top-right: Reset + Fullscreen */}
        <Panel position="top-right">
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={resetLayout}
              title="Reset node positions to auto-layout"
              style={{
                background: 'var(--surface0)', border: '1px solid var(--surface1)',
                borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                color: 'var(--subtext0)', display: 'flex', alignItems: 'center',
                gap: 4, fontSize: 11,
              }}
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              onClick={() => setFullscreen(f => !f)}
              style={{
                background: 'var(--surface0)', border: '1px solid var(--surface1)',
                borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                color: 'var(--subtext0)', display: 'flex', alignItems: 'center',
                gap: 4, fontSize: 11,
              }}
            >
              {fullscreen
                ? <><Minimize2 size={12} /> Exit</>
                : <><Maximize2 size={12} /> Expand</>}
            </button>
          </div>
        </Panel>

        {/* Bottom-left: Legend */}
        <Panel position="bottom-left">
          <div style={{
            background: 'var(--surface0)', border: '1px solid var(--surface1)',
            borderRadius: 8, padding: '8px 12px',
            display: 'flex', gap: 12, flexWrap: 'wrap',
            fontSize: 9, color: 'var(--subtext0)',
          }}>
            <span><span style={{ color: '#89b4fa' }}>━━</span> cascade</span>
            <span><span style={{ color: '#f9e2af' }}>━━</span> mgmt</span>
            <span><span style={{ color: '#cba6f7' }}>━━</span> backplane</span>
            <span><span style={{ color: '#f5c2e7' }}>╌╌</span> wireless</span>
            <span><span style={{ color: '#585b70' }}>···</span> logical</span>
            {discoveredLinks.length > 0 && (
              <span><span style={{ color: '#f9e2af', opacity: 0.75 }}>╌╌</span> discovered</span>
            )}
            <span>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#a6e3a1' }} /> running
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f38ba8' }} /> off
            </span>
          </div>
        </Panel>
      </ReactFlow>

      {/* ── Floating draggable filter panels ───────────────────── */}

      {/* Networks filter */}
      <DraggablePanel defaultX={10} defaultY={10}>
        <div style={{
          background: 'var(--surface0)', border: '1px solid var(--surface1)',
          borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          minWidth: 180, userSelect: 'none',
        }}>
          {/* Header — draggable handle */}
          <div
            data-drag="true"
            style={{
              padding: '5px 8px',
              borderBottom: showNetFilter ? '1px solid var(--surface1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 4,
              cursor: 'grab', borderRadius: showNetFilter ? '8px 8px 0 0' : 8,
            }}
          >
            <GripVertical size={9} color="var(--overlay0)" data-drag="true" />
            <Cloud size={10} color="var(--subtext0)" data-drag="true" />
            <span
              data-drag="true"
              style={{ fontSize: 9, fontWeight: 600, color: 'var(--subtext0)', flex: 1 }}
            >
              NETWORKS
            </span>
            <span style={{
              fontSize: 8, padding: '0 4px', borderRadius: 6,
              background: 'var(--surface1)',
            }}>
              {(networkDefs ?? []).length}
            </span>
            <button
              onClick={() => setShowNetFilter(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, display: 'flex', color: 'var(--overlay0)',
              }}
            >
              <ChevronRight
                size={10}
                style={{
                  transform: showNetFilter ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>

          {/* Body */}
          {showNetFilter && (
            <div style={{ padding: '4px 8px 6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
                <button onClick={() => toggleAllNetShowLinks(true)} style={showHideBtnStyle('var(--green)')}>Show All</button>
                <button onClick={() => toggleAllNetShowLinks(false)} style={showHideBtnStyle('var(--red)')}>Hide All</button>
                <button onClick={clearAllNetFocus} style={showHideBtnStyle('var(--blue)')}>Clear Focus</button>
              </div>
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: 'var(--overlay0)', fontWeight: 600, padding: '0 2px' }}>
                <span style={{ flex: 1 }}>Network</span>
                <span style={{ width: 42, textAlign: 'center' }}>Links</span>
                <span style={{ width: 42, textAlign: 'center' }}>Focus</span>
              </div>
              {(networkDefs ?? []).map(nd => {
                const color = NET_TYPE_COLOR[nd.type] ?? '#6c7086'
                const filter = netFilters[nd.network_id] ?? { showLinks: true, focus: false }
                // Count connected interfaces
                const memberCount = apiNodes.reduce((count, n) =>
                  count + (n.interfaces ?? []).filter(ifc =>
                    (ifc.networks ?? []).includes(nd.network_id)
                  ).length, 0)
                return (
                  <div
                    key={nd.network_id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 4px', borderRadius: 4,
                      border: `1px solid ${filter.showLinks || filter.focus ? color + '35' : 'var(--surface1)'}`,
                      background: filter.focus ? `${color}12` : 'transparent',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Cloud size={9} color={color} style={{ flexShrink: 0 }} />
                    <span style={{
                      flex: 1, fontSize: 9, fontWeight: 500,
                      color: filter.showLinks || filter.focus ? color : 'var(--overlay0)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      opacity: filter.showLinks || filter.focus ? 1 : 0.5,
                    }}>
                      {nd.label || nd.id}
                    </span>
                    <span style={{
                      fontSize: 7, padding: '0 3px', borderRadius: 6,
                      background: `${color}15`, color,
                    }}>
                      {memberCount}
                    </span>
                    {/* Show Links toggle */}
                    <button
                      onClick={() => toggleNetShowLinks(nd.network_id)}
                      title={`${filter.showLinks ? 'Hide' : 'Show'} link edges for ${nd.label}`}
                      style={{
                        width: 38, padding: '2px 0', borderRadius: 3, fontSize: 8,
                        border: `1px solid ${filter.showLinks ? color + '40' : 'var(--surface1)'}`,
                        background: filter.showLinks ? `${color}20` : 'transparent',
                        color: filter.showLinks ? color : 'var(--overlay0)',
                        cursor: 'pointer', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                      }}
                    >
                      <Link2 size={7} />
                      {filter.showLinks ? 'ON' : 'OFF'}
                    </button>
                    {/* Focus toggle */}
                    <button
                      onClick={() => toggleNetFocus(nd.network_id)}
                      title={`${filter.focus ? 'Unfocus' : 'Focus'} — ${filter.focus ? 'show all nodes' : 'hide non-members'}`}
                      style={{
                        width: 38, padding: '2px 0', borderRadius: 3, fontSize: 8,
                        border: `1px solid ${filter.focus ? '#f9e2af40' : 'var(--surface1)'}`,
                        background: filter.focus ? '#f9e2af20' : 'transparent',
                        color: filter.focus ? '#f9e2af' : 'var(--overlay0)',
                        cursor: 'pointer', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                      }}
                    >
                      <Focus size={7} />
                      {filter.focus ? 'ON' : 'OFF'}
                    </button>
                  </div>
                )
              })}
              {(networkDefs ?? []).length === 0 && (
                <div style={{ fontSize: 9, color: 'var(--overlay0)', textAlign: 'center', padding: 6 }}>
                  No networks assigned
                </div>
              )}
            </div>
          )}
        </div>
      </DraggablePanel>

      {/* Links filter (medium group) */}
      <DraggablePanel defaultX={10} defaultY={showNetFilter ? 260 : 50}>
        <div style={{
          background: 'var(--surface0)', border: '1px solid var(--surface1)',
          borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          minWidth: 140, userSelect: 'none',
        }}>
          <div
            data-drag="true"
            style={{
              padding: '5px 8px',
              borderBottom: showLinkFilter ? '1px solid var(--surface1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 4,
              cursor: 'grab', borderRadius: showLinkFilter ? '8px 8px 0 0' : 8,
            }}
          >
            <GripVertical size={9} color="var(--overlay0)" data-drag="true" />
            <Cable size={10} color="var(--subtext0)" data-drag="true" />
            <span
              data-drag="true"
              style={{ fontSize: 9, fontWeight: 600, color: 'var(--subtext0)', flex: 1 }}
            >
              LINKS
            </span>
            <span style={{
              fontSize: 8, padding: '0 4px', borderRadius: 6,
              background: 'var(--surface1)',
            }}>
              {visibleLinkCount + discoveredLinks.length}/{links.length + discoveredLinks.length}
            </span>
            <button
              onClick={() => setShowLinkFilter(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, display: 'flex', color: 'var(--overlay0)',
              }}
            >
              <ChevronRight
                size={10}
                style={{
                  transform: showLinkFilter ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>
          {showLinkFilter && (
            <div style={{ padding: '4px 8px 6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
                <button onClick={() => toggleAllGroups(true)} style={showHideBtnStyle('var(--green)')}>Show All</button>
                <button onClick={() => toggleAllGroups(false)} style={showHideBtnStyle('var(--red)')}>Hide All</button>
              </div>
              {(['physical', 'wireless', 'logical'] as MediumGroup[]).map(g => {
                const meta = MEDIUM_GROUP_META[g]
                const Icon = meta.icon
                const count = groupCounts[g]
                const visible = visibleGroups[g]
                if (count === 0) return null
                return (
                  <button
                    key={g}
                    onClick={() => toggleGroup(g)}
                    title={`${visible ? 'Hide' : 'Show'} ${meta.label} links (${count})`}
                    style={filterRowStyle(visible, meta.color)}
                  >
                    {visible ? <Eye size={9} /> : <EyeOff size={9} />}
                    <Icon size={10} />
                    <span style={{ flex: 1 }}>{meta.label}</span>
                    <span style={filterBadgeStyle(visible, meta.color)}>{count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DraggablePanel>

      {/* Devices filter */}
      <DraggablePanel defaultX={10} defaultY={(showNetFilter ? 260 : 50) + (showLinkFilter ? 150 : 40)}>
        <div style={{
          background: 'var(--surface0)', border: '1px solid var(--surface1)',
          borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          minWidth: 140, userSelect: 'none',
        }}>
          {/* Header — draggable handle */}
          <div
            data-drag="true"
            style={{
              padding: '5px 8px',
              borderBottom: showCategoryFilter ? '1px solid var(--surface1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 4,
              cursor: 'grab', borderRadius: showCategoryFilter ? '8px 8px 0 0' : 8,
            }}
          >
            <GripVertical size={9} color="var(--overlay0)" data-drag="true" />
            <Layers size={10} color="var(--subtext0)" data-drag="true" />
            <span
              data-drag="true"
              style={{ fontSize: 9, fontWeight: 600, color: 'var(--subtext0)', flex: 1 }}
            >
              DEVICES
            </span>
            <span style={{
              fontSize: 8, padding: '0 4px', borderRadius: 6,
              background: 'var(--surface1)',
            }}>
              {filteredNodes.length}/{apiNodes.length}
            </span>
            <button
              onClick={() => setShowCategoryFilter(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, display: 'flex', color: 'var(--overlay0)',
              }}
            >
              <ChevronRight
                size={10}
                style={{
                  transform: showCategoryFilter ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>

          {/* Body */}
          {showCategoryFilter && (
            <div style={{ padding: '4px 8px 6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
                <button onClick={() => toggleAllCategories(true)} style={showHideBtnStyle('var(--green)')}>Show All</button>
                <button onClick={() => toggleAllCategories(false)} style={showHideBtnStyle('var(--red)')}>Hide All</button>
              </div>
              {Object.entries(categoryCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => {
                  const meta = CATEGORY_META[cat] ?? CATEGORY_META.generic
                  const CatIcon = ICON_MAP[meta.icon] ?? Box
                  const visible = visibleCategories[cat] !== false
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      title={`${visible ? 'Hide' : 'Show'} ${meta.label} devices (${count})`}
                      style={filterRowStyle(visible, meta.color)}
                    >
                      {visible ? <Eye size={9} /> : <EyeOff size={9} />}
                      <CatIcon size={10} />
                      <span style={{ flex: 1 }}>{meta.label}</span>
                      <span style={filterBadgeStyle(visible, meta.color)}>{count}</span>
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      </DraggablePanel>

      {/* Edge hover tooltip (rendered outside ReactFlow for proper z-index) */}
      {hoveredEdge && (
        <EdgeTooltip
          link={hoveredEdge.link}
          x={hoveredEdge.x}
          y={hoveredEdge.y}
        />
      )}
    </div>
  )
}
