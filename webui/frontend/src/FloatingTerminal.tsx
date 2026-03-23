/* triv WebUI — FloatingTerminal: draggable, resizable terminal window */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

const MIN_W = 420
const MIN_H = 240

interface Props {
  type: 'console' | 'ssh'
  target: string
  user?: string
  port?: number
  password?: string
  onClose: () => void
}

export default function FloatingTerminal({ type, target, user, port, password, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef     = useRef<HTMLDivElement>(null)
  const fitAddonRef  = useRef<FitAddon | null>(null)

  const [pos, setPos]   = useState({ x: -1, y: -1 })
  const [size, setSize] = useState({ w: 760, h: 460 })
  const [maximized, setMaximized] = useState(false)
  const prevGeom = useRef({ pos: { x: 0, y: 0 }, size: { w: 760, h: 460 } })

  // Center on mount
  useEffect(() => {
    if (pos.x < 0) {
      setPos({
        x: Math.max(0, Math.round((window.innerWidth  - size.w) / 2)),
        y: Math.max(0, Math.round((window.innerHeight - size.h) / 2)),
      })
    }
  }, [])

  // xterm + WebSocket
  useEffect(() => {
    if (!xtermRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background:          '#1e1e2e',
        foreground:          '#cdd6f4',
        cursor:              '#f5e0dc',
        selectionBackground: '#585b7066',
        black:   '#45475a', red:     '#f38ba8',
        green:   '#a6e3a1', yellow:  '#f9e2af',
        blue:    '#89b4fa', magenta: '#cba6f7',
        cyan:    '#94e2d5', white:   '#bac2de',
        brightBlack: '#585b70', brightRed:     '#f38ba8',
        brightGreen: '#a6e3a1', brightYellow:  '#f9e2af',
        brightBlue:  '#89b4fa', brightMagenta: '#cba6f7',
        brightCyan:  '#94e2d5', brightWhite:   '#a6adc8',
      },
    })
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(xtermRef.current)
    requestAnimationFrame(() => fitAddon.fit())

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let url: string
    if (type === 'console') {
      url = `${proto}://${location.host}/ws/console/${target}`
    } else {
      const params = new URLSearchParams()
      if (user) params.set('user', user)
      if (port) params.set('port', String(port))
      if (password) params.set('password', password)
      const qs = params.toString()
      url = `${proto}://${location.host}/ws/ssh/${target}${qs ? '?' + qs : ''}`
    }
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    ws.onmessage = e => term.write(new Uint8Array(e.data as ArrayBuffer))
    ws.onclose   = () => term.write('\r\n\x1b[90m--- connection closed ---\x1b[0m\r\n')
    term.onData(d => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(new TextEncoder().encode(d))
    })

    return () => { ws.close(); term.dispose() }
  }, [type, target])

  // Re-fit on size change
  useEffect(() => {
    requestAnimationFrame(() => fitAddonRef.current?.fit())
  }, [size, maximized])

  // Drag
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (maximized) return
    e.preventDefault()
    const ox = e.clientX - pos.x, oy = e.clientY - pos.y
    const move = (ev: MouseEvent) => setPos({
      x: Math.max(0, Math.min(ev.clientX - ox, window.innerWidth  - 100)),
      y: Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40)),
    })
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
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
      requestAnimationFrame(() => fitAddonRef.current?.fit())
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
    }}>
      {/* Title bar */}
      <div
        onMouseDown={onDragStart}
        onDoubleClick={toggleMax}
        style={{
          height: 34, minHeight: 34,
          background: 'var(--crust)',
          display: 'flex', alignItems: 'center',
          padding: '0 10px',
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
          fontFamily: 'var(--font-mono)',
        }}>
          ● {target} — {type}
        </span>
        <div style={{ width: 52 }} /> {/* Balance traffic lights */}
      </div>

      {/* Terminal body */}
      <div ref={xtermRef} style={{ flex: 1, background: '#1e1e2e' }} />

      {/* Resize handle */}
      {!maximized && (
        <div onMouseDown={onResizeStart} style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 20, height: 20, cursor: 'nwse-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--overlay0)', fontSize: 11, userSelect: 'none',
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
