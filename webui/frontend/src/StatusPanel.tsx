/* triv WebUI — StatusPanel: system health & network status */

import React from 'react'
import {
  Activity, AlertTriangle, CheckCircle, Wifi, Shield,
  Clock, Layers, Unplug, Server, Cpu,
} from 'lucide-react'
import type { SystemStatus, BridgeStatus } from './types'

interface Props {
  status: SystemStatus | null
  bridges: BridgeStatus[]
}

export default function StatusPanel({ status, bridges }: Props) {
  if (!status) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--subtext0)' }}>
        <Activity size={20} className="spin" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 12 }}>Loading status…</div>
      </div>
    )
  }

  const healthy = !status.health.has_orphans && status.health.loops.length === 0
  const orphanCount = Object.values(status.health.orphans).flat().length

  return (
    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text)' }}>
      {/* Health badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderRadius: 8,
        background: healthy ? '#a6e3a112' : '#f38ba812',
        border: `1px solid ${healthy ? '#a6e3a130' : '#f38ba830'}`,
        marginBottom: 12,
      }}>
        {healthy
          ? <CheckCircle size={16} color="#a6e3a1" />
          : <AlertTriangle size={16} color="#f38ba8" />}
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {healthy ? 'System Healthy' : 'Issues Detected'}
          </div>
          {!healthy && (
            <div style={{ fontSize: 10, color: 'var(--subtext0)', marginTop: 2 }}>
              {status.health.loops.length > 0 && `${status.health.loops.length} loop(s) · `}
              {orphanCount > 0 && `${orphanCount} orphan(s)`}
            </div>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 8, marginBottom: 14,
      }}>
        <StatBox icon={<Server size={12} />} label="Nodes" value={status.node_count} />
        <StatBox icon={<Unplug size={12} />} label="Links" value={status.link_count} />
        <StatBox icon={<Wifi size={12} />} label="Bridges" value={status.health.bridge_count} />
        <StatBox icon={<Layers size={12} />} label="VLANs" value={status.health.vlan_count} />
      </div>

      {/* Drivers */}
      <Section title="Drivers" icon={<Cpu size={11} />}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {status.drivers_used.map(d => (
            <span key={d} style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 4,
              background: 'var(--surface1)', color: 'var(--text)',
            }}>{d}</span>
          ))}
          {status.drivers_available
            .filter(d => !status.drivers_used.includes(d))
            .map(d => (
              <span key={d} style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: 'var(--surface0)', color: 'var(--overlay1)',
              }}>{d}</span>
            ))}
        </div>
      </Section>

      {/* Plugins */}
      {status.plugins_loaded.length > 0 && (
        <Section title="Plugins" icon={<Shield size={11} />}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {status.plugins_loaded.map(p => (
              <span key={p} style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: '#cba6f715', color: '#cba6f7',
              }}>{p}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Bridges / Networks */}
      {bridges.length > 0 && (
        <Section title="Networks" icon={<Wifi size={11} />}>
          {bridges.map(br => (
            <div key={br.name} style={{
              padding: '6px 8px', marginBottom: 4, borderRadius: 6,
              background: 'var(--surface0)', border: '1px solid var(--surface1)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: br.state === 'UP' ? '#a6e3a1' : '#f38ba8',
                }} />
                <span style={{ fontWeight: 600, fontSize: 11 }}>{br.name}</span>
                {br.stp && (
                  <span style={{
                    fontSize: 8, padding: '0 3px', borderRadius: 2,
                    background: '#89b4fa20', color: '#89b4fa',
                  }}>STP</span>
                )}
                <span style={{
                  fontSize: 9, color: 'var(--subtext0)', marginLeft: 'auto',
                }}>
                  {br.attached.length} attached
                </span>
              </div>
              {br.stats && (
                <div style={{ fontSize: 9, color: 'var(--overlay1)', marginTop: 3 }}>
                  TX {fmtBytes(br.stats.tx_bytes)} · RX {fmtBytes(br.stats.rx_bytes)}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Loops warning */}
      {status.health.loops.length > 0 && (
        <Section title="L2 Loops Detected" icon={<AlertTriangle size={11} color="#f38ba8" />}>
          {status.health.loops.map((loop, i) => (
            <div key={i} style={{
              fontSize: 10, color: '#f38ba8', padding: '4px 6px',
              background: '#f38ba810', borderRadius: 4, marginBottom: 2,
            }}>
              {loop}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 6,
      background: 'var(--surface0)', border: '1px solid var(--surface1)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ color: 'var(--overlay1)' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: 9, color: 'var(--subtext0)', marginTop: 1 }}>{label}</div>
      </div>
    </div>
  )
}

function Section({ title, icon, children }: {
  title: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 10, fontWeight: 600, color: 'var(--subtext0)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        marginBottom: 6,
      }}>
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`
}
