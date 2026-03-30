/* triv WebUI — React hooks for API data fetching */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from './apiFetch'
import type { NodeDef, DriverInfo, LinkDef, TopologyDef, SystemStatus, BridgeStatus, ProjectsResponse, ActionDef } from './types'

// Generic poll hook
function usePoll<T>(url: string, interval: number, initial: T): { data: T; refresh: () => void; loading: boolean } {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)

  const doFetch = useCallback(() => {
    apiFetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [url])

  useEffect(() => {
    doFetch()
    const id = setInterval(doFetch, interval)
    return () => clearInterval(id)
  }, [doFetch, interval])

  return { data, refresh: doFetch, loading }
}

// Nodes with runtime state — polls every 4s
export function useNodes() {
  return usePoll<NodeDef[]>('/api/nodes', 4000, [])
}

// Full system status — polls every 6s
export function useSystemStatus() {
  return usePoll<SystemStatus | null>('/api/status', 6000, null)
}

// Topology (static, fetched once)
export function useTopology() {
  const [topo, setTopo] = useState<TopologyDef | null>(null)
  const [rev, setRev] = useState(0)
  useEffect(() => {
    apiFetch('/api/topology').then(r => r.json()).then(setTopo).catch(() => {})
  }, [rev])
  const refresh = useCallback(() => setRev(r => r + 1), [])
  return { data: topo, refresh }
}

// Drivers list (refreshable)
export function useDrivers() {
  const [drivers, setDrivers] = useState<DriverInfo[]>([])
  const [rev, setRev] = useState(0)
  useEffect(() => {
    apiFetch('/api/drivers').then(r => r.json()).then(setDrivers).catch(() => {})
  }, [rev])
  const refresh = useCallback(() => setRev(r => r + 1), [])
  return { data: drivers, refresh }
}

// Links (enriched with network info, polls every 6s)
export function useLinks() {
  return usePoll<LinkDef[]>('/api/links', 6000, [])
}

// Networks (bridges) — polls every 5s
interface NetworksResponse {
  bridges: BridgeStatus[]
}
export function useNetworks() {
  const raw = usePoll<NetworksResponse>('/api/networks', 5000, { bridges: [] })
  return { data: raw.data.bridges, refresh: raw.refresh, loading: raw.loading }
}

// Connectivity — on-demand (triggered manually, or polls every 15s)
export function useConnectivity() {
  return usePoll<any>('/api/connectivity', 15000, null)
}

// Ping single node — on demand
export function usePingNode() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const ping = useCallback(async (nodeId: string) => {
    setLoading(true)
    try {
      const r = await apiFetch(`/api/ping/${nodeId}`)
      const data = await r.json()
      setResult(data)
      return data
    } finally {
      setLoading(false)
    }
  }, [])
  return { result, ping, loading }
}

// Single action (POST)
export function useAction() {
  const [busy, setBusy] = useState(false)
  const act = useCallback(async (url: string, body?: any) => {
    setBusy(true)
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      })
      return await res.json()
    } finally {
      setBusy(false)
    }
  }, [])
  return { act, busy }
}

// Topology-level actions (resolved, fetched once + refreshable)
export function useTopologyActions() {
  const [actions, setActions] = useState<ActionDef[]>([])
  const [rev, setRev] = useState(0)
  useEffect(() => {
    apiFetch('/api/topology/actions')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setActions)
      .catch(() => setActions([]))
  }, [rev])
  const refresh = useCallback(() => setRev(r => r + 1), [])

  const executeAction = useCallback(async (actionId: string): Promise<any> => {
    const res = await apiFetch(`/api/topology/action/${actionId}`, { method: 'POST' })
    return res.json()
  }, [])

  return { actions, refresh, executeAction }
}

// Discovered links from live Docker network state (on-demand, not auto-polled)
export interface DiscoveredLinksResponse {
  nodes: NodeDef[]
  edges: LinkDef[]
}

export function useDiscoveredLinks() {
  const [data, setData] = useState<DiscoveredLinksResponse>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)

  const discover = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/api/links/discovered')
      const d = await r.json()
      setData(d)
      return d as DiscoveredLinksResponse
    } catch {
      return { nodes: [], edges: [] }
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setData({ nodes: [], edges: [] }), [])

  return { data, loading, discover, clear }
}

// Organizations management
export interface OrgDef {
  id: string
  name: string
  vendors: string[]
  active?: boolean
}

export interface OrgsResponse {
  orgs: OrgDef[]
  active_org: string
}

