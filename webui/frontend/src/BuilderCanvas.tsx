import { apiFetch } from './apiFetch'
/* triv WebUI — BuilderCanvas: Visual topology builder with drag-and-drop
   node creation, click-to-connect interfaces, and live property editing.
   Persists positions and topology changes back to topology.json.        */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  type Node as RFNode, type Edge as RFEdge,
  type NodeChange, type EdgeChange, type Connection,
  applyNodeChanges, applyEdgeChanges, addEdge,
  Handle, Position,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Server, HardDrive, Cpu, CircuitBoard, Network, Globe,
  ArrowLeftRight, Monitor, Radio, Box, Layers, Folder,
  Plus, Trash2, Save, X, GripVertical, ChevronRight, ChevronDown,
  Plug, Link2, Unlink, RotateCcw, Maximize2, Minimize2,
  Settings, Eye, Package, Edit3, Square, Cloud, Shield,
} from 'lucide-react'
import type { NodeDef, LinkDef, InterfaceDef, NetworkDefDef } from './types'
import { CATEGORY_META, STATE_COLOR, RUNTIME_BADGE } from './types'
import NetworkNode from './NetworkNode'
import CapabilitiesModal from './CapabilitiesModal'
import type { CatalogEntry } from './hooks'

/* ── Icon map (same as TopologyCanvas) ────────────────────────────── */
const ICON_MAP: Record<string, React.FC<any>> = {
  Server, HardDrive, Cpu, CircuitBoard, Network, Globe,
  ArrowLeftRight, Monitor, Radio, Box, Layers, Folder, Package, Square,
}

/* ── Constants ────────────────────────────────────────────────────── */
const NODE_W = 180
const AUTO_SAVE_DELAY = 1200 // ms debounce

/* ── Palette items ────────────────────────────────────────────────── */
interface PaletteItem {
  category: string
  runtime: string | null
  driver: string
  label: string
  icon: string
  color: string
  description: string
  /** json-driver id to auto-import into capabilities (null = blank node) */
  defaultJsonDriver?: string | null
  /** Full capabilities template — overrides defaultJsonDriver when set */
  defaultCapabilities?: {
    drivers: { driver: string; driver_args: Record<string, any> }[]
    actions: { '$ref': string; driver: string; origin: string }[]
  } | null
  /** Default interfaces to create with the node */
  defaultInterfaces?: { id: string; type: string; label: string; direction?: string }[]
}

const PALETTE: PaletteItem[] = [
  {
    category: 'generic', runtime: 'libvirt', driver: 'generic',
    label: 'VM Node', icon: 'Cpu', color: '#a6e3a1',
    description: 'Virtual machine (libvirt/QEMU)',
    defaultJsonDriver: 'generic-driver-libvirt',
  },
  {
    category: 'generic', runtime: 'docker', driver: 'generic',
    label: 'Container Node', icon: 'Monitor', color: '#89b4fa',
    description: 'Docker / Podman container',
    defaultJsonDriver: 'generic-driver-container',
  },
  {
    category: 'generic', runtime: 'app', driver: 'generic',
    label: 'App Node', icon: 'Package', color: '#f5c2e7',
    description: 'Application process',
    defaultJsonDriver: 'generic-driver-app',
  },
  {
    category: 'generic', runtime: 'remote', driver: 'generic',
    label: 'Remote Node', icon: 'Globe', color: '#fab387',
    description: 'Remote / physical device (SSH)',
    defaultJsonDriver: 'generic-driver-remote',
  },
  {
    category: 'llm', runtime: 'llm', driver: 'generic',
    label: 'LLM Node', icon: 'Cpu', color: '#cba6f7',
    description: 'LLM service — Ollama, OpenAI, Anthropic, Groq',
    defaultJsonDriver: 'generic-driver-llm',
    defaultInterfaces: [{ id: 'api', type: 'internal', label: 'API' }],
  },
  {
    category: 'llm', runtime: 'docker', driver: 'generic',
    label: 'Ollama Node', icon: 'Cpu', color: '#94e2d5',
    description: 'Ollama LLM container — pre-configured, ready to pull & run models',
    defaultCapabilities: {
      drivers: [
        {
          driver: 'generic-driver-container',
          driver_args: {
            image: 'ollama/ollama',
            'container-name': 'ollama',
            volumes: 'ollama:/root/.ollama',
            ports: '11434:11434',
          },
        },
        {
          driver: 'generic-driver-ollama',
          driver_args: { base_url: 'http://localhost:11434', model: '', temperature: 0.7, num_predict: 2048 },
        },
      ],
      actions: [
        { '$ref': 'container-create',          driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'container-start',           driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'container-stop',            driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'container-restart',         driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'container-rm',              driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'console-sh',                driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'logs',                      driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'container-status',          driver: 'generic-driver-container', origin: 'native' },
        { '$ref': 'ollama-check-connection',   driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-list-models',        driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-pull',               driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-ps',                 driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-chat',               driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-show',               driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-delete',             driver: 'generic-driver-ollama',    origin: 'native' },
        { '$ref': 'ollama-status',             driver: 'generic-driver-ollama',    origin: 'native' },
      ],
    },
    defaultInterfaces: [{ id: 'api', type: 'internal', label: 'API' }],
  },
  {
    category: 'agent', runtime: 'agent', driver: 'generic',
    label: 'Agent Node', icon: 'Zap', color: '#f5c2e7',
    description: 'AI agent — reasons over tasks using topology nodes as tools',
    defaultJsonDriver: 'generic-driver-agent',
    defaultInterfaces: [{ id: 'llm', type: 'internal', label: 'LLM' }],
  },
  {
    category: 'generic', runtime: null, driver: 'generic',
    label: 'Logical Node', icon: 'Box', color: '#6c7086',
    description: 'No runtime — grouping / reference only',
    defaultJsonDriver: null,
  },
  {
    category: 'generic', runtime: null, driver: 'generic',
    label: 'Blank Node', icon: 'Square', color: '#585b70',
    description: 'Empty node — configure drivers & capabilities manually',
    defaultJsonDriver: null,
  },
]

/* ── Link types ───────────────────────────────────────────────────── */
const LINK_TYPES = ['management', 'cascade', 'fiber', 'ethernet', 'backplane', 'logical', 'wi-fi', 'bluetooth', 'ai']
const LINK_TYPE_COLOR: Record<string, string> = {
  cascade: '#89b4fa', management: '#f9e2af', backplane: '#cba6f7',
  logical: '#585b70', fiber: '#94e2d5', ethernet: '#6c7086',
  wireless: '#f5c2e7', 'wi-fi': '#f5c2e7', bluetooth: '#74c7ec',
  ai: '#cba6f7',
}

const _AI_RUNTIMES = new Set(['llm', 'agent'])

const NET_PALETTE_COLORS: Record<string, string> = {
  bridge:        '#89b4fa',
  docker:        '#94e2d5',
  trunk:         '#cba6f7',
  'vlan-bridge': '#fab387',
  p2p:           '#a6e3a1',
}

