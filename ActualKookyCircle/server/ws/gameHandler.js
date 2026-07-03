const waitingPlayers = new Map()
const activeGames = new Map()

// ── Tic-Tac-Toe helpers ──────────────────────────────────────────────────────

function makeTTTBoard() { return Array(9).fill(null) }

function checkTTTWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a]
  }
  return board.every(Boolean) ? 'draw' : null
}

// ── Connect 4 helpers ────────────────────────────────────────────────────────

const C4_ROWS = 6, C4_COLS = 7

function makeC4Board() {
  return Array(C4_ROWS).fill(null).map(() => Array(C4_COLS).fill(null))
}

function checkC4Winner(board, row, col, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  for (const [dr, dc] of dirs) {
    let count = 1
    for (let i=1; i<4; i++) {
      const r=row+dr*i, c=col+dc*i
      if (r<0||r>=C4_ROWS||c<0||c>=C4_COLS||board[r][c]!==player) break
      count++
    }
    for (let i=1; i<4; i++) {
      const r=row-dr*i, c=col-dc*i
      if (r<0||r>=C4_ROWS||c<0||c>=C4_COLS||board[r][c]!==player) break
      count++
    }
    if (count >= 4) return true
  }
  return false
}

// ── RPS helpers ──────────────────────────────────────────────────────────────

function rpsResult(a, b) {
  if (a === b) return 'draw'
  if ((a===0&&b===2)||(a===1&&b===0)||(a===2&&b===1)) return 'win'
  return 'loss'
}

// ── Main handler ─────────────────────────────────────────────────────────────

