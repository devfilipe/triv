/* triv WebUI — NetworkNode: ReactFlow custom node for NetworkDef objects */

import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Cloud, Network } from 'lucide-react'
import type { NetworkDefDef } from './types'

const TYPE_COLOR: Record<string, string> = {
  bridge:        '#89b4fa',  // blue
  docker:        '#94e2d5',  // teal
  trunk:         '#cba6f7',  // mauve
  'vlan-bridge': '#fab387',  // peach
  p2p:           '#a6e3a1',  // green
}

function statusDotColor(status: any): string {
  if (!status) return '#6c7086'
  if (status.deployed && status.bridge_state === 'up') return '#a6e3a1'
  if (status.deployed) return '#f9e2af'
  return '#6c7086'
}

interface NetworkNodeData {
  nd: NetworkDefDef
  status?: any
}

export default function NetworkNode({ data }: { data: NetworkNodeData }) {
  const { nd, status } = data
  if (!nd) return null

  const color = TYPE_COLOR[nd.type] ?? '#6c7086'
  const dot = statusDotColor(status)
  const Icon = nd.type === 'docker' ? Network : Cloud
  const netId = nd.network_id ? nd.network_id.slice(0, 8) : ''

  const bridgeName: string | undefined = status?.bridge_name
  const bridgeState: string | undefined = status?.bridge_state
  const deployed: boolean = !!status?.deployed

  const stateColor = deployed
    ? (bridgeState === 'up' ? '#a6e3a1' : '#f9e2af')
    : '#6c7086'
  const stateLabel = deployed
    ? (bridgeState === 'up' ? 'up' : bridgeState ?? 'down')
    : 'not deployed'

  return (
    <div style={{
      minWidth: 210,
      background: 'var(--mantle)',
      border: `1px solid ${color}50`,
      borderRadius: 10,
      padding: '10px 14px',
      fontFamily: 'var(--font-sans)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    }}>
      <Handle
        type="target" position={Position.Top} id="target"
        style={{ background: 'transparent', border: 'none', width: 1, height: 1, minWidth: 1, minHeight: 1 }}
      />
      <Handle
        type="target" position={Position.Left} id="iface-target"
        style={{
          width: 10, height: 10,
          background: color,
          border: '2px solid var(--mantle)',
          borderRadius: '50%',
          left: -6,
        }}
      />

      {/* Header row: icon · label · status dot + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={14} color={color} />
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)', flex: 1 }}>
          {nd.label || nd.id}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: dot,
          }} />
          <span style={{ fontSize: 8, color: stateColor, fontWeight: 600 }}>
            {stateLabel}
          </span>
        </div>
      </div>

      {/* Type badge + subnet */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 3,
          background: `${color}20`, color, fontWeight: 500,
        }}>
          {nd.type}
        </span>
        {nd.subnet && (
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--subtext1)',
          }}>
            {nd.subnet}
          </span>
        )}
        {nd.gateway && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--overlay1)',
          }}>
            gw {nd.gateway}
          </span>
        )}
      </div>

      {/* Bridge name in OS */}
      {bridgeName && (
        <div style={{
          marginTop: 4, display: 'flex', alignItems: 'center', gap: 5,
          paddingTop: 4, borderTop: '1px solid var(--surface1)',
        }}>
          <span style={{ fontSize: 8, color: 'var(--overlay0)' }}>bridge</span>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--subtext1)',
            background: 'var(--surface0)', padding: '0 4px', borderRadius: 3,
          }}>
            {bridgeName}
          </span>
        </div>
      )}

      {/* Footer: network_id */}
      {netId && (
        <div style={{ textAlign: 'right', marginTop: 4 }}>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--overlay0)',
          }}>
            {netId}
          </span>
        </div>
      )}

      <Handle
        type="source" position={Position.Bottom} id="source"
        style={{ background: 'transparent', border: 'none', width: 1, height: 1, minWidth: 1, minHeight: 1 }}
      />
    </div>
  )
}
