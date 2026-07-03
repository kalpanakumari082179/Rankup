import { api } from '../api.js'
import { state, toast, navigate } from '../app.js'
import { gameWs } from '../ws.js'

const GAME_LIST = [
  { id:'tictactoe', name:'Tic-Tac-Toe',   icon:'bi-grid-3x3',      type:'Multiplayer',  desc:'Classic 3×3 strategy game' },
  { id:'connect4',  name:'Connect 4',      icon:'bi-circle-fill',   type:'Multiplayer',  desc:'Drop pieces, get 4 in a row' },
  { id:'rps',       name:'Rock Paper Scissors', icon:'bi-hand-index-thumb', type:'Multiplayer', desc:'Quick 1v1 showdown' },
  { id:'snake',     name:'Snake',          icon:'bi-arrow-repeat',  type:'Single Player',desc:'Eat, grow, survive' },
  { id:'2048',      name:'2048',           icon:'bi-grid-fill',     type:'Single Player',desc:'Merge tiles to reach 2048' },
  { id:'memory',    name:'Memory Match',   icon:'bi-card-text',     type:'Single Player',desc:'Flip and match all pairs' },
  { id:'trivia',    name:'Gaming Trivia',  icon:'bi-question-circle','type':'Single Player',desc:'Test your gaming knowledge' },
  { id:'wordle',    name:'GameWord',       icon:'bi-alphabet',      type:'Single Player',desc:'Guess the 5-letter game title' },
]

export function renderGames(container, path) {
  const gameId = path?.split('/games/')[1]
  if (gameId) {
    const game = GAME_LIST.find(g => g.id === gameId)
    if (game) { renderGamePage(container, game); return }
  }
  renderHub(container)
}

function renderHub(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title"><i class="bi bi-controller"></i> Games</h1>
    </div>
    <div class="section">
      <div class="section-title"><i class="bi bi-people-fill"></i> Multiplayer</div>
      <div class="games-grid">
        ${GAME_LIST.filter(g=>g.type==='Multiplayer').map(gameCardHtml).join('')}
      </div>
    </div>
    <div class="section">
      <div class="section-title"><i class="bi bi-person-fill"></i> Single Player</div>
      <div class="games-grid">
        ${GAME_LIST.filter(g=>g.type==='Single Player').map(gameCardHtml).join('')}
      </div>
    </div>
    <div class="section">
      <div class="section-title"><i class="bi bi-bar-chart-fill"></i> Your Game Stats</div>
      <div id="game-stats-grid" class="stat-grid"><div class="spinner" style="margin:20px auto"></div></div>
    </div>
  `
  container.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const game = GAME_LIST.find(g => g.id === card.dataset.game)
      if (game) { history.pushState(null,'',`/games/${game.id}`); renderGamePage(container, game) }
    })
  })
  loadGameStats(container)
}

function gameCardHtml(g) {
  return `
    <div class="game-card" data-game="${g.id}">
      <div class="game-icon"><i class="bi ${g.icon}"></i></div>
      <div class="game-name">${g.name}</div>
      <div class="game-type"><i class="bi ${g.type==='Multiplayer'?'bi-people':'bi-person'}"></i>${g.type}</div>
      <div style="font-size:11.5px;color:var(--text-3);text-align:center">${g.desc}</div>
    </div>
  `
}

async function loadGameStats(container) {
  try {
    const { stats } = await api.get('/games/stats')
    const el = container.querySelector('#game-stats-grid')
    if (!stats?.length) { el.innerHTML = '<p class="text-dim">Play some games to see stats here!</p>'; return }
    el.innerHTML = stats.map(s => `
      <div class="stat-card">
        <div class="stat-value">${s.played||0}</div>
        <div class="stat-label">${s.game_name}</div>
        <div style="font-size:11px;color:var(--green);margin-top:2px">${s.wins||0}W / ${s.losses||0}L</div>
      </div>
    `).join('')
  } catch {}
}

// ── Game page wrapper ──────────────────────────────────────────────────────
function renderGamePage(container, game) {
  container.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-ghost btn-icon" id="back-to-games"><i class="bi bi-arrow-left"></i></button>
        <h1 class="page-title" style="margin:0"><i class="bi ${game.icon}"></i> ${game.name}</h1>
        <span class="tag">${game.type}</span>
      </div>
    </div>
    <div id="game-container"></div>
  `
  container.querySelector('#back-to-games').addEventListener('click', () => {
    history.pushState(null,'','/games')
    renderHub(container)
  })

  const gc = container.querySelector('#game-container')
  switch (game.id) {
    case 'tictactoe': renderTTT(gc); break
    case 'connect4':  renderC4(gc);  break
    case 'rps':       renderRPS(gc); break
    case 'snake':     renderSnake(gc); break
    case '2048':      render2048(gc); break
    case 'memory':    renderMemory(gc); break
    case 'trivia':    renderTrivia(gc); break
    case 'wordle':    renderWordle(gc); break
  }
}

async function saveResult(game_name, result, score) {
  try { await api.post('/games/results', { game_name, result, score }) } catch {}
}

