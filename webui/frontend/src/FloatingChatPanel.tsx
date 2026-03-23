/* triv WebUI — FloatingChatPanel: interactive multi-turn LLM chat */

import React, { useState, useRef, useEffect } from 'react'
import { X, Send, Trash2, MessageSquare, Settings, ChevronDown, ChevronRight, Loader } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

interface Props {
  nodeId: string
  title: string
  onClose: () => void
}

export default function FloatingChatPanel({ nodeId, title, onClose }: Props) {
  const panelRef   = useRef<HTMLDivElement>(null)
  const bodyRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const dragging   = useRef(false)
  const offset     = useRef({ x: 0, y: 0 })

  const [pos, setPos]           = useState({ x: 100, y: 80 })
  const [size, setSize]         = useState({ w: 640, h: 520 })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [system, setSystem]     = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [loading, setLoading]   = useState(false)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, loading])

  // Drag
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

  // Resize (bottom-right corner)
  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startW = size.w, startH = size.h
    const onMove = (ev: MouseEvent) => setSize({
      w: Math.max(420, startW + ev.clientX - startX),
      h: Math.max(300, startH + ev.clientY - startY),
    })
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    inputRef.current?.focus()

    try {
      const res = await fetch(`/api/nodes/${nodeId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })), system }),
      })
      const data = await res.json()
      if (res.ok && data.ok && data.output) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.output }])
      } else {
        const errText = data.output || data.error || data.detail || `HTTP ${res.status}`
        setMessages(prev => [...prev, { role: 'assistant', content: errText, error: true }])
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Network error: ${err.message}`, error: true }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Minimal Markdown: bold, inline code, code blocks
  function renderContent(text: string) {
    const lines = text.split('\n')
    const out: React.ReactNode[] = []
    let inCode = false
    let codeLang = ''
    let codeBuf: string[] = []
    let key = 0

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (!inCode) {
          inCode = true
          codeLang = line.slice(3).trim()
          codeBuf = []
        } else {
          out.push(
            <pre key={key++} style={{
              background: 'var(--base)', border: '1px solid var(--surface1)',
              borderRadius: 6, padding: '8px 10px', margin: '6px 0',
              fontSize: 11, overflowX: 'auto', whiteSpace: 'pre',
            }}>
              {codeLang && <span style={{ color: 'var(--overlay1)', fontSize: 10 }}>{codeLang}{'\n'}</span>}
              {codeBuf.join('\n')}
            </pre>
          )
          inCode = false; codeLang = ''; codeBuf = []
        }
        continue
      }
      if (inCode) { codeBuf.push(line); continue }

      // inline: bold + inline code
      const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
      const inline = parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`'))
          return <code key={i} style={{ background: 'var(--surface0)', borderRadius: 3, padding: '0 4px', fontSize: 11 }}>{p.slice(1, -1)}</code>
        if (p.startsWith('**') && p.endsWith('**'))
          return <strong key={i}>{p.slice(2, -2)}</strong>
        return p
      })
      out.push(<div key={key++}>{inline.length ? inline : '\u00a0'}</div>)
    }
    // flush unclosed code block
    if (inCode && codeBuf.length) out.push(<pre key={key++}>{codeBuf.join('\n')}</pre>)
    return out
  }

  const btns: React.CSSProperties = {
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
      {/* ── Title bar ── */}
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
        <MessageSquare size={12} color="var(--subtext0)" />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <button onClick={() => setShowSystem(s => !s)} title="System prompt" style={btns}>
          <Settings size={12} />
        </button>
        <button onClick={() => setMessages([])} title="Clear conversation" style={btns}>
          <Trash2 size={12} />
        </button>
        <button onClick={onClose} style={btns}><X size={13} /></button>
      </div>

      {/* ── System prompt (collapsible) ── */}
      {showSystem && (
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--surface0)', background: 'var(--mantle)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--subtext0)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Settings size={10} /> System prompt
          </div>
          <textarea
            value={system}
            onChange={e => setSystem(e.target.value)}
            placeholder="You are a helpful assistant…"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--surface0)', border: '1px solid var(--surface1)',
              borderRadius: 5, color: 'var(--text)', fontSize: 11,
              padding: '4px 8px', resize: 'none', fontFamily: 'var(--font-sans)',
            }}
          />
        </div>
      )}

      {/* ── Messages ── */}
      <div
        ref={bodyRef}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ color: 'var(--overlay0)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            Start chatting — press Enter to send, Shift+Enter for newline.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ fontSize: 10, color: 'var(--overlay0)', marginBottom: 2, paddingInline: 4 }}>
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div style={{
              maxWidth: '85%', padding: '8px 12px', borderRadius: 10,
              background: msg.role === 'user'
                ? 'var(--blue)'
                : msg.error ? 'var(--red)' : 'var(--surface1)',
              color: msg.role === 'user' ? '#1e1e2e' : msg.error ? '#1e1e2e' : 'var(--text)',
              fontSize: 12.5, lineHeight: 1.6,
              borderTopRightRadius: msg.role === 'user' ? 2 : 10,
              borderTopLeftRadius:  msg.role === 'user' ? 10 : 2,
            }}>
              {msg.role === 'assistant' ? renderContent(msg.content) : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--overlay1)', fontSize: 12 }}>
            <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Thinking…
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px',
        borderTop: '1px solid var(--surface0)', background: 'var(--mantle)', flexShrink: 0,
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          rows={2}
          style={{
            flex: 1, background: 'var(--surface0)', border: '1px solid var(--surface1)',
            borderRadius: 6, color: 'var(--text)', fontSize: 12,
            padding: '6px 10px', resize: 'none', fontFamily: 'var(--font-sans)',
            outline: 'none',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          title="Send (Enter)"
          style={{
            background: 'var(--blue)', border: 'none', borderRadius: 6,
            color: '#1e1e2e', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !input.trim() ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, flexShrink: 0,
          }}
        >
          <Send size={16} />
        </button>
      </div>

      {/* ── Resize handle ── */}
      <div onMouseDown={onResizeMouseDown} style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'se-resize' }} />

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
