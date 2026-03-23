/* triv WebUI — ConnectivityPanel: link connectivity checks */

import React from 'react'
import {
  Wifi, RefreshCw, ArrowRight, Clock,
  CheckCircle, XCircle, AlertCircle, MinusCircle,
} from 'lucide-react'

/* ── Types matching new backend response ────────────────────────── */

interface CheckResult {
  reachable: boolean
  status_code?: number
  detail: string
  method: string
  from: string
  url?: string
  rtt_ms?: number
  check?: {
    label?: string
    from?: string
    method?: string
    url?: string
    auth?: string
    expected_status?: number
    timeout?: number
  }
}

interface LinkEntry {
  link_id: string
  label?: string
  type?: string
  source: { node: string; interface: string; ip: string | null }
  target: { node: string; interface: string; ip: string | null }
  reachable: boolean | null
  status: string          // "ok" | "fail" | "error" | "no-check"
  detail: string
  method?: string
  from_node?: string
  check_result?: CheckResult
}

interface ConnectivityResponse {
  links: LinkEntry[]
}

interface Props {
  data: ConnectivityResponse | null
  loading?: boolean
  onRefresh: () => void
}

/* ── Main Panel ─────────────────────────────────────────────────── */

export default function ConnectivityPanel({ data, loading, onRefresh }: Props) {
  const links = data?.links ?? []
  const checked   = links.filter(l => l.status !== 'no-check')
  const okCount   = checked.filter(l => l.status === 'ok').length
  const failCount = checked.filter(l => l.status === 'fail' || l.status === 'error').length
  const noCheck   = links.filter(l => l.status === 'no-check').length

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
      }}>
        <Wifi size={18} color="var(--teal)" />
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          Connectivity
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            background: 'var(--surface0)', border: '1px solid var(--surface1)',
            borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
            color: 'var(--subtext0)', display: 'flex', alignItems: 'center',
            gap: 4, fontSize: 11,
          }}
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {!data && !loading && (
        <div style={{ color: 'var(--subtext0)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
          Click Refresh to run connectivity checks.
        </div>
      )}

      {data && (
        <>
          {/* ── Summary stats ─────────────────────────────── */}
          <Section title="Summary">
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <StatBox label="Links"       value={links.length}  color="var(--blue)" />
              <StatBox label="OK"          value={okCount}       color="#a6e3a1" />
              <StatBox label="Failed"      value={failCount}     color={failCount > 0 ? '#f38ba8' : 'var(--subtext0)'} />
              <StatBox label="No Check"    value={noCheck}       color="var(--subtext0)" />
            </div>
          </Section>

          {/* ── Link results ──────────────────────────────── */}
          <Section title="Link Checks">
            {links.length === 0 && (
              <div style={{ color: 'var(--subtext0)', fontSize: 11 }}>
                No links defined in topology.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {links.map(link => (
                <LinkCheckCard key={link.link_id} link={link} />
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

/* ── Link check card ─────────────────────────────────────────────── */

function LinkCheckCard({ link }: { link: LinkEntry }) {
  const isOk      = link.status === 'ok'
  const isFail    = link.status === 'fail' || link.status === 'error'
  const isNoCheck = link.status === 'no-check'

  const borderColor = isOk ? '#a6e3a130' : isFail ? '#f38ba830' : 'var(--surface1)'
  const statusColor = isOk ? '#a6e3a1' : isFail ? '#f38ba8' : 'var(--subtext0)'
  const StatusIcon  = isOk ? CheckCircle : isFail ? XCircle : isNoCheck ? MinusCircle : AlertCircle

  const cr = link.check_result
  const checkLabel = cr?.check?.label

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--mantle)',
      border: `1px solid ${borderColor}`,
    }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <StatusIcon size={14} color={statusColor} />
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>
          {link.link_id}
        </span>
        {link.label && (
          <span style={{ fontSize: 10, color: 'var(--subtext0)', fontStyle: 'italic' }}>
            — {link.label}
          </span>
        )}
        {link.type && (
          <span style={{
            marginLeft: 'auto', fontSize: 9, padding: '1px 6px', borderRadius: 3,
            background: 'var(--surface0)', color: 'var(--subtext0)',
            fontWeight: 500, textTransform: 'uppercase',
          }}>
            {link.type}
          </span>
        )}
      </div>

      {/* Source → Target row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, color: 'var(--subtext1)',
      }}>
        {/* Source */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
            {link.source.node}
          </div>
          <div style={{ fontSize: 9, color: 'var(--subtext0)' }}>
            {link.source.interface}
          </div>
          {link.source.ip && (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--subtext1)', marginTop: 2,
            }}>
              {link.source.ip}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <ArrowRight size={14} color={statusColor} />
          <span style={{ fontSize: 8, color: statusColor, fontWeight: 600 }}>
            {isOk ? 'OK' : isFail ? 'FAIL' : isNoCheck ? 'N/A' : link.status.toUpperCase()}
          </span>
        </div>

        {/* Target */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
            {link.target.node}
          </div>
          <div style={{ fontSize: 9, color: 'var(--subtext0)' }}>
            {link.target.interface}
          </div>
          {link.target.ip && (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--subtext1)', marginTop: 2,
            }}>
              {link.target.ip}
            </div>
          )}
        </div>
      </div>

      {/* Check detail row */}
      {!isNoCheck && (
        <div style={{
          marginTop: 8, padding: '6px 8px', borderRadius: 6,
          background: 'var(--base)', fontSize: 10,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {/* Check label / method */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {checkLabel && (
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                {checkLabel}
              </span>
            )}
            {link.method && (
              <span style={{
                fontSize: 9, padding: '0 4px', borderRadius: 3,
                background: 'var(--surface0)', color: 'var(--subtext0)',
                fontFamily: 'var(--font-mono)',
              }}>
                {link.method}
              </span>
            )}
            {link.from_node && (
              <span style={{ fontSize: 9, color: 'var(--subtext0)' }}>
                from <span style={{ fontWeight: 600, color: 'var(--subtext1)' }}>{link.from_node}</span>
              </span>
            )}
          </div>

          {/* URL */}
          {cr?.url && (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'var(--subtext0)', wordBreak: 'break-all',
            }}>
              {cr.url}
            </div>
          )}

          {/* Result */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontWeight: 600,
              color: statusColor,
            }}>
              {link.detail}
            </span>
            {cr?.rtt_ms != null && (
              <span style={{
                marginLeft: 'auto', fontSize: 9, color: 'var(--subtext0)',
                display: 'flex', alignItems: 'center', gap: 2,
              }}>
                <Clock size={8} />
                {cr.rtt_ms.toFixed(1)}ms
              </span>
            )}
          </div>
        </div>
      )}

      {/* No-check hint */}
      {isNoCheck && (
        <div style={{
          marginTop: 6, fontSize: 9, color: 'var(--subtext0)',
          fontStyle: 'italic',
        }}>
          No connectivity_check defined for this link.
        </div>
      )}
    </div>
  )
}

/* ── Reusable helpers ────────────────────────────────────────────── */

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8,
      background: 'var(--surface0)', border: '1px solid var(--surface1)',
      minWidth: 80,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--subtext0)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--subtext0)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        marginBottom: 8, paddingLeft: 2,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}
