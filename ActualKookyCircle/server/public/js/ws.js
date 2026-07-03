// WebSocket manager
// Maintains up to 3 connections: chat, clan, game

const WS_BASE = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

class ManagedSocket {
  constructor(type) {
    this.type = type
    this.ws = null
    this.listeners = {}
    this.queue = []
    this.connected = false
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.ws = new WebSocket(`${WS_BASE}?type=${this.type}`)
    this.ws.onopen = () => {
      this.connected = true
      this.queue.forEach(m => this.ws.send(JSON.stringify(m)))
      this.queue = []
    }
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const handlers = this.listeners[msg.type] || []
        handlers.forEach(fn => fn(msg))
      } catch {}
    }
    this.ws.onclose = () => {
      this.connected = false
    }
    this.ws.onerror = () => {
      this.connected = false
    }
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false
    this.queue = []
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      this.queue.push(data)
    }
  }

  on(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
    return () => this.off(type, fn)
  }

  off(type, fn) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(f => f !== fn)
    }
  }

  offAll() { this.listeners = {} }
}

export const chatWs = new ManagedSocket('chat')
export const clanWs = new ManagedSocket('clan')
export const gameWs = new ManagedSocket('game')

export function connectAll() {
  chatWs.connect()
}

export function disconnectAll() {
  chatWs.disconnect()
  clanWs.disconnect()
  gameWs.disconnect()
}
