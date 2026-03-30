import { apiFetch } from './apiFetch'
/* triv WebUI — FloatingTaskPanel: agent task input + output log */

import React, { useState, useRef, useEffect } from 'react'
import { X, Zap, Loader } from 'lucide-react'

interface RunEntry {
  task: string
  output: string
  ok: boolean
}

interface Props {
  nodeId: string
  title: string
  onClose: () => void
}

export default function FloatingTaskPanel({ nodeId, title, onClose }: Props) {
  const panelRef  = useRef<HTMLDivElement>(null)
  const bodyRef   = useRef<HTMLDivElement>(null)
  const dragging  = useRef(false)
  const offset    = useRef({ x: 0, y: 0 })

  const [pos, setPos]       = useState({ x: 120, y: 100 })
  const [size, setSize]     = useState({ w: 660, h: 500 })
  const [task, setTask]     = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<RunEntry[]>([])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [history, loading])

  function onTitleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragging.current = true
    const rect = panelRef.current!.getBoundingClientRect()
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      setPos({ x: ev.clientX - offset.current.x, y: ev.clientY - offset.current.y })
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startW = size.w, startH = size.h
    const onMove = (ev: MouseEvent) => setSize({
      w: Math.max(420, startW + ev.clientX - startX),
      h: Math.max(280, startH + ev.clientY - startY),
    })
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function runTask() {
    const text = task.trim()
    if (!text || loading) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/nodes/${nodeId}/action/run-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: text }),
      })
      const data = await res.json()
      const output = data.output || data.error || data.detail || (res.ok ? '(no output)' : `HTTP ${res.status}`)
      setHistory(h => [...h, { task: text, output, ok: !!data.ok }])
      setTask('')
    } catch (err: any) {
      setHistory(h => [...h, { task: text, output: `Network error: ${err.message}`, ok: false }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTask() }
  }

  const btn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--overlay1)', display: 'flex', alignItems: 'center', padding: 2,
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed', left: pos.x, top: pos.y,
        width: size.w, height: size.h, zIndex: 9000,
        display: 'flex', flexDirection: 'column',
        background: 'var(--crust)', border: '1px solid var(--surface1)',
        borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontFamily: 'var(--font-sans)', fontSize: 13, overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', background: 'var(--mantle)',
          borderBottom: '1px solid var(--surface0)',
          cursor: 'move', userSelect: 'none', flexShrink: 0,
        }}
      >
        <button onClick={onClose} style={{ width: 12, height: 12, borderRadius: '50%', background: '#f38ba8', border: 'none', cursor: 'pointer', flexShrink: 0 }} />
        <Zap size={12} color="var(--subtext0)" />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <button onClick={onClose} style={btn}><X size={13} /></button>
      </div>

      {/* Output log */}
      <div
        ref={bodyRef}
        style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {history.length === 0 && !loading && (
          <div style={{ color: 'var(--overlay0)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            Describe a task in natural language — the agent will reason step-by-step and act on the topology nodes.
          </div>
        )}

        {history.map((entry, i) => (
          <div key={i}>
            {/* Task bubble */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <div style={{
                maxWidth: '80%', padding: '6px 10px', borderRadius: '10px 10px 2px 10px',
                background: 'var(--blue)', color: '#1e1e2e', fontSize: 12,
              }}>
                {entry.task}
              </div>
            </div>
            {/* Agent output */}
            <div style={{
              background: entry.ok ? 'var(--surface0)' : 'color-mix(in srgb, var(--red) 15%, var(--surface0))',
              border: `1px solid ${entry.ok ? 'var(--surface1)' : 'var(--red)'}`,
              borderRadius: 6, padding: '8px 10px',
              fontFamily: 'var(--font-mono)', fontSize: 11.5,
              color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.55,
            }}>
              {entry.output}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--overlay1)', fontSize: 12 }}>
            <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Agent running…
          </div>
        )}
      </div>

      {/* Task input */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px',
        borderTop: '1px solid var(--surface0)', background: 'var(--mantle)', flexShrink: 0,
      }}>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
          placeholder="Describe the task… (Enter to run, Shift+Enter for newline)"
          rows={2}
          style={{
            flex: 1, background: 'var(--surface0)', border: '1px solid var(--surface1)',
            borderRadius: 6, color: 'var(--text)', fontSize: 12,
            padding: '6px 10px', resize: 'none', fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
        <button
          onClick={runTask}
          disabled={loading || !task.trim()}
          title="Run task (Enter)"
          style={{
            background: 'var(--mauve)', border: 'none', borderRadius: 6,
            color: '#1e1e2e', cursor: loading || !task.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !task.trim() ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, flexShrink: 0,
          }}
        >
          <Zap size={16} />
        </button>
      </div>

      <div onMouseDown={onResizeMouseDown} style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'se-resize' }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