/* ── Custom node component ────────────────────────────────────────── */
function BuilderNode({ data }: { data: any }) {
  const {
    nodeId, label, category, runtime, state, accentColor, interfaces,
    selected, onSelectNode, networkDefs,
  } = data

  const meta = CATEGORY_META[category] ?? CATEGORY_META.generic
  const Icon = ICON_MAP[meta.icon] ?? Box
  const accent = accentColor ?? meta.color
  const stateColor = STATE_COLOR[state ?? 'undefined'] ?? '#585b70'
  const rt = runtime ? RUNTIME_BADGE[runtime] : null
  const ifaces: InterfaceDef[] = interfaces ?? []
  const ndList: NetworkDefDef[] = networkDefs ?? []

  /* Lookup network label+color by network_id */
  const netMeta = (netId: string) => {
    const nd = ndList.find(n => n.network_id === netId)
    const color = nd ? (NET_PALETTE_COLORS[nd.type] ?? '#6c7086') : '#6c7086'
    const label = nd?.label ?? netId
    return { color, label }
  }

  return (
    <div
      onClick={() => onSelectNode?.(nodeId)}
      style={{
        minWidth: NODE_W,
        background: selected ? 'var(--surface0)' : 'var(--mantle)',
        border: selected ? `2px solid ${accent}` : `1px solid ${stateColor}40`,
        borderRadius: 10,
        boxShadow: selected ? `0 0 14px ${accent}40` : '0 2px 8px rgba(0,0,0,0.2)',
        padding: 0, cursor: 'grab',
        transition: 'border 0.15s, box-shadow 0.15s',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* --- Top handle (target) --- */}
      <Handle
        type="target" position={Position.Top} id="target"
        style={{
          width: 10, height: 10, background: accent,
          border: '2px solid var(--mantle)', borderRadius: '50%',
        }}
      />

      {/* --- Body --- */}
      <div style={{ padding: '10px 14px', textAlign: 'center' }}>
        {/* Icon row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: `${accent}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={15} color={accent} />
          </div>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: stateColor,
            boxShadow: state === 'running' ? `0 0 6px ${stateColor}` : 'none',
          }} />
        </div>

        {/* Label */}
        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)', marginTop: 5, lineHeight: 1.2 }}>
          {label}
        </div>

        {/* Category + runtime badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 3 }}>
          <span style={{ fontSize: 9, color: 'var(--subtext0)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            {meta.label}
          </span>
          {rt && (
            <span style={{
              fontSize: 8, padding: '1px 4px', borderRadius: 3,
              background: rt.bg, color: rt.color, fontWeight: 500,
            }}>
              {rt.label}
            </span>
          )}
        </div>

        {/* Interface ports with connectable handles */}
        {ifaces.length > 0 && (
          <div style={{
            marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'stretch',
          }}>
            {ifaces.map((ifc, idx) => {
              const nets = ifc.networks ?? []
              const hasNet = nets.length > 0
              const firstNet = hasNet ? netMeta(nets[0]) : null
              const handleColor = firstNet?.color ?? '#6c7086'
              return (
                <div key={ifc.id} style={{
                  display: 'flex', alignItems: 'center', gap: 4, position: 'relative',
                }}>
                  <span style={{
                    fontSize: 8, padding: '1px 5px', borderRadius: 3, flex: 1,
                    background: hasNet ? `${handleColor}15` : 'var(--surface1)',
                    color: hasNet ? handleColor : 'var(--subtext0)',
                    border: `1px solid ${hasNet ? handleColor + '40' : 'var(--surface2, var(--surface1))'}`,
                    textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {ifc.label ?? ifc.id}
                    {hasNet && (
                      <span style={{ fontSize: 7, marginLeft: 3, opacity: 0.7 }}>
                        → {firstNet!.label}{nets.length > 1 ? ` +${nets.length - 1}` : ''}
                      </span>
                    )}
                  </span>
                  {/* Per-interface connectable handle on the right */}
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`iface-${ifc.id}`}
                    style={{
                      position: 'absolute',
                      right: -19,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 8, height: 8,
                      background: hasNet ? handleColor : 'var(--surface2)',
                      border: `2px solid ${hasNet ? handleColor : 'var(--overlay0)'}`,
                      borderRadius: '50%',
                      cursor: 'crosshair',
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* --- Bottom handle (source) --- */}
      <Handle
        type="source" position={Position.Bottom} id="source"
        style={{
          width: 10, height: 10, background: accent,
          border: '2px solid var(--mantle)', borderRadius: '50%',
        }}
      />
    </div>
  )
}

const nodeTypes = { builderNode: BuilderNode, networkNode: NetworkNode }

/* ── Props ────────────────────────────────────────────────────────── */
interface Props {
  nodes: NodeDef[]
  links: LinkDef[]
  onMutate: () => void   // trigger data refresh in parent
  networkDefs?: NetworkDefDef[]
  networkStatuses?: Record<string, any>
  catalog?: CatalogEntry[]
  onRefreshNetworks?: () => void
}

/* ── Helpers ──────────────────────────────────────────────────────── */
function genId(prefix: string, existingIds: Set<string>): string {
  let i = 0
  while (existingIds.has(`${prefix}-${i}`)) i++
  return `${prefix}-${i}`
}

function autoLayout(nodes: NodeDef[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const roots = nodes.filter(n => !n.parent)
  const children = nodes.filter(n => n.parent)
  const COLS = Math.max(1, Math.ceil(Math.sqrt(roots.length)))
  const COL_GAP = 260, ROW_GAP = 200

  roots.forEach((n, i) => {
    pos.set(n.id, {
      x: (i % COLS) * COL_GAP + 40,
      y: Math.floor(i / COLS) * ROW_GAP + 40,
    })
  })

  const childCount: Record<string, number> = {}
  children.forEach(n => {
    if (!n.parent) return
    const c = childCount[n.parent] ?? 0
    const pp = pos.get(n.parent) ?? { x: 40, y: 40 }
    pos.set(n.id, { x: pp.x + (c % 3) * 240, y: pp.y + 160 + Math.floor(c / 3) * 160 })
    childCount[n.parent] = c + 1
  })

  let fx = 40
  nodes.forEach(n => {
    if (!pos.has(n.id)) { pos.set(n.id, { x: fx, y: 600 }); fx += 240 }
  })
  return pos
}

/* ── Main component ──────────────────────────────────────────────── */
export default function BuilderCanvas({ nodes, links, onMutate, networkDefs = [], networkStatuses = {}, catalog = [], onRefreshNetworks }: Props) {
  const [rfNodes, setRfNodes] = useState<RFNode[]>([])
  const [rfEdges, setRfEdges] = useState<RFEdge[]>([])
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [showPalette, setShowPalette] = useState(true)
  const [showProps, setShowProps] = useState(true)
  const [dirty, setDirty] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── Node editing state ──────────────────────────────────────── */
  const [editNodeId, setEditNodeId] = useState<string | null>(null)
  const [editNodeForm, setEditNodeForm] = useState<Record<string, any>>({})

  /* ── Capabilities modal ─────────────────────────────────────── */
  const [capsNode, setCapsNode] = useState<NodeDef | null>(null)

  /* ── Network palette busy state ──────────────────────────────── */
  const [busyNet, setBusyNet] = useState<string | null>(null)

  /* ── Link creation state ─────────────────────────────────────── */
  const [newLinkForm, setNewLinkForm] = useState<{
    id: string; type: string;
    srcNode: string; srcIface: string;
    tgtNode: string; tgtIface: string;
  } | null>(null)

  /* ── Build RF nodes from API data ──────────────────────────── */
  const nodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])

  const buildRfNodes = useCallback((apiNodes: NodeDef[]) => {
    const auto = autoLayout(apiNodes)
    return apiNodes.map(n => {
      const pos = n.position ?? auto.get(n.id) ?? { x: 0, y: 0 }
      const meta = CATEGORY_META[n.category] ?? CATEGORY_META.generic
      return {
        id: n.id,
        type: 'builderNode',
        position: pos,
        data: {
          nodeId: n.id,
          label: (n.properties as any)?.label ?? n.vm_name ?? n.id,
          category: n.category,
          runtime: n.runtime,
          state: n.state,
          accentColor: n.driver_meta?.accent_color ?? meta.color,
          interfaces: n.interfaces ?? [],
          selected: false,
          onSelectNode: undefined as any, // wired below
          networkDefs,
        },
      } as RFNode
    })
  }, [networkDefs])

  const buildRfEdges = useCallback((apiLinks: LinkDef[]) => {
    return apiLinks.map(lk => {
      const color = LINK_TYPE_COLOR[lk.type] ?? '#6c7086'
      return {
        id: lk.id,
        source: lk.source.node,
        target: lk.target.node,
        sourceHandle: 'source',
        targetHandle: 'target',
        label: lk.label ?? lk.id,
        labelStyle: { fontSize: 9, fontWeight: 500, fill: 'var(--subtext0)', fontFamily: 'var(--font-sans)' },
        labelBgStyle: { fill: 'var(--base)', fillOpacity: 0.85 },
        labelBgPadding: [4, 2] as [number, number],
        style: { stroke: color, strokeWidth: lk.type === 'cascade' ? 2.5 : 1.8 },
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      } as RFEdge
    })
  }, [])

  /* ── Build network-membership edges from interface.networks[] ── */
  const buildNetEdges = useCallback((apiNodes: NodeDef[]): RFEdge[] => {
    const edges: RFEdge[] = []
    for (const node of apiNodes) {
      for (const ifc of (node.interfaces ?? [])) {
        for (const netId of (ifc.networks ?? [])) {
          const nd = networkDefs.find(n => n.network_id === netId)
          if (!nd) continue
          const color = NET_PALETTE_COLORS[nd.type] ?? '#6c7086'
          edges.push({
            id: `net-edge-${node.id}-${ifc.id}-${netId}`,
            source: node.id,
            target: `net-${netId}`,
            sourceHandle: `iface-${ifc.id}`,
            targetHandle: 'iface-target',
            label: ifc.label ?? ifc.id,
            labelStyle: { fontSize: 8, fontWeight: 500, fill: color, fontFamily: 'var(--font-sans)' },
            labelBgStyle: { fill: 'var(--base)', fillOpacity: 0.85 },
            labelBgPadding: [3, 1] as [number, number],
            style: { stroke: color, strokeWidth: 1.5, strokeDasharray: '4 3' },
            animated: false,
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 10, height: 10 },
          })
        }
      }
    }
    return edges
  }, [networkDefs])

  /* ── Sync from API data → ReactFlow state ──────────────────── */
  const prevNodeIdsRef = useRef<string>('')

  useEffect(() => {
    const idsKey = nodes.map(n => n.id).sort().join(',')
    const structureChanged = idsKey !== prevNodeIdsRef.current
    prevNodeIdsRef.current = idsKey

    if (structureChanged || rfNodes.length === 0) {
      setRfNodes(prev => {
        const netNodes = prev.filter(n => n.type === 'networkNode')
        return [...buildRfNodes(nodes), ...netNodes]
      })
    } else {
      // Preserve positions — only update data (state, label, etc.)
      setRfNodes(prev => {
        const posMap = new Map(prev.map(n => [n.id, n.position]))
        const netNodes = prev.filter(n => n.type === 'networkNode')
        return [...buildRfNodes(nodes).map(n => ({
          ...n,
          position: posMap.get(n.id) ?? n.position,
        })), ...netNodes]
      })
    }
    setRfEdges([...buildRfEdges(links), ...buildNetEdges(nodes)])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, networkDefs])

  /* ── Sync network def nodes into rfNodes ────────────────────── */
  useEffect(() => {
    if (!networkDefs || networkDefs.length === 0) return
    setRfNodes(prev => {
      // Compute auto-position based on existing device nodes
      const deviceNodes = prev.filter(n => n.type !== 'networkNode')
      const maxY = deviceNodes.reduce((m, n) => Math.max(m, n.position.y + 120), 40)
      const netNodes = networkDefs.map((nd, i) => {
        const existingPos = prev.find(n => n.id === `net-${nd.network_id || nd.id}`)?.position
        const storedPos = nd.position && (nd.position.x !== 0 || nd.position.y !== 0)
          ? nd.position : undefined
        const pos = existingPos ?? storedPos ?? { x: 40 + i * 240, y: maxY + 80 }
        return {
          id: `net-${nd.network_id || nd.id}`,
          type: 'networkNode',
          position: pos,
          draggable: true,
          data: { nd, status: networkStatuses[nd.network_id] },
        }
      })
      return [...deviceNodes, ...netNodes]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkDefs, networkStatuses])

  /* ── Wire selection callback into node data ────────────────── */
  useEffect(() => {
    setRfNodes(prev => prev.map(n => ({
      ...n,
      data: {
        ...n.data,
        selected: n.id === selectedNode,
        onSelectNode: (id: string) => setSelectedNode(id),
      },
    })))
  }, [selectedNode])

  /* ── Position save (debounced) ─────────────────────────────── */
  const savePositions = useCallback(async (rfn: RFNode[]) => {
    const positions: Record<string, { x: number; y: number }> = {}
    rfn.filter(n => n.type !== 'networkNode').forEach(n => {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
    })
    try {
      await apiFetch('/api/topology/nodes/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      })
      setDirty(false)
    } catch (e) {
      console.error('Failed to save positions:', e)
    }
  }, [])

  const scheduleSave = useCallback((rfn: RFNode[]) => {
    setDirty(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => savePositions(rfn), AUTO_SAVE_DELAY)
  }, [savePositions])

  /* ── Network node position save ─────────────────────────────── */
  const saveNetworkPosition = useCallback(async (networkId: string, x: number, y: number) => {
    try {
      await apiFetch(`/api/v2/networks/${networkId}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: Math.round(x), y: Math.round(y) }),
      })
    } catch (e) {
      console.error('Failed to save network position:', e)
    }
  }, [])

  /* ── ReactFlow change handlers ─────────────────────────────── */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes(prev => {
      const next = applyNodeChanges(changes, prev)
      const dragStopChanges = changes.filter(c => c.type === 'position' && !c.dragging)
      if (dragStopChanges.length > 0) {
        for (const c of dragStopChanges) {
          if (c.type !== 'position') continue
          const node = next.find(n => n.id === c.id)
          if (!node) continue
          if (node.type === 'networkNode') {
            // Extract network_id from node id (format: "net-{network_id}")
            const networkId = node.id.replace(/^net-/, '')
            saveNetworkPosition(networkId, node.position.x, node.position.y)
          }
        }
        scheduleSave(next)
      }
      return next
    })
  }, [scheduleSave, saveNetworkPosition])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges(prev => applyEdgeChanges(changes, prev))
  }, [])

  const onNodeClick = useCallback((_: any, node: RFNode) => {
    setSelectedNode(node.id)
    setSelectedEdge(null)
  }, [])

  const onEdgeClick = useCallback((_: any, edge: RFEdge) => {
    setSelectedEdge(edge.id)
    setSelectedNode(null)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setSelectedEdge(null)
  }, [])

  /* ── Connection handler (link creation via drag) ───────────── */
  const onConnect = useCallback(async (connection: Connection) => {
    const src = connection.source
    const tgt = connection.target
    const srcHandle = connection.sourceHandle ?? ''
    if (!src || !tgt || src === tgt) return

    /* ── Interface → Network connection ─────────────────────── */
    if (srcHandle.startsWith('iface-') && tgt.startsWith('net-')) {
      const ifaceId = srcHandle.replace('iface-', '')
      const networkId = tgt.replace('net-', '')
      const node = nodes.find(n => n.id === src)
      if (!node) return

      const ifaces = (node.interfaces ?? []).map(i => {
        if (i.id !== ifaceId) return i
        const nets = i.networks ?? []
        if (nets.includes(networkId)) return i
        return { ...i, networks: [...nets, networkId] }
      })
      const body: any = { ...node, interfaces: ifaces }
      if (node.position) body.position = node.position

      try {
        await apiFetch(`/api/topology/nodes/${src}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        onMutate()
      } catch (e) {
        console.error('Failed to connect interface to network:', e)
      }
      return
    }

    /* ── Standard node → node link creation ─────────────────── */
    const srcNode = nodes.find(n => n.id === src)
    const tgtNode = nodes.find(n => n.id === tgt)
    const isAiLink = _AI_RUNTIMES.has(srcNode?.runtime ?? '') || _AI_RUNTIMES.has(tgtNode?.runtime ?? '')
    const existingIds = new Set(links.map(l => l.id))
    setNewLinkForm({
      id: genId('link', existingIds),
      type: isAiLink ? 'ai' : 'management',
      srcNode: src,
      srcIface: srcNode?.interfaces?.[0]?.id ?? '',
      tgtNode: tgt,
      tgtIface: tgtNode?.interfaces?.[0]?.id ?? '',
    })
  }, [nodes, links, onMutate])

  /* ── Disconnect interface from network ─────────────────────── */
  const handleDisconnectIfaceNet = useCallback(async (nodeId: string, ifaceId: string, networkId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    const ifaces = (node.interfaces ?? []).map(i => {
      if (i.id !== ifaceId) return i
      return { ...i, networks: (i.networks ?? []).filter(n => n !== networkId) }
    })
    const body: any = { ...node, interfaces: ifaces }
    if (node.position) body.position = node.position

    try {
      await apiFetch(`/api/topology/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onMutate()
      setSelectedEdge(null)
    } catch (e) {
      console.error('Failed to disconnect interface from network:', e)
    }
  }, [nodes, onMutate])

  /* ── Create node from palette ──────────────────────────────── */
  const handleCreateNode = useCallback(async (item: PaletteItem) => {
    // Let the backend generate a UUID-based id
    const body: any = {
      driver: item.driver,
      category: item.category,
    }
    if (item.runtime) body.runtime = item.runtime
    body.properties = { label: item.label }
    body.interfaces = item.defaultInterfaces ?? []

    // Place it at a reasonable position
    const maxX = rfNodes.reduce((mx, n) => Math.max(mx, n.position.x), 0)
    body.position = { x: maxX + 280, y: 80 }

    try {
      const resp = await apiFetch('/api/topology/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (data.ok && data.id) {
        // Auto-create capabilities — use explicit template or auto-import from json-driver
        if (item.defaultCapabilities) {
          try {
            await apiFetch(`/api/nodes/${data.id}/capabilities`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.defaultCapabilities),
            })
          } catch (e) {
            console.error('Failed to create default capabilities:', e)
          }
        } else if (item.defaultJsonDriver) {
          try {
            const catResp = await apiFetch('/api/drivers/catalog')
            const catalog = await catResp.json()
            const drv = catalog.find((d: any) => d.id === item.defaultJsonDriver)
            if (drv) {
              const actions = Object.keys(drv.actions || {})
                .filter((k: string) => !k.startsWith('_'))
                .map((k: string) => ({
                  '$ref': k,
                  driver: item.defaultJsonDriver,
                  origin: 'native',
                }))
              await apiFetch(`/api/nodes/${data.id}/capabilities`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  drivers: [{ driver: item.defaultJsonDriver, driver_args: {} }],
                  actions,
                }),
              })
            }
          } catch (e) {
            console.error('Failed to create default capabilities:', e)
          }
        }
        onMutate()
        setSelectedNode(data.id)
      }
    } catch (e) {
      console.error('Failed to create node:', e)
    }
  }, [rfNodes, onMutate])

  /* ── Delete node ───────────────────────────────────────────── */
  const handleDeleteNode = useCallback(async (id: string) => {
    if (!confirm(`Delete node "${id}" and all its links?`)) return
    try {
      await apiFetch(`/api/topology/nodes/${id}`, { method: 'DELETE' })
      setSelectedNode(null)
      onMutate()
    } catch (e) {
      console.error('Failed to delete node:', e)
    }
  }, [onMutate])

  /* ── Delete link ───────────────────────────────────────────── */
  const handleDeleteLink = useCallback(async (id: string) => {
    if (!confirm(`Delete link "${id}"?`)) return
    try {
      await apiFetch(`/api/topology/links/${id}`, { method: 'DELETE' })
      setSelectedEdge(null)
      onMutate()
    } catch (e) {
      console.error('Failed to delete link:', e)
    }
  }, [onMutate])

  /* ── Save link (from form) ─────────────────────────────────── */
  const handleSaveLink = useCallback(async () => {
    if (!newLinkForm) return
    const srcNode = nodes.find(n => n.id === newLinkForm.srcNode)
    const tgtNode = nodes.find(n => n.id === newLinkForm.tgtNode)
    const srcFallback = srcNode?.interfaces?.[0]?.id ?? 'eth0'
    const tgtFallback = tgtNode?.interfaces?.[0]?.id ?? 'eth0'
    const body = {
      id: newLinkForm.id,
      type: newLinkForm.type,
      source: { node: newLinkForm.srcNode, interface: newLinkForm.srcIface || srcFallback },
      target: { node: newLinkForm.tgtNode, interface: newLinkForm.tgtIface || tgtFallback },
    }
    try {
      const resp = await apiFetch('/api/topology/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (data.ok) {
        setNewLinkForm(null)
        onMutate()
      }
    } catch (e) {
      console.error('Failed to create link:', e)
    }
  }, [newLinkForm, onMutate])

  /* ── Node edit: open form ──────────────────────────────────── */
  const handleEditNode = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    setEditNodeId(id)
    setEditNodeForm({
      driver: node.driver,
      category: node.category,
      runtime: node.runtime ?? '',
      parent: node.parent ?? '',
      label: (node.properties as any)?.label ?? '',
      env: node.env ?? '',
    })
  }, [nodes])

  /* ── Node edit: save ───────────────────────────────────────── */
  const handleSaveNodeEdit = useCallback(async () => {
    if (!editNodeId) return
    const orig = nodes.find(n => n.id === editNodeId)
    if (!orig) return

    const body: any = {
      id: editNodeId,
      driver: orig.driver || 'generic',  // driver is managed via Capabilities, preserve original
      category: editNodeForm.category || 'generic',
      interfaces: orig.interfaces ?? [],
      properties: { ...(orig.properties ?? {}), label: editNodeForm.label || undefined },
    }

    if (editNodeForm.runtime) body.runtime = editNodeForm.runtime
    if (editNodeForm.parent) body.parent = editNodeForm.parent
    if (editNodeForm.env) body.env = editNodeForm.env
    if (orig.position) body.position = orig.position

    try {
      const resp = await apiFetch(`/api/topology/nodes/${editNodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (data.ok) {
        setEditNodeId(null)
        onMutate()
      }
    } catch (e) {
      console.error('Failed to update node:', e)
    }
  }, [editNodeId, editNodeForm, nodes, onMutate])

  /* ── Interface management ──────────────────────────────────── */
  const handleAddInterface = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    const ifaces = [...(node.interfaces ?? [])]
    const isAiNode = _AI_RUNTIMES.has(node.runtime ?? '')
    const newId = isAiNode ? `ai${ifaces.length}` : `eth${ifaces.length}`
    const newType = isAiNode ? 'internal' : 'ethernet'
    ifaces.push({ id: newId, type: newType, label: newId })

    const body: any = { ...node, interfaces: ifaces }
    // Preserve position
    if (node.position) body.position = node.position

    try {
      await apiFetch(`/api/topology/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onMutate()
    } catch (e) {
      console.error('Failed to add interface:', e)
    }
  }, [nodes, onMutate])

  const handleDeleteInterface = useCallback(async (nodeId: string, ifaceId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    const ifaces = (node.interfaces ?? []).filter(i => i.id !== ifaceId)
    const body: any = { ...node, interfaces: ifaces }
    if (node.position) body.position = node.position

    try {
      await apiFetch(`/api/topology/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onMutate()
    } catch (e) {
      console.error('Failed to delete interface:', e)
    }
  }, [nodes, onMutate])

  const handleSaveInterface = useCallback(async (
    nodeId: string,
    oldIfaceId: string,
    patch: { id: string; label: string; type: string; direction: string; ip: string; vlan: string },
  ) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    const vlanNum = patch.vlan ? parseInt(patch.vlan, 10) : undefined
    const ifaces = (node.interfaces ?? []).map(i =>
      i.id === oldIfaceId
        ? { ...i, id: patch.id.trim() || oldIfaceId, label: patch.label, type: patch.type, direction: patch.direction, ip: patch.ip || undefined, vlan: (vlanNum && !isNaN(vlanNum)) ? vlanNum : undefined }
        : i,
    )
    const body: any = { ...node, interfaces: ifaces }
    if (node.position) body.position = node.position
    try {
      await apiFetch(`/api/topology/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onMutate()
    } catch (e) {
      console.error('Failed to save interface:', e)
    }
  }, [nodes, onMutate])

  // Inline-editing state for interfaces (id + label + type + direction + ip)
  const [editingIface, setEditingIface] = useState<{
    nodeId: string; ifaceId: string
    id: string; label: string; type: string; direction: string; ip: string; vlan: string
  } | null>(null)

  /* ── Network sidebar: remove (unassign) from topology ──────── */
  const handleUnassignNetwork = useCallback(async (networkId: string) => {
    setBusyNet(networkId)
    try {
      await apiFetch('/api/v2/networks/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network_id: networkId }),
      })
      onRefreshNetworks?.()
    } catch (e) {
      console.error('Failed to unassign network:', e)
    } finally {
      setBusyNet(null)
    }
  }, [onRefreshNetworks])

  /* ── Reset layout ──────────────────────────────────────────── */
  const handleResetLayout = useCallback(() => {
    const auto = autoLayout(nodes)
    setRfNodes(prev => prev.map(n => ({
      ...n,
      position: auto.get(n.id) ?? n.position,
    })))
    // Save after reset
    const positions: Record<string, { x: number; y: number }> = {}
    auto.forEach((v, k) => { positions[k] = v })
    apiFetch('/api/topology/nodes/positions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    }).catch(() => {})
  }, [nodes])

  /* ── Selected objects ──────────────────────────────────────── */
  const selNode = useMemo(() => nodes.find(n => n.id === selectedNode), [nodes, selectedNode])
  const selLink = useMemo(() => links.find(l => l.id === selectedEdge), [links, selectedEdge])

  /* ── Render ────────────────────────────────────────────────── */
  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 8000, background: 'var(--base)', display: 'flex' }
    : { height: '100%', width: '100%', display: 'flex' }

  const panelStyle: React.CSSProperties = {
    background: 'var(--mantle)',
    borderRight: '1px solid var(--surface1)',
    overflowY: 'auto',
    fontSize: 11,
    fontFamily: 'var(--font-sans)',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    borderRadius: 5,
    border: '1px solid var(--surface1)',
    background: 'var(--surface0)',
    color: 'var(--text)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    outline: 'none',
  }

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  }

  const btnStyle = (color: string, small = false): React.CSSProperties => ({
    padding: small ? '3px 8px' : '5px 12px',
    borderRadius: 5,
    border: `1px solid ${color}40`,
    background: `${color}15`,
    color,
    fontSize: small ? 9 : 10,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  })

  const sectionTitle = (text: string) => (
    <div style={{
      fontSize: 9, fontWeight: 700, color: 'var(--subtext0)',
      textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '8px 12px 4px', borderBottom: '1px solid var(--surface0)',
    }}>
      {text}
    </div>
  )

  return (
    <div style={containerStyle}>
      {/* ── Left: Palette panel ────────────────────────────────── */}
      {showPalette && (
        <div style={{ ...panelStyle, width: 180, minWidth: 180 }}>
          {sectionTitle('Node Palette')}
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {PALETTE.map(item => {
              const PIcon = ICON_MAP[item.icon] ?? Box
              return (
                <button
                  key={item.label}
                  onClick={() => handleCreateNode(item)}
                  title={item.description}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 7,
                    border: `1px solid ${item.color}30`,
                    background: `${item.color}08`,
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 11, fontWeight: 500,
                    transition: 'background 0.15s',
                  }}
                  onMouseOver={e => (e.currentTarget.style.background = `${item.color}20`)}
                  onMouseOut={e => (e.currentTarget.style.background = `${item.color}08`)}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: `${item.color}20`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <PIcon size={13} color={item.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 8, color: 'var(--subtext0)' }}>
                      {item.description}
                    </div>
                  </div>
                  <Plus size={12} color="var(--overlay0)" style={{ marginLeft: 'auto' }} />
                </button>
              )
            })}
          </div>

          {sectionTitle('Quick Link')}
          <div style={{ padding: 8 }}>
            <button
              onClick={() => {
                const existingIds = new Set(links.map(l => l.id))
                setNewLinkForm({
                  id: genId('link', existingIds),
                  type: 'management',
                  srcNode: nodes[0]?.id ?? '',
                  srcIface: '',
                  tgtNode: nodes[1]?.id ?? '',
                  tgtIface: '',
                })
              }}
              style={btnStyle('#89b4fa')}
            >
              <Link2 size={11} /> New Link
            </button>
          </div>

          {sectionTitle(`Topology: ${nodes.length}N / ${links.length}L`)}

          {/* ── Network Instances ─────────────────────────────── */}
          {networkDefs.length > 0 && (
            <>
              {sectionTitle(`Networks (${networkDefs.length})`)}
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {networkDefs.map(nd => {
                  const color = NET_PALETTE_COLORS[nd.type] ?? '#6c7086'
                  const status = networkStatuses[nd.network_id]
                  const deployed = !!status?.deployed
                  const isBusy = busyNet === nd.network_id
                  return (
                    <div
                      key={nd.network_id || nd.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 7,
                        border: `1px solid ${color}30`,
                        background: `${color}08`,
                        fontSize: 11, fontWeight: 500,
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: 5,
                        background: `${color}20`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <Cloud size={11} color={color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {nd.label || nd.id}
                        </div>
                        <div style={{ fontSize: 8, color: 'var(--subtext0)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {nd.type}
                          <span style={{
                            display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                            background: deployed ? '#a6e3a1' : '#6c7086',
                          }} />
                          {deployed ? 'deployed' : 'not deployed'}
                        </div>
                      </div>
                      <button
                        onClick={() => !busyNet && handleUnassignNetwork(nd.network_id)}
                        disabled={!!busyNet}
                        title={`Remove "${nd.label || nd.id}" from topology`}
                        style={{
                          background: 'none', border: 'none', cursor: busyNet ? 'wait' : 'pointer',
                          color: isBusy ? '#f38ba8' : 'var(--overlay0)',
                          padding: 2, display: 'flex', alignItems: 'center',
                          opacity: busyNet && !isBusy ? 0.4 : 1,
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Center: ReactFlow canvas ───────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.15}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--crust)' }}
          connectionLineStyle={{ stroke: '#89b4fa', strokeWidth: 2, strokeDasharray: '5 3' }}
          defaultEdgeOptions={{ animated: false }}
        >
          <Background color="var(--surface0)" gap={20} size={1} />
          <Controls
            showInteractive={false}
            style={{ background: 'var(--surface0)', borderRadius: 8, border: '1px solid var(--surface1)' }}
          />
          <MiniMap
            nodeColor={() => '#6c7086'}
            maskColor="rgba(17,17,27,0.7)"
            style={{ background: 'var(--mantle)', borderRadius: 8, border: '1px solid var(--surface1)' }}
          />

          {/* Top-right toolbar */}
          <Panel position="top-right">
            <div style={{ display: 'flex', gap: 6 }}>
              {dirty && (
                <span style={{
                  fontSize: 9, padding: '5px 8px', borderRadius: 5,
                  background: '#f9e2af20', color: '#f9e2af', fontWeight: 600,
                }}>
                  SAVING…
                </span>
              )}
              <button onClick={handleResetLayout} title="Reset layout" style={btnStyle('#6c7086', true)}>
                <RotateCcw size={11} /> Reset
              </button>
              <button onClick={() => setShowPalette(v => !v)} title="Toggle palette" style={btnStyle('#89b4fa', true)}>
                <Package size={11} /> {showPalette ? 'Hide' : 'Show'} Palette
              </button>
              <button onClick={() => setShowProps(v => !v)} title="Toggle properties" style={btnStyle('#a6e3a1', true)}>
                <Settings size={11} /> {showProps ? 'Hide' : 'Show'} Props
              </button>
              <button onClick={() => setFullscreen(f => !f)} style={btnStyle('#6c7086', true)}>
                {fullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                {fullscreen ? ' Exit' : ' Expand'}
              </button>
            </div>
          </Panel>

          {/* Bottom legend */}
          <Panel position="bottom-left">
            <div style={{
              background: 'var(--surface0)', border: '1px solid var(--surface1)',
              borderRadius: 8, padding: '6px 12px',
              display: 'flex', gap: 10, fontSize: 9, color: 'var(--subtext0)',
            }}>
              <span>Drag from <b style={{ color: '#89b4fa' }}>●</b> handle to connect</span>
              <span>Click node/link to edit</span>
              <span>Palette → add nodes</span>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* ── Right: Properties panel ────────────────────────────── */}
      {showProps && (
        <div style={{ ...panelStyle, width: 280, minWidth: 280, borderRight: 'none', borderLeft: '1px solid var(--surface1)' }}>
          {/* ── Node selected ──────────────────────────────── */}
          {selNode && !editNodeId && (
            <>
              {sectionTitle('Selected Node')}
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>
                  {(selNode.properties as any)?.label ?? selNode.vm_name ?? selNode.id}
                </div>

                {/* Info rows */}
                {([
                  ['ID', selNode.id],
                  ['Short ID', (selNode.properties as any)?.short_id ?? '—'],
                  ['Driver', selNode.driver],
                  ['Category', selNode.category],
                  ['Runtime', selNode.runtime ?? '—'],
                  ['Parent', selNode.parent ?? '—'],
                  ['State', selNode.state ?? 'undefined'],
                  ['Capabilities', selNode.env ?? '(not created)'],
                  // Docker-specific (from driver_args)
                  ...(selNode.runtime === 'docker' ? [
                    ['Image', selNode.driver_args?.image ?? '—'],
                    ['Container', selNode.driver_args?.['container-name'] ?? selNode.vm_name ?? '—'],
                    ...(selNode.driver_args?.command ? [['Command', selNode.driver_args.command]] : []),
                  ] : []),
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--surface0)' }}>
                    <span style={{ color: 'var(--subtext0)', fontSize: 10 }}>{k}</span>
                    <span style={{ color: 'var(--text)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{v}</span>
                  </div>
                ))}

                {/* Interfaces */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--subtext0)', textTransform: 'uppercase' }}>
                      Interfaces ({selNode.interfaces?.length ?? 0})
                    </span>
                    <button onClick={() => handleAddInterface(selNode.id)} style={btnStyle('#a6e3a1', true)} title="Add interface">
                      <Plus size={9} /> Add
                    </button>
                  </div>
                  {(selNode.interfaces ?? []).map(ifc => {
                    const isEditing = editingIface?.nodeId === selNode.id && editingIface?.ifaceId === ifc.id
                    const fieldStyle: React.CSSProperties = {
                      fontSize: 10, color: 'var(--text)', background: 'var(--crust)',
                      border: '1px solid var(--surface2)', borderRadius: 3,
                      padding: '1px 4px', outline: 'none', fontFamily: 'var(--font-mono)',
                      width: '100%', boxSizing: 'border-box',
                    }
                    const labelStyle: React.CSSProperties = {
                      fontSize: 9, color: 'var(--subtext0)', marginBottom: 2, display: 'block',
                    }
                    return (
                      <div key={ifc.id} style={{
                        borderRadius: 5, background: 'var(--surface0)', marginBottom: 3,
                        border: isEditing ? '1px solid var(--blue)' : '1px solid transparent',
                      }}>
                        {isEditing ? (
                          /* ── Expanded edit form ── */
                          <div style={{ padding: '6px 8px' }}>
                            <div style={{
                              fontSize: 9, color: 'var(--yellow)', background: 'var(--crust)',
                              border: '1px solid var(--yellow)', borderRadius: 4,
                              padding: '4px 6px', marginBottom: 7, lineHeight: 1.5,
                            }}>
                              The <strong>ID</strong> must match the placeholder in the libvirt domain XML template:
                              {' '}<code style={{ fontFamily: 'var(--font-mono)' }}>{'{{IFACE_<id>_MAC}}'}</code> / <code style={{ fontFamily: 'var(--font-mono)' }}>{'{{IFACE_<id>_BRIDGE}}'}</code>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px', marginBottom: 6 }}>
                              <div>
                                <label style={labelStyle}>ID (used in templates)</label>
                                <input
                                  autoFocus
                                  style={{ ...fieldStyle, fontWeight: 700, borderColor: 'var(--blue)' }}
                                  value={editingIface!.id}
                                  onChange={e => setEditingIface(prev => prev ? { ...prev, id: e.target.value } : null)}
                                  onKeyDown={e => { if (e.key === 'Escape') setEditingIface(null) }}
                                  placeholder="e.g. eth0"
                                />
                              </div>
                              <div>
                                <label style={labelStyle}>Label</label>
                                <input
                                  style={fieldStyle}
                                  value={editingIface!.label}
                                  onChange={e => setEditingIface(prev => prev ? { ...prev, label: e.target.value } : null)}
                                  onKeyDown={e => { if (e.key === 'Escape') setEditingIface(null) }}
                                  placeholder="Display name"
                                />
                              </div>
                              <div>
                                <label style={labelStyle}>Type</label>
                                <select
                                  style={{ ...fieldStyle, cursor: 'pointer' }}
                                  value={editingIface!.type}
                                  onChange={e => setEditingIface(prev => prev ? { ...prev, type: e.target.value } : null)}
                                >
                                  {['undefined', 'ethernet', 'serial', 'optical', 'internal', 'dummy', 'bluetooth', 'wi-fi'].map(t => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label style={labelStyle}>Direction</label>
                                <select
                                  style={{ ...fieldStyle, cursor: 'pointer' }}
                                  value={editingIface!.direction}
                                  onChange={e => setEditingIface(prev => prev ? { ...prev, direction: e.target.value } : null)}
                                >
                                  {['bidir', 'in', 'out'].map(d => (
                                    <option key={d} value={d}>{d}</option>
                                  ))}
                                </select>
                              </div>
                              {editingIface!.type === 'ethernet' && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>IP Address (e.g. 10.0.0.1 or 10.0.0.1/24)</label>
                                <input
                                  style={fieldStyle}
                                  value={editingIface!.ip}
                                  onChange={e => setEditingIface(prev => prev ? { ...prev, ip: e.target.value } : null)}
                                  onKeyDown={e => { if (e.key === 'Escape') setEditingIface(null) }}
                                  placeholder="10.0.0.1/24"
                                />
                              </div>
                              )}
                              {editingIface!.type === 'ethernet' && (
                              <div>
                                <label style={labelStyle}>VLAN ID</label>
                                <input
                                  style={fieldStyle}
                                  value={editingIface!.vlan}
                                  onChange={e => setEditingIface(prev => prev ? { ...prev, vlan: e.target.value.replace(/[^0-9]/g, '') } : null)}
                                  onKeyDown={e => { if (e.key === 'Escape') setEditingIface(null) }}
                                  placeholder="e.g. 100"
                                />
                              </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => setEditingIface(null)}
                                style={{ ...btnStyle('var(--overlay1)', true), fontSize: 9, padding: '2px 6px' }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  handleSaveInterface(selNode.id, ifc.id, {
                                    id: editingIface!.id,
                                    label: editingIface!.label,
                                    type: editingIface!.type,
                                    direction: editingIface!.direction,
                                    ip: editingIface!.ip,
                                    vlan: editingIface!.vlan,
                                  })
                                  setEditingIface(null)
                                }}
                                style={{ ...btnStyle('#a6e3a1', true), fontSize: 9, padding: '2px 6px' }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Collapsed view ── */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px' }}>
                            <Plug size={10} color="var(--blue)" />
                            <span style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>
                              {ifc.label && ifc.label !== ifc.id
                                ? <>{ifc.label} <span style={{ fontWeight: 400, color: 'var(--subtext0)' }}>({ifc.id})</span></>
                                : ifc.id}
                            </span>
                            <span style={{ fontSize: 8, color: 'var(--subtext0)' }}>{ifc.type}</span>
                            <button
                              onClick={() => setEditingIface({
                                nodeId: selNode.id, ifaceId: ifc.id,
                                id: ifc.id, label: ifc.label ?? '', type: ifc.type ?? 'ethernet',
                                direction: (ifc as any).direction ?? 'bidir',
                                ip: ifc.ip ?? '',
                                vlan: ifc.vlan != null ? String(ifc.vlan) : '',
                              })}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--overlay1)' }}
                              title="Edit interface"
                            >
                              <Edit3 size={9} />
                            </button>
                            <button
                              onClick={() => handleDeleteInterface(selNode.id, ifc.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#f38ba8' }}
                              title="Remove interface"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Capabilities button */}
                {selNode.runtime && (
                  <button
                    onClick={() => setCapsNode(selNode)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      width: '100%', marginTop: 10,
                      padding: '7px 10px', borderRadius: 7,
                      border: '1px solid var(--mauve)40',
                      background: 'var(--mauve)12',
                      color: 'var(--mauve)', cursor: 'pointer',
                      fontSize: 11, fontWeight: 600,
                      transition: 'background 0.15s',
                    }}
                    onMouseOver={e => (e.currentTarget.style.background = 'var(--mauve)22')}
                    onMouseOut={e => (e.currentTarget.style.background = 'var(--mauve)12')}
                  >
                    <Shield size={12} />
                    Capabilities
                    {selNode.env
                      ? <span style={{ marginLeft: 'auto', fontSize: 9, color: '#a6e3a1' }}>● configured</span>
                      : <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--overlay0)' }}>○ not set</span>
                    }
                  </button>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button onClick={() => handleEditNode(selNode.id)} style={btnStyle('#89b4fa')}>
                    <Settings size={11} /> Edit
                  </button>
                  <button onClick={() => handleDeleteNode(selNode.id)} style={btnStyle('#f38ba8')}>
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Node edit form ─────────────────────────────── */}
          {editNodeId && (
            <>
              {sectionTitle(`Edit: ${editNodeId}`)}
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Label</label>
                <input
                  style={inputStyle}
                  value={editNodeForm.label ?? ''}
                  onChange={e => setEditNodeForm(f => ({ ...f, label: e.target.value }))}
                />

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Driver</label>
                <div style={{
                  ...inputStyle, background: 'var(--surface0)', color: 'var(--subtext0)',
                  cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{editNodeForm.driver ?? 'generic'}</span>
                  <span style={{ fontSize: 8, color: 'var(--overlay0)' }}>via Capabilities</span>
                </div>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Category</label>
                <select
                  style={selectStyle}
                  value={editNodeForm.category ?? 'generic'}
                  onChange={e => setEditNodeForm(f => ({ ...f, category: e.target.value }))}
                >
                  {Object.keys(CATEGORY_META).map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Runtime</label>
                <select
                  style={selectStyle}
                  value={editNodeForm.runtime ?? ''}
                  onChange={e => setEditNodeForm(f => ({ ...f, runtime: e.target.value }))}
                >
                  <option value="">none (logical)</option>
                  <option value="libvirt">libvirt (VM)</option>
                  <option value="docker">docker (Container)</option>
                  <option value="app">app (Application)</option>
                  <option value="remote">remote (SSH)</option>
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Parent</label>
                <select
                  style={selectStyle}
                  value={editNodeForm.parent ?? ''}
                  onChange={e => setEditNodeForm(f => ({ ...f, parent: e.target.value }))}
                >
                  <option value="">— none —</option>
                  {nodes.filter(n => n.id !== editNodeId).map(n => {
                    const lbl = (n.properties as any)?.label
                    return <option key={n.id} value={n.id}>{lbl ? `${lbl} (${n.id})` : n.id}</option>
                  })}
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Env file</label>
                <input
                  style={inputStyle}
                  value={editNodeForm.env ?? ''}
                  onChange={e => setEditNodeForm(f => ({ ...f, env: e.target.value }))}
                  placeholder="e.g. capabilities-node-r1.json"
                />

                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={handleSaveNodeEdit} style={btnStyle('#a6e3a1')}>
                    <Save size={11} /> Save
                  </button>
                  <button onClick={() => setEditNodeId(null)} style={btnStyle('#6c7086')}>
                    <X size={11} /> Cancel
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Link / Network-membership edge selected ─── */}
          {selLink && !newLinkForm && (
            <>
              {sectionTitle('Selected Link')}
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>
                  {selLink.label ?? selLink.id}
                </div>
                {[
                  ['ID', selLink.id],
                  ['Type', selLink.type],
                  ['Source', `${selLink.source.node} : ${selLink.source.interface}`],
                  ['Target', `${selLink.target.node} : ${selLink.target.interface}`],
                  ['Bridge', selLink.bridge ?? '—'],
                  ['Segment', selLink.segment ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--surface0)' }}>
                    <span style={{ color: 'var(--subtext0)', fontSize: 10 }}>{k}</span>
                    <span style={{ color: 'var(--text)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{v}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button onClick={() => handleDeleteLink(selLink.id)} style={btnStyle('#f38ba8')}>
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>
            </>
          )}
          {/* ── Network-membership edge selected ───────────── */}
          {!selLink && selectedEdge?.startsWith('net-edge-') && !newLinkForm && (() => {
            const parts = selectedEdge.split('-')
            // net-edge-{nodeId}-{ifaceId}-{networkId} — but IDs may contain dashes
            // Parse: after "net-edge-" find the node, interface, and network
            const suffix = selectedEdge.replace('net-edge-', '')
            let parsedNodeId = '', parsedIfaceId = '', parsedNetId = ''
            for (const n of nodes) {
              if (suffix.startsWith(n.id + '-')) {
                parsedNodeId = n.id
                const rest = suffix.slice(n.id.length + 1)
                for (const ifc of (n.interfaces ?? [])) {
                  if (rest.startsWith(ifc.id + '-')) {
                    parsedIfaceId = ifc.id
                    parsedNetId = rest.slice(ifc.id.length + 1)
                    break
                  }
                }
                break
              }
            }
            if (!parsedNodeId || !parsedIfaceId || !parsedNetId) return null
            const nd = networkDefs.find(n => n.network_id === parsedNetId)
            const ndColor = nd ? (NET_PALETTE_COLORS[nd.type] ?? '#6c7086') : '#6c7086'
            return (
              <>
                {sectionTitle('Network Connection')}
                <div style={{ padding: 12 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                  }}>
                    <Cloud size={14} color={ndColor} />
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                      {nd?.label ?? parsedNetId}
                    </span>
                  </div>
                  {[
                    ['Node', parsedNodeId],
                    ['Interface', parsedIfaceId],
                    ['Network', parsedNetId],
                    ['Type', nd?.type ?? '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--surface0)' }}>
                      <span style={{ color: 'var(--subtext0)', fontSize: 10 }}>{k}</span>
                      <span style={{ color: 'var(--text)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <button
                      onClick={() => handleDisconnectIfaceNet(parsedNodeId, parsedIfaceId, parsedNetId)}
                      style={btnStyle('#f38ba8')}
                    >
                      <Unlink size={11} /> Disconnect
                    </button>
                  </div>
                </div>
              </>
            )
          })()}

          {/* ── Link creation form ─────────────────────────── */}
          {newLinkForm && (
            <>
              {sectionTitle('New Link')}
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Link ID</label>
                <input
                  style={inputStyle}
                  value={newLinkForm.id}
                  onChange={e => setNewLinkForm(f => f ? { ...f, id: e.target.value } : f)}
                />

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Type</label>
                <select
                  style={selectStyle}
                  value={newLinkForm.type}
                  onChange={e => setNewLinkForm(f => f ? { ...f, type: e.target.value } : f)}
                >
                  {LINK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Source node</label>
                <select
                  style={selectStyle}
                  value={newLinkForm.srcNode}
                  onChange={e => setNewLinkForm(f => f ? { ...f, srcNode: e.target.value } : f)}
                >
                  <option value="">— select —</option>
                  {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Source interface</label>
                <select
                  style={selectStyle}
                  value={newLinkForm.srcIface}
                  onChange={e => setNewLinkForm(f => f ? { ...f, srcIface: e.target.value } : f)}
                >
                  <option value="">— auto —</option>
                  {(nodes.find(n => n.id === newLinkForm.srcNode)?.interfaces ?? []).map(i => (
                    <option key={i.id} value={i.id}>{i.label ?? i.id}</option>
                  ))}
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Target node</label>
                <select
                  style={selectStyle}
                  value={newLinkForm.tgtNode}
                  onChange={e => setNewLinkForm(f => f ? { ...f, tgtNode: e.target.value } : f)}
                >
                  <option value="">— select —</option>
                  {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                </select>

                <label style={{ fontSize: 9, color: 'var(--subtext0)', fontWeight: 600 }}>Target interface</label>
                <select
                  style={selectStyle}
                  value={newLinkForm.tgtIface}
                  onChange={e => setNewLinkForm(f => f ? { ...f, tgtIface: e.target.value } : f)}
                >
                  <option value="">— auto —</option>
                  {(nodes.find(n => n.id === newLinkForm.tgtNode)?.interfaces ?? []).map(i => (
                    <option key={i.id} value={i.id}>{i.label ?? i.id}</option>
                  ))}
                </select>

                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    onClick={handleSaveLink}
                    disabled={!newLinkForm.srcNode || !newLinkForm.tgtNode}
                    style={{
                      ...btnStyle('#a6e3a1'),
                      opacity: (!newLinkForm.srcNode || !newLinkForm.tgtNode) ? 0.4 : 1,
                    }}
                  >
                    <Save size={11} /> Create
                  </button>
                  <button onClick={() => setNewLinkForm(null)} style={btnStyle('#6c7086')}>
                    <X size={11} /> Cancel
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Nothing selected ───────────────────────────── */}
          {!selNode && !selLink && !editNodeId && !newLinkForm && !selectedEdge?.startsWith('net-edge-') && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--overlay0)' }}>
              <Eye size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div style={{ fontSize: 11, fontWeight: 500 }}>
                Select a node or link to view properties
              </div>
              <div style={{ fontSize: 9, marginTop: 4, color: 'var(--overlay0)' }}>
                or use the palette to add nodes
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Capabilities modal ───────────────────────────────────── */}
      {capsNode && (
        <CapabilitiesModal
          node={capsNode}
          onClose={() => setCapsNode(null)}
          onRefresh={onMutate}
        />
      )}
    </div>
  )
}
