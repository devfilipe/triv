/* triv WebUI — FloatingJsonEditor: modal JSON editor with syntax highlighting */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Save, X, RotateCcw, AlertCircle, Check, Copy,
  FileJson, Maximize2, Minimize2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Simple JSON syntax highlighter (zero dependencies)
// ---------------------------------------------------------------------------

function highlightJson(json: string): string {
  // Escape HTML first
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Tokenize: strings, numbers, booleans, null, keys, brackets
  return escaped.replace(
    /("(?:\\.|[^"\\])*")\s*:/g,  // keys
    '<span class="json-key">$1</span>:',
  ).replace(
    /:\s*("(?:\\.|[^"\\])*")/g,  // string values
    ': <span class="json-string">$1</span>',
  ).replace(
    /:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,  // numbers
    ': <span class="json-number">$1</span>',
  ).replace(
    /:\s*(true|false)/g,  // booleans
    ': <span class="json-bool">$1</span>',
  ).replace(
    /:\s*(null)/g,  // null
    ': <span class="json-null">$1</span>',
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  title: string
  content: string
  filename: string
  onSave: (content: string) => Promise<{ ok: boolean; error?: string; name?: string; nodes?: number; links?: number }>
  onClose: () => void
  onReload?: () => void
}

export default function FloatingJsonEditor({
  title, content: initialContent, filename, onSave, onClose, onReload,
}: Props) {
  const [content, setContent] = useState(initialContent)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Format JSON on load
  useEffect(() => {
    try {
      const formatted = JSON.stringify(JSON.parse(initialContent), null, 2)
      setContent(formatted)
    } catch {
      setContent(initialContent)
    }
  }, [initialContent])

  function handleChange(value: string) {
    setContent(value)
    setDirty(true)
    setError(null)
    setSuccess(null)
  }

  // Validate JSON
  const jsonError = useCallback((): string | null => {
    try {
      JSON.parse(content)
      return null
    } catch (e: any) {
      return e.message
    }
  }, [content])

  async function handleSave() {
    const err = jsonError()
    if (err) {
      setError(`Invalid JSON: ${err}`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Normalize: pretty-print before saving
      const pretty = JSON.stringify(JSON.parse(content), null, 2) + '\n'
      const result = await onSave(pretty)
      if (result.ok) {
        setDirty(false)
        setSuccess(`Saved & reloaded — ${result.name} (${result.nodes} nodes, ${result.links} links)`)
        setTimeout(() => setSuccess(null), 4000)
        onReload?.()
      } else {
        setError(result.error || 'Save failed')
      }
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleFormat() {
    try {
      const formatted = JSON.stringify(JSON.parse(content), null, 2)
      setContent(formatted)
      setError(null)
    } catch (e: any) {
      setError(`Cannot format: ${e.message}`)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(content)
  }

  // Ctrl+S to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tab key inserts 2 spaces
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const val = ta.value
      const newVal = val.substring(0, start) + '  ' + val.substring(end)
      setContent(newVal)
      setDirty(true)
      // Restore cursor position
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }

  const currentError = jsonError()
  const lineCount = content.split('\n').length

  const panelStyle: React.CSSProperties = maximized
    ? { position: 'fixed', inset: 16, zIndex: 9999 }
    : {
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '80vw', maxWidth: 900, height: '80vh',
        zIndex: 9999,
      }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) onClose() }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Editor panel */}
      <div style={{
        ...panelStyle,
        background: 'var(--mantle)',
        borderRadius: maximized ? 0 : 14,
        border: '1px solid var(--surface1)',
        boxShadow: '0 16px 64px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* ── Header ────────────────────────────────── */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--surface0)',
          display: 'flex', alignItems: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <FileJson size={15} color="var(--mauve)" />
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{title}</span>
          <span style={{
            fontSize: 10, color: 'var(--overlay0)',
            fontFamily: 'var(--font-mono)',
          }}>{filename}</span>
          {dirty && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3,
              background: '#f9e2af20', color: '#f9e2af',
              fontWeight: 600,
            }}>MODIFIED</span>
          )}
          <div style={{ flex: 1 }} />

          {/* Mode toggle */}
          <div style={{
            display: 'flex', borderRadius: 6,
            border: '1px solid var(--surface1)', overflow: 'hidden',
          }}>
            {(['edit', 'preview'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '4px 10px', fontSize: 10, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: mode === m ? 'var(--surface0)' : 'transparent',
                  color: mode === m ? 'var(--text)' : 'var(--overlay0)',
                  textTransform: 'uppercase',
                }}
              >{m}</button>
            ))}
          </div>

          {/* Toolbar buttons */}
          <button onClick={handleCopy} title="Copy to clipboard" style={toolBtnStyle}>
            <Copy size={13} />
          </button>
          <button onClick={handleFormat} title="Format JSON" style={toolBtnStyle}>
            <RotateCcw size={13} />
          </button>
          <button onClick={() => setMaximized(m => !m)} title={maximized ? 'Restore' : 'Maximize'} style={toolBtnStyle}>
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty || !!currentError}
            title="Save & Reload (Ctrl+S)"
            style={{
              ...toolBtnStyle,
              background: dirty && !currentError ? 'var(--green)' : 'var(--surface0)',
              color: dirty && !currentError ? 'var(--crust)' : 'var(--overlay0)',
              opacity: saving ? 0.6 : 1,
              padding: '4px 10px',
              gap: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <Save size={13} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>Save</span>
          </button>
          <button onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) onClose() }} style={toolBtnStyle}>
            <X size={14} />
          </button>
        </div>

        {/* ── Status bar (errors/success) ─────────────── */}
        {(error || success || currentError) && (
          <div style={{
            padding: '6px 16px', fontSize: 11, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 6,
            background: error || currentError ? '#f38ba810' : '#a6e3a110',
            borderBottom: '1px solid var(--surface0)',
          }}>
            {(error || currentError) ? (
              <>
                <AlertCircle size={12} color="#f38ba8" />
                <span style={{ color: '#f38ba8' }}>{error || currentError}</span>
              </>
            ) : success ? (
              <>
                <Check size={12} color="#a6e3a1" />
                <span style={{ color: '#a6e3a1' }}>{success}</span>
              </>
            ) : null}
          </div>
        )}

        {/* ── Editor / Preview ────────────────────────── */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {mode === 'edit' ? (
            <div style={{ display: 'flex', height: '100%' }}>
              {/* Line numbers */}
              <div style={{
                width: 48, flexShrink: 0,
                background: 'var(--crust)',
                borderRight: '1px solid var(--surface0)',
                overflowY: 'hidden',
                padding: '12px 0',
                userSelect: 'none',
              }}>
                <pre style={{
                  margin: 0, padding: 0,
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  lineHeight: '1.5em', color: 'var(--overlay0)',
                  textAlign: 'right', paddingRight: 8,
                }}>
                  {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
                </pre>
              </div>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={e => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={e => {
                  // Sync line numbers scroll
                  const lineDiv = e.currentTarget.previousElementSibling as HTMLElement
                  if (lineDiv) lineDiv.scrollTop = e.currentTarget.scrollTop
                }}
                spellCheck={false}
                style={{
                  flex: 1, resize: 'none',
                  background: 'var(--base)',
                  color: 'var(--text)',
                  border: 'none', outline: 'none',
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  lineHeight: '1.5em',
                  padding: '12px 16px',
                  tabSize: 2,
                  whiteSpace: 'pre',
                  overflowWrap: 'normal',
                  overflowX: 'auto',
                }}
              />
            </div>
          ) : (
            /* Preview with syntax highlighting */
            <div style={{
              height: '100%', overflowY: 'auto', overflowX: 'auto',
              padding: '12px 16px',
              background: 'var(--base)',
            }}>
              <pre
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  lineHeight: '1.5em', color: 'var(--text)',
                  whiteSpace: 'pre',
                }}
                dangerouslySetInnerHTML={{ __html: highlightJson(content) }}
              />
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────── */}
        <div style={{
          padding: '6px 16px',
          borderTop: '1px solid var(--surface0)',
          display: 'flex', alignItems: 'center', gap: 12,
          fontSize: 10, color: 'var(--overlay0)',
          flexShrink: 0,
        }}>
          <span>{lineCount} lines</span>
          <span>{content.length} chars</span>
          <span>JSON {currentError ? '✗' : '✓'}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)' }}>Ctrl+S to save</span>
        </div>
      </div>

      {/* ── Highlight styles ─────────────────────────── */}
      <style>{`
        .json-key    { color: #89b4fa; }
        .json-string { color: #a6e3a1; }
        .json-number { color: #fab387; }
        .json-bool   { color: #cba6f7; }
        .json-null   { color: #f38ba8; font-style: italic; }
      `}</style>
    </>
  )
}

const toolBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: '1px solid var(--surface1)', cursor: 'pointer',
  background: 'var(--surface0)', color: 'var(--subtext0)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
