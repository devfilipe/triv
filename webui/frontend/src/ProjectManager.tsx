/* triv WebUI — ProjectManager: project switching, add/remove/cleanup
   Renders as a centered modal (not a dropdown) to avoid scrolling issues. */

import React, { useState, useEffect, useRef } from 'react'
import {
  FolderOpen, Plus, Trash2, Power, Check, X, Search,
  AlertTriangle, Loader2, FolderSearch, Folder,
  ChevronRight, ArrowUp, Home, FileJson,
} from 'lucide-react'
import type { ProjectDef } from './types'

interface ProjectManagerProps {
  projects: ProjectDef[]
  activeId: string
  /** The last project that was active (remembers across restarts). */
  lastActiveId?: string
  onActivate: (id: string) => Promise<any>
  onAdd: (path: string, name?: string, description?: string) => Promise<any>
  /** Create a brand-new project (directory + skeleton topology). */
  onCreate: (name: string, dirName?: string, description?: string) => Promise<any>
  onRemove: (id: string) => Promise<any>
  onCleanup: (id: string) => Promise<any>
  onScan: (path: string) => Promise<any>
  onBrowse: (path: string) => Promise<any>
  onGetDefaults: () => Promise<any>
  /** Called after any project switch so parent can refresh all data. */
  onProjectChanged: () => void
  /** Open the topology JSON file in the editor panel. */
  onEditTopology?: () => void
  /** Incremented by parent to force-open the modal (e.g. from the "no project" screen). */
  forceOpen?: number
}

