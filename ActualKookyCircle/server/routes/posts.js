import express from 'express'
import pool from '../db/index.js'
import { filterContent } from '../lib/filter.js'
import { checkAndAwardAchievements } from './achievements.js'

const router = express.Router()

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' })
  next()
}

router.get('/', async (req, res) => {
  const { tag, limit = 20, offset = 0 } = req.query
  try {
    let query = `
      SELECT p.*, u.username, u.avatar_url,
        COUNT(DISTINCT l.id) AS like_count,
        COUNT(DISTINCT c.id) AS comment_count,
        MAX(CASE WHEN l.user_id=$1 THEN 1 ELSE 0 END) AS user_liked
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN likes l ON l.post_id = p.id
      LEFT JOIN comments c ON c.post_id = p.id
    `
    const values = [req.session.userId || 0]
    if (tag) {
      query += ` WHERE $2=ANY(p.tags)`
      values.push(tag)
    }
    query += ` GROUP BY p.id, u.username, u.avatar_url ORDER BY p.created_at DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`
    values.push(Number(limit), Number(offset))
    const result = await pool.query(query, values)
    res.json({ posts: result.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  let { content, image_url, tags } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' })
  content = filterContent(content)
  try {
    const result = await pool.query(
      `INSERT INTO posts (user_id, content, image_url, tags) VALUES ($1,$2,$3,$4)
       RETURNING *, (SELECT username FROM users WHERE id=$1) as username, (SELECT avatar_url FROM users WHERE id=$1) as avatar_url`,
      [req.session.userId, content, image_url || null, tags || []]
    )
    checkAndAwardAchievements(req.session.userId).catch(() => {})
    res.json({ post: { ...result.rows[0], like_count: 0, comment_count: 0, user_liked: 0 } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM posts WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT id FROM likes WHERE post_id=$1 AND user_id=$2', [req.params.id, req.session.userId])
    if (existing.rows[0]) {
      await pool.query('DELETE FROM likes WHERE post_id=$1 AND user_id=$2', [req.params.id, req.session.userId])
      res.json({ liked: false })
    } else {
      await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1,$2)', [req.params.id, req.session.userId])
      res.json({ liked: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/:id/comments', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.username, u.avatar_url FROM comments c
       JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`,
      [req.params.id]
    )
    res.json({ comments: result.rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/:id/comments', requireAuth, async (req, res) => {
  let { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' })
  content = filterContent(content)
  try {
    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, content) VALUES ($1,$2,$3)
       RETURNING *, (SELECT username FROM users WHERE id=$2) as username, (SELECT avatar_url FROM users WHERE id=$2) as avatar_url`,
      [req.params.id, req.session.userId, content]
    )
    res.json({ comment: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
