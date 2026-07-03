import express from 'express'
import jwt from 'jsonwebtoken'
import speakeasy from 'speakeasy'
import rateLimit from 'express-rate-limit'
import pool from '../db/index.js'

const router = express.Router()

// ── Rate limiter — 5 attempts per 15 min per IP ──────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many login attempts, try again later' })
})

// ── Admin JWT middleware ──────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET)
    if (payload.role !== 'admin') throw new Error()
    next()
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

// ── Action logger ─────────────────────────────────────────────────────────────

async function adminLog(action, targetType, targetId, notes = '') {
  try {
    await pool.query(
      'INSERT INTO admin_logs (admin_action, target_type, target_id, notes) VALUES ($1,$2,$3,$4)',
      [action, targetType || null, targetId || null, notes]
    )
  } catch (err) {
    console.error('Admin log error:', err.message)
  }
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const { password, totpCode } = req.body

  if (!password || !totpCode) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Layer 1 — password check (constant-time compare would be ideal but env var is fine here)
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Layer 2 — TOTP
  const verified = speakeasy.totp.verify({
    secret: process.env.ADMIN_TOTP_SECRET,
    encoding: 'base32',
    token: String(totpCode),
    window: 1 // ±30s grace
  })

  if (!verified) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = jwt.sign(
    { role: 'admin' },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: '2h' }
  )

  await adminLog('admin_login', null, null, 'Successful admin login')
  res.json({ token, expiresIn: 7200 })
})

