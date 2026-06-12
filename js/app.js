import { initAuth, session, signOut } from "./auth.js";
import { initJobs, getJobs, renderBoard, renderJobDetail, showJobForm, setCustomers } from "./jobs.js";
import { initCustomers, getCustomers, renderCustomerList, renderCustomerDetail } from "./customers.js";
import { initNotifications, renderNotifications } from "./notifications.js";

let _unsubJobs = null;
let _unsubCustomers = null;
let _unsubNotifs = null;
let _currentView = "board";
let _selectedJob = null;
let _selectedCustomer = null;

// ── App entry point ───────────────────────────────────────────────────────────
initAuth(onLogin);

function onLogin() {
  renderNav();

  _unsubJobs = initJobs((jobs) => {
    setCustomers(getCustomers());
    if (_currentView === "board") refreshBoard();
    if (_currentView === "job" && _selectedJob) {
      const updated = jobs.find(j => j.id === _selectedJob.id);
      if (updated) { _selectedJob = updated; refreshJobDetail(); }
    }
  });

  _unsubCustomers = initCustomers((customers) => {
    setCustomers(customers);
    if (_currentView === "customers") refreshCustomers();
  });

  _unsubNotifs = initNotifications((unread) => {
    const badge = document.getElementById("notif-badge");
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? "" : "none";
    }
  });

  navigateTo("board");
}

// ── Navigation ────────────────────────────────────────────────────────────────
function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = `
    <div class="nav-brand">
      <span class="nav-logo">AE</span>
      <span class="nav-title">Production</span>
    </div>
    <div class="nav-links">
      <button class="nav-btn active" data-view="board">Board</button>
      ${session.isAdmin ? `<button class="nav-btn" data-view="customers">Customers</button>` : ""}
      <button class="nav-btn notif-nav" data-view="notifications">
        Notifications
        <span class="notif-badge" id="notif-badge" style="display:none">0</span>
      </button>
    </div>
    <div class="nav-right">
      <span class="nav-user">${session.user}</span>
      ${session.isAdmin ? `<button class="btn btn-primary btn-sm" id="new-job-btn">+ New Job</button>` : ""}
      <button class="nav-btn" id="sign-out-btn">Sign out</button>
    </div>
  `;

  nav.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  document.getElementById("new-job-btn")?.addEventListener("click", () => {
    showJobForm(null, () => {});
  });

  document.getElementById("sign-out-btn").addEventListener("click", () => {
    cleanup();
    signOut();
  });
}

function setActiveNav(view) {
  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

function navigateTo(view, data = null) {
  _currentView = view;
  setActiveNav(view);

  const main = document.getElementById("main");

  if (view === "board") {
    _selectedJob = null;
    main.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Production Board</h1>
      </div>
      <div id="board-container"></div>
    `;
    refreshBoard();
  }

  else if (view === "job" && data) {
    _selectedJob = data;
    main.innerHTML = `
      <div class="page-header">
        <button class="back-link" id="back-to-board">← Board</button>
      </div>
      <div id="job-detail-container"></div>
    `;
    document.getElementById("back-to-board").addEventListener("click", () => navigateTo("board"));
    refreshJobDetail();
  }

  else if (view === "customers") {
    _selectedCustomer = null;
    main.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Customers</h1>
      </div>
      <div id="customers-container"></div>
    `;
    refreshCustomers();
  }

  else if (view === "customer-detail" && data) {
    _selectedCustomer = data.customer;
    const jobs = data.jobs;
    main.innerHTML = `
      <div class="page-header">
        <button class="back-link" id="back-to-customers">← Customers</button>
      </div>
      <div id="customer-detail-container"></div>
    `;
    document.getElementById("back-to-customers").addEventListener("click", () => navigateTo("customers"));
    renderCustomerDetail(_selectedCustomer, jobs, document.getElementById("customer-detail-container"));
  }

  else if (view === "notifications") {
    main.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Notifications</h1>
      </div>
      <div id="notifs-container"></div>
    `;
    renderNotifications(document.getElementById("notifs-container"));
  }
}

function refreshBoard() {
  const container = document.getElementById("board-container");
  if (!container) return;
  renderBoard(getJobs(), container, (job) => navigateTo("job", job));
}

function refreshJobDetail() {
  const container = document.getElementById("job-detail-container");
  if (!container || !_selectedJob) return;
  renderJobDetail(_selectedJob, container, () => {
    const updated = getJobs().find(j => j.id === _selectedJob.id);
    if (updated) { _selectedJob = updated; refreshJobDetail(); }
    else navigateTo("board");
  });
}

function refreshCustomers() {
  const container = document.getElementById("customers-container");
  if (!container) return;
  renderCustomerList(getCustomers(), getJobs(), container, (customer, jobs) => {
    navigateTo("customer-detail", { customer, jobs });
  });
}

function cleanup() {
  _unsubJobs?.();
  _unsubCustomers?.();
  _unsubNotifs?.();
}