export function useOrgs() {
  const [data, setData] = useState<OrgsResponse>({ orgs: [], active_org: '' })
  const [loading, setLoading] = useState(true)

  const doFetch = useCallback(() => {
    apiFetch('/api/orgs')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { doFetch() }, [doFetch])

  const activate = useCallback(async (orgId: string) => {
    const res = await apiFetch(`/api/orgs/${orgId}/activate`, { method: 'POST' })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  const createOrg = useCallback(async (name: string, vendors?: string[]) => {
    const res = await apiFetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, vendors: vendors || [] }),
    })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  const updateOrg = useCallback(async (orgId: string, body: { name?: string; add_vendors?: string[]; remove_vendors?: string[] }) => {
    const res = await apiFetch(`/api/orgs/${orgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  const deleteOrg = useCallback(async (orgId: string) => {
    const res = await apiFetch(`/api/orgs/${orgId}`, { method: 'DELETE' })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  return { data, loading, refresh: doFetch, activate, createOrg, updateOrg, deleteOrg }
}

// Projects management
export function useProjects() {
  const [data, setData] = useState<ProjectsResponse>({ active: '', last_active: '', projects: [] })
  const [loading, setLoading] = useState(true)

  const doFetch = useCallback(() => {
    apiFetch('/api/projects')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { doFetch() }, [doFetch])

  const activate = useCallback(async (projectId: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/activate`, { method: 'POST' })
    const result = await res.json()
    if (result.ok) doFetch()
    else if (!result.ok && res.status === 409) {
      return { ok: false, detail: result.detail }
    }
    return result
  }, [doFetch])

  const addProject = useCallback(async (path: string, name?: string, description?: string) => {
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name: name || '', description: description || '' }),
    })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  const removeProject = useCallback(async (projectId: string) => {
    const res = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  const cleanupProject = useCallback(async (projectId: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/cleanup`, { method: 'POST' })
    if (!res.ok) throw new Error(`Cleanup failed: ${res.status} ${res.statusText}`)
    return await res.json()
  }, [])

  const scanDir = useCallback(async (path: string) => {
    const res = await apiFetch('/api/projects/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    return await res.json()
  }, [])

  const browseDir = useCallback(async (path: string) => {
    const res = await apiFetch('/api/projects/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    return await res.json()
  }, [])

  const getDefaults = useCallback(async () => {
    const res = await apiFetch('/api/projects/defaults')
    return await res.json()
  }, [])

  const createProject = useCallback(async (name: string, dirName?: string, description?: string) => {
    const res = await apiFetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dir_name: dirName || '', description: description || '' }),
    })
    const result = await res.json()
    if (result.ok) doFetch()
    return result
  }, [doFetch])

  return { data, loading, refresh: doFetch, activate, addProject, removeProject, cleanupProject, createProject, scanDir, browseDir, getDefaults }
}

// ── V2 Network Defs ──────────────────────────────────────────────────
export interface NetworkDefData {
  id: string
  network_id: string
  label: string
  description: string
  type: 'bridge' | 'vlan-bridge' | 'p2p' | 'trunk' | 'docker'
  bridge: string
  vlan?: number
  parent_network?: string
  stp: boolean
  vlan_filtering: boolean
  vlans?: number[]
  subnet?: string
  gateway?: string
  docker?: { enabled?: boolean; subnet?: string; gateway?: string; bridge_name?: string }
  host?: { ip?: string; prefix?: number; access?: boolean }
  internet?: { enabled?: boolean; masquerade_iface?: string; access?: boolean }
  status?: {
    network_id: string
    id: string
    deployed: boolean
    bridge_state: string
    docker_exists: boolean
    host_joined: boolean
    internet_active: boolean
  }
}

export function useNetworkDefs() {
  return usePoll<NetworkDefData[]>('/api/v2/networks', 4000, [])
}

// ── Network Catalog ──────────────────────────────────────────────────
export interface CatalogEntry {
  id: string
  label: string
  description: string
  type: string
  bridge: string
  subnet?: string
  stp?: boolean
  host?: { ip?: string; prefix?: number }
  internet?: { enabled?: boolean }
  _file: string
  assigned: boolean
  network_id?: string
}

export function useNetworkCatalog() {
  return usePoll<CatalogEntry[]>('/api/v2/networks/catalog', 5000, [])
}

// ── Network Templates (built-in types) ───────────────────────────────
export interface NetworkTemplate {
  id: string
  label: string
  type: string
  description: string
  color: string
  stp?: boolean
  vlan_filtering?: boolean
}

export function useNetworkTemplates() {
  const [data, setData] = useState<NetworkTemplate[]>([])
  useEffect(() => {
    apiFetch('/api/v2/networks/templates').then(r => r.json()).then(setData).catch(() => {})
  }, [])
  return { data }
}
