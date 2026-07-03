import { api } from '../api.js'
import { state, toast, timeAgo, avatar, showModal, closeModal } from '../app.js'

const TAGS = ['#tips-and-ideas','#FPS','#RPG','#strategy','#casual','#retro','#mobile','#esports','#highlights']

export async function renderFeed(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title"><i class="bi bi-house-door-fill"></i> Community Feed</h1>
      <button class="btn btn-primary btn-sm" id="new-post-btn"><i class="bi bi-plus-lg"></i> Post</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 260px;gap:20px;align-items:start">
      <div>
        <!-- Compose area -->
        <div class="card" id="compose-area" style="margin-bottom:14px">
          <div style="display:flex;gap:10px;align-items:flex-start">
            ${avatar(state.user.avatar_url, state.user.username, 'avatar-md')}
            <div style="flex:1">
              <textarea class="input" id="post-input" placeholder="What's happening in your game world?" rows="2" style="resize:none"></textarea>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;flex-wrap:wrap;gap:6px">
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${TAGS.slice(0,5).map(t=>`<span class="tag" style="cursor:pointer" data-tag="${t}">${t}</span>`).join('')}
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <input class="input" id="img-url-input" placeholder="Image URL (optional)" style="width:200px;font-size:12px;padding:5px 8px">
                  <button class="btn btn-primary btn-sm" id="submit-post"><i class="bi bi-send"></i> Post</button>
                </div>
              </div>
              <div id="selected-tags" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px"></div>
            </div>
          </div>
        </div>

        <!-- Filter tabs -->
        <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm active-filter" data-filter="">All Posts</button>
          ${TAGS.map(t=>`<button class="btn btn-ghost btn-sm" data-filter="${t}">${t}</button>`).join('')}
        </div>

        <!-- Posts -->
        <div id="posts-list"></div>
        <div id="posts-loading" class="state-container"><div class="spinner"></div></div>
      </div>

      <!-- Sidebar widget -->
      <div class="hidden" id="feed-aside" style="display:flex;flex-direction:column;gap:14px">
        <div class="card card-sm">
          <div class="section-title"><i class="bi bi-fire"></i> Trending Tags</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${TAGS.map(t=>`<span class="tag" style="cursor:pointer" data-filter-tag="${t}">${t}</span>`).join('')}
          </div>
        </div>
        <div class="card card-sm">
          <div class="section-title"><i class="bi bi-trophy"></i> Your Stats</div>
          <div id="mini-stats" class="text-dim" style="font-size:13px">Loading...</div>
        </div>
      </div>
    </div>
  `

  // Show aside on wider screens
  if (window.innerWidth >= 900) {
    document.getElementById('feed-aside').classList.remove('hidden')
    document.getElementById('feed-aside').style.display = 'flex'
    loadMiniStats()
  }

  let activeFilter = ''
  let selectedTags = []

  const postsEl  = container.querySelector('#posts-list')
  const loadingEl = container.querySelector('#posts-loading')

  // Tag picker in compose
  container.querySelectorAll('[data-tag]').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag
      if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter(t => t !== tag)
        el.style.opacity = '1'
      } else {
        selectedTags.push(tag)
        el.style.opacity = '.5'
      }
      updateSelectedTags()
    })
  })

  function updateSelectedTags() {
    const el = container.querySelector('#selected-tags')
    el.innerHTML = selectedTags.map(t => `<span class="tag">${t} <span style="cursor:pointer" data-remove="${t}">×</span></span>`).join('')
    el.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedTags = selectedTags.filter(t => t !== btn.dataset.remove)
        container.querySelector(`[data-tag="${btn.dataset.remove}"]`).style.opacity = '1'
        updateSelectedTags()
      })
    })
  }

  // Submit post
  container.querySelector('#submit-post').addEventListener('click', async () => {
    const content = container.querySelector('#post-input').value.trim()
    const image_url = container.querySelector('#img-url-input').value.trim()
    if (!content) { toast('Write something first', 'error'); return }
    const btn = container.querySelector('#submit-post')
    btn.disabled = true
    try {
      const { post } = await api.post('/posts', { content, image_url: image_url || null, tags: selectedTags })
      container.querySelector('#post-input').value = ''
      container.querySelector('#img-url-input').value = ''
      selectedTags = []
      container.querySelector('#selected-tags').innerHTML = ''
      container.querySelectorAll('[data-tag]').forEach(el => el.style.opacity = '1')
      postsEl.insertAdjacentHTML('afterbegin', postCard(post))
      bindPostEvents(postsEl.firstElementChild)
      toast('Posted!', 'success')
    } catch (e) { toast(e.message, 'error') }
    finally { btn.disabled = false }
  })

  // Filter buttons
  container.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter
      container.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active-filter', 'btn-primary'))
      btn.classList.add('active-filter')
      loadPosts(activeFilter)
    })
  })

  // Trending tag click
  container.querySelectorAll('[data-filter-tag]').forEach(el => {
    el.addEventListener('click', () => {
      activeFilter = el.dataset.filterTag
      loadPosts(activeFilter)
    })
  })

  // New post button (mobile)
  container.querySelector('#new-post-btn').addEventListener('click', () => {
    container.querySelector('#compose-area').scrollIntoView({ behavior:'smooth' })
    container.querySelector('#post-input').focus()
  })

  await loadPosts('')

  async function loadPosts(tag) {
    loadingEl.innerHTML = '<div class="spinner"></div>'
    loadingEl.style.display = 'flex'
    postsEl.innerHTML = ''
    try {
      const params = tag ? `?tag=${encodeURIComponent(tag)}&limit=30` : '?limit=30'
      const { posts } = await api.get(`/posts${params}`)
      loadingEl.style.display = 'none'
      if (!posts.length) {
        postsEl.innerHTML = `<div class="state-container">
          <i class="bi bi-chat-square-text state-icon"></i>
          <div class="state-title">No posts yet</div>
          <p class="state-desc">Be the first to post something!</p>
        </div>`
        return
      }
      posts.forEach(p => {
        const el = document.createElement('div')
        el.innerHTML = postCard(p)
        const card = el.firstElementChild
        postsEl.appendChild(card)
        bindPostEvents(card)
      })
    } catch { loadingEl.innerHTML = '<p class="text-dim">Failed to load posts</p>' }
  }
}

function postCard(p) {
  const tagsHtml = p.tags?.length ? `<div class="post-tags">${p.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div>` : ''
  const imgHtml  = p.image_url ? `<img class="post-image" src="${p.image_url}" alt="" loading="lazy">` : ''
  const mine     = p.user_id === state.user?.id

  return `
    <div class="post-card" style="margin-bottom:12px" data-id="${p.id}">
      <div class="post-header">
        ${avatar(p.avatar_url, p.username, 'avatar-md')}
        <div class="post-meta">
          <div class="post-username" data-uid="${p.user_id}">${p.username}</div>
          <div class="post-time">${timeAgo(p.created_at)}</div>
        </div>
        ${mine ? `<button class="btn btn-ghost btn-icon btn-sm delete-post" title="Delete post"><i class="bi bi-trash3"></i></button>` : ''}
      </div>
      <div class="post-content">${escHtml(p.content)}</div>
      ${imgHtml}
      ${tagsHtml}
      <div class="post-actions">
        <button class="post-action-btn like-btn ${p.user_liked ? 'liked' : ''}" data-liked="${p.user_liked}">
          <i class="bi bi-heart${p.user_liked ? '-fill' : ''}"></i>
          <span class="like-count">${p.like_count || 0}</span>
        </button>
        <button class="post-action-btn comment-toggle-btn">
          <i class="bi bi-chat"></i>
          <span>${p.comment_count || 0}</span>
        </button>
        <button class="post-action-btn report-btn" style="margin-left:auto">
          <i class="bi bi-flag"></i>
        </button>
      </div>
      <div class="comments-section hidden" style="margin-top:10px;border-top:1px solid var(--border-2);padding-top:10px"></div>
    </div>
  `
}

function bindPostEvents(card) {
  const postId = card.dataset.id

  // Like
  card.querySelector('.like-btn').addEventListener('click', async function() {
    try {
      const { liked } = await api.post(`/posts/${postId}/like`)
      const countEl = this.querySelector('.like-count')
      const icon    = this.querySelector('i')
      const count   = parseInt(countEl.textContent)
      if (liked) {
        countEl.textContent = count + 1
        icon.className = 'bi bi-heart-fill'
        this.classList.add('liked')
        this.dataset.liked = '1'
      } else {
        countEl.textContent = Math.max(0, count - 1)
        icon.className = 'bi bi-heart'
        this.classList.remove('liked')
        this.dataset.liked = '0'
      }
    } catch (e) { toast(e.message, 'error') }
  })

  // Comments toggle
  card.querySelector('.comment-toggle-btn').addEventListener('click', async function() {
    const sec = card.querySelector('.comments-section')
    if (!sec.classList.contains('hidden')) { sec.classList.add('hidden'); return }
    sec.classList.remove('hidden')
    sec.innerHTML = '<div class="spinner" style="margin:8px auto"></div>'
    try {
      const { comments } = await api.get(`/posts/${postId}/comments`)
      renderComments(sec, postId, comments)
    } catch { sec.innerHTML = '<p class="text-dim">Failed to load</p>' }
  })

  // Delete
  card.querySelector('.delete-post')?.addEventListener('click', async function() {
    if (!confirm('Delete this post?')) return
    try { await api.delete(`/posts/${postId}`); card.remove(); toast('Post deleted') } catch (e) { toast(e.message,'error') }
  })

  // Report
  card.querySelector('.report-btn').addEventListener('click', () => {
    showModal(`
      <div class="modal-title"><i class="bi bi-flag-fill text-red"></i> Report Post</div>
      <div class="form-field">
        <label class="form-label">Reason</label>
        <select class="input" id="report-reason">
          <option>Spam</option><option>Harassment</option><option>Inappropriate content</option><option>Misinformation</option><option>Other</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Cancel</button>
        <button class="btn btn-danger" id="submit-report"><i class="bi bi-flag"></i> Report</button>
      </div>
    `)
    document.getElementById('submit-report').addEventListener('click', async () => {
      const reason = document.getElementById('report-reason').value
      try {
        await api.post('/moderation/report', { target_type: 'post', target_id: parseInt(postId), reason })
        closeModal()
        toast('Reported — thanks for keeping the community safe', 'info')
      } catch (e) { toast(e.message,'error') }
    })
  })
}

function renderComments(sec, postId, comments) {
  sec.innerHTML = `
    ${comments.map(c => `
      <div style="display:flex;gap:8px;margin-bottom:10px">
        ${avatar(c.avatar_url, c.username, 'avatar-sm')}
        <div style="flex:1">
          <span style="font-weight:600;font-size:12.5px">${c.username}</span>
          <span style="font-size:11px;color:var(--text-3);margin-left:5px">${timeAgo(c.created_at)}</span>
          <p style="font-size:13px;margin-top:2px;color:var(--text)">${escHtml(c.content)}</p>
        </div>
      </div>
    `).join('')}
    <div style="display:flex;gap:8px;margin-top:6px">
      ${avatar(state.user?.avatar_url, state.user?.username, 'avatar-sm')}
      <div style="flex:1;display:flex;gap:6px">
        <input class="input" id="comment-input-${postId}" placeholder="Write a comment…" style="padding:5px 10px;font-size:13px">
        <button class="btn btn-primary btn-sm" id="send-comment-${postId}"><i class="bi bi-send"></i></button>
      </div>
    </div>
  `

  document.getElementById(`send-comment-${postId}`).addEventListener('click', async () => {
    const inp = document.getElementById(`comment-input-${postId}`)
    const content = inp.value.trim()
    if (!content) return
    try {
      const { comment } = await api.post(`/posts/${postId}/comments`, { content })
      inp.value = ''
      const newHtml = `
        <div style="display:flex;gap:8px;margin-bottom:10px">
          ${avatar(comment.avatar_url, comment.username, 'avatar-sm')}
          <div style="flex:1">
            <span style="font-weight:600;font-size:12.5px">${comment.username}</span>
            <p style="font-size:13px;margin-top:2px">${escHtml(comment.content)}</p>
          </div>
        </div>
      `
      sec.insertAdjacentHTML('afterbegin', newHtml)
    } catch (e) { toast(e.message,'error') }
  })
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function loadMiniStats() {
  try {
    const { stats } = await api.get('/games/stats').catch(() => ({ stats: [] }))
    const total = stats.reduce((a,s) => a + (parseInt(s.played)||0), 0)
    const wins  = stats.reduce((a,s) => a + (parseInt(s.wins)||0), 0)
    document.getElementById('mini-stats').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px">
        <div class="flex-between"><span>Games Played</span><span class="mono text-accent">${total}</span></div>
        <div class="flex-between"><span>Total Wins</span><span class="mono text-green">${wins}</span></div>
      </div>
    `
  } catch {}
}
