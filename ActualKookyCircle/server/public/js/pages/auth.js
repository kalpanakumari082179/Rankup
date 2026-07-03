import { api } from '../api.js'
import { onLogin } from '../app.js'

export function renderAuth() {
  const el = document.getElementById('auth-screen')
  showLogin(el)
}

function showLogin(el) {
  el.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">
        <div class="auth-logo-icon">↑</div>
        <div>
          <div class="auth-logo-text">RankUp</div>
          <div class="auth-tagline">Level up your game</div>
        </div>
      </div>
      <div class="auth-title">Welcome back</div>
      <div id="auth-error" class="form-error hidden"></div>
      <div class="form-field">
        <label class="form-label">Email or Username</label>
        <input class="input" id="login-id" type="text" placeholder="your@email.com" autocomplete="username">
      </div>
      <div class="form-field">
        <label class="form-label">Password</label>
        <input class="input" id="login-pw" type="password" placeholder="••••••••" autocomplete="current-password">
      </div>
      <button class="btn btn-primary w-full mt" id="login-btn" style="justify-content:center">
        <i class="bi bi-box-arrow-in-right"></i> Sign In
      </button>
      <div class="auth-switch">Don't have an account? <a id="goto-register">Create one</a></div>
    </div>
  `
  el.querySelector('#goto-register').addEventListener('click', () => showRegister(el))
  el.querySelector('#login-btn').addEventListener('click', () => doLogin(el))
  el.querySelectorAll('.input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(el) }))
}

async function doLogin(el) {
  const identifier = el.querySelector('#login-id').value.trim()
  const password = el.querySelector('#login-pw').value
  const errEl = el.querySelector('#auth-error')
  const btn = el.querySelector('#login-btn')

  errEl.classList.add('hidden')
  if (!identifier || !password) { showErr(errEl, 'Fill in all fields'); return }

  btn.disabled = true
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div>'

  try {
    const { user } = await api.post('/auth/login', { email: identifier, password })
    onLogin(user)
  } catch (e) {
    showErr(errEl, e.message || 'Login failed')
    btn.disabled = false
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Sign In'
  }
}

function showRegister(el) {
  el.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">
        <div class="auth-logo-icon">↑</div>
        <div>
          <div class="auth-logo-text">RankUp</div>
          <div class="auth-tagline">Your gaming hub starts here</div>
        </div>
      </div>
      <div class="auth-title">Create account</div>
      <div id="auth-error" class="form-error hidden"></div>
      <div class="form-field">
        <label class="form-label">Username</label>
        <input class="input" id="reg-user" type="text" placeholder="CoolGamer99" maxlength="32" autocomplete="username">
      </div>
      <div class="form-field">
        <label class="form-label">Email</label>
        <input class="input" id="reg-email" type="email" placeholder="you@email.com" autocomplete="email">
      </div>
      <div class="form-field">
        <label class="form-label">Password <span style="color:var(--text-3);font-size:10px;text-transform:none">(min 6 chars)</span></label>
        <input class="input" id="reg-pw" type="password" placeholder="••••••••" autocomplete="new-password">
      </div>
      <div class="form-field">
        <label class="form-label">Main Platform</label>
        <select class="input" id="reg-platform">
          <option value="">Select platform</option>
          <option value="PC">PC</option>
          <option value="PlayStation">PlayStation</option>
          <option value="Xbox">Xbox</option>
          <option value="Nintendo Switch">Nintendo Switch</option>
          <option value="Mobile">Mobile</option>
          <option value="Multi-platform">Multi-platform</option>
        </select>
      </div>
      <button class="btn btn-primary w-full mt" id="reg-btn" style="justify-content:center">
        <i class="bi bi-person-plus"></i> Create Account
      </button>
      <div class="auth-switch">Already have an account? <a id="goto-login">Sign in</a></div>
    </div>
  `
  el.querySelector('#goto-login').addEventListener('click', () => showLogin(el))
  el.querySelector('#reg-btn').addEventListener('click', () => doRegister(el))
  el.querySelectorAll('.input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(el) }))
}

async function doRegister(el) {
  const username = el.querySelector('#reg-user').value.trim()
  const email    = el.querySelector('#reg-email').value.trim()
  const password = el.querySelector('#reg-pw').value
  const platform = el.querySelector('#reg-platform').value
  const errEl    = el.querySelector('#auth-error')
  const btn      = el.querySelector('#reg-btn')

  errEl.classList.add('hidden')
  if (!username || !email || !password) { showErr(errEl, 'Fill in all fields'); return }
  if (password.length < 6) { showErr(errEl, 'Password must be at least 6 characters'); return }

  btn.disabled = true
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div>'

  try {
    const { user } = await api.post('/auth/register', { username, email, password, platform })
    onLogin(user)
  } catch (e) {
    showErr(errEl, e.message || 'Registration failed')
    btn.disabled = false
    btn.innerHTML = '<i class="bi bi-person-plus"></i> Create Account'
  }
}

function showErr(el, msg) {
  el.textContent = msg
  el.classList.remove('hidden')
}