// ════════════════════════════════════════════════════════════════
// TIC-TAC-TOE (Multiplayer via WS)
// ════════════════════════════════════════════════════════════════
function renderTTT(gc) {
  let gameState = null; let mySymbol = null; let unsubs = []
  const cleanup = () => { unsubs.forEach(u=>u()); unsubs=[]; gameWs.disconnect() }

  gc.innerHTML = `
    <div class="card" style="max-width:420px;margin:0 auto">
      <div id="ttt-lobby">
        <div class="state-container" style="padding:30px">
          <div class="game-icon" style="margin:0 auto 16px"><i class="bi bi-grid-3x3"></i></div>
          <div class="state-title">Tic-Tac-Toe</div>
          <p class="state-desc">Find an opponent and play. First to get 3 in a row wins!</p>
          <button class="btn btn-primary mt" id="ttt-find"><i class="bi bi-search"></i> Find Match</button>
        </div>
      </div>
      <div id="ttt-game" class="hidden">
        <div style="text-align:center;margin-bottom:14px">
          <div id="ttt-status" style="font-size:14px;font-weight:600;color:var(--accent-3)">Waiting…</div>
          <div id="ttt-symbol" style="font-size:12px;color:var(--text-2);margin-top:2px"></div>
        </div>
        <div class="game-board-wrap">
          <div id="ttt-board" style="display:grid;grid-template-columns:repeat(3,100px);gap:6px;justify-content:center"></div>
        </div>
        <div style="text-align:center;margin-top:16px">
          <button class="btn btn-ghost btn-sm" id="ttt-quit"><i class="bi bi-x-lg"></i> Quit</button>
        </div>
      </div>
    </div>
  `

  gc.querySelector('#ttt-find').addEventListener('click', () => {
    gameWs.connect()
    gameWs.send({ type: 'ttt_find_game' })
    gc.querySelector('#ttt-status') && (gc.querySelector('#ttt-status').textContent = 'Searching…')
    gc.querySelector('#ttt-lobby').classList.add('hidden')
    gc.querySelector('#ttt-game').classList.remove('hidden')
    gc.querySelector('#ttt-status').textContent = 'Looking for opponent…'
  })

  gc.querySelector('#ttt-quit').addEventListener('click', () => { cleanup(); renderTTT(gc) })

  unsubs.push(gameWs.on('ttt_waiting', () => { gc.querySelector('#ttt-status').textContent = '🔍 Looking for opponent…' }))

  unsubs.push(gameWs.on('ttt_start', msg => {
    mySymbol = msg.symbol; gameState = { board: Array(9).fill(null), turn: 'X' }
    gc.querySelector('#ttt-symbol').textContent = `You are ${mySymbol}`
    renderTTTBoard()
  }))

  unsubs.push(gameWs.on('ttt_move', msg => {
    gameState.board[msg.index] = msg.symbol; gameState.turn = msg.turn
    renderTTTBoard()
  }))

  unsubs.push(gameWs.on('ttt_end', msg => {
    renderTTTBoard()
    const won = msg.winner === mySymbol
    gc.querySelector('#ttt-status').textContent = msg.winner === 'draw' ? "It's a draw!" : won ? '🏆 You win!' : '😞 You lose'
    gc.querySelector('#ttt-status').style.color = won ? 'var(--green)' : msg.winner === 'draw' ? 'var(--gold)' : 'var(--red)'
    const result = msg.winner === 'draw' ? 'draw' : won ? 'win' : 'loss'
    saveResult('Tic-Tac-Toe', result)
  }))

  unsubs.push(gameWs.on('ttt_opponent_left', () => {
    gc.querySelector('#ttt-status').textContent = 'Opponent disconnected — you win!'
    gc.querySelector('#ttt-status').style.color = 'var(--green)'
    saveResult('Tic-Tac-Toe', 'win')
  }))

  function renderTTTBoard() {
    const board = gc.querySelector('#ttt-board')
    const myTurn = gameState.turn === mySymbol
    gc.querySelector('#ttt-status').textContent = myTurn ? '⚡ Your turn' : '⏳ Opponent\'s turn'
    gc.querySelector('#ttt-status').style.color = myTurn ? 'var(--accent-3)' : 'var(--text-2)'
    board.innerHTML = gameState.board.map((cell, i) => `
      <div style="
        width:100px;height:100px;background:var(--surface-2);border:2px solid ${cell?'var(--border)':'var(--border)'};
        border-radius:var(--r);display:flex;align-items:center;justify-content:center;
        font-size:42px;font-weight:700;cursor:${!cell&&myTurn?'pointer':'default'};
        color:${cell==='X'?'var(--accent-3)':'var(--red)'};
        transition:var(--trans);font-family:var(--font-d)
      " data-i="${i}">${cell||''}</div>
    `).join('')
    board.querySelectorAll('[data-i]').forEach(cell => {
      cell.addEventListener('click', () => {
        const i = parseInt(cell.dataset.i)
        if (!gameState.board[i] && gameState.turn === mySymbol) {
          gameWs.send({ type: 'ttt_move', index: i })
        }
      })
    })
  }
}

