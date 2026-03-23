/* triv WebUI — NetStats: comprehensive network infrastructure viewer
 *
 * Full-page dashboard showing live state of all triv-managed network
 * elements: Linux bridges (with members), Docker networks, veth pairs,
 * VLAN sub-interfaces, tap devices, libvirt networks, and iptables rules.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Activity, RefreshCw, Loader2, Trash2,
  Network, Box, Cable, Layers, Server, Shield, ChevronDown, ChevronRight,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────

interface BridgeMember {
  name: string; state: string; kind: string; mtu?: number; mac?: string
}
interface BridgeInfo {
  name: string; source: string; link?: string; logical?: string
  state: string; stp: boolean; stale?: boolean
  stats?: { tx_packets: number; rx_packets: number; tx_bytes: number; rx_bytes: number }
  members: BridgeMember[]
}
interface DockerNet {
  name: string; driver: string; scope: string; id: string
  subnet?: string; gateway?: string; bridge_name?: string
  containers?: { name: string; ipv4: string; mac: string }[]
}
interface VethInfo {
  name: string; state: string; master: string; peer?: string; mtu?: number; mac?: string
}
interface VlanInfo {
  name: string; state: string; vlan_id?: number; master: string; ip?: string; mtu?: number
}
interface TapInfo {
  name: string; state: string; master: string; mtu?: number; mac?: string
}
interface LibvirtNet {
  name: string; active: boolean; autostart: boolean; persistent: boolean; bridge?: string
}
interface IptablesRule {
  table: string; chain: string; rule: string
}
interface NetStatsData {
  bridges: BridgeInfo[]
  docker_networks: DockerNet[]
  veths: VethInfo[]
  vlans: VlanInfo[]
  taps: TapInfo[]
  libvirt_networks: LibvirtNet[]
  iptables_rules: IptablesRule[]
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function fmtPkts(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function StateDot({ state }: { state: string }) {
  const up = state === 'UP' || state === 'up'
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: up ? '#a6e3a1' : state === 'DOWN' || state === 'down' ? '#f38ba8' : '#f9e2af',
      flexShrink: 0,
    }} />
  )
}

const TAG_STYLE: React.CSSProperties = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', gap: 3,
}

function Tag({ children, color = 'var(--overlay1)', bg = 'var(--surface1)' }: {
  children: React.ReactNode; color?: string; bg?: string
}) {
  return <span style={{ ...TAG_STYLE, background: bg, color }}>{children}</span>
}

// ── Section component ────────────────────────────────────────────────

function Section({ title, icon, count, color = 'var(--blue)', children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; count: number; color?: string
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text)', width: '100%', padding: '6px 0',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        <span style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 10,
          background: `${color}20`, color, fontWeight: 700,
        }}>{count}</span>
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  )
}

// ── Card wrapper ─────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  padding: '8px 10px', marginBottom: 6, borderRadius: 6,
  background: 'var(--surface0)', border: '1px solid var(--surface1)',
  fontSize: 11,
}

// ── Bridge card ──────────────────────────────────────────────────────

function BridgeCard({ br, onDelete }: { br: BridgeInfo; onDelete?: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ ...CARD, ...(br.stale ? { opacity: 0.65, borderColor: '#f38ba840' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
           onClick={() => setExpanded(e => !e)}>
        <StateDot state={br.state} />
        <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{br.name}</span>
        {br.logical && <Tag color="#89b4fa" bg="#89b4fa18">{br.logical}</Tag>}
        {br.stale && <Tag color="#f38ba8" bg="#f38ba818">stale</Tag>}
        {br.stp && <Tag color="#a6e3a1" bg="#a6e3a118">STP</Tag>}
        <Tag>{br.source}</Tag>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--subtext0)' }}>
          {br.members.length} member{br.members.length !== 1 ? 's' : ''}
        </span>
        {br.stale && onDelete && (
          <button
            title="Remove stale bridge"
            onClick={e => { e.stopPropagation(); onDelete(br.name) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, display: 'flex', color: '#f38ba8',
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
        {expanded ? <ChevronDown size={12} color="var(--overlay1)" /> : <ChevronRight size={12} color="var(--overlay1)" />}
      </div>
      {br.stats && (
        <div style={{ fontSize: 9, color: 'var(--overlay1)', marginTop: 3 }}>
          TX {fmtPkts(br.stats.tx_packets)} pkts ({fmtBytes(br.stats.tx_bytes)})
          {' · '}
          RX {fmtPkts(br.stats.rx_packets)} pkts ({fmtBytes(br.stats.rx_bytes)})
        </div>
      )}
      {expanded && br.members.length > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid var(--surface1)' }}>
          {br.members.map(m => (
            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontSize: 10 }}>
              <StateDot state={m.state} />
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{m.name}</span>
              <Tag color={
                m.kind === 'tap' ? '#cba6f7' :
                m.kind === 'veth' ? '#89dceb' :
                m.kind === 'vlan' ? '#a6e3a1' : 'var(--overlay1)'
              } bg={
                m.kind === 'tap' ? '#cba6f718' :
                m.kind === 'veth' ? '#89dceb18' :
                m.kind === 'vlan' ? '#a6e3a118' : 'var(--surface1)'
              }>{m.kind}</Tag>
              {m.mac && <span style={{ color: 'var(--subtext0)', fontFamily: 'monospace', fontSize: 9 }}>{m.mac}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Docker network card ──────────────────────────────────────────────

function DockerNetCard({ net }: { net: DockerNet }) {
  const [expanded, setExpanded] = useState(false)
  const cCount = net.containers?.length ?? 0
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
           onClick={() => setExpanded(e => !e)}>
        <Box size={12} color="#f38ba8" />
        <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{net.name}</span>
        <Tag color="#f38ba8" bg="#f38ba818">{net.driver}</Tag>
        {net.subnet && <Tag color="#89b4fa" bg="#89b4fa18">{net.subnet}</Tag>}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--subtext0)' }}>
          {cCount} container{cCount !== 1 ? 's' : ''}
        </span>
        {expanded ? <ChevronDown size={12} color="var(--overlay1)" /> : <ChevronRight size={12} color="var(--overlay1)" />}
      </div>
      {net.bridge_name && (
        <div style={{ fontSize: 9, color: 'var(--overlay1)', marginTop: 2 }}>
          Host bridge: <span style={{ fontFamily: 'monospace' }}>{net.bridge_name}</span>
          {net.gateway && <> · GW: <span style={{ fontFamily: 'monospace' }}>{net.gateway}</span></>}
        </div>
      )}
      {expanded && net.containers && net.containers.length > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid var(--surface1)' }}>
          {net.containers.map(c => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontSize: 10 }}>
              <Server size={10} color="#89dceb" />
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              {c.ipv4 && <span style={{ fontFamily: 'monospace', color: 'var(--subtext0)', fontSize: 9 }}>{c.ipv4}</span>}
              {c.mac && <span style={{ fontFamily: 'monospace', color: 'var(--overlay0)', fontSize: 9 }}>{c.mac}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────

export default function NetStats() {
  const [data, setData] = useState<NetStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const doFetch = useCallback(() => {
    setLoading(true)
    fetch('/api/netstats')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const staleCount = data?.bridges.filter(b => b.stale).length ?? 0

  const removeBridge = useCallback((name: string) => {
    fetch(`/api/netstats/bridges/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => doFetch())
  }, [doFetch])

  const cleanupStale = useCallback(() => {
    fetch('/api/netstats/cleanup-stale', { method: 'POST' })
      .then(r => r.json())
      .then(() => doFetch())
  }, [doFetch])

  useEffect(() => {
    doFetch()
    const id = setInterval(doFetch, 8000)
    return () => clearInterval(id)
  }, [doFetch])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--surface0)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--mantle)', flexShrink: 0,
      }}>
        <Activity size={16} color="#74c7ec" />
        <span style={{ fontWeight: 700, fontSize: 15 }}>Net Stats</span>
        <span style={{ fontSize: 11, color: 'var(--subtext0)' }}>
          Live infrastructure snapshot
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={doFetch} disabled={loading} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6, border: 'none',
          background: 'var(--surface0)', color: 'var(--text)',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
        {staleCount > 0 && (
          <button onClick={cleanupStale} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6, border: 'none',
            background: '#f38ba818', color: '#f38ba8',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            <Trash2 size={12} />
            Clean Stale ({staleCount})
          </button>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, marginBottom: 12,
            background: '#f38ba812', border: '1px solid #f38ba830',
            color: '#f38ba8', fontSize: 11,
          }}>
            Failed to load: {error}
          </div>
        )}

        {!data && loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--subtext0)' }}>
            <Loader2 size={20} className="spin" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 12 }}>Loading network stats…</div>
          </div>
        )}

        {data && (
          <>
            {/* ── Summary counters ──────────────────────────── */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 8, marginBottom: 16,
            }}>
              <CounterBox icon={<Network size={14} />} label="Bridges" value={data.bridges.length} color="#89b4fa" />
              <CounterBox icon={<Box size={14} />} label="Docker Nets" value={data.docker_networks.length} color="#f38ba8" />
              <CounterBox icon={<Cable size={14} />} label="Veth Pairs" value={data.veths.length} color="#89dceb" />
              <CounterBox icon={<Layers size={14} />} label="VLANs" value={data.vlans.length} color="#a6e3a1" />
              <CounterBox icon={<Server size={14} />} label="Tap Devices" value={data.taps.length} color="#cba6f7" />
              <CounterBox icon={<Shield size={14} />} label="iptables" value={data.iptables_rules.length} color="#f9e2af" />
            </div>

            {/* ── Bridges ──────────────────────────────────── */}
            {data.bridges.length > 0 && (
              <Section title="Linux Bridges" icon={<Network size={14} />} count={data.bridges.length} color="#89b4fa">
                {data.bridges.map(br => <BridgeCard key={br.name} br={br} onDelete={removeBridge} />)}
              </Section>
            )}

            {/* ── Docker Networks ──────────────────────────── */}
            {data.docker_networks.length > 0 && (
              <Section title="Docker Networks" icon={<Box size={14} />} count={data.docker_networks.length} color="#f38ba8">
                {data.docker_networks.map(n => <DockerNetCard key={n.name} net={n} />)}
              </Section>
            )}

            {/* ── Veth Pairs ──────────────────────────────── */}
            {data.veths.length > 0 && (
              <Section title="Veth Pairs" icon={<Cable size={14} />} count={data.veths.length} color="#89dceb">
                {data.veths.map(v => (
                  <div key={v.name} style={CARD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <StateDot state={v.state} />
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{v.name}</span>
                      {v.master && <Tag>master: {v.master}</Tag>}
                      {v.peer && <Tag color="#89dceb" bg="#89dceb18">peer: {v.peer}</Tag>}
                      {v.mac && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--subtext0)' }}>{v.mac}</span>}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* ── VLANs ───────────────────────────────────── */}
            {data.vlans.length > 0 && (
              <Section title="VLAN Sub-interfaces" icon={<Layers size={14} />} count={data.vlans.length} color="#a6e3a1">
                {data.vlans.map(v => (
                  <div key={v.name} style={CARD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <StateDot state={v.state} />
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{v.name}</span>
                      {v.vlan_id != null && <Tag color="#a6e3a1" bg="#a6e3a118">VLAN {v.vlan_id}</Tag>}
                      {v.master && <Tag>master: {v.master}</Tag>}
                      {v.ip && <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#89b4fa' }}>{v.ip}</span>}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* ── Taps ────────────────────────────────────── */}
            {data.taps.length > 0 && (
              <Section title="Tap Devices (VMs)" icon={<Server size={14} />} count={data.taps.length} color="#cba6f7">
                {data.taps.map(t => (
                  <div key={t.name} style={CARD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <StateDot state={t.state} />
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{t.name}</span>
                      {t.master && <Tag color="#cba6f7" bg="#cba6f718">bridge: {t.master}</Tag>}
                      {t.mac && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--subtext0)' }}>{t.mac}</span>}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* ── Libvirt Networks ─────────────────────────── */}
            {data.libvirt_networks.length > 0 && (
              <Section title="Libvirt Networks" icon={<Network size={14} />} count={data.libvirt_networks.length} color="#f9e2af" defaultOpen={false}>
                {data.libvirt_networks.map(n => (
                  <div key={n.name} style={CARD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <StateDot state={n.active ? 'UP' : 'DOWN'} />
                      <span style={{ fontWeight: 700, fontSize: 11 }}>{n.name}</span>
                      {n.bridge && <Tag color="#f9e2af" bg="#f9e2af18">{n.bridge}</Tag>}
                      {n.autostart && <Tag color="#a6e3a1" bg="#a6e3a118">autostart</Tag>}
                      {n.persistent && <Tag>persistent</Tag>}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* ── iptables ─────────────────────────────────── */}
            {data.iptables_rules.length > 0 && (
              <Section title="iptables Rules (triv)" icon={<Shield size={14} />} count={data.iptables_rules.length} color="#f9e2af" defaultOpen={false}>
                {data.iptables_rules.map((r, i) => (
                  <div key={i} style={{
                    ...CARD, fontFamily: 'monospace', fontSize: 10,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    <Tag color="#f9e2af" bg="#f9e2af18">{r.table}/{r.chain}</Tag>
                    <div style={{ marginTop: 3, color: 'var(--subtext0)' }}>{r.rule}</div>
                  </div>
                ))}
              </Section>
            )}

            {/* ── Empty state ──────────────────────────────── */}
            {data.bridges.length === 0 && data.docker_networks.length === 0 &&
             data.veths.length === 0 && data.vlans.length === 0 &&
             data.taps.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--subtext0)' }}>
                <Network size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div style={{ fontSize: 13 }}>No network infrastructure detected</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  Deploy a network or connect nodes to see elements here.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Counter box ──────────────────────────────────────────────────────

function CounterBox({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string
}) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--surface0)', border: '1px solid var(--surface1)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ color }}>{icon}</span>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: 9, color: 'var(--subtext0)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}
