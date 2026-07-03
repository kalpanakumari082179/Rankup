import pool from '../db/index.js'
import { filterContent, containsBannedWord } from '../lib/filter.js'

const roomClients = new Map()
const dmClients = new Map()

export function handleChatConnection(ws, userId, username, avatarUrl) {
  ws.userId = userId
  ws.username = username
  ws.avatarUrl = avatarUrl
  ws.currentRoom = null

  ws.on('message', async (raw) => {
    let data
    try { data = JSON.parse(raw) } catch { return }

    if (data.type === 'join_room') {
      if (ws.currentRoom) {
        const prev = roomClients.get(ws.currentRoom)
        if (prev) prev.delete(ws)
      }
      ws.currentRoom = data.roomId
      if (!roomClients.has(data.roomId)) roomClients.set(data.roomId, new Set())
      roomClients.get(data.roomId).add(ws)
      ws.send(JSON.stringify({ type: 'room_joined', roomId: data.roomId }))
    }

    if (data.type === 'room_message') {
      const content = filterContent(data.content?.trim())
      if (!content || content.length > 500) return
      try {
        const result = await pool.query(
          `INSERT INTO chat_messages (room_id, sender_id, content, is_dm) VALUES ($1,$2,$3,false) RETURNING *`,
          [data.roomId, userId, content]
        )
        const msg = {
          type: 'room_message',
          message: {
            ...result.rows[0],
            username,
            avatar_url: avatarUrl
          }
        }
        const clients = roomClients.get(data.roomId)
        if (clients) {
          clients.forEach(client => {
            if (client.readyState === 1) client.send(JSON.stringify(msg))
          })
        }
      } catch (err) {
        console.error('Chat error:', err.message)
      }
    }

    if (data.type === 'dm') {
      const content = filterContent(data.content?.trim())
      if (!content || content.length > 500) return
      const recipientId = data.recipientId
      try {
        const result = await pool.query(
          `INSERT INTO chat_messages (sender_id, recipient_id, content, is_dm) VALUES ($1,$2,$3,true) RETURNING *`,
          [userId, recipientId, content]
        )
        const msg = {
          type: 'dm',
          message: { ...result.rows[0], username, avatar_url: avatarUrl }
        }
        ws.send(JSON.stringify(msg))
        const recipientWs = dmClients.get(recipientId)
        if (recipientWs && recipientWs.readyState === 1) {
          recipientWs.send(JSON.stringify(msg))
        }
      } catch (err) {
        console.error('DM error:', err.message)
      }
    }
  })

  dmClients.set(userId, ws)

  ws.on('close', () => {
    if (ws.currentRoom) {
      const clients = roomClients.get(ws.currentRoom)
      if (clients) clients.delete(ws)
    }
    if (dmClients.get(userId) === ws) dmClients.delete(userId)
  })
}