export default function ProjectManager({
  projects, activeId, lastActiveId, onActivate, onAdd, onCreate, onRemove, onCleanup, onScan,
  onBrowse, onGetDefaults, onProjectChanged, onEditTopology, forceOpen,
}: ProjectManagerProps) {
  const [showModal, setShowModal] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [cleaningUp, setCleaningUp] = useState<string | null>(null)

  // Auto-open when no project is active (e.g. after cleanup deactivation)
  const prevActiveRef = useRef(activeId)
  useEffect(() => {
    if (!activeId && prevActiveRef.current) {
      // active project just became empty → open the modal
      setShowModal(true)
    }
    prevActiveRef.current = activeId
  }, [activeId])

  // Force-open when parent increments forceOpen counter
  useEffect(() => {
    if (forceOpen && forceOpen > 0) setShowModal(true)
  }, [forceOpen])

  const activeProject = projects.find(p => p.id === activeId)

  async function handleActivate(id: string) {
    if (id === activeId) return
    setSwitching(id)
    try {
      const result = await onActivate(id)
      if (result.ok) {
        onProjectChanged()
        setShowModal(false)
      } else {
        // 409 conflict — need cleanup first
        alert(result.detail || 'Cannot activate: another project is active. Run cleanup first.')
      }
    } finally {
      setSwitching(null)
    }
  }

  async function handleCleanup(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const projName = projects.find(p => p.id === id)?.name ?? id
    if (!confirm(
      `Full cleanup for "${projName}"?\n\n` +
      '• Disconnect all segments (host + networking)\n' +
      '• Stop & remove all VMs and containers\n' +
      '• Remove bridges, VLANs, Docker networks\n' +
      '• Clean temp files\n\n' +
      'The project will be deactivated after cleanup.'
    )) return

    setCleaningUp(id)
    try {
      await onCleanup(id)
      // Refresh projects to pick up deactivated state
      onProjectChanged()
    } catch (err) {
      console.error('Cleanup failed:', err)
    } finally {
      setCleaningUp(null)
    }
  }

  async function handleRemove(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Remove project "${projects.find(p => p.id === id)?.name}" from the list?\n\nFiles on disk will NOT be deleted.`)) return
    await onRemove(id)
  }

  return (
    <>
      {/* ── Trigger button (in the nav rail) ───────────────────── */}
      <button
        onClick={() => setShowModal(o => !o)}
        title={`Project: ${activeProject?.name ?? '—'}`}
        style={{
          width: 40, height: 40, borderRadius: 8,
          border: '1px solid var(--surface1)', cursor: 'pointer',
          background: showModal ? 'var(--surface0)' : 'transparent',
          color: 'var(--mauve)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s ease',
        }}
      >
        <FolderOpen size={17} />
      </button>

      {/* ── Centered modal ─────────────────────────────────────── */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 420, maxHeight: '80vh', overflowY: 'auto',
              background: 'var(--mantle)', borderRadius: 14,
              border: '1px solid var(--surface1)',
              boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--surface0)',
              display: 'flex', alignItems: 'center', gap: 8,
              position: 'sticky', top: 0, background: 'var(--mantle)', zIndex: 1,
              borderRadius: '14px 14px 0 0',
            }}>
              <FolderOpen size={14} color="var(--mauve)" />
              <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Projects</span>
              <button
                onClick={() => { setShowCreateDialog(true); setShowModal(false) }}
                title="Create new project"
                style={{
                  height: 26, borderRadius: 6, padding: '0 8px',
                  border: '1px solid var(--surface1)', cursor: 'pointer',
                  background: 'var(--surface0)', color: 'var(--green)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 4, fontSize: 11, fontWeight: 600,
                }}
              >
                <Plus size={12} /> New
              </button>
              <button
                onClick={() => { setShowAddDialog(true); setShowModal(false) }}
                title="Import existing project directory"
                style={{
                  width: 28, height: 26, borderRadius: 6,
                  border: '1px solid var(--surface1)', cursor: 'pointer',
                  background: 'var(--surface0)', color: 'var(--blue)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <FolderSearch size={13} />
              </button>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: 'none', cursor: 'pointer',
                  background: 'transparent', color: 'var(--overlay1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Project list */}
            <div style={{ padding: 8 }}>
              {projects.map(proj => {
                const isActive = proj.id === activeId
                const isLastActive = !activeId && !!lastActiveId && proj.id === lastActiveId
                const isSwitching = switching === proj.id
                return (
                  <div
                    key={proj.id}
                    onClick={() => handleActivate(proj.id)}
                    style={{
                      padding: '10px 12px', borderRadius: 8,
                      cursor: isActive ? 'default' : 'pointer',
                      background: isActive ? 'var(--surface0)' : isLastActive ? 'var(--surface0)44' : 'transparent',
                      border: isActive ? '1px solid var(--mauve)40' : isLastActive ? '1px solid var(--overlay0)30' : '1px solid transparent',
                      marginBottom: 2,
                      transition: 'all 0.12s ease',
                      opacity: isSwitching ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget.style.background = 'var(--surface0)') }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget.style.background = 'transparent') }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isSwitching ? (
                        <Loader2 size={14} color="var(--mauve)" style={{ animation: 'spin 1s linear infinite' }} />
                      ) : isActive ? (
                        <Check size={14} color="var(--green)" />
                      ) : (
                        <div style={{ width: 14, height: 14 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: 13,
                          color: isActive ? 'var(--text)' : 'var(--subtext1)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          {proj.name}
                          {isLastActive && (
                            <span style={{
                              fontSize: 9, fontWeight: 700,
                              padding: '1px 5px', borderRadius: 4,
                              background: 'var(--overlay0)30',
                              color: 'var(--subtext0)',
                              letterSpacing: '0.3px',
                              flexShrink: 0,
                            }}>
                              LAST USED
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontSize: 10, color: 'var(--overlay0)',
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {proj.path}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 2 }}>
                        {isActive && proj.has_topology && onEditTopology && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowModal(false); onEditTopology() }}
                            title="Edit topology JSON"
                            style={{
                              width: 26, height: 26, borderRadius: 4,
                              border: 'none', cursor: 'pointer',
                              background: 'transparent', color: 'var(--mauve)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            <FileJson size={13} />
                          </button>
                        )}
                        {isActive && (
                        <button
                          onClick={(e) => handleCleanup(proj.id, e)}
                          disabled={cleaningUp === proj.id}
                          title="Full cleanup — stop everything and deactivate project"
                          style={{
                            width: 26, height: 26, borderRadius: 4,
                            border: 'none', cursor: cleaningUp === proj.id ? 'wait' : 'pointer',
                            background: cleaningUp === proj.id ? 'var(--surface1)' : 'transparent',
                            color: cleaningUp === proj.id ? 'var(--peach)' : 'var(--yellow)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            animation: cleaningUp === proj.id ? 'pulse 1s infinite' : 'none',
                          }}
                        >
                          <Power size={13} />
                        </button>
                        )}
                        {!isActive && (
                          <button
                            onClick={(e) => handleRemove(proj.id, e)}
                            title="Remove from list"
                            style={{
                              width: 26, height: 26, borderRadius: 4,
                              border: 'none', cursor: 'pointer',
                              background: 'transparent', color: 'var(--red)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    {proj.description && (
                      <div style={{ fontSize: 10, color: 'var(--overlay0)', marginTop: 4, paddingLeft: 22 }}>
                        {proj.description}
                      </div>
                    )}
                  </div>
                )
              })}

              {projects.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--subtext0)', fontSize: 12 }}>
                  No projects registered.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add Project Dialog ─────────────────────────────────── */}
      {showAddDialog && (
        <AddProjectDialog
          onAdd={onAdd}
          onScan={onScan}
          onBrowse={onBrowse}
          onGetDefaults={onGetDefaults}
          onClose={() => setShowAddDialog(false)}
        />
      )}

      {/* ── Create Project Dialog ──────────────────────────────── */}
      {showCreateDialog && (
        <CreateProjectDialog
          onCreate={onCreate}
          onGetDefaults={onGetDefaults}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {/* ── Keyframe for spinner ───────────────────────────────── */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </>
  )
}


/* ── Add Project Dialog (with directory browser) ──────────────────── */

interface BrowseEntry {
  name: string
  path: string
  has_topology: boolean
}

function AddProjectDialog({ onAdd, onScan, onBrowse, onGetDefaults, onClose }: {
  onAdd: (path: string, name?: string, description?: string) => Promise<any>
  onScan: (path: string) => Promise<any>
  onBrowse: (path: string) => Promise<any>
  onGetDefaults: () => Promise<any>
  onClose: () => void
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scanResult, setScanResult] = useState<any>(null)
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  // Directory browser state
  const [showBrowser, setShowBrowser] = useState(false)
  const [browseDir, setBrowseDir] = useState('')
  const [browseParent, setBrowseParent] = useState<string | null>(null)
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([])
  const [browsing, setBrowsing] = useState(false)

  // Load defaults on mount → populate default path
  useEffect(() => {
    onGetDefaults().then(defaults => {
      if (!path) {
        setPath(defaults.projects_root || '/root/.triv/vendors')
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleScan() {
    if (!path.trim()) return
    setScanning(true)
    setError('')
    setScanResult(null)
    try {
      const result = await onScan(path.trim())
      setScanResult(result)
      if (result.auto_name && !name) setName(result.auto_name)
      if (!result.valid) setError('No topology JSON files found in this directory.')
    } catch (e: any) {
      setError(e.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function handleAdd() {
    if (!path.trim()) return
    setAdding(true)
    setError('')
    try {
      const result = await onAdd(path.trim(), name.trim(), description.trim())
      if (result.ok) {
        onClose()
      } else {
        setError(result.detail || 'Failed to add project')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to add project')
    } finally {
      setAdding(false)
    }
  }

  async function openBrowser() {
    const startPath = path.trim() || '/triv-projects'
    setShowBrowser(true)
    await navigateTo(startPath)
  }

  async function navigateTo(dirPath: string) {
    setBrowsing(true)
    try {
      const result = await onBrowse(dirPath)
      setBrowseDir(result.current)
      setBrowseParent(result.parent)
      setBrowseEntries(result.directories || [])
    } catch {
      setBrowseEntries([])
    } finally {
      setBrowsing(false)
    }
  }

  function selectBrowsePath(selectedPath: string) {
    setPath(selectedPath)
    setShowBrowser(false)
    setScanResult(null)
    setName('')
    setError('')
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: '1px solid var(--surface1)', background: 'var(--base)',
    color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)',
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: showBrowser ? 560 : 460,
          maxHeight: '85vh',
          background: 'var(--mantle)', borderRadius: 14,
          border: '1px solid var(--surface1)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--surface0)',
          display: 'flex', alignItems: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <FolderSearch size={16} color="var(--mauve)" />
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>
            {showBrowser ? 'Select Directory' : 'Add Project'}
          </span>
          {showBrowser && (
            <button
              onClick={() => setShowBrowser(false)}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--surface1)', cursor: 'pointer',
                background: 'var(--surface0)', color: 'var(--text)',
                fontSize: 11, fontWeight: 600,
              }}
            >
              Back
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 6,
              border: 'none', cursor: 'pointer',
              background: 'transparent', color: 'var(--overlay1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Directory browser view ─────────────────────────────── */}
        {showBrowser ? (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Current path bar */}
            <div style={{
              padding: '8px 14px', borderBottom: '1px solid var(--surface0)',
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--base)', flexShrink: 0,
            }}>
              <Home
                size={13}
                color="var(--blue)"
                style={{ cursor: 'pointer', flexShrink: 0 }}
                onClick={() => navigateTo('/')}
              />
              <span style={{
                fontSize: 12, fontFamily: 'var(--font-mono)',
                color: 'var(--text)', flex: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {browseDir || '/'}
              </span>
              {browsing && <Loader2 size={13} color="var(--mauve)" style={{ animation: 'spin 1s linear infinite' }} />}
            </div>

            {/* Navigation: parent dir */}
            {browseParent && (
              <button
                onClick={() => navigateTo(browseParent)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', margin: '4px 8px 0 8px', borderRadius: 6,
                  border: 'none', cursor: 'pointer',
                  background: 'transparent', color: 'var(--subtext0)',
                  fontSize: 12, textAlign: 'left', width: 'calc(100% - 16px)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface0)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <ArrowUp size={13} />
                <span>..</span>
                <span style={{ fontSize: 10, color: 'var(--overlay0)', flex: 1 }}>
                  ({browseParent})
                </span>
              </button>
            )}

            {/* Directory listing */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '4px 8px',
            }}>
              {browseEntries.length === 0 && !browsing && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--subtext0)', fontSize: 12 }}>
                  No subdirectories found.
                </div>
              )}
              {browseEntries.map(entry => (
                <div
                  key={entry.path}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 6,
                    cursor: 'pointer',
                    background: 'transparent',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface0)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Click folder name → navigate into */}
                  <div
                    onClick={() => navigateTo(entry.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      flex: 1, minWidth: 0,
                    }}
                  >
                    <Folder size={14} color={entry.has_topology ? 'var(--green)' : 'var(--overlay1)'} />
                    <span style={{
                      fontSize: 12, color: 'var(--text)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {entry.name}
                    </span>
                    {entry.has_topology && (
                      <span style={{
                        fontSize: 8, padding: '1px 5px', borderRadius: 3,
                        background: '#a6e3a120', color: '#a6e3a1',
                        fontWeight: 600, flexShrink: 0,
                      }}>
                        TOPOLOGY
                      </span>
                    )}
                    <ChevronRight size={11} color="var(--overlay0)" style={{ flexShrink: 0 }} />
                  </div>

                  {/* Select this dir */}
                  <button
                    onClick={() => selectBrowsePath(entry.path)}
                    title={`Select ${entry.path}`}
                    style={{
                      padding: '3px 8px', borderRadius: 4,
                      border: '1px solid var(--surface1)', cursor: 'pointer',
                      background: entry.has_topology ? 'var(--green)' : 'var(--surface0)',
                      color: entry.has_topology ? 'var(--crust)' : 'var(--subtext0)',
                      fontSize: 10, fontWeight: 600, flexShrink: 0,
                    }}
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>

            {/* Select current directory button */}
            <div style={{
              padding: '10px 14px', borderTop: '1px solid var(--surface0)',
              display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
            }}>
              <span style={{ fontSize: 11, color: 'var(--subtext0)', flex: 1 }}>
                Or use current: <b style={{ color: 'var(--text)' }}>{browseDir}</b>
              </span>
              <button
                onClick={() => selectBrowsePath(browseDir)}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  border: 'none', cursor: 'pointer',
                  background: 'var(--mauve)', color: 'var(--crust)',
                  fontSize: 12, fontWeight: 700,
                }}
              >
                Select This
              </button>
            </div>
          </div>
        ) : (
          /* ── Form view ─────────────────────────────────────────── */
          <>
            <div style={{
              padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
              flex: 1, overflowY: 'auto',
            }}>
              {/* Path */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block' }}>
                  PROJECT DIRECTORY
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    placeholder="/path/to/my-project"
                    style={{ ...inputStyle, flex: 1 }}
                    onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
                  />
                  <button
                    onClick={openBrowser}
                    title="Browse directories"
                    style={{
                      padding: '0 10px', borderRadius: 6,
                      border: '1px solid var(--surface1)', cursor: 'pointer',
                      background: 'var(--surface0)', color: 'var(--mauve)',
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <Folder size={13} />
                  </button>
                  <button
                    onClick={handleScan}
                    disabled={scanning || !path.trim()}
                    style={{
                      padding: '0 12px', borderRadius: 6,
                      border: '1px solid var(--surface1)', cursor: 'pointer',
                      background: 'var(--surface0)', color: 'var(--blue)',
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 12, fontWeight: 600, opacity: scanning ? 0.6 : 1,
                    }}
                  >
                    {scanning ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
                    Scan
                  </button>
                </div>
              </div>

              {/* Scan result */}
              {scanResult && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: scanResult.valid ? '#a6e3a110' : '#f38ba810',
                  border: `1px solid ${scanResult.valid ? '#a6e3a130' : '#f38ba830'}`,
                  fontSize: 11,
                }}>
                  {scanResult.valid ? (
                    <>
                      <div style={{ color: '#a6e3a1', fontWeight: 600, marginBottom: 4 }}>
                        ✓ Found {scanResult.topology_files.length} topology file(s)
                      </div>
                      {scanResult.topology_files.map((f: string) => (
                        <div key={f} style={{ color: 'var(--overlay1)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                          {f}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ color: '#f38ba8', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={13} /> No topology files found
                    </div>
                  )}
                </div>
              )}

              {/* Name */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block' }}>
                  NAME (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Auto-detected from topology"
                  style={inputStyle}
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block' }}>
                  DESCRIPTION (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Brief description"
                  style={{ ...inputStyle, fontFamily: 'inherit' }}
                />
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: '#f38ba810', border: '1px solid #f38ba830',
                  color: '#f38ba8', fontSize: 12,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <AlertTriangle size={13} /> {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 18px', borderTop: '1px solid var(--surface0)',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
              flexShrink: 0,
            }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  border: '1px solid var(--surface1)', cursor: 'pointer',
                  background: 'var(--surface0)', color: 'var(--text)',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !path.trim()}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  border: 'none', cursor: 'pointer',
                  background: 'var(--mauve)', color: 'var(--crust)',
                  fontSize: 12, fontWeight: 700, opacity: adding ? 0.6 : 1,
                }}
              >
                {adding ? 'Adding...' : 'Add Project'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


/* ── Create Project Dialog ────────────────────────────────────────── */

function CreateProjectDialog({ onCreate, onGetDefaults, onClose }: {
  onCreate: (name: string, dirName?: string, description?: string) => Promise<any>
  onGetDefaults: () => Promise<any>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [dirName, setDirName] = useState('')
  const [dirNameTouched, setDirNameTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [parentDir, setParentDir] = useState('')

  // Load defaults
  useEffect(() => {
    onGetDefaults().then(defaults => {
      setParentDir(defaults.projects_root || '')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-derive dirName from name (unless user manually edited it)
  const derivedDirName = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || ''

  const effectiveDirName = dirNameTouched ? dirName : derivedDirName

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      const result = await onCreate(name.trim(), effectiveDirName, description.trim())
      if (result.ok) {
        onClose()
      } else {
        setError(result.detail || 'Failed to create project')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  const previewPath = `${parentDir}/${effectiveDirName || '...'}`

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440, background: 'var(--mantle)', borderRadius: 14,
          border: '1px solid var(--surface1)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--surface0)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Plus size={14} color="var(--green)" />
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Create New Project</span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 6,
              border: 'none', cursor: 'pointer',
              background: 'transparent', color: 'var(--overlay1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Project Name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block' }}>
              Project Name *
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. My Lab"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--surface1)',
                background: 'var(--surface0)', color: 'var(--text)',
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Directory Name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block' }}>
              Directory Name
            </label>
            <input
              value={dirNameTouched ? dirName : derivedDirName}
              onChange={e => { setDirName(e.target.value); setDirNameTouched(true) }}
              placeholder="auto-derived from name"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--surface1)',
                background: 'var(--surface0)', color: 'var(--text)',
                fontSize: 13, outline: 'none', fontFamily: 'var(--font-mono)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{
              marginTop: 4, fontSize: 10, color: 'var(--overlay0)',
              fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Folder size={10} />
              {previewPath}
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext0)', marginBottom: 4, display: 'block' }}>
              Description
            </label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--surface1)',
                background: 'var(--surface0)', color: 'var(--text)',
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Info box */}
          <div style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'var(--surface0)', border: '1px solid var(--surface1)',
            fontSize: 11, color: 'var(--subtext0)', lineHeight: 1.5,
          }}>
            Creates <code style={{ color: 'var(--mauve)', fontSize: 10 }}>topology.json</code> with
            an empty topology skeleton. Use the <b>Builder</b> or <b>Editor</b> views to add nodes and links.
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '8px 10px', borderRadius: 6,
              background: '#f38ba820', border: '1px solid #f38ba840',
              fontSize: 12, color: '#f38ba8',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertTriangle size={14} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--surface0)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px', borderRadius: 6,
              border: '1px solid var(--surface1)', cursor: 'pointer',
              background: 'transparent', color: 'var(--subtext1)',
              fontSize: 12, fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            style={{
              padding: '7px 18px', borderRadius: 6,
              border: 'none', cursor: creating || !name.trim() ? 'not-allowed' : 'pointer',
              background: creating || !name.trim() ? 'var(--surface1)' : 'var(--green)',
              color: creating || !name.trim() ? 'var(--overlay0)' : 'var(--crust)',
              fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {creating ? (
              <>
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                Creating...
              </>
            ) : (
              <>
                <Plus size={12} />
                Create Project
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