// ════════════════════════════════════════════════════════════════
// CONNECT 4 (Multiplayer via WS)
// ════════════════════════════════════════════════════════════════
function renderC4(gc) {
  let board = null; let myColor = null; let myTurn = false; let unsubs = []
  const cleanup = () => { unsubs.forEach(u=>u()); unsubs=[]; gameWs.disconnect() }
  const COLS = 7; const ROWS = 6

  gc.innerHTML = `
    <div class="card" style="max-width:520px;margin:0 auto">
      <div id="c4-lobby">
        <div class="state-container" style="padding:30px">
          <div class="game-icon" style="margin:0 auto 16px"><i class="bi bi-circle-fill" style="color:var(--accent-2)"></i></div>
          <div class="state-title">Connect 4</div>
          <p class="state-desc">Drop your pieces and connect 4 in a row — horizontally, vertically, or diagonally!</p>
          <button class="btn btn-primary mt" id="c4-find"><i class="bi bi-search"></i> Find Match</button>
        </div>
      </div>
      <div id="c4-game" class="hidden">
        <div style="text-align:center;margin-bottom:12px">
          <div id="c4-status" style="font-size:14px;font-weight:600">Waiting…</div>
          <div id="c4-color" style="font-size:12px;color:var(--text-2);margin-top:2px"></div>
        </div>
        <div class="game-board-wrap">
          <div id="c4-board" style="background:var(--accent);padding:8px;border-radius:var(--r-lg);display:inline-grid;grid-template-columns:repeat(7,46px);gap:5px"></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="c4-quit" style="margin:14px auto;display:flex"><i class="bi bi-x-lg"></i> Quit</button>
      </div>
    </div>
  `

  gc.querySelector('#c4-find').addEventListener('click', () => {
    gameWs.connect(); gameWs.send({ type: 'c4_find_game' })
    gc.querySelector('#c4-lobby').classList.add('hidden')
    gc.querySelector('#c4-game').classList.remove('hidden')
    gc.querySelector('#c4-status').textContent = '🔍 Looking for opponent…'
  })
  gc.querySelector('#c4-quit').addEventListener('click', () => { cleanup(); renderC4(gc) })

  unsubs.push(gameWs.on('c4_start', msg => {
    myColor = msg.color
    board = Array.from({length: ROWS}, () => Array(COLS).fill(null))
    gc.querySelector('#c4-color').textContent = `You are ${myColor === 'red' ? '🔴 Red' : '🟡 Yellow'}`
    myTurn = msg.first === myColor
    renderC4Board()
  }))

  unsubs.push(gameWs.on('c4_move', msg => {
    board = msg.board; myTurn = msg.turn === myColor
    renderC4Board()
  }))

  unsubs.push(gameWs.on('c4_end', msg => {
    board = msg.board; renderC4Board()
    const won = msg.winner === myColor
    const draw = msg.winner === 'draw'
    gc.querySelector('#c4-status').textContent = draw ? "It's a draw!" : won ? '🏆 You win!' : '😞 You lose'
    gc.querySelector('#c4-status').style.color = won ? 'var(--green)' : draw ? 'var(--gold)' : 'var(--red)'
    saveResult('Connect 4', draw ? 'draw' : won ? 'win' : 'loss')
  }))

  unsubs.push(gameWs.on('c4_opponent_left', () => {
    gc.querySelector('#c4-status').textContent = 'Opponent left — you win!'
    gc.querySelector('#c4-status').style.color = 'var(--green)'
    saveResult('Connect 4', 'win')
  }))

  function renderC4Board() {
    const boardEl = gc.querySelector('#c4-board')
    const status  = gc.querySelector('#c4-status')
    status.textContent = myTurn ? '⚡ Your turn' : '⏳ Opponent\'s turn'
    status.style.color = myTurn ? 'var(--gold)' : 'var(--text-2)'

    // Column headers for clicking
    boardEl.innerHTML = `
      ${Array.from({length:COLS},(_,c)=>`
        <div style="width:46px;height:46px;background:rgba(255,255,255,.15);border-radius:50%;cursor:${myTurn?'pointer':'default'};
          display:flex;align-items:center;justify-content:center;font-size:10px;color:rgba(255,255,255,.5)" data-col="${c}">
          <i class="bi bi-caret-down-fill"></i>
        </div>
      `).join('')}
      ${board.flatMap((row,r) => row.map((cell,c) => `
        <div style="width:46px;height:46px;border-radius:50%;background:${cell==='red'?'#ef4444':cell==='yellow'?'#f59e0b':'rgba(0,0,0,.5)'}"></div>
      `)).join('')}
    `

    boardEl.querySelectorAll('[data-col]').forEach(col => {
      col.addEventListener('click', () => {
        if (myTurn) gameWs.send({ type: 'c4_move', col: parseInt(col.dataset.col) })
      })
    })
  }
}

