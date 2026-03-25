/* triv WebUI — Shared TypeScript types */

export interface InterfaceDef {
  id: string
  type: string
  direction?: string
  label?: string
  description?: string
  speed?: string
  connector?: string
  ip?: string
  vlan?: number
  mac?: string
  networks?: string[]
}

export interface ActionDef {
  id: string
  type: 'console' | 'exec' | 'exec-with-data' | 'exec-output' | 'ssh' | 'link' | 'webui' | 'define-vm' | 'define-container' | 'driver-command' | 'network-connect' | 'container-remove' | 'vm-destroy-clean' | 'tool'
  label: string
  icon?: string
  command?: string
  confirm?: string
  data?: string
  data_source?: 'inline' | 'file-picker'
  data_prompt?: string
  file_filter?: string
  host?: string
  user?: string
  port?: number
  password?: string
  url?: string
  driver?: string
  origin?: string
}

export interface HealthResult {
  status: 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown'
  last_check?: number   // Unix timestamp
  error?: string | null
  configured?: boolean
}

export interface NodeDef {
  id: string
  driver: string
  category: string
  runtime: string | null
  parent: string | null
  interfaces: InterfaceDef[]
  properties: Record<string, any>
  env?: string
  // enriched by backend
  vm_name?: string
  label?: string        // display name from properties.label (overrides vm_name for display)
  state?: string
  driver_meta?: {
    vendor: string
    accent_color: string
    logo_url?: string
  }
  driver_args?: Record<string, any>
  actions?: ActionDef[]
  health?: HealthResult | null
  position?: { x: number; y: number } | null
}

export interface LinkEndpoint {
  node: string
  interface: string
  // Enriched by backend
  interface_label?: string
  interface_type?: string
  interface_ip?: string
  interface_direction?: string
  interface_connector?: string
}

export interface LinkDef {
  id: string
  type: string
  medium?: string
  medium_group?: 'physical' | 'wireless' | 'logical'
  bidir?: boolean
  source: LinkEndpoint
  target: LinkEndpoint
  segment?: string
  label?: string
  description?: string
  properties?: Record<string, any>
  network?: Record<string, any>
  bridge?: string
  bridge_state?: string
  docker_network_status?: string
  discovered?: boolean  // true for live-discovered links not in topology JSON
}

export interface NetworkDefDef {
  id: string
  network_id: string
  label: string
  description?: string
  type: string
  bridge?: string
  subnet?: string
  gateway?: string
  vlan?: number
  position?: { x: number; y: number }
}

export interface TopologyDef {
  version: string
  name: string
  nodes: NodeDef[]
  links: LinkDef[]
  networks?: Record<string, any>
  actions?: ActionDef[]
  network_defs?: NetworkDefDef[]
  network_statuses?: Record<string, any>
}

export interface DriverInfo {
  name: string
  vendor: string
  label: string
  version: string
  accent_color: string
  logo_url?: string
  actions: { name: string; label: string; icon: string; description: string }[]
}

export interface BridgeStatus {
  name: string
  link: string | null
  state: string
  stp: boolean
  attached: string[]
  stats: { tx_packets: number; rx_packets: number; tx_bytes: number; rx_bytes: number }
}

export interface SystemStatus {
  project: string
  topology_name: string
  uptime_seconds: number
  node_count: number
  link_count: number
  drivers_used: string[]
  drivers_available: string[]
  plugins_loaded: string[]
  nodes: NodeDef[]
  health: {
    loops: string[]
    orphans: Record<string, string[]>
    has_orphans: boolean
    bridge_count: number
    vlan_count: number
  }
}

// Category display info
export const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
  rack:       { icon: 'Server',       label: 'Rack',       color: '#6c7086' },
  chassis:    { icon: 'HardDrive',    label: 'Chassis',    color: '#89b4fa' },
  cluster:    { icon: 'Layers',       label: 'Cluster',    color: '#89dceb' },
  group:      { icon: 'Folder',       label: 'Group',      color: '#a6adc8' },
  controller: { icon: 'Cpu',          label: 'Controller', color: '#a6e3a1' },
  linecard:   { icon: 'CircuitBoard', label: 'Linecard',   color: '#94e2d5' },
  switch:     { icon: 'Network',      label: 'Switch',     color: '#cba6f7' },
  router:     { icon: 'Globe',        label: 'Router',     color: '#fab387' },
  gateway:    { icon: 'ArrowLeftRight', label: 'Gateway',  color: '#f9e2af' },
  server:     { icon: 'Monitor',      label: 'Server',     color: '#74c7ec' },
  pc:         { icon: 'Monitor',      label: 'PC',         color: '#89dceb' },
  beacon:     { icon: 'Radio',        label: 'Beacon',     color: '#f5c2e7' },
  network:    { icon: 'Network',      label: 'Network',    color: '#f9e2af' },  // discovered hub
  generic:    { icon: 'Box',          label: 'Device',     color: '#6c7086' },
  llm:        { icon: 'Cpu',          label: 'LLM',        color: '#cba6f7' },
  agent:      { icon: 'Zap',          label: 'Agent',      color: '#f5c2e7' },
}

// Health status display
export const HEALTH_COLOR: Record<string, string> = {
  healthy:   '#a6e3a1',
  unhealthy: '#f38ba8',
  starting:  '#f9e2af',
  none:      '#6c7086',
  unknown:   '#585b70',
}

export const RUNTIME_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  libvirt:  { label: 'VM',        color: '#a6e3a1', bg: '#a6e3a120' },
  docker:   { label: 'Container', color: '#89b4fa', bg: '#89b4fa20' },
  podman:   { label: 'Container', color: '#89b4fa', bg: '#89b4fa20' },
  physical: { label: 'Physical',  color: '#fab387', bg: '#fab38720' },
  app:      { label: 'App',       color: '#f5c2e7', bg: '#f5c2e720' },
  remote:   { label: 'Remote',    color: '#fab387', bg: '#fab38720' },
  llm:      { label: 'LLM',       color: '#cba6f7', bg: '#cba6f720' },
  agent:    { label: 'Agent',     color: '#f5c2e7', bg: '#f5c2e720' },
}

export const STATE_COLOR: Record<string, string> = {
  running:    '#a6e3a1',
  'shut off': '#f38ba8',
  online:     '#a6e3a1',
  offline:    '#f38ba8',
  logical:    '#6c7086',
  undefined:  '#585b70',
  paused:     '#f9e2af',
  crashed:    '#f38ba8',
  // Docker-specific states
  created:    '#89b4fa',
  exited:     '#f38ba8',
  dead:       '#f38ba8',
  removing:   '#f9e2af',
  restarting: '#f9e2af',
}

/* ── Project management types ──────────────────────────────────── */

export interface ProjectDef {
  id: string
  name: string
  path: string
  description?: string
  active?: boolean
  has_topology?: boolean
}

export interface ProjectsResponse {
  active: string
  last_active?: string
  active_org?: string
  projects: ProjectDef[]
}
