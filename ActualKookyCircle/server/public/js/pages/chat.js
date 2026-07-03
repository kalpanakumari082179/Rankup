import { api } from '../api.js'
import { state, toast, timeAgo, avatar } from '../app.js'
import { chatWs } from '../ws.js'

const ROOMS = [
  { id: 'general',  name: 'General',         icon: 'bi-hash' },
  { id: 'lfg',      name: 'Looking for Group', icon: 'bi-people-fill' },
  { id: 'off-topic',name: 'Off Topic',        icon: 'bi-chat-dots' },
]

let currentRoom = null
let currentDm   = null
let unsubRoom   = null

export async function renderChat(container) {
  container.innerHTML = `
    <div class="page-header" style="margin-bottom:12px">
      <h1 class="page-title"><i class="bi bi-chat-dots-fill"></i> Chat</h1>
    </div>
    <div class="chat-layout">
      <!-- Sidebar -->
      <div class="chat-sidebar">
        <div style="overflow-y:auto;flex:1">
          <div class="chat-sidebar-section">Rooms</div>
          ${ROOMS.map(r => `
            <div class="chat-room-item" data-room="${r.id}">
              <i class="bi ${r.icon}"></i>${r.name}
            </div>
          `).join('')}
          <div class="chat-sidebar-section" style="margin-top:8px">Direct Messages</div>
          <div id="dm-list"><div style="padding:8px 12px;font-size:12px;color:var(--text-3)">Loading...</div></div>
          <div style="padding:6px 8px">
            <button class="btn btn-ghost btn-sm w-full" id="new-dm-btn" style="justify-content:center">
              <i class="bi bi-plus-lg"></i> New DM
            </button>
          </div>
        </div>
      </div>

      <!-- Main chat area -->
      <div class="chat-main">
        <div class="chat-topbar">
          <i class="bi bi-hash" id="chat-icon" style="color:var(--text-2)"></i>
          <span class="chat-topbar-name" id="chat-title">Select a room or DM</span>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="state-container">
            <i class="bi bi-chat-left state-icon"></i>
            <p class="state-desc">Select a room or conversation to start chatting</p>
          </div>
        </div>
        <div class="chat-input-area" id="chat-input-area" style="display:none">
          <textarea class="input" id="chat-input" placeholder="Message…" rows="1" style="min-height:36px;max-height:100px;resize:none"></textarea>
          <button class="btn btn-primary btn-icon" id="chat-send"><i class="bi bi-send-fill"></i></button>
        </div>
      </div>
    </div>
  `

  loadDmList(container)

  // Room clicks
  container.querySelectorAll('[data-room]').forEach(el => {
    el.addEventListener('click', () => openRoom(el.dataset.room, container))
  })

  // New DM
  container.querySelector('#new-dm-btn').addEventListener('click', () => showNewDmModal(container))

  // Send button & Enter key
  container.querySelector('#chat-send').addEventListener('click', () => sendMessage(container))
  container.querySelector('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(container) }
  })

  // Auto-open general
  openRoom('general', container)
}

async function openRoom(roomId, container) {
  if (unsubRoom) { unsubRoom(); unsubRoom = null }
  currentRoom = roomId
  currentDm   = null

  const room = ROOMS.find(r => r.id === roomId) || { name: roomId, icon: 'bi-hash' }

  container.querySelectorAll('[data-room]').forEach(el =>
    el.classList.toggle('active', el.dataset.room === roomId)
  )
  container.querySelector('#chat-icon').className = `bi ${room.icon}`
  container.querySelector('#chat-title').textContent = room.name
  container.querySelector('#chat-input').placeholder = `Message #${room.name}…`
  container.querySelector('#chat-input-area').style.display = 'flex'

  const msgsEl = container.querySelector('#chat-messages')
  msgsEl.innerHTML = '<div class="state-container"><div class="spinner"></div></div>'

  try {
    const { messages } = await api.get(`/chat/rooms/${roomId}/messages`)
    renderMessages(msgsEl, messages)
    scrollBottom(msgsEl)
  } catch { msgsEl.innerHTML = '<p class="state-container text-dim">Failed to load messages</p>' }

  // Subscribe to live messages
  chatWs.connect()
  chatWs.send({ type: 'chat:join', room: roomId })

  unsubRoom = chatWs.on('chat:message', (msg) => {
    if (msg.room !== currentRoom) return
    appendMessage(msgsEl, msg)
    scrollBottom(msgsEl)
  })
}

async function openDm(userId, username, avatarUrl, container) {
  if (unsubRoom) { unsubRoom(); unsubRoom = null }
  currentDm   = userId
  currentRoom = null

  container.querySelectorAll('[data-room]').forEach(el => el.classList.remove('active'))
  container.querySelectorAll('[data-dm]').forEach(el =>
    el.classList.toggle('active', el.dataset.dm == userId)
  )

  container.querySelector('#chat-icon').className = 'bi bi-person-fill'
  container.querySelector('#chat-title').textContent = username
  container.querySelector('#chat-input').placeholder = `Message ${username}…`
  container.querySelector('#chat-input-area').style.display = 'flex'

  const msgsEl = container.querySelector('#chat-messages')
  msgsEl.innerHTML = '<div class="state-container"><div class="spinner"></div></div>'

  try {
    const { messages } = await api.get(`/chat/dm/${userId}`)
    renderMessages(msgsEl, messages)
    scrollBottom(msgsEl)
  } catch { msgsEl.innerHTML = '<p class="state-container text-dim">Failed to load</p>' }

  chatWs.connect()
  unsubRoom = chatWs.on('chat:dm', (msg) => {
    if (msg.from_user_id !== currentDm && msg.to_user_id !== currentDm) return
    appendMessage(msgsEl, { ...msg, username: msg.from_username })
    scrollBottom(msgsEl)
  })
}

