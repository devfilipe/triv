/* triv WebUI — FloatingOutputPanel: scrollable exec output display */

import React, { useRef, useEffect, useState } from 'react'
import { X, Copy, Check, Terminal, Minus } from 'lucide-react'

interface Props {
  title: string
  output: string   // stdout + stderr merged
  onClose: () => void
  live?: boolean          // true while command is still running (shows spinner)
  minimized?: boolean     // body hidden, only titlebar visible
  onMinimize?: () => void
}

export default function FloatingOutputPanel({ title, output, onClose, live, minimized, onMinimize }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef  = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const offset   = useRef({ x: 0, y: 0 })
  const [pos, setPos]       = useState({ x: 80, y: 80 })
  const [size, setSize]     = useState({ w: 700, h: 420 })
  const [copied, setCopied] = useState(false)

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [output])

  // Drag
  function onTitleMouseDown(e: React.MouseEvent) {
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
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startW = size.w, startH = size.h
    const onMove = (ev: MouseEvent) => {
      setSize({
        w: Math.max(360, startW + ev.clientX - startX),
        h: Math.max(200, startH + ev.clientY - startY),
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function copyOutput() {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // Simple ANSI colour → HTML (bold, common fg colours)
  function ansiToHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\x1b\[0m/g, '</span>')
      .replace(/\x1b\[1m/g,  '<span style="font-weight:700">')
      .replace(/\x1b\[31m/g, '<span style="color:#f38ba8">')
      .replace(/\x1b\[32m/g, '<span style="color:#a6e3a1">')
      .replace(/\x1b\[33m/g, '<span style="color:#f9e2af">')
      .replace(/\x1b\[34m/g, '<span style="color:#89b4fa">')
      .replace(/\x1b\[35m/g, '<span style="color:#cba6f7">')
      .replace(/\x1b\[36m/g, '<span style="color:#89dceb">')
      .replace(/\x1b\[37m/g, '<span style="color:#cdd6f4">')
      .replace(/\x1b\[\d+m/g, '')  // strip remaining escape codes
  }

  return (
    <>
    <style>{`@keyframes triv-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: pos.x, top: pos.y,
        width: size.w,
        height: minimized ? 'auto' : size.h,
        zIndex: 9000,
        display: 'flex', flexDirection: 'column',
        background: 'var(--crust)',
        border: '1px solid var(--surface1)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        overflow: 'hidden',
        resize: 'none',
      }}
    >
      {/* ── Title bar ──────────────────────────────────────────── */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'var(--mantle)',
          borderBottom: '1px solid var(--surface0)',
          cursor: 'move', userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {/* Traffic-light close */}
        <button
          onClick={onClose}
          style={{
            width: 12, height: 12, borderRadius: '50%',
            background: '#f38ba8', border: 'none', cursor: 'pointer',
            flexShrink: 0,
          }}
        />
        <Terminal size={12} color="var(--subtext0)" />
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 600,
          color: 'var(--text)', fontFamily: 'var(--font-sans)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        {live && (
          <span title="Running…" style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: 'var(--green)', flexShrink: 0,
            animation: 'triv-pulse 1.2s ease-in-out infinite',
          }} />
        )}
        {!minimized && (
          <button
            onClick={copyOutput}
            title="Copy output"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--overlay1)', display: 'flex', alignItems: 'center',
              padding: 2,
            }}
          >
            {copied ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
          </button>
        )}
        {onMinimize && (
          <button
            onClick={onMinimize}
            title={minimized ? 'Expand' : 'Minimize'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--overlay1)', display: 'flex', alignItems: 'center',
              padding: 2,
            }}
          >
            <Minus size={13} />
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--overlay1)', display: 'flex', alignItems: 'center',
            padding: 2,
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Output body ────────────────────────────────────────── */}
      {!minimized && (
        <div
          ref={bodyRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 14px',
            color: 'var(--text)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
          dangerouslySetInnerHTML={{ __html: ansiToHtml(output) }}
        />
      )}

      {/* ── Resize handle ──────────────────────────────────────── */}
      {!minimized && (
        <div
          onMouseDown={onResizeMouseDown}
          style={{
            position: 'absolute', right: 0, bottom: 0,
            width: 14, height: 14, cursor: 'se-resize',
            background: 'transparent',
          }}
        />
      )}
    </div>
    </>
  )
}