// ════════════════════════════════════════════════════════════════
// RPS (Multiplayer via WS)
// ════════════════════════════════════════════════════════════════
function renderRPS(gc) {
  let unsubs = []
  const cleanup = () => { unsubs.forEach(u=>u()); unsubs=[]; gameWs.disconnect() }
  const choices = [
    { id:'rock',     icon:'✊', label:'Rock' },
    { id:'paper',    icon:'✋', label:'Paper' },
    { id:'scissors', icon:'✌️', label:'Scissors' },
  ]

  gc.innerHTML = `
    <div class="card" style="max-width:400px;margin:0 auto;text-align:center">
      <div id="rps-lobby">
        <div class="state-container" style="padding:30px">
          <div style="font-size:48px;margin-bottom:12px">✊✋✌️</div>
          <div class="state-title">Rock Paper Scissors</div>
          <p class="state-desc">Quick 1v1 — choose simultaneously, fastest fingers win!</p>
          <button class="btn btn-primary mt" id="rps-find"><i class="bi bi-search"></i> Find Match</button>
        </div>
      </div>
      <div id="rps-game" class="hidden" style="padding:16px">
        <div id="rps-status" style="font-size:16px;font-weight:700;margin-bottom:20px;color:var(--accent-3)">Waiting…</div>
        <div id="rps-choices" class="hidden" style="display:flex;justify-content:center;gap:12px;margin-bottom:20px">
          ${choices.map(c=>`
            <div class="game-card" data-choice="${c.id}" style="padding:16px 20px;cursor:pointer;width:100px">
              <div style="font-size:36px">${c.icon}</div>
              <div style="font-size:13px;font-weight:700;margin-top:6px">${c.label}</div>
            </div>
          `).join('')}
        </div>
        <div id="rps-result" class="hidden" style="margin:16px 0">
          <div style="font-size:48px;margin-bottom:8px" id="rps-result-icons"></div>
          <div style="font-size:18px;font-weight:700" id="rps-result-text"></div>
          <div style="font-size:13px;color:var(--text-2);margin-top:4px" id="rps-result-sub"></div>
          <button class="btn btn-primary mt" id="rps-again"><i class="bi bi-arrow-repeat"></i> Play Again</button>
        </div>
        <button class="btn btn-ghost btn-sm" id="rps-quit" style="margin:8px auto"><i class="bi bi-x-lg"></i> Quit</button>
      </div>
    </div>
  `

  gc.querySelector('#rps-find').addEventListener('click', () => {
    gameWs.connect(); gameWs.send({ type: 'rps_find_game' })
    gc.querySelector('#rps-lobby').classList.add('hidden')
    gc.querySelector('#rps-game').classList.remove('hidden')
    gc.querySelector('#rps-status').textContent = '🔍 Looking for opponent…'
  })
  gc.querySelector('#rps-quit').addEventListener('click', () => { cleanup(); renderRPS(gc) })

  unsubs.push(gameWs.on('rps_start', () => {
    gc.querySelector('#rps-status').textContent = '⚡ Make your choice!'
    gc.querySelector('#rps-choices').classList.remove('hidden')
    gc.querySelector('#rps-result').classList.add('hidden')
  }))

  unsubs.push(gameWs.on('rps_waiting_opponent', () => {
    gc.querySelector('#rps-status').textContent = '⏳ Waiting for opponent…'
  }))

  unsubs.push(gameWs.on('rps_result', msg => {
    const won = msg.winner === 'you'
    const draw = msg.winner === 'draw'
    const icons = { rock:'✊', paper:'✋', scissors:'✌️' }
    gc.querySelector('#rps-choices').classList.add('hidden')
    gc.querySelector('#rps-result').classList.remove('hidden')
    gc.querySelector('#rps-result-icons').textContent = `${icons[msg.my_choice]} vs ${icons[msg.opp_choice]}`
    gc.querySelector('#rps-result-text').textContent = draw ? "It's a draw!" : won ? '🏆 You Win!' : '😞 You Lose'
    gc.querySelector('#rps-result-text').style.color = draw ? 'var(--gold)' : won ? 'var(--green)' : 'var(--red)'
    gc.querySelector('#rps-result-sub').textContent = `You: ${msg.my_choice} | Opponent: ${msg.opp_choice}`
    gc.querySelector('#rps-status').textContent = ''
    saveResult('Rock Paper Scissors', draw ? 'draw' : won ? 'win' : 'loss')
  }))

  unsubs.push(gameWs.on('rps_opponent_left', () => {
    gc.querySelector('#rps-status').textContent = 'Opponent left!'
    gc.querySelector('#rps-choices').classList.add('hidden')
  }))

  gc.querySelector('#rps-choices').addEventListener('click', e => {
    const card = e.target.closest('[data-choice]')
    if (!card) return
    gc.querySelectorAll('[data-choice]').forEach(c => c.classList.remove('active'))
    card.classList.add('active')
    gameWs.send({ type: 'rps_choice', choice: card.dataset.choice })
    gc.querySelector('#rps-status').textContent = `You chose ${card.dataset.choice}! Waiting…`
  })

  gc.querySelector('#rps-again').addEventListener('click', () => {
    gameWs.send({ type: 'rps_find_game' })
    gc.querySelector('#rps-result').classList.add('hidden')
    gc.querySelector('#rps-status').textContent = '🔍 Finding another match…'
  })
}

