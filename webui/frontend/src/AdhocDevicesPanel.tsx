import { apiFetch } from './apiFetch'
/* triv WebUI — Ad-hoc devices panel (quick-add VM / container / physical) */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Edit3, Save, X, Monitor, Terminal,
  Server, Wifi, Key, AlertCircle,
} from 'lucide-react'
import { CATEGORY_META } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdhocDevice {
  id: string
  label: string
  category: string
  type: 'vm' | 'container' | 'physical'
  hostname: string
  port: number
  username: string
  password?: string | null
  key_file?: string | null
  driver: string
  properties: Record<string, any>
}

interface Props {
  onOpenTerminal: (target: { type: 'ssh'; target: string }) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdhocDevicesPanel({ onOpenTerminal }: Props) {
  const [devices, setDevices] = useState<AdhocDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<'create' | string | null>(null)

  const refresh = useCallback(() => {
    apiFetch('/api/adhoc').then(r => r.json()).then(d => { setDevices(d); setLoading(false) })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleDelete(id: string) {
    if (!confirm(`Remove ad-hoc device "${id}"?`)) return
    await apiFetch(`/api/adhoc/${id}`, { method: 'DELETE' })
    refresh()
  }

  function handleSSH(dev: AdhocDevice) {
    if (!dev.hostname) return
    const target = dev.username ? `${dev.username}@${dev.hostname}` : dev.hostname
    onOpenTerminal({ type: 'ssh', target })
  }

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          <Monitor size={18} style={{ verticalAlign: 'text-bottom', marginRight: 8 }} />
          Ad-hoc Devices
        </h2>
        <span style={{
          fontSize: 10, color: 'var(--subtext0)',
          padding: '2px 8px', borderRadius: 10, background: 'var(--surface0)',
        }}>
          {devices.length}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing('create')} style={btnStyle('#a6e3a1')}>
          <Plus size={13} /> Add Device
        </button>
      </div>

      {loading && <div style={{ color: 'var(--subtext0)', fontSize: 12 }}>Loading…</div>}

      {!loading && devices.length === 0 && (
        <div style={{
          padding: 32, borderRadius: 12,
          background: 'var(--mantle)', border: '1px dashed var(--surface1)',
          textAlign: 'center', color: 'var(--subtext0)',
        }}>
          <Monitor size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div style={{ fontSize: 13, marginBottom: 4 }}>No ad-hoc devices yet.</div>
          <div style={{ fontSize: 11 }}>
            Add a standalone VM, container, or physical network element for quick SSH access.
          </div>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 10,
      }}>
        {devices.map(dev => {
          const meta = CATEGORY_META[dev.category] ?? CATEGORY_META.generic
          return (
            <div key={dev.id} style={{
              padding: '14px 16px', borderRadius: 10,
              background: 'var(--mantle)', border: '1px solid var(--surface1)',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{dev.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--subtext0)' }}>{dev.id}</div>
                </div>
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 3,
                  background: dev.type === 'physical' ? '#f9e2af20' : dev.type === 'vm' ? '#89b4fa20' : '#a6e3a120',
                  color: dev.type === 'physical' ? '#f9e2af' : dev.type === 'vm' ? '#89b4fa' : '#a6e3a1',
                  fontWeight: 500, textTransform: 'uppercase',
                }}>{dev.type}</span>
              </div>

              {/* Connection info */}
              {dev.hostname && (
                <div style={{
                  fontSize: 11, color: 'var(--overlay1)', marginBottom: 8,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Wifi size={11} />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {dev.username}@{dev.hostname}:{dev.port}
                  </span>
                  {dev.key_file && <span title="Key-based auth"><Key size={10} color="#f9e2af" /></span>}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                {dev.hostname && (
                  <button onClick={() => handleSSH(dev)} style={btnStyle('#89b4fa')}>
                    <Terminal size={12} /> SSH
                  </button>
                )}
                <button onClick={() => setEditing(dev.id)} style={btnStyle('var(--overlay1)')}>
                  <Edit3 size={12} /> Edit
                </button>
                <div style={{ flex: 1 }} />
                <button onClick={() => handleDelete(dev.id)} style={btnStyle('#f38ba8')}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Form modal */}
      {editing !== null && (
        <DeviceFormModal
          mode={editing === 'create' ? 'create' : 'edit'}
          initial={editing !== 'create' ? devices.find(d => d.id === editing) : undefined}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing === 'create') {
              await apiFetch('/api/adhoc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              })
            } else {
              await apiFetch(`/api/adhoc/${editing}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              })
            }
            refresh()
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal — Device form
// ---------------------------------------------------------------------------

function DeviceFormModal({ mode, initial, onClose, onSave }: {
  mode: 'create' | 'edit'; initial?: AdhocDevice
  onClose: () => void; onSave: (data: any) => Promise<void>
}) {
  const [form, setForm] = useState({
    id: initial?.id ?? '',
    label: initial?.label ?? '',
    category: initial?.category ?? 'server',
    type: initial?.type ?? 'physical',
    hostname: initial?.hostname ?? '',
    port: initial?.port ?? 22,
    username: initial?.username ?? 'root',
    password: initial?.password ?? '',
    key_file: initial?.key_file ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const categories = Object.keys(CATEGORY_META)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const data: any = { ...form, port: Number(form.port) }
      if (!data.password) delete data.password
      if (!data.key_file) delete data.key_file
      await onSave(data)
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--base)', borderRadius: 12,
        border: '1px solid var(--surface1)', padding: 20, width: 420,
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
      }}>
        <form onSubmit={handleSubmit}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>
            {mode === 'create' ? 'Add Ad-hoc Device' : `Edit ${initial?.label}`}
          </h3>
          {error && (
            <div style={{ color: '#f38ba8', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="ID">
              <input value={form.id} onChange={e => setForm({ ...form, id: e.target.value })}
                disabled={mode === 'edit'} required style={inputStyle} />
            </Field>
            <Field label="Label">
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
                required style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Category">
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as any })} style={inputStyle}>
                <option value="physical">Physical</option>
                <option value="vm">VM</option>
                <option value="container">Container</option>
              </select>
            </Field>
          </div>

          <div style={{
            padding: '10px 12px', marginTop: 8, marginBottom: 8,
            borderRadius: 8, background: 'var(--surface0)', border: '1px solid var(--surface1)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 6, textTransform: 'uppercase' }}>
              SSH Connection
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
              <Field label="Hostname / IP">
                <input value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })}
                  style={inputStyle} placeholder="192.168.1.100" />
              </Field>
              <Field label="Port">
                <input type="number" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })}
                  style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Username">
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  style={inputStyle} />
              </Field>
              <Field label="Password">
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  style={inputStyle} placeholder="(optional)" />
              </Field>
            </div>
            <Field label="Key file (path)">
              <input value={form.key_file} onChange={e => setForm({ ...form, key_file: e.target.value })}
                style={inputStyle} placeholder="~/.ssh/id_rsa (optional)" />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" onClick={onClose} style={btnStyle('var(--surface1)')}>Cancel</button>
            <button type="submit" disabled={saving} style={btnStyle('#a6e3a1')}>
              <Save size={13} /> {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 2, textTransform: 'uppercase' }}>
        {label}
      </div>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 6,
  border: '1px solid var(--surface1)', background: 'var(--mantle)',
  color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

function btnStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    background: `${color}18`, color: color,
  }
}
