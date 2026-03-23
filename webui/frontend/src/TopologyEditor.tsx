/* triv WebUI — Topology CRUD editor (nodes + links) */

import React, { useState, useCallback } from 'react'
import {
  Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronRight,
  Server, Link2, AlertCircle,
} from 'lucide-react'
import type { NodeDef, LinkDef } from './types'
import { CATEGORY_META } from './types'
import { useAction } from './hooks'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  nodes: NodeDef[]
  links: LinkDef[]
  drivers: string[]
  onMutate: () => void        // trigger data refresh
}

type EditTarget =
  | { kind: 'node'; mode: 'create' }
  | { kind: 'node'; mode: 'edit'; id: string }
  | { kind: 'link'; mode: 'create' }
  | null

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TopologyEditor({ nodes, links, drivers, onMutate }: Props) {
  const [editTarget, setEditTarget]   = useState<EditTarget>(null)
  const [expandedNode, setExpandedNode] = useState<string | null>(null)
  const { act, busy } = useAction()

  async function handleDeleteNode(id: string) {
    if (!confirm(`Delete node "${id}" and all its links?`)) return
    await act(`/api/topology/nodes/${id}`, undefined)
    // DELETE via fetch directly
    await fetch(`/api/topology/nodes/${id}`, { method: 'DELETE' })
    onMutate()
  }

  async function handleDeleteLink(id: string) {
    if (!confirm(`Delete link "${id}"?`)) return
    await fetch(`/api/topology/links/${id}`, { method: 'DELETE' })
    onMutate()
  }

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          <Edit3 size={18} style={{ verticalAlign: 'text-bottom', marginRight: 8 }} />
          Topology Editor
        </h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditTarget({ kind: 'node', mode: 'create' })} style={btnStyle('#a6e3a1')}>
          <Plus size={13} /> Add Node
        </button>
        <button onClick={() => setEditTarget({ kind: 'link', mode: 'create' })} style={btnStyle('#89b4fa')}>
          <Link2 size={13} /> Add Link
        </button>
      </div>

      {/* Nodes section */}
      <SectionHeader title="Nodes" count={nodes.length} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 8, marginBottom: 20 }}>
        {nodes.map(node => (
          <NodeRow
            key={node.id}
            node={node}
            expanded={expandedNode === node.id}
            onToggle={() => setExpandedNode(expandedNode === node.id ? null : node.id)}
            onEdit={() => setEditTarget({ kind: 'node', mode: 'edit', id: node.id })}
            onDelete={() => handleDeleteNode(node.id)}
          />
        ))}
      </div>

      {/* Links section */}
      <SectionHeader title="Links" count={links.length} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 8 }}>
        {links.map(lk => (
          <LinkRow key={lk.id} link={lk} onDelete={() => handleDeleteLink(lk.id)} />
        ))}
      </div>

      {/* Modals */}
      {editTarget?.kind === 'node' && (
        <NodeFormModal
          mode={editTarget.mode}
          initial={editTarget.mode === 'edit' ? nodes.find(n => n.id === editTarget.id) : undefined}
          drivers={drivers}
          existingNodes={nodes}
          onClose={() => setEditTarget(null)}
          onSave={async (data) => {
            if (editTarget.mode === 'create') {
              await fetch('/api/topology/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              })
            } else {
              await fetch(`/api/topology/nodes/${editTarget.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              })
            }
            onMutate()
            setEditTarget(null)
          }}
        />
      )}

      {editTarget?.kind === 'link' && (
        <LinkFormModal
          nodes={nodes}
          onClose={() => setEditTarget(null)}
          onSave={async (data) => {
            await fetch('/api/topology/links', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            onMutate()
            setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: 'var(--subtext0)',
      textTransform: 'uppercase', letterSpacing: '0.5px',
      marginBottom: 8, paddingLeft: 4,
    }}>
      {title} ({count})
    </div>
  )
}

function NodeRow({ node, expanded, onToggle, onEdit, onDelete }: {
  node: NodeDef; expanded: boolean; onToggle: () => void
  onEdit: () => void; onDelete: () => void
}) {
  const meta = CATEGORY_META[node.category ?? 'generic'] ?? CATEGORY_META.generic
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--mantle)', border: '1px solid var(--surface1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)', padding: 0 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span style={{ color: meta.color, fontSize: 12 }}>{meta.icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{node.id}</span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3,
          background: 'var(--surface0)', color: 'var(--overlay1)',
        }}>{node.category}</span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3,
          background: 'var(--surface0)', color: 'var(--overlay1)', fontFamily: 'var(--font-mono)',
        }}>{node.driver}</span>
        <button onClick={onEdit} style={iconBtn}><Edit3 size={12} /></button>
        <button onClick={onDelete} style={{ ...iconBtn, color: '#f38ba8' }}><Trash2 size={12} /></button>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 24, fontSize: 11, color: 'var(--overlay1)' }}>
          {node.runtime && <div>Runtime: <b>{node.runtime}</b></div>}
          {node.parent && <div>Parent: <b>{node.parent}</b></div>}
          {node.interfaces && node.interfaces.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <b>Interfaces:</b>
              {node.interfaces.map(iface => (
                <div key={iface.id} style={{ paddingLeft: 12, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                  {iface.id} ({iface.type}){iface.ip ? ` — ${iface.ip}` : ''}
                </div>
              ))}
            </div>
          )}
          {node.properties && Object.keys(node.properties).length > 0 && (
            <div style={{ marginTop: 4 }}>
              <b>Properties:</b> {JSON.stringify(node.properties)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LinkRow({ link, onDelete }: { link: LinkDef; onDelete: () => void }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--mantle)', border: '1px solid var(--surface1)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <Link2 size={14} color="var(--overlay1)" />
      <span style={{ fontWeight: 600, fontSize: 13 }}>{link.id}</span>
      <span style={{
        fontSize: 9, padding: '1px 6px', borderRadius: 3,
        background: link.type === 'cascade' ? '#fab38720' : '#89b4fa20',
        color: link.type === 'cascade' ? '#fab387' : '#89b4fa',
        fontWeight: 500, textTransform: 'uppercase',
      }}>{link.type}</span>
      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--overlay1)' }}>
        {link.source?.node}:{link.source?.interface} ⟷ {link.target?.node}:{link.target?.interface}
      </span>
      <div style={{ flex: 1 }} />
      <button onClick={onDelete} style={{ ...iconBtn, color: '#f38ba8' }}><Trash2 size={12} /></button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal — Node form
// ---------------------------------------------------------------------------

function NodeFormModal({ mode, initial, drivers, existingNodes, onClose, onSave }: {
  mode: 'create' | 'edit'; initial?: NodeDef
  drivers: string[]; existingNodes: NodeDef[]
  onClose: () => void; onSave: (data: any) => Promise<void>
}) {
  const [form, setForm] = useState<Record<string, any>>({
    id: initial?.id ?? '',
    driver: initial?.driver ?? drivers[0] ?? 'generic',
    category: initial?.category ?? 'generic',
    runtime: initial?.runtime ?? '',
    parent: initial?.parent ?? '',
    properties: JSON.stringify(initial?.properties ?? {}, null, 2),
    env: initial?.env ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const categories = Object.keys(CATEGORY_META)
  const runtimes = ['', 'libvirt', 'docker', 'podman', 'app', 'remote', 'llm', 'agent']
  const parentOptions = ['', ...existingNodes.filter(n => !n.parent).map(n => n.id)]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const data: any = {
        id: form.id.trim(),
        driver: form.driver,
        category: form.category,
      }
      if (form.runtime) data.runtime = form.runtime
      if (form.parent) data.parent = form.parent
      if (form.env) data.env = form.env
      try {
        data.properties = JSON.parse(form.properties || '{}')
      } catch {
        setError('Invalid JSON in properties')
        setSaving(false)
        return
      }
      await onSave(data)
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ width: 440 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>
          {mode === 'create' ? 'Add Node' : `Edit ${initial?.id}`}
        </h3>
        {error && (
          <div style={{ color: '#f38ba8', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <Field label="ID" disabled={mode === 'edit'}>
          <input value={form.id} onChange={e => setForm({ ...form, id: e.target.value })}
            disabled={mode === 'edit'} required style={inputStyle} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Driver">
            <select value={form.driver} onChange={e => setForm({ ...form, driver: e.target.value })} style={inputStyle}>
              {drivers.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Runtime">
            <select value={form.runtime} onChange={e => setForm({ ...form, runtime: e.target.value })} style={inputStyle}>
              {runtimes.map(r => <option key={r} value={r}>{r || '(none — logical)'}</option>)}
            </select>
          </Field>
          <Field label="Parent">
            <select value={form.parent} onChange={e => setForm({ ...form, parent: e.target.value })} style={inputStyle}>
              {parentOptions.map(p => <option key={p} value={p}>{p || '(none)'}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Env file">
          <input value={form.env} onChange={e => setForm({ ...form, env: e.target.value })} style={inputStyle}
            placeholder="e.g. capabilities-node-r1.json" />
        </Field>
        <Field label="Properties (JSON)">
          <textarea value={form.properties} onChange={e => setForm({ ...form, properties: e.target.value })}
            style={{ ...inputStyle, minHeight: 60, fontFamily: 'var(--font-mono)', fontSize: 11 }} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onClose} style={btnStyle('var(--surface1)')}>Cancel</button>
          <button type="submit" disabled={saving} style={btnStyle('#a6e3a1')}>
            <Save size={13} /> {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Modal — Link form
// ---------------------------------------------------------------------------

function LinkFormModal({ nodes, onClose, onSave }: {
  nodes: NodeDef[]; onClose: () => void; onSave: (data: any) => Promise<void>
}) {
  const runnableNodes = nodes.filter(n => n.interfaces && n.interfaces.length > 0)
  const [form, setForm] = useState({
    id: '',
    type: 'ethernet',
    bidir: true,
    srcNode: runnableNodes[0]?.id ?? '',
    srcIface: '',
    dstNode: runnableNodes[1]?.id ?? runnableNodes[0]?.id ?? '',
    dstIface: '',
    segment: '',
  })
  const [saving, setSaving] = useState(false)

  const srcIfaces = nodes.find(n => n.id === form.srcNode)?.interfaces ?? []
  const dstIfaces = nodes.find(n => n.id === form.dstNode)?.interfaces ?? []

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        id: form.id.trim(),
        type: form.type,
        bidir: form.bidir,
        source: { node: form.srcNode, interface: form.srcIface },
        target: { node: form.dstNode, interface: form.dstIface },
        ...(form.segment ? { segment: form.segment } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ width: 420 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Add Link</h3>
        <Field label="Link ID">
          <input value={form.id} onChange={e => setForm({ ...form, id: e.target.value })}
            required style={inputStyle} placeholder="e.g. link-r1-r2" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Type">
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={inputStyle}>
              {['ethernet', 'cascade', 'management', 'optical', 'virtual'].map(t =>
                <option key={t} value={t}>{t}</option>
              )}
            </select>
          </Field>
          <Field label="Bidirectional">
            <select value={form.bidir ? 'yes' : 'no'}
              onChange={e => setForm({ ...form, bidir: e.target.value === 'yes' })} style={inputStyle}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Source node">
            <select value={form.srcNode} onChange={e => setForm({ ...form, srcNode: e.target.value, srcIface: '' })} style={inputStyle}>
              {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
          </Field>
          <Field label="Source interface">
            <select value={form.srcIface} onChange={e => setForm({ ...form, srcIface: e.target.value })} style={inputStyle}>
              <option value="">— select —</option>
              {srcIfaces.map(i => <option key={i.id} value={i.id}>{i.id} ({i.label || i.type})</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Target node">
            <select value={form.dstNode} onChange={e => setForm({ ...form, dstNode: e.target.value, dstIface: '' })} style={inputStyle}>
              {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
          </Field>
          <Field label="Target interface">
            <select value={form.dstIface} onChange={e => setForm({ ...form, dstIface: e.target.value })} style={inputStyle}>
              <option value="">— select —</option>
              {dstIfaces.map(i => <option key={i.id} value={i.id}>{i.id} ({i.label || i.type})</option>)}
            </select>
          </Field>
        </div>
        <Field label="Segment (optional)">
          <input value={form.segment} onChange={e => setForm({ ...form, segment: e.target.value })} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onClose} style={btnStyle('var(--surface1)')}>Cancel</button>
          <button type="submit" disabled={saving} style={btnStyle('#89b4fa')}>
            <Link2 size={13} /> Create
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--base)', borderRadius: 12,
        border: '1px solid var(--surface1)', padding: 20,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
      }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label style={{ display: 'block', marginBottom: 8, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 3, textTransform: 'uppercase' }}>
        {label}
      </div>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 6,
  border: '1px solid var(--surface1)', background: 'var(--mantle)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
}

function btnStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    background: `${color}18`, color: color,
  }
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--overlay1)', padding: 2,
}
