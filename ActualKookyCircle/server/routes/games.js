import express from 'express'
import pool from '../db/index.js'
import { checkAndAwardAchievements } from './achievements.js'

const router = express.Router()

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' })
  next()
}

router.post('/results', requireAuth, async (req, res) => {
  const { game_name, result, score, metadata } = req.body
  if (!game_name || !result) return res.status(400).json({ error: 'game_name and result required' })
  try {
    const r = await pool.query(
      'INSERT INTO game_results (user_id, game_name, result, score, metadata) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.session.userId, game_name, result, score || 0, metadata || {}]
    )
    checkAndAwardAchievements(req.session.userId).catch(() => {})
    res.json({ result: r.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/stats/me', requireAuth, async (req, res) => {
  const uid = req.session.userId
  try {
    const summary = await pool.query(
      `SELECT game_name,
        COUNT(*) AS total,
        SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN result='draw' THEN 1 ELSE 0 END) AS draws,
        MAX(score) AS best_score
       FROM game_results WHERE user_id=$1 GROUP BY game_name`,
      [uid]
    )
    const activity = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS games_played
       FROM game_results WHERE user_id=$1
       AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day ASC`,
      [uid]
    )
    const recent = await pool.query(
      `SELECT gr.*, u.username FROM game_results gr JOIN users u ON u.id=gr.user_id
       WHERE gr.user_id=$1 ORDER BY gr.created_at DESC LIMIT 10`,
      [uid]
    )
    res.json({ summary: summary.rows, activity: activity.rows, recent: recent.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/trivia/questions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM trivia_questions ORDER BY RANDOM() LIMIT 10'
    )
    res.json({ questions: result.rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