// ════════════════════════════════════════════════════════════════
// SNAKE
// ════════════════════════════════════════════════════════════════
function renderSnake(gc) {
  const CELL = 20, COLS = 20, ROWS = 20
  const W = COLS * CELL, H = ROWS * CELL
  let snake, dir, food, score, interval, running = false

  gc.innerHTML = `
    <div style="max-width:440px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:14px;font-weight:600">Score: <span id="snake-score" class="mono text-accent">0</span></div>
        <div style="font-size:12px;color:var(--text-2)">High Score: <span id="snake-hi" class="mono">${localStorage.getItem('snake_hi')||0}</span></div>
      </div>
      <canvas id="snake-canvas" width="${W}" height="${H}" style="border:2px solid var(--border);border-radius:var(--r);display:block;margin:0 auto;background:var(--surface-2)"></canvas>
      <div id="snake-ui" style="text-align:center;margin-top:14px">
        <button class="btn btn-primary" id="snake-start"><i class="bi bi-play-fill"></i> Start Game</button>
      </div>
      <!-- Mobile D-pad -->
      <div id="dpad" style="display:grid;grid-template-columns:repeat(3,52px);grid-template-rows:repeat(2,52px);gap:4px;justify-content:center;margin-top:16px">
        <div></div>
        <button class="btn btn-secondary btn-icon" id="d-up" style="font-size:20px;width:52px;height:52px"><i class="bi bi-chevron-up"></i></button>
        <div></div>
        <button class="btn btn-secondary btn-icon" id="d-left" style="font-size:20px;width:52px;height:52px"><i class="bi bi-chevron-left"></i></button>
        <button class="btn btn-secondary btn-icon" id="d-down" style="font-size:20px;width:52px;height:52px"><i class="bi bi-chevron-down"></i></button>
        <button class="btn btn-secondary btn-icon" id="d-right" style="font-size:20px;width:52px;height:52px"><i class="bi bi-chevron-right"></i></button>
      </div>
    </div>
  `

  const canvas = gc.querySelector('#snake-canvas')
  const ctx    = canvas.getContext('2d')

  function initGame() {
    snake = [{x:10,y:10},{x:9,y:10},{x:8,y:10}]
    dir = {x:1,y:0}; score = 0; running = true
    placeFood(); draw()
    gc.querySelector('#snake-score').textContent = '0'
    gc.querySelector('#snake-ui').innerHTML = `<button class="btn btn-ghost btn-sm" id="snake-stop"><i class="bi bi-stop-fill"></i> Stop</button>`
    gc.querySelector('#snake-stop').addEventListener('click', endGame)
  }

  function placeFood() {
    do { food = {x:Math.floor(Math.random()*COLS),y:Math.floor(Math.random()*ROWS)} }
    while (snake.some(s=>s.x===food.x&&s.y===food.y))
  }

  function gameLoop() {
    if (!running) return
    const head = {x:(snake[0].x+dir.x+COLS)%COLS, y:(snake[0].y+dir.y+ROWS)%ROWS}
    if (snake.some(s=>s.x===head.x&&s.y===head.y)) { endGame(); return }
    snake.unshift(head)
    if (head.x===food.x&&head.y===food.y) {
      score += 10; gc.querySelector('#snake-score').textContent = score; placeFood()
    } else snake.pop()
    draw()
  }

  function draw() {
    ctx.fillStyle = '#0e0e16'; ctx.fillRect(0,0,W,H)
    // Draw grid
    ctx.strokeStyle = 'rgba(255,255,255,.03)'; ctx.lineWidth = .5
    for(let x=0;x<COLS;x++){ctx.beginPath();ctx.moveTo(x*CELL,0);ctx.lineTo(x*CELL,H);ctx.stroke()}
    for(let y=0;y<ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*CELL);ctx.lineTo(W,y*CELL);ctx.stroke()}
    // Food
    ctx.fillStyle = '#ef4444'
    ctx.beginPath(); ctx.arc(food.x*CELL+CELL/2, food.y*CELL+CELL/2, CELL/2-2, 0, Math.PI*2); ctx.fill()
    // Snake
    snake.forEach((s,i) => {
      ctx.fillStyle = i===0 ? '#7c3aed' : `hsl(${260-i*3},60%,${55-i*1.2}%)`
      ctx.beginPath(); ctx.roundRect(s.x*CELL+1,s.y*CELL+1,CELL-2,CELL-2,4); ctx.fill()
    })
    if (!running) {
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Inter'; ctx.textAlign = 'center'
      ctx.fillText('Game Over', W/2, H/2-10)
      ctx.font = '14px Inter'; ctx.fillStyle = '#a78bfa'
      ctx.fillText(`Score: ${score}`, W/2, H/2+16)
    }
  }

  function endGame() {
    running = false; clearInterval(interval); draw()
    const hi = parseInt(localStorage.getItem('snake_hi')||0)
    if (score > hi) { localStorage.setItem('snake_hi', score); gc.querySelector('#snake-hi').textContent = score }
    gc.querySelector('#snake-ui').innerHTML = `<button class="btn btn-primary" id="snake-restart"><i class="bi bi-arrow-repeat"></i> Play Again</button>`
    gc.querySelector('#snake-restart').addEventListener('click', startGame)
    saveResult('Snake', 'complete', score)
  }

  function startGame() {
    clearInterval(interval); initGame()
    interval = setInterval(gameLoop, 130)
  }

  // Controls
  document.addEventListener('keydown', e => {
    if (!running) return
    const map = {ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}}
    const d = map[e.key]
    if (d && !(dir.x===-d.x&&dir.y===-d.y)) { e.preventDefault(); dir=d }
  })

  gc.querySelector('#d-up').addEventListener('click',   () => { if(dir.y!==1) dir={x:0,y:-1} })
  gc.querySelector('#d-down').addEventListener('click',  () => { if(dir.y!==-1) dir={x:0,y:1} })
  gc.querySelector('#d-left').addEventListener('click',  () => { if(dir.x!==1) dir={x:-1,y:0} })
  gc.querySelector('#d-right').addEventListener('click', () => { if(dir.x!==-1) dir={x:1,y:0} })
  gc.querySelector('#snake-start').addEventListener('click', startGame)
}