// ── GET /api/admin/stats ──────────────────────────────────────────────────────

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [users, posts, games, activeToday, clans, reports] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM posts'),
      pool.query('SELECT COUNT(*) FROM game_results'),
      pool.query(`SELECT COUNT(DISTINCT user_id) FROM game_results WHERE created_at > NOW() - INTERVAL '1 day'`),
      pool.query('SELECT COUNT(*) FROM clans'),
      pool.query(`SELECT COUNT(*) FROM reports WHERE status='pending'`)
    ])

    res.json({
      totalUsers: Number(users.rows[0].count),
      totalPosts: Number(posts.rows[0].count),
      totalGamesPlayed: Number(games.rows[0].count),
      activeUsersToday: Number(activeToday.rows[0].count),
      totalClans: Number(clans.rows[0].count),
      pendingReports: Number(reports.rows[0].count)
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── GET /api/admin/users ──────────────────────────────────────────────────────

router.get('/users', requireAdmin, async (req, res) => {
  const { search, banned, page = 1 } = req.query
  const limit = 25
  const offset = (Number(page) - 1) * limit

  try {
    const conditions = []
    const values = []

    if (search) {
      values.push(`%${search}%`)
      conditions.push(`(username ILIKE $${values.length} OR email ILIKE $${values.length})`)
    }
    if (banned === 'true') {
      conditions.push('is_banned = TRUE')
    } else if (banned === 'false') {
      conditions.push('is_banned = FALSE')
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await pool.query(`SELECT COUNT(*) FROM users ${where}`, values)
    const total = Number(countRes.rows[0].count)

    values.push(limit, offset)
    const result = await pool.query(`
      SELECT id, username, email, avatar_url, platform, is_banned, ban_reason, created_at
      FROM users ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values)

    res.json({
      users: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit)
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────

router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, username, email, avatar_url, bio, platform, is_banned, ban_reason, created_at FROM users WHERE id=$1',
      [req.params.id]
    )
    if (!user.rows[0]) return res.status(404).json({ error: 'User not found' })

    const [postCount, gameStats, clan] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM posts WHERE user_id=$1', [req.params.id]),
      pool.query(`
        SELECT game_name,
          COUNT(*) AS played,
          COUNT(*) FILTER (WHERE result='win') AS wins,
          MAX(score) AS best_score
        FROM game_results WHERE user_id=$1
        GROUP BY game_name ORDER BY played DESC
      `, [req.params.id]),
      pool.query(`
        SELECT c.id, c.name, c.tag, cm.role
        FROM clan_members cm JOIN clans c ON c.id=cm.clan_id
        WHERE cm.user_id=$1 LIMIT 1
      `, [req.params.id])
    ])

    res.json({
      user: user.rows[0],
      postCount: Number(postCount.rows[0].count),
      gameStats: gameStats.rows,
      clan: clan.rows[0] || null
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── POST /api/admin/users/:id/ban ────────────────────────────────────────────

router.post('/users/:id/ban', requireAdmin, async (req, res) => {
  const { reason } = req.body
  if (!reason?.trim()) return res.status(400).json({ error: 'Ban reason required' })

  try {
    const result = await pool.query(
      'UPDATE users SET is_banned=TRUE, ban_reason=$1 WHERE id=$2 RETURNING username',
      [reason.trim(), req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' })

    await adminLog(`ban_user`, 'user', Number(req.params.id), reason.trim())
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── POST /api/admin/users/:id/unban ──────────────────────────────────────────

router.post('/users/:id/unban', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE users SET is_banned=FALSE, ban_reason=NULL WHERE id=$1 RETURNING username',
      [req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' })

    await adminLog('unban_user', 'user', Number(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await pool.query('SELECT username FROM users WHERE id=$1', [req.params.id])
    if (!user.rows[0]) return res.status(404).json({ error: 'User not found' })

    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id])
    await adminLog('delete_user', 'user', Number(req.params.id), `Deleted user: ${user.rows[0].username}`)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── GET /api/admin/reports ────────────────────────────────────────────────────

router.get('/reports', requireAdmin, async (req, res) => {
  const { status, page = 1 } = req.query
  const limit = 25
  const offset = (Number(page) - 1) * limit

  try {
    const values = []
    let where = ''
    if (status && ['pending','reviewed','dismissed'].includes(status)) {
      values.push(status)
      where = `WHERE r.status=$1`
    }

    const countRes = await pool.query(`SELECT COUNT(*) FROM reports r ${where}`, values)
    const total = Number(countRes.rows[0].count)

    values.push(limit, offset)
    const result = await pool.query(`
      SELECT r.*,
        u.username AS reporter_username,
        u.avatar_url AS reporter_avatar
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values)

    res.json({
      reports: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit)
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── GET /api/admin/reports/:id ────────────────────────────────────────────────

router.get('/reports/:id', requireAdmin, async (req, res) => {
  try {
    const report = await pool.query(`
      SELECT r.*,
        u.username AS reporter_username,
        u.email AS reporter_email,
        u.avatar_url AS reporter_avatar
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      WHERE r.id=$1
    `, [req.params.id])

    if (!report.rows[0]) return res.status(404).json({ error: 'Report not found' })

    const r = report.rows[0]
    let targetContent = null

    // Fetch the reported content for context
    if (r.target_type === 'post') {
      const p = await pool.query(
        'SELECT p.*, u.username FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=$1',
        [r.target_id]
      )
      targetContent = p.rows[0] || null
    } else if (r.target_type === 'user') {
      const u = await pool.query(
        'SELECT id, username, email, avatar_url, is_banned FROM users WHERE id=$1',
        [r.target_id]
      )
      targetContent = u.rows[0] || null
    }

    res.json({ report: r, targetContent })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── PATCH /api/admin/reports/:id ─────────────────────────────────────────────

router.patch('/reports/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body
  if (!status || !['pending','reviewed','dismissed'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, reviewed, or dismissed' })
  }

  try {
    const result = await pool.query(
      'UPDATE reports SET status=$1, notes=$2, resolved=(status != \'pending\') WHERE id=$3 RETURNING *',
      [status, notes || '', req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Report not found' })

    await adminLog('update_report', 'report', Number(req.params.id), `Status → ${status}`)
    res.json({ report: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── DELETE /api/admin/posts/:id ───────────────────────────────────────────────

router.delete('/posts/:id', requireAdmin, async (req, res) => {
  try {
    const post = await pool.query('SELECT id, user_id, content FROM posts WHERE id=$1', [req.params.id])
    if (!post.rows[0]) return res.status(404).json({ error: 'Post not found' })

    await pool.query('DELETE FROM posts WHERE id=$1', [req.params.id])
    await adminLog('delete_post', 'post', Number(req.params.id), `Deleted post by user ${post.rows[0].user_id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── DELETE /api/admin/clans/:id ───────────────────────────────────────────────

router.delete('/clans/:id', requireAdmin, async (req, res) => {
  try {
    const clan = await pool.query('SELECT id, name FROM clans WHERE id=$1', [req.params.id])
    if (!clan.rows[0]) return res.status(404).json({ error: 'Clan not found' })

    await pool.query('DELETE FROM clans WHERE id=$1', [req.params.id])
    await adminLog('delete_clan', 'clan', Number(req.params.id), `Deleted clan: ${clan.rows[0].name}`)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── GET /api/admin/logs ───────────────────────────────────────────────────────

router.get('/logs', requireAdmin, async (req, res) => {
  const { action, targetType, page = 1 } = req.query
  const limit = 50
  const offset = (Number(page) - 1) * limit

  try {
    const conditions = []
    const values = []

    if (action) {
      values.push(`%${action}%`)
      conditions.push(`admin_action ILIKE $${values.length}`)
    }
    if (targetType) {
      values.push(targetType)
      conditions.push(`target_type = $${values.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await pool.query(`SELECT COUNT(*) FROM admin_logs ${where}`, values)
    const total = Number(countRes.rows[0].count)

    values.push(limit, offset)
    const result = await pool.query(`
      SELECT * FROM admin_logs ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values)

    res.json({
      logs: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit)
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