async function sendMessage(container) {
  const inp = container.querySelector('#chat-input')
  const content = inp.value.trim()
  if (!content) return
  inp.value = ''
  inp.style.height = ''

  if (currentRoom) {
    chatWs.send({ type: 'chat:message', room: currentRoom, content })
  } else if (currentDm) {
    chatWs.send({ type: 'chat:dm', to: currentDm, content })
    const msgsEl = container.querySelector('#chat-messages')
    appendMessage(msgsEl, {
      username: state.user.username,
      avatar_url: state.user.avatar_url,
      content,
      created_at: new Date().toISOString(),
      user_id: state.user.id,
    })
    scrollBottom(msgsEl)
  }
}

function renderMessages(el, messages) {
  if (!messages.length) {
    el.innerHTML = '<div class="state-container"><i class="bi bi-chat-square state-icon"></i><p class="state-desc">No messages yet. Say hi!</p></div>'
    return
  }
  el.innerHTML = ''
  messages.forEach(m => appendMessage(el, m))
}

function appendMessage(el, m) {
  const mine = m.user_id === state.user?.id || m.username === state.user?.username
  const div  = document.createElement('div')
  div.className = 'chat-msg'
  div.innerHTML = `
    ${avatar(m.avatar_url, m.username, 'avatar-sm')}
    <div class="chat-msg-body">
      <div class="chat-msg-top">
        <span class="chat-msg-user" style="${mine ? 'color:var(--accent-3)' : ''}">${m.username}</span>
        <span class="chat-msg-time">${timeAgo(m.created_at)}</span>
      </div>
      <div class="chat-msg-text">${escHtml(m.content)}</div>
    </div>
  `
  el.appendChild(div)
}

async function loadDmList(container) {
  try {
    const { friends } = await api.get('/friends')
    const accepted = friends.filter(f => f.status === 'accepted')
    const dmList = container.querySelector('#dm-list')
    if (!accepted.length) {
      dmList.innerHTML = '<div style="padding:4px 12px;font-size:12px;color:var(--text-3)">Add friends to DM</div>'
      return
    }
    dmList.innerHTML = accepted.map(f => `
      <div class="chat-room-item" data-dm="${f.id}">
        ${avatar(f.avatar_url, f.username, 'avatar-sm')}
        <span style="font-size:13px">${f.username}</span>
      </div>
    `).join('')
    dmList.querySelectorAll('[data-dm]').forEach(el => {
      const f = accepted.find(fr => fr.id == el.dataset.dm)
      if (f) el.addEventListener('click', () => openDm(f.id, f.username, f.avatar_url, container))
    })
  } catch {}
}

function showNewDmModal(container) {
  const id = 'dm-search-modal'
  document.getElementById('modal-overlay').classList.remove('hidden')
  document.getElementById('modal-box').innerHTML = `
    <div class="modal-title"><i class="bi bi-chat-dots-fill"></i> New Direct Message</div>
    <div class="form-field">
      <input class="input" id="dm-user-search" placeholder="Search username…">
    </div>
    <div id="dm-search-results" style="min-height:60px"></div>
    <div style="margin-top:12px;text-align:right">
      <button class="btn btn-ghost" id="dm-close">Cancel</button>
    </div>
  `
  document.getElementById('dm-close').addEventListener('click', () =>
    document.getElementById('modal-overlay').classList.add('hidden')
  )

  let searchTimer
  document.getElementById('dm-user-search').addEventListener('input', e => {
    clearTimeout(searchTimer)
    const q = e.target.value.trim()
    if (!q) return
    searchTimer = setTimeout(async () => {
      try {
        const { users } = await api.get(`/users/search?q=${encodeURIComponent(q)}`)
        const res = document.getElementById('dm-search-results')
        res.innerHTML = users.filter(u => u.id !== state.user.id).map(u => `
          <div class="friend-card" style="cursor:pointer;margin-bottom:6px" data-uid="${u.id}" data-uname="${u.username}" data-uavatar="${u.avatar_url||''}">
            ${avatar(u.avatar_url, u.username, 'avatar-sm')}
            <div class="friend-info"><div class="friend-name">${u.username}</div></div>
          </div>
        `).join('') || '<p class="text-dim center" style="padding:12px">No users found</p>'

        res.querySelectorAll('[data-uid]').forEach(el => {
          el.addEventListener('click', () => {
            document.getElementById('modal-overlay').classList.add('hidden')
            openDm(parseInt(el.dataset.uid), el.dataset.uname, el.dataset.uavatar, container)
          })
        })
      } catch {}
    }, 400)
  })
}

function scrollBottom(el) { el.scrollTop = el.scrollHeight }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