// ════════════════════════════════════════════════════════════════
// 2048
// ════════════════════════════════════════════════════════════════
function render2048(gc) {
  const SIZE = 4
  let board, score, best

  const COLORS = {0:'#1c1c28',2:'#8b5cf6',4:'#7c3aed',8:'#6d28d9',16:'#5b21b6',32:'#4c1d95',64:'#f59e0b',128:'#ef4444',256:'#ec4899',512:'#22c55e',1024:'#06b6d4',2048:'#f97316'}

  gc.innerHTML = `
    <div style="max-width:380px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <div class="stat-card" style="min-width:100px;text-align:center">
          <div class="stat-value" id="g2048-score">0</div><div class="stat-label">Score</div>
        </div>
        <button class="btn btn-secondary" id="g2048-new"><i class="bi bi-arrow-repeat"></i> New Game</button>
        <div class="stat-card" style="min-width:100px;text-align:center">
          <div class="stat-value" id="g2048-best">${localStorage.getItem('2048_best')||0}</div><div class="stat-label">Best</div>
        </div>
      </div>
      <div id="g2048-board" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:var(--surface);padding:10px;border-radius:var(--r-lg);border:1px solid var(--border)"></div>
      <p style="text-align:center;font-size:12px;color:var(--text-3);margin-top:10px">Arrow keys to move · Swipe on mobile</p>
    </div>
  `

  function init() {
    board = Array.from({length:SIZE},()=>Array(SIZE).fill(0))
    score = 0; best = parseInt(localStorage.getItem('2048_best')||0)
    addTile(); addTile(); render()
  }

  function addTile() {
    const empty = []
    board.forEach((row,r)=>row.forEach((v,c)=>{ if(!v) empty.push([r,c]) }))
    if (!empty.length) return
    const [r,c] = empty[Math.floor(Math.random()*empty.length)]
    board[r][c] = Math.random()<.9?2:4
  }

  function merge(row) {
    let r = row.filter(v=>v)
    for(let i=0;i<r.length-1;i++) {
      if(r[i]===r[i+1]) { r[i]*=2; score+=r[i]; r[i+1]=0 }
    }
    r = r.filter(v=>v)
    while(r.length<SIZE) r.push(0)
    return r
  }

  function move(dir) {
    let moved = false
    const prev = JSON.stringify(board)
    if(dir==='left')  board = board.map(merge)
    if(dir==='right') board = board.map(r=>[...merge([...r].reverse())].reverse())
    if(dir==='up')    { board = rotateL(board); board=board.map(merge); board=rotateR(board) }
    if(dir==='down')  { board = rotateR(board); board=board.map(merge); board=rotateL(board) }
    if(JSON.stringify(board)!==prev) { moved=true; addTile() }
    if(score>best){ best=score; localStorage.setItem('2048_best',best) }
    render()
    if(board.flat().includes(2048)) { setTimeout(()=>{ toast('🎉 You reached 2048!','success'); saveResult('2048','win',score) },200) }
    else if(!hasMove()) { setTimeout(()=>{ toast('Game over!','error'); saveResult('2048','loss',score) },200) }
  }

  function rotateL(b){ return b[0].map((_,c)=>b.map(r=>r[c]).reverse()) }
  function rotateR(b){ return b[0].map((_,c)=>b.map(r=>r[SIZE-1-c])) }

  function hasMove() {
    if(board.flat().includes(0)) return true
    for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) {
      if(c<SIZE-1&&board[r][c]===board[r][c+1]) return true
      if(r<SIZE-1&&board[r][c]===board[r+1][c]) return true
    }
    return false
  }

  function render() {
    gc.querySelector('#g2048-score').textContent = score
    gc.querySelector('#g2048-best').textContent  = best
    gc.querySelector('#g2048-board').innerHTML = board.flat().map(v=>`
      <div style="aspect-ratio:1;background:${COLORS[v]||'#7c3aed'};border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;
        font-family:var(--font-d);font-size:${v>=1000?'18px':v>=100?'22px':'26px'};font-weight:700;color:${v?'#fff':'transparent'};transition:all .1s">
        ${v||''}
      </div>
    `).join('')
  }

  // Keyboard
  document.addEventListener('keydown', e => {
    const map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}
    if(map[e.key]){ e.preventDefault(); move(map[e.key]) }
  })

  // Swipe
  let tx,ty
  gc.addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY },{ passive:true })
  gc.addEventListener('touchend', e=>{
    const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty
    if(Math.max(Math.abs(dx),Math.abs(dy))<30) return
    move(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'))
  })

  gc.querySelector('#g2048-new').addEventListener('click', init)
  init()
}

// ════════════════════════════════════════════════════════════════
// MEMORY MATCH
// ════════════════════════════════════════════════════════════════
function renderMemory(gc) {
  const ICONS = ['🎮','🕹️','🏆','⚔️','🛡️','🎯','💣','🚀','👾','🦊','🐉','🌟','🔥','💎','🎲','🧩']
  let cards, flipped, matched, moves, timer, startTime, running=false

  gc.innerHTML = `
    <div style="max-width:440px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>Moves: <span class="mono text-accent" id="mem-moves">0</span></div>
        <button class="btn btn-primary btn-sm" id="mem-start"><i class="bi bi-play-fill"></i> Start</button>
        <div>Time: <span class="mono text-gold" id="mem-time">0s</span></div>
      </div>
      <div id="mem-board" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"></div>
      <div id="mem-result" class="hidden" style="text-align:center;margin-top:16px">
        <div style="font-size:20px;font-weight:700;color:var(--green)" id="mem-result-text"></div>
      </div>
    </div>
  `

  function init() {
    const pairs = [...ICONS,...ICONS].sort(()=>Math.random()-.5)
    cards = pairs.map((icon,i)=>({id:i,icon,flipped:false,matched:false}))
    flipped=[]; matched=0; moves=0; running=true
    clearInterval(timer); startTime=Date.now()
    timer=setInterval(()=>{ gc.querySelector('#mem-time').textContent=Math.floor((Date.now()-startTime)/1000)+'s' },1000)
    gc.querySelector('#mem-moves').textContent='0'
    gc.querySelector('#mem-result').classList.add('hidden')
    render()
  }

  function render() {
    gc.querySelector('#mem-board').innerHTML = cards.map((c,i)=>`
      <div class="mem-card" data-i="${i}" style="aspect-ratio:1;background:${c.flipped||c.matched?'var(--accent-dim)':'var(--surface-2)'};
        border:2px solid ${c.flipped||c.matched?'var(--accent)':'var(--border)'};border-radius:var(--r);
        display:flex;align-items:center;justify-content:center;font-size:28px;cursor:pointer;transition:all .15s">
        ${c.flipped||c.matched?c.icon:''}
      </div>
    `).join('')
    gc.querySelector('#mem-board').querySelectorAll('[data-i]').forEach(el=>{
      el.addEventListener('click',()=>flipCard(parseInt(el.dataset.i)))
    })
  }

  function flipCard(i) {
    if(!running||cards[i].matched||cards[i].flipped||flipped.length===2) return
    cards[i].flipped=true; flipped.push(i); render()
    if(flipped.length===2) {
      moves++; gc.querySelector('#mem-moves').textContent=moves
      const [a,b]=flipped
      if(cards[a].icon===cards[b].icon) {
        cards[a].matched=cards[b].matched=true; matched+=2; flipped=[]
        if(matched===cards.length) {
          running=false; clearInterval(timer)
          const t=Math.floor((Date.now()-startTime)/1000)
          gc.querySelector('#mem-result').classList.remove('hidden')
          gc.querySelector('#mem-result-text').textContent=`🏆 Completed in ${moves} moves, ${t}s!`
          saveResult('Memory Match','win',moves)
        }
      } else {
        setTimeout(()=>{ cards[a].flipped=cards[b].flipped=false; flipped=[]; render() },900)
      }
    }
  }

  gc.querySelector('#mem-start').addEventListener('click', init)
  init()
}