export function handleGameConnection(ws, userId, username) {
  ws.userId = userId
  ws.username = username
  ws.gameId = null

  ws.on('message', async (raw) => {
    let data
    try { data = JSON.parse(raw) } catch { return }

    // ─ Tic-Tac-Toe ──────────────────────────────────────────────────────────

    if (data.type === 'ttt_find_game') {
      const gameCode = data.gameCode
      if (waitingPlayers.has(gameCode)) {
        const player1 = waitingPlayers.get(gameCode)
        waitingPlayers.delete(gameCode)
        const gameId = `ttt_${gameCode}_${Date.now()}`
        const game = {
          id: gameId, type: 'ttt',
          board: makeTTTBoard(),
          players: [
            { ws: player1, userId: player1.userId, username: player1.username, symbol: 'X' },
            { ws, userId, username, symbol: 'O' }
          ],
          currentTurn: 0, status: 'active'
        }
        activeGames.set(gameId, game)
        ws.gameId = gameId; player1.gameId = gameId
        const startMsg = (sym) => JSON.stringify({ type:'ttt_start', gameId, symbol:sym, board:game.board, currentTurn:'X', opponent:sym==='X'?username:player1.username })
        player1.send(startMsg('X')); ws.send(startMsg('O'))
      } else {
        waitingPlayers.set(gameCode, ws)
        ws.send(JSON.stringify({ type: 'ttt_waiting', gameCode }))
      }
    }

    if (data.type === 'ttt_move') {
      const game = activeGames.get(ws.gameId)
      if (!game || game.type !== 'ttt' || game.status !== 'active') return
      const pi = game.players.findIndex(p => p.userId === userId)
      if (pi !== game.currentTurn) return
      const { cell } = data
      if (game.board[cell] !== null) return
      game.board[cell] = game.players[pi].symbol
      const winner = checkTTTWinner(game.board)
      if (winner) {
        game.status = 'done'
        game.players.forEach((p,i) => {
          const myResult = winner==='draw' ? 'draw' : (i===pi ? 'win' : 'loss')
          p.ws.send(JSON.stringify({ type:'ttt_end', board:game.board, winner, result:myResult }))
        })
        activeGames.delete(ws.gameId)
      } else {
        game.currentTurn = 1 - game.currentTurn
        const msg = JSON.stringify({ type:'ttt_move', board:game.board, cell, symbol:game.players[pi].symbol, currentTurn:game.players[game.currentTurn].symbol })
        game.players.forEach(p => p.ws.readyState===1 && p.ws.send(msg))
      }
    }

    // ─ Connect 4 ────────────────────────────────────────────────────────────

    if (data.type === 'c4_find_game') {
      const gameCode = `c4_${data.gameCode}`
      if (waitingPlayers.has(gameCode)) {
        const player1 = waitingPlayers.get(gameCode)
        waitingPlayers.delete(gameCode)
        const gameId = `c4_${data.gameCode}_${Date.now()}`
        const game = {
          id: gameId, type: 'c4',
          board: makeC4Board(),
          players: [
            { ws: player1, userId: player1.userId, username: player1.username, num: 1 },
            { ws, userId, username, num: 2 }
          ],
          currentTurn: 0, status: 'active'
        }
        activeGames.set(gameId, game)
        ws.gameId = gameId; player1.gameId = gameId
        const startMsg = (num) => JSON.stringify({ type:'c4_start', gameId, playerNum:num, board:game.board, currentTurn:1, opponent:num===1?username:player1.username })
        player1.send(startMsg(1)); ws.send(startMsg(2))
      } else {
        waitingPlayers.set(gameCode, ws)
        ws.send(JSON.stringify({ type: 'c4_waiting', gameCode: data.gameCode }))
      }
    }

    if (data.type === 'c4_move') {
      const game = activeGames.get(ws.gameId)
      if (!game || game.type !== 'c4' || game.status !== 'active') return
      const pi = game.players.findIndex(p => p.userId === userId)
      if (pi !== game.currentTurn) return
      const { col } = data
      if (col < 0 || col >= C4_COLS || game.board[0][col]) return
      let row = -1
      for (let r = C4_ROWS-1; r >= 0; r--) {
        if (!game.board[r][col]) { game.board[r][col] = game.players[pi].num; row = r; break }
      }
      const won = checkC4Winner(game.board, row, col, game.players[pi].num)
      const draw = !won && game.board[0].every(Boolean)
      if (won || draw) {
        game.status = 'done'
        game.players.forEach((p,i) => {
          const res = draw ? 'draw' : (i===pi ? 'win' : 'loss')
          p.ws.send(JSON.stringify({ type:'c4_end', board:game.board, winner:won?game.players[pi].num:null, result:res }))
        })
        activeGames.delete(ws.gameId)
      } else {
        game.currentTurn = 1 - game.currentTurn
        const msg = JSON.stringify({ type:'c4_move', board:game.board, col, playerNum:game.players[pi].num, currentTurn:game.players[game.currentTurn].num })
        game.players.forEach(p => p.ws.readyState===1 && p.ws.send(msg))
      }
    }

    // ─ RPS ──────────────────────────────────────────────────────────────────

    if (data.type === 'rps_find_game') {
      const gameCode = `rps_${data.gameCode}`
      if (waitingPlayers.has(gameCode)) {
        const player1 = waitingPlayers.get(gameCode)
        waitingPlayers.delete(gameCode)
        const gameId = `rps_${data.gameCode}_${Date.now()}`
        const game = {
          id: gameId, type: 'rps',
          players: [
            { ws: player1, userId: player1.userId, username: player1.username, choice: null },
            { ws, userId, username, choice: null }
          ],
          status: 'active'
        }
        activeGames.set(gameId, game)
        ws.gameId = gameId; player1.gameId = gameId
        player1.send(JSON.stringify({ type:'rps_start', gameId, opponent:username }))
        ws.send(JSON.stringify({ type:'rps_start', gameId, opponent:player1.username }))
      } else {
        waitingPlayers.set(gameCode, ws)
        ws.send(JSON.stringify({ type: 'rps_waiting', gameCode: data.gameCode }))
      }
    }

    if (data.type === 'rps_choice') {
      const game = activeGames.get(ws.gameId)
      if (!game || game.type !== 'rps' || game.status !== 'active') return
      const pi = game.players.findIndex(p => p.userId === userId)
      if (pi === -1 || game.players[pi].choice !== null) return
      game.players[pi].choice = data.choice
      ws.send(JSON.stringify({ type: 'rps_waiting_opponent' }))
      if (game.players.every(p => p.choice !== null)) {
        const [p0, p1] = game.players
        const r0 = rpsResult(p0.choice, p1.choice)
        const r1 = rpsResult(p1.choice, p0.choice)
        p0.ws.send(JSON.stringify({ type:'rps_result', yourChoice:p0.choice, opponentChoice:p1.choice, result:r0 }))
        p1.ws.send(JSON.stringify({ type:'rps_result', yourChoice:p1.choice, opponentChoice:p0.choice, result:r1 }))
        // Reset for next round
        game.players[0].choice = null
        game.players[1].choice = null
      }
    }
  })

  ws.on('close', () => {
    if (ws.gameId) {
      const game = activeGames.get(ws.gameId)
      if (game && game.status === 'active') {
        game.status = 'abandoned'
        game.players.forEach(p => {
          if (p.userId !== userId && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ type: `${game.type}_opponent_left` }))
          }
        })
        activeGames.delete(ws.gameId)
      }
    }
    for (const [code, player] of waitingPlayers.entries()) {
      if (player.userId === userId) waitingPlayers.delete(code)
    }
  })
}
