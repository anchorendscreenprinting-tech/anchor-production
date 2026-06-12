import { PINS, ADMINS } from "./config.js";

export const session = { user: null, isAdmin: false };

let _pinBuffer = "";
let _pendingUser = null;
let _onLogin = null;

export function initAuth(onLogin) {
  _onLogin = onLogin;
  renderUserSelect();
}

function renderUserSelect() {
  const root = document.getElementById("auth-screen");
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">
        <span class="auth-logo-mark">AE</span>
        <span class="auth-logo-text">Production</span>
      </div>
      <p class="auth-prompt">Select your name to sign in</p>
      <div class="user-grid">
        ${Object.keys(PINS).map(name => `
          <button class="user-btn" data-user="${name}">
            <span class="user-avatar">${name[0]}</span>
            <span class="user-name">${name}</span>
            ${ADMINS.includes(name) ? '<span class="user-badge">Admin</span>' : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;
  root.querySelectorAll(".user-btn").forEach(btn => {
    btn.addEventListener("click", () => startPin(btn.dataset.user));
  });
}

function startPin(name) {
  _pendingUser = name;
  _pinBuffer = "";
  const root = document.getElementById("auth-screen");
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">
        <span class="auth-logo-mark">AE</span>
        <span class="auth-logo-text">Production</span>
      </div>
      <p class="auth-prompt">Enter PIN for <strong>${name}</strong></p>
      <div class="pin-dots" id="pin-dots">
        <span class="dot"></span><span class="dot"></span>
        <span class="dot"></span><span class="dot"></span>
      </div>
      <div class="pin-error" id="pin-error"></div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9,"←",0,"⌫"].map(k => `
          <button class="pin-key" data-key="${k}">${k}</button>
        `).join("")}
      </div>
      <button class="back-btn" id="pin-back">← Back</button>
    </div>
  `;
  root.querySelectorAll(".pin-key").forEach(btn => {
    btn.addEventListener("click", () => handlePinKey(btn.dataset.key));
  });
  document.getElementById("pin-back").addEventListener("click", renderUserSelect);
}

function handlePinKey(key) {
  if (key === "←" || key === "⌫") {
    _pinBuffer = _pinBuffer.slice(0, -1);
  } else {
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += key;
  }
  updateDots();
  if (_pinBuffer.length === 4) checkPin();
}

function updateDots() {
  const dots = document.querySelectorAll(".dot");
  dots.forEach((d, i) => d.classList.toggle("filled", i < _pinBuffer.length));
}

function checkPin() {
  if (_pinBuffer === PINS[_pendingUser]) {
    session.user = _pendingUser;
    session.isAdmin = ADMINS.includes(_pendingUser);
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-screen").classList.remove("hidden");
    _onLogin?.();
  } else {
    const err = document.getElementById("pin-error");
    err.textContent = "Incorrect PIN";
    document.querySelectorAll(".dot").forEach(d => d.classList.add("error"));
    setTimeout(() => {
      _pinBuffer = "";
      updateDots();
      err.textContent = "";
      document.querySelectorAll(".dot").forEach(d => d.classList.remove("error"));
    }, 1200);
  }
}

export function signOut() {
  session.user = null;
  session.isAdmin = false;
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  renderUserSelect();
}