// ════════════════════════════════════════════════════════════════
// TRIVIA
// ════════════════════════════════════════════════════════════════
function renderTrivia(gc) {
  const QS = [
    {q:'What year was Minecraft first released publicly?',a:'2009',opts:['2007','2009','2011','2013']},
    {q:'Which game franchise features a character called Master Chief?',a:'Halo',opts:['Call of Duty','Halo','Destiny','Titanfall']},
    {q:'In Pokemon, what type is Charizard?',a:'Fire/Flying',opts:['Fire','Fire/Dragon','Fire/Flying','Dragon/Flying']},
    {q:'What is the highest rank in most games called?',a:'Grandmaster',opts:['Diamond','Legend','Grandmaster','Celestial']},
    {q:'Which company made The Legend of Zelda?',a:'Nintendo',opts:['Sega','Nintendo','Sony','Capcom']},
    {q:'What does "GG" stand for in gaming?',a:'Good Game',opts:['Good Going','Great Game','Good Game','Get Going']},
    {q:'In Chess, which piece can only move diagonally?',a:'Bishop',opts:['Rook','Knight','Bishop','Queen']},
    {q:'What is the name of the main character in The Witcher games?',a:'Geralt',opts:['Ciri','Yennefer','Geralt','Dandelion']},
    {q:'Which game invented the battle royale genre on PC?',a:'PlayerUnknown\'s Battlegrounds',opts:['Fortnite','PlayerUnknown\'s Battlegrounds','H1Z1','DayZ']},
    {q:'What color is Luigi\'s hat in Mario games?',a:'Green',opts:['Blue','Yellow','Red','Green']},
  ]
  let cur=0, score=0, answered=false

  gc.innerHTML = `
    <div class="card" style="max-width:520px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span id="tri-q-num" style="font-size:13px;color:var(--text-2)">Question 1/10</span>
        <span class="mono text-gold" id="tri-score" style="font-size:14px;font-weight:700">0 pts</span>
      </div>
      <div id="tri-content"></div>
    </div>
  `

  function showQ() {
    answered=false
    const q=QS[cur]
    gc.querySelector('#tri-q-num').textContent=`Question ${cur+1}/10`
    gc.querySelector('#tri-content').innerHTML=`
      <div style="font-size:17px;font-weight:600;margin-bottom:20px;line-height:1.5">${q.q}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${q.opts.map(o=>`
          <button class="btn btn-secondary w-full" data-ans="${o}" style="justify-content:flex-start;text-align:left;font-weight:500">
            ${o}
          </button>
        `).join('')}
      </div>
    `
    gc.querySelector('#tri-content').querySelectorAll('[data-ans]').forEach(btn=>{
      btn.addEventListener('click',()=>answer(btn,q))
    })
  }

  function answer(btn, q) {
    if(answered) return; answered=true
    const correct=btn.dataset.ans===q.a
    btn.style.background=correct?'var(--green-dim)':'var(--red-dim)'
    btn.style.borderColor=correct?'var(--green)':'var(--red)'
    gc.querySelector('#tri-content').querySelectorAll('[data-ans]').forEach(b=>{
      if(b.dataset.ans===q.a) { b.style.background='var(--green-dim)'; b.style.borderColor='var(--green)' }
    })
    if(correct){ score+=10; gc.querySelector('#tri-score').textContent=`${score} pts` }
    setTimeout(()=>{ cur++; if(cur<QS.length) showQ(); else showResult() },1200)
  }

  function showResult() {
    const pct=Math.round(score/100*100)
    gc.querySelector('#tri-content').innerHTML=`
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:56px;margin-bottom:8px">${pct>=80?'🏆':pct>=60?'⭐':'😬'}</div>
        <div style="font-size:22px;font-weight:700">${score}/100 points</div>
        <div style="font-size:14px;color:var(--text-2);margin:6px 0 20px">${pct>=80?'Excellent! You really know your games!':pct>=60?'Good job! Keep playing!':'Practice makes perfect!'}</div>
        <button class="btn btn-primary" id="tri-replay"><i class="bi bi-arrow-repeat"></i> Play Again</button>
      </div>
    `
    gc.querySelector('#tri-replay').addEventListener('click',()=>{ cur=0;score=0;gc.querySelector('#tri-score').textContent='0 pts';showQ() })
    saveResult('Gaming Trivia','complete',score)
  }

  showQ()
}

