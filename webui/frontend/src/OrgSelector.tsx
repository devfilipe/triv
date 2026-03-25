/* triv WebUI — OrgSelector: select or create an organization */

import React, { useState } from 'react'
import { Building2, Plus, Check, ChevronRight, X } from 'lucide-react'
import type { OrgDef } from './hooks'

interface OrgSelectorProps {
  orgs: OrgDef[]
  activeOrgId: string
  onActivate: (orgId: string) => Promise<any>
  onCreate: (name: string, vendors?: string[]) => Promise<any>
  onSkip: () => void
}

export default function OrgSelector({ orgs, activeOrgId, onActivate, onCreate, onSkip }: OrgSelectorProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newVendors, setNewVendors] = useState('')
  const [creating, setCreating] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleActivate(id: string) {
    setActivating(id)
    try {
      await onActivate(id)
    } finally {
      setActivating(null)
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    try {
      const vendors = newVendors.split(',').map(v => v.trim()).filter(Boolean)
      const result = await onCreate(newName.trim(), vendors)
      if (result.ok) {
        await onActivate(result.id)
        setShowCreate(false)
        setNewName('')
        setNewVendors('')
      } else {
        setError(result.detail || result.error || 'Failed to create org')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(17,17,27,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 480, maxWidth: '94vw',
        background: 'var(--base)', border: '1px solid var(--surface0)',
        borderRadius: 14, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Building2 size={22} color="#cba6f7" />
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Select Organization</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--subtext0)', marginBottom: 24, marginTop: 0 }}>
          Projects are scoped to the active org. Select one to continue.
        </p>

        {/* Org list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {orgs.map(org => (
            <button
              key={org.id}
              onClick={() => handleActivate(org.id)}
              disabled={activating !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                border: org.id === activeOrgId ? '1px solid #cba6f7' : '1px solid var(--surface1)',
                background: org.id === activeOrgId ? 'color-mix(in srgb, #cba6f7 12%, var(--surface0))' : 'var(--surface0)',
                textAlign: 'left', transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, #cba6f7 18%, var(--surface1))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Building2 size={16} color="#cba6f7" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{org.name}</div>
                <div style={{ fontSize: 11, color: 'var(--subtext0)', marginTop: 1 }}>
                  {org.vendors.length === 0
                    ? 'No vendors yet'
                    : org.vendors.slice(0, 4).join(', ') + (org.vendors.length > 4 ? ` +${org.vendors.length - 4}` : '')}
                </div>
              </div>
              {org.id === activeOrgId
                ? <Check size={15} color="#a6e3a1" style={{ flexShrink: 0 }} />
                : activating === org.id
                  ? <span style={{ fontSize: 11, color: 'var(--subtext0)' }}>...</span>
                  : <ChevronRight size={15} color="var(--overlay0)" style={{ flexShrink: 0 }} />
              }
            </button>
          ))}

          {orgs.length === 0 && !showCreate && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--subtext0)', fontSize: 12 }}>
              No organizations yet. Create one to get started.
            </div>
          )}
        </div>

        {/* Create form */}
        {showCreate ? (
          <div style={{
            padding: 16, borderRadius: 8,
            background: 'var(--surface0)', border: '1px solid var(--surface1)',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>New Organization</div>
            <input
              placeholder="Organization name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 6, marginBottom: 8,
                background: 'var(--surface1)', border: '1px solid var(--overlay0)',
                color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
            <input
              placeholder="Vendors / departments (comma-separated, optional)"
              value={newVendors}
              onChange={e => setNewVendors(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 6, marginBottom: 8,
                background: 'var(--surface1)', border: '1px solid var(--overlay0)',
                color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {error && <div style={{ fontSize: 11, color: '#f38ba8', marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: '#cba6f7', color: '#1e1e2e', fontSize: 12, fontWeight: 600,
                  opacity: !newName.trim() || creating ? 0.5 : 1,
                }}
              >
                {creating ? 'Creating\u2026' : 'Create & Select'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setError('') }}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: '1px solid var(--surface1)',
                  background: 'transparent', color: 'var(--subtext0)', fontSize: 12, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8, marginBottom: 16,
              border: '1px dashed var(--overlay0)', background: 'transparent',
              color: 'var(--subtext0)', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Plus size={13} /> New Organization
          </button>
        )}

        {/* Skip */}
        <button
          onClick={onSkip}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 8,
            border: 'none', background: 'transparent',
            color: 'var(--overlay0)', fontSize: 11, cursor: 'pointer',
          }}
        >
          Continue without selecting an org
        </button>
      </div>
    </div>
  )
}
