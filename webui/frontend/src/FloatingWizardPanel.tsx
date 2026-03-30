import { apiFetch } from './apiFetch'
/* triv WebUI — FloatingWizardPanel: context-aware AI Wizard chat */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Wand2, Loader, ChevronDown, ChevronUp, Settings, AlertTriangle } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  ok?: boolean
}

interface BlockedAction {
  action_id: string
  node_id: string
  payload: Record<string, any>
}

interface PendingConfirmation {
  task: string
  blockedActions: BlockedAction[]
}

interface WizardStatus {
  enabled: boolean
  topology_loaded: boolean
  provider: string
  model: string
}

interface ActiveOrg {
  id: string
  name: string
  vendors: string[]
}

interface Props {
  context: string
  contextLabel: string
  onClose: () => void
  onOpenConfig: () => void
  onBusyChange?: (busy: boolean) => void
}

export default function FloatingWizardPanel({ context, contextLabel, onClose, onOpenConfig, onBusyChange }: Props) {
  const panelRef   = useRef<HTMLDivElement>(null)
  const bodyRef    = useRef<HTMLDivElement>(null)
  const dragging   = useRef(false)
  const offset     = useRef({ x: 0, y: 0 })
  const abortRef   = useRef<AbortController | null>(null)

  const [pos, setPos]           = useState({ x: 80, y: 80 })
  const [size, setSize]         = useState({ w: 580, h: 520 })
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus]     = useState<WizardStatus | null>(null)
  const [activeOrg, setActiveOrg] = useState<ActiveOrg | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null)

  // Fetch wizard status + active org on mount; abort in-flight task on unmount
  useEffect(() => {
    apiFetch('/api/wizard/status').then(r => r.json()).then(setStatus).catch(() => setStatus(null))
    apiFetch('/api/orgs/active').then(r => r.json()).then(d => setActiveOrg(d.id ? d : null)).catch(() => setActiveOrg(null))
    return () => { abortRef.current?.abort() }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, loading])

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
      w: Math.max(400, startW + ev.clientX - startX),
      h: Math.max(300, startH + ev.clientY - startY),
    })
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const doSend = useCallback(async (text: string, confirmedActions?: string[]) => {
    if (!text || loading) return
    setInput('')
    setPendingConfirm(null)
    if (!confirmedActions) {
      setMessages(m => [...m, { role: 'user', content: text }])
    }
    setLoading(true)
    onBusyChange?.(true)

    // Cancel any previous in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const body: Record<string, any> = { task: text, context }
      if (confirmedActions) body.confirmed_actions = confirmedActions

      const res = await apiFetch('/api/wizard/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        const txt = await res.text()
        setMessages(m => [...m, { role: 'assistant', content: `Server error (${res.status}): ${txt.slice(0, 300)}`, ok: false }])
        return
      }
      const data = await res.json()
      const output = data.output || data.error || data.detail || (res.ok ? '(no output)' : `HTTP ${res.status}`)
      setMessages(m => [...m, { role: 'assistant', content: output, ok: data.ok !== false }])

      // If the backend flagged blocked destructive actions, show confirmation
      if (data.confirmation_required && data.blocked_actions?.length) {
        setPendingConfirm({
          task: text,
          blockedActions: data.blocked_actions,
        })
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setMessages(m => [...m, { role: 'assistant', content: `Network error: ${err.message}`, ok: false }])
    } finally {
      setLoading(false)
      onBusyChange?.(false)
    }
  }, [loading, context, onBusyChange])

  const sendMessage = useCallback(() => {
    doSend(input.trim())
  }, [input, doSend])

  const confirmPending = useCallback(() => {
    if (!pendingConfirm) return
    const actionIds = [...new Set(pendingConfirm.blockedActions.map(b => b.action_id))]
    setMessages(m => [...m, { role: 'user', content: `✓ Confirmed: ${actionIds.join(', ')}` }])
    doSend(pendingConfirm.task, actionIds)
  }, [pendingConfirm, doSend])

  const rejectPending = useCallback(() => {
    setPendingConfirm(null)
    setMessages(m => [...m, { role: 'user', content: '✗ Cancelled — destructive actions rejected.' }])
  }, [])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const notEnabled = status && !status.enabled
  const notLoaded  = status && !status.topology_loaded

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed', left: pos.x, top: pos.y,
        width: size.w, height: size.h, zIndex: 9100,
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
        <button
          onClick={onClose}
          style={{ width: 12, height: 12, borderRadius: '50%', background: '#f38ba8', border: 'none', cursor: 'pointer', flexShrink: 0 }}
        />
        <Wand2 size={12} color="#cba6f7" />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
          Wizard
          {contextLabel && (
            <span style={{ color: 'var(--subtext0)', fontWeight: 400, marginLeft: 6 }}>
              · {contextLabel}
            </span>
          )}
        </span>
        {status && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 8,
            background: status.enabled ? 'color-mix(in srgb, #a6e3a1 20%, var(--surface0))' : 'var(--surface0)',
            color: status.enabled ? '#a6e3a1' : 'var(--overlay1)',
            border: `1px solid ${status.enabled ? '#a6e3a1' : 'var(--surface1)'}`,
          }}>
            {status.enabled ? (status.model || 'on') : 'disabled'}
          </span>
        )}
        <button
          onClick={onOpenConfig}
          title="Wizard settings"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)', display: 'flex', padding: 2 }}
        >
          <Settings size={12} />
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--overlay1)', display: 'flex', padding: 2 }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Context + Org bar */}
      {(context || activeOrg) && (
        <div style={{ borderBottom: '1px solid var(--surface0)', background: 'var(--base)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '3px 10px', gap: 6 }}>
            {/* Org badge */}
            {activeOrg && (
              <span style={{
                fontSize: 10, padding: '1px 7px', borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, #89b4fa 15%, var(--surface0))',
                color: '#89b4fa', border: '1px solid #89b4fa40',
              }}>
                🏢 {activeOrg.name}
              </span>
            )}
            {/* Context toggle */}
            {context && (
              <button
                onClick={() => setShowContext(v => !v)}
                style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '2px 0', color: 'var(--subtext0)', fontSize: 11, minWidth: 0,
                }}
              >
                {showContext ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Context: {contextLabel}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--overlay0)', fontSize: 10, flexShrink: 0 }}>
                  {context.length.toLocaleString()} chars
                </span>
              </button>
            )}
          </div>
          {showContext && context && (
            <pre style={{
              margin: 0, padding: '6px 10px', fontSize: 10, color: 'var(--overlay1)',
              maxHeight: 120, overflowY: 'auto', background: 'var(--mantle)',
              borderTop: '1px solid var(--surface0)',
            }}>
              {context.length > 2000 ? context.slice(0, 2000) + '\n…' : context}
            </pre>
          )}
        </div>
      )}

      {/* Body */}
      <div
        ref={bodyRef}
        style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {notEnabled && (
          <div style={{
            margin: 'auto', textAlign: 'center', color: 'var(--subtext0)',
            display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
          }}>
            <Wand2 size={28} color="var(--overlay0)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Wizard is disabled</div>
            <div style={{ fontSize: 12 }}>Enable it and configure a provider in Wizard settings.</div>
            <button
              onClick={onOpenConfig}
              style={{
                marginTop: 4, padding: '7px 16px', borderRadius: 6,
                background: '#cba6f7', border: 'none', cursor: 'pointer',
                color: '#1e1e2e', fontSize: 12, fontWeight: 600,
              }}
            >
              Open Settings
            </button>
          </div>
        )}

        {!notEnabled && messages.length === 0 && !loading && (
          <div style={{ color: 'var(--overlay0)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            Ask the Wizard to help you build your topology, configure nodes, set up drivers or networks.
          </div>
        )}

        {!notEnabled && messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '82%', padding: '6px 10px',
                  borderRadius: '10px 10px 2px 10px',
                  background: '#cba6f7', color: '#1e1e2e', fontSize: 12,
                }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div style={{
                background: msg.ok === false
                  ? 'color-mix(in srgb, var(--red) 12%, var(--surface0))'
                  : 'var(--surface0)',
                border: `1px solid ${msg.ok === false ? 'var(--red)' : 'var(--surface1)'}`,
                borderRadius: 6, padding: '8px 10px',
                fontFamily: 'var(--font-mono)', fontSize: 11.5,
                color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.55,
              }}>
                {msg.content}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--overlay1)', fontSize: 12 }}>
            <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Wizard thinking…
          </div>
        )}

        {/* Confirmation banner for blocked destructive actions */}
        {pendingConfirm && !loading && (
          <div style={{
            background: 'color-mix(in srgb, #fab387 12%, var(--surface0))',
            border: '1px solid #fab38760',
            borderRadius: 8, padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <AlertTriangle size={14} color="#fab387" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#fab387' }}>Confirmation required</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text)', marginBottom: 8, lineHeight: 1.5 }}>
              The wizard wants to execute destructive operations:
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {pendingConfirm.blockedActions.map((b, i) => (
                  <li key={i} style={{ color: 'var(--subtext1)' }}>
                    <code style={{ color: '#f38ba8' }}>{b.action_id}</code>
                    {b.payload && Object.keys(b.payload).length > 0 && (
                      <span style={{ color: 'var(--overlay0)' }}>
                        {' '}({Object.entries(b.payload).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={confirmPending}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: '#fab387', border: 'none', cursor: 'pointer', color: '#1e1e2e',
                }}
              >
                Confirm
              </button>
              <button
                onClick={rejectPending}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12,
                  background: 'var(--surface1)', border: 'none', cursor: 'pointer', color: 'var(--text)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      {!notEnabled && (
        <div style={{
          display: 'flex', gap: 6, padding: '8px 10px',
          borderTop: '1px solid var(--surface0)', background: 'var(--mantle)', flexShrink: 0,
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
            placeholder="Ask the Wizard… (Enter to send, Shift+Enter for newline)"
            rows={2}
            style={{
              flex: 1, background: 'var(--surface0)', border: '1px solid var(--surface1)',
              borderRadius: 6, color: 'var(--text)', fontSize: 12,
              padding: '6px 10px', resize: 'none', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            title="Send (Enter)"
            style={{
              background: '#cba6f7', border: 'none', borderRadius: 6,
              color: '#1e1e2e', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 38, flexShrink: 0,
            }}
          >
            <Wand2 size={16} />
          </button>
        </div>
      )}

      <div onMouseDown={onResizeMouseDown} style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'se-resize' }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