// ════════════════════════════════════════════════════════════════
// GAMEWORD (Wordle-style)
// ════════════════════════════════════════════════════════════════
function renderWordle(gc) {
  const WORDS = ['MARIO','SONIC','ZELDA','HADES','DOOM3','QUAKE','PONG2','METRU','KIRBY','CRASH','BANJO','PIKMI','SABLE','TUNIC','LUNAR']
  const WORD  = WORDS[Math.floor(Math.random()*WORDS.length)]
  const MAX   = 6; const LEN=5
  let guesses=[], current='', over=false

  gc.innerHTML = `
    <div style="max-width:380px;margin:0 auto;text-align:center">
      <p style="font-size:13px;color:var(--text-2);margin-bottom:14px">Guess the 5-letter game title in 6 tries</p>
      <div id="wl-board" style="display:inline-flex;flex-direction:column;gap:5px;margin-bottom:14px"></div>
      <div id="wl-keyboard" style="display:flex;flex-direction:column;gap:4px;align-items:center;margin-bottom:10px"></div>
      <div id="wl-msg" style="font-size:14px;font-weight:600;min-height:22px;color:var(--accent-3)"></div>
    </div>
  `

  const ROWS = Array.from({length:MAX},(_,i)=>i)
  const KEYS = [['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['ENTER','Z','X','C','V','B','N','M','⌫']]
  const keyStates = {}

  function render() {
    const board = gc.querySelector('#wl-board')
    board.innerHTML = ROWS.map(r=>{
      const guess = guesses[r]
      const active = r===guesses.length && !over
      const chars  = active ? current.padEnd(LEN).split('') : guess ? guess.split('') : Array(LEN).fill('')
      const colors = guess ? getColors(guess) : Array(LEN).fill('empty')
      return `<div style="display:flex;gap:5px">
        ${chars.map((ch,c)=>`
          <div style="width:56px;height:56px;border:2px solid ${
            active&&current.length>c?'var(--accent)':guess?
              colors[c]==='correct'?'var(--green)':colors[c]==='present'?'var(--gold)':'var(--surface-3)'
            :'var(--border)'
          };border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;
          font-family:var(--font-d);font-size:22px;font-weight:700;
          background:${guess?colors[c]==='correct'?'var(--green-dim)':colors[c]==='present'?'var(--gold-dim)':'var(--surface-2)':'var(--surface-2)'}">
            ${ch.trim()}
          </div>
        `).join('')}
      </div>`
    }).join('')

    // Keyboard
    gc.querySelector('#wl-keyboard').innerHTML = KEYS.map(row=>`
      <div style="display:flex;gap:4px">
        ${row.map(k=>`
          <button class="btn btn-secondary" data-key="${k}" style="min-width:${k.length>1?'52px':'34px'};height:42px;padding:4px 6px;font-size:12px;font-weight:700;
            background:${keyStates[k]==='correct'?'var(--green-dim)':keyStates[k]==='present'?'var(--gold-dim)':keyStates[k]==='absent'?'var(--surface-3)':'var(--surface-2)'};
            border-color:${keyStates[k]==='correct'?'var(--green)':keyStates[k]==='present'?'var(--gold)':'var(--border)'}">
            ${k}
          </button>
        `).join('')}
      </div>
    `).join('')
    gc.querySelector('#wl-keyboard').querySelectorAll('[data-key]').forEach(btn=>{
      btn.addEventListener('click',()=>handleKey(btn.dataset.key))
    })
  }

  function getColors(guess) {
    const res=Array(LEN).fill('absent')
    const remaining=WORD.split('')
    guess.split('').forEach((ch,i)=>{ if(ch===WORD[i]){ res[i]='correct'; remaining[i]=null } })
    guess.split('').forEach((ch,i)=>{ if(res[i]!=='correct'){ const j=remaining.indexOf(ch); if(j>=0){ res[i]='present'; remaining[j]=null } } })
    return res
  }

  function handleKey(k) {
    if(over) return
    if(k==='ENTER'||k==='enter') {
      if(current.length<LEN){ gc.querySelector('#wl-msg').textContent='Not enough letters'; return }
      const colors=getColors(current)
      current.split('').forEach((ch,i)=>{
        if(!keyStates[ch]||keyStates[ch]!=='correct') keyStates[ch]=colors[i]
      })
      guesses.push(current); current=''
      if(guesses[guesses.length-1]===WORD) {
        over=true; gc.querySelector('#wl-msg').textContent='🏆 Correct!'
        gc.querySelector('#wl-msg').style.color='var(--green)'
        saveResult('GameWord','win',guesses.length)
      } else if(guesses.length===MAX) {
        over=true; gc.querySelector('#wl-msg').textContent=`Answer: ${WORD}`
        gc.querySelector('#wl-msg').style.color='var(--red)'
        saveResult('GameWord','loss')
      } else gc.querySelector('#wl-msg').textContent=''
    } else if(k==='⌫'||k==='Backspace') {
      current=current.slice(0,-1); gc.querySelector('#wl-msg').textContent=''
    } else if(k.length===1&&current.length<LEN) {
      current+=k.toUpperCase()
    }
    render()
  }

  document.addEventListener('keydown', e=>{ if(!e.ctrlKey&&!e.metaKey) handleKey(e.key.length===1?e.key:e.key) })

  render()
}
