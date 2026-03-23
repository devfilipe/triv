/* triv WebUI — FloatingWebPanel: draggable, resizable iframe panel */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'

const MIN_W = 480
const MIN_H = 320

interface Props {
  title: string
  url: string
  onClose: () => void
}

export default function FloatingWebPanel({ title, url, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef    = useRef<HTMLIFrameElement>(null)

  const [pos, setPos]   = useState({ x: -1, y: -1 })
  const [size, setSize] = useState({ w: 900, h: 600 })
  const [maximized, setMaximized] = useState(false)
  const prevGeom = useRef({ pos: { x: 0, y: 0 }, size: { w: 900, h: 600 } })
  const [key, setKey] = useState(0) // remount iframe for refresh

  // Center on mount
  useEffect(() => {
    if (pos.x < 0) {
      setPos({
        x: Math.max(0, Math.round((window.innerWidth  - size.w) / 2)),
        y: Math.max(0, Math.round((window.innerHeight - size.h) / 2)),
      })
    }
  }, [])

  // Drag
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (maximized) return
    e.preventDefault()
    const ox = e.clientX - pos.x, oy = e.clientY - pos.y
    const move = (ev: MouseEvent) => setPos({
      x: Math.max(0, Math.min(ev.clientX - ox, window.innerWidth  - 100)),
      y: Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40)),
    })
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }, [pos, maximized])

  // Resize
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    if (maximized) return
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY, sw = size.w, sh = size.h
    const move = (ev: MouseEvent) => setSize({
      w: Math.max(MIN_W, sw + ev.clientX - sx),
      h: Math.max(MIN_H, sh + ev.clientY - sy),
    })
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }, [size, maximized])

  // Maximize / Restore
  const toggleMax = useCallback(() => {
    if (maximized) {
      setPos(prevGeom.current.pos)
      setSize(prevGeom.current.size)
      setMaximized(false)
    } else {
      prevGeom.current = { pos, size }
      setPos({ x: 0, y: 0 })
      setSize({ w: window.innerWidth, h: window.innerHeight })
      setMaximized(true)
    }
  }, [maximized, pos, size])

  const wStyle: React.CSSProperties = maximized
    ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999 }
    : { position: 'fixed', top: pos.y, left: pos.x, width: size.w, height: size.h, zIndex: 9999 }

  return (
    <div ref={containerRef} style={{
      ...wStyle,
      display: 'flex', flexDirection: 'column',
      borderRadius: maximized ? 0 : 10,
      overflow: 'hidden',
      boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
      border: '1px solid var(--surface1)',
      background: 'var(--crust)',
    }}>
      {/* Title bar */}
      <div
        onMouseDown={onDragStart}
        onDoubleClick={toggleMax}
        style={{
          height: 34, minHeight: 34,
          background: 'var(--crust)',
          display: 'flex', alignItems: 'center',
          padding: '0 10px', gap: 8,
          cursor: maximized ? 'default' : 'move',
          userSelect: 'none',
          borderBottom: '1px solid var(--surface0)',
        }}
      >
        {/* Traffic lights */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} title="Close" style={dot('#f38ba8')} />
          <button title="Minimize" style={dot('#f9e2af')} />
          <button onClick={toggleMax} title={maximized ? 'Restore' : 'Maximize'} style={dot('#a6e3a1')} />
        </div>

        <span style={{
          flex: 1, textAlign: 'center',
          color: 'var(--subtext0)', fontSize: 11, fontWeight: 500,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          fontFamily: 'var(--font-sans)',
        }}>
          {title}
        </span>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => setKey(k => k + 1)}
            title="Reload"
            style={iconBtn()}
          >
            <RefreshCw size={12} />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title="Open in new tab"
            style={{ ...iconBtn(), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* URL bar */}
      <div style={{
        padding: '4px 10px',
        background: 'var(--mantle)',
        borderBottom: '1px solid var(--surface0)',
        fontSize: 10,
        color: 'var(--subtext0)',
        fontFamily: 'var(--font-mono)',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}>
        {url}
      </div>

      {/* iframe body */}
      <iframe
        key={key}
        ref={iframeRef}
        src={url}
        style={{
          flex: 1,
          border: 'none',
          background: '#fff',
          display: 'block',
        }}
        title={title}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />

      {/* Resize handle */}
      {!maximized && (
        <div onMouseDown={onResizeStart} style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 20, height: 20, cursor: 'nwse-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--overlay0)', fontSize: 11, userSelect: 'none',
          zIndex: 1,
        }}>⟡</div>
      )}
    </div>
  )
}

function dot(bg: string): React.CSSProperties {
  return {
    width: 12, height: 12, borderRadius: '50%',
    background: bg, border: 'none', cursor: 'pointer',
    padding: 0, transition: 'opacity 0.15s',
  }
}

function iconBtn(): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--overlay1)',
    padding: '3px',
    borderRadius: 4,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}
