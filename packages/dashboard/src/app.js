/* ============================================================
   VibeKit Dashboard — Application Core
   Client-side routing, state, API client, page rendering
   ============================================================ */

// ─── Configuration ────────────────────────────────────────────
const CONFIG = {
  apiBase: window.VIBEKIT_API_BASE || '/api/v1',
  projectHeader: 'X-Project-ID',
};

// ─── Mock Data ────────────────────────────────────────────────
const MOCK = {
  projects: [
    { id: 'proj_7kX9mRtL', name: 'SaaS Starter', status: 'active', region: 'us-east-1', lastDeployed: '2025-05-14T10:23:00Z', framework: 'Next.js', planTier: 'pro' },
    { id: 'proj_Qw2Np8Fv', name: 'Mobile API', status: 'active', region: 'eu-west-1', lastDeployed: '2025-05-13T18:45:00Z', framework: 'Hono', planTier: 'free' },
    { id: 'proj_Bz4Kd1Ys', name: 'E-commerce Backend', status: 'deploying', region: 'us-west-2', lastDeployed: '2025-05-14T11:02:00Z', framework: 'Express', planTier: 'pro' },
    { id: 'proj_Xm6Hj3Wc', name: 'Blog Platform', status: 'stopped', region: 'ap-south-1', lastDeployed: '2025-04-28T09:15:00Z', framework: 'Astro', planTier: 'free' },
    { id: 'proj_Tn9Rf5Ae', name: 'Analytics Service', status: 'active', region: 'us-east-1', lastDeployed: '2025-05-12T14:30:00Z', framework: 'Fastify', planTier: 'business' },
    { id: 'proj_Lp1Gv7Ud', name: 'Auth Microservice', status: 'active', region: 'eu-central-1', lastDeployed: '2025-05-14T08:00:00Z', framework: 'Hono', planTier: 'pro' },
  ],
  users: [
    { id: 'usr_a1', email: 'alice@example.com', name: 'Alice Chen', role: 'admin', status: 'active', createdAt: '2025-01-12T08:00:00Z', lastLogin: '2025-05-14T09:12:00Z', sessions: 3 },
    { id: 'usr_b2', email: 'bob@acme.io', name: 'Bob Martinez', role: 'member', status: 'active', createdAt: '2025-02-05T14:30:00Z', lastLogin: '2025-05-14T10:45:00Z', sessions: 1 },
    { id: 'usr_c3', email: 'carol@startup.dev', name: 'Carol Williams', role: 'member', status: 'active', createdAt: '2025-03-18T11:00:00Z', lastLogin: '2025-05-13T16:20:00Z', sessions: 2 },
    { id: 'usr_d4', email: 'dave@corp.com', name: 'Dave Thompson', role: 'viewer', status: 'banned', createdAt: '2025-01-30T09:45:00Z', lastLogin: '2025-04-20T12:00:00Z', sessions: 0 },
    { id: 'usr_e5', email: 'eve@design.co', name: 'Eve Park', role: 'member', status: 'active', createdAt: '2025-04-02T16:15:00Z', lastLogin: '2025-05-14T07:30:00Z', sessions: 4 },
    { id: 'usr_f6', email: 'frank@dev.io', name: 'Frank Russo', role: 'admin', status: 'active', createdAt: '2025-01-05T10:00:00Z', lastLogin: '2025-05-14T11:00:00Z', sessions: 2 },
    { id: 'usr_g7', email: 'grace@test.com', name: 'Grace Liu', role: 'member', status: 'active', createdAt: '2025-04-28T13:20:00Z', lastLogin: '2025-05-12T09:00:00Z', sessions: 1 },
    { id: 'usr_h8', email: 'hank@example.org', name: 'Hank Dubois', role: 'viewer', status: 'active', createdAt: '2025-03-10T08:45:00Z', lastLogin: '2025-05-10T15:40:00Z', sessions: 0 },
  ],
  tables: [
    { name: 'users', rows: 1247, size: '2.4 MB', lastModified: '2025-05-14T10:00:00Z' },
    { name: 'sessions', rows: 8432, size: '12.1 MB', lastModified: '2025-05-14T11:05:00Z' },
    { name: 'products', rows: 356, size: '890 KB', lastModified: '2025-05-13T14:20:00Z' },
    { name: 'orders', rows: 2891, size: '5.7 MB', lastModified: '2025-05-14T09:30:00Z' },
    { name: 'audit_logs', rows: 45230, size: '67.3 MB', lastModified: '2025-05-14T11:10:00Z' },
    { name: 'migrations', rows: 14, size: '12 KB', lastModified: '2025-05-10T08:00:00Z' },
  ],
  files: [
    { name: 'uploads', type: 'folder', size: null, modified: '2025-05-14T10:00:00Z' },
    { name: 'avatars', type: 'folder', size: null, modified: '2025-05-13T16:00:00Z' },
    { name: 'documents', type: 'folder', size: null, modified: '2025-05-12T09:00:00Z' },
    { name: 'logo.png', type: 'image', size: '24 KB', modified: '2025-05-01T08:00:00Z' },
    { name: 'favicon.ico', type: 'file', size: '4 KB', modified: '2025-04-15T10:00:00Z' },
    { name: 'robots.txt', type: 'file', size: '1 KB', modified: '2025-03-20T12:00:00Z' },
    { name: 'backup-20250514.sql', type: 'file', size: '148 MB', modified: '2025-05-14T02:00:00Z' },
  ],
  deployments: [
    { id: 'dep_01', project: 'SaaS Starter', commit: 'a3f9c21', branch: 'main', status: 'success', duration: '47s', createdAt: '2025-05-14T10:23:00Z', author: 'Alice Chen' },
    { id: 'dep_02', project: 'E-commerce Backend', commit: 'b7d2e14', branch: 'main', status: 'in-progress', duration: '--', createdAt: '2025-05-14T11:02:00Z', author: 'Bob Martinez' },
    { id: 'dep_03', project: 'Mobile API', commit: 'e1c8a59', branch: 'feature/auth', status: 'success', duration: '32s', createdAt: '2025-05-13T18:45:00Z', author: 'Carol Williams' },
    { id: 'dep_04', project: 'Analytics Service', commit: '9f4b7d2', branch: 'main', status: 'failed', duration: '1m 12s', createdAt: '2025-05-13T15:30:00Z', author: 'Eve Park' },
    { id: 'dep_05', project: 'Auth Microservice', commit: 'c2a6f81', branch: 'main', status: 'success', duration: '28s', createdAt: '2025-05-14T08:00:00Z', author: 'Frank Russo' },
    { id: 'dep_06', project: 'Blog Platform', commit: '4d7e3b9', branch: 'staging', status: 'success', duration: '55s', createdAt: '2025-05-12T09:20:00Z', author: 'Grace Liu' },
    { id: 'dep_07', project: 'SaaS Starter', commit: '8a1f5c3', branch: 'main', status: 'failed', duration: '1m 45s', createdAt: '2025-05-12T07:10:00Z', author: 'Alice Chen' },
    { id: 'dep_08', project: 'Mobile API', commit: 'f6d9a42', branch: 'main', status: 'success', duration: '35s', createdAt: '2025-05-11T22:00:00Z', author: 'Hank Dubois' },
  ],
  apiKeys: [
    { id: 'key_1', name: 'Production', prefix: 'vk_live_7kX9...mRtL', createdAt: '2025-01-12T08:00:00Z', lastUsed: '2025-05-14T11:00:00Z' },
    { id: 'key_2', name: 'Development', prefix: 'vk_test_Qw2N...p8Fv', createdAt: '2025-02-20T10:30:00Z', lastUsed: '2025-05-14T09:15:00Z' },
    { id: 'key_3', name: 'CI/CD Pipeline', prefix: 'vk_live_Bz4K...d1Ys', createdAt: '2025-03-05T14:00:00Z', lastUsed: '2025-05-13T20:30:00Z' },
  ],
  activity: [
    { type: 'deploy', message: 'SaaS Starter deployed to production', time: '3 minutes ago' },
    { type: 'user', message: 'New user signed up: carol@startup.dev', time: '12 minutes ago' },
    { type: 'db', message: 'Migration #14 applied to production DB', time: '28 minutes ago' },
    { type: 'error', message: 'Build failed for Analytics Service (dep_04)', time: '1 hour ago' },
    { type: 'deploy', message: 'Auth Microservice deployed to production', time: '3 hours ago' },
    { type: 'user', message: 'User dave@corp.com banned by admin', time: '5 hours ago' },
    { type: 'db', message: 'Database backup completed (148 MB)', time: '9 hours ago' },
    { type: 'deploy', message: 'Blog Platform deployed to staging', time: '1 day ago' },
  ],
  buildLogs: [
    { time: '11:02:00', level: 'info', msg: 'Build started for E-commerce Backend' },
    { time: '11:02:01', level: 'info', msg: 'Cloning repository...' },
    { time: '11:02:04', level: 'info', msg: 'Installing dependencies (pnpm install)...' },
    { time: '11:02:18', level: 'success', msg: 'Dependencies installed (247 packages)' },
    { time: '11:02:19', level: 'info', msg: 'Running build script...' },
    { time: '11:02:22', level: 'info', msg: 'Compiling TypeScript...' },
    { time: '11:02:31', level: 'success', msg: 'Build completed successfully' },
    { time: '11:02:32', level: 'info', msg: 'Running database migrations...' },
    { time: '11:02:34', level: 'success', msg: 'Migrations applied (0 pending)' },
    { time: '11:02:35', level: 'info', msg: 'Deploying to us-west-2...' },
    { time: '11:02:40', level: 'info', msg: 'Health check pending...' },
    { time: '11:02:45', level: 'warning', msg: 'Health check attempt 1/3 - waiting...' },
    { time: '11:02:50', level: 'success', msg: 'Health check passed' },
    { time: '11:02:51', level: 'success', msg: 'Deployment complete. Live at https://ecom.vibekit.dev' },
  ],
  invoices: [
    { id: 'inv_001', date: '2025-05-01', amount: '$49.00', status: 'paid', plan: 'Pro' },
    { id: 'inv_002', date: '2025-04-01', amount: '$49.00', status: 'paid', plan: 'Pro' },
    { id: 'inv_003', date: '2025-03-01', amount: '$49.00', status: 'paid', plan: 'Pro' },
    { id: 'inv_004', date: '2025-02-01', amount: '$29.00', status: 'paid', plan: 'Starter' },
    { id: 'inv_005', date: '2025-01-01', amount: '$29.00', status: 'paid', plan: 'Starter' },
  ],
  migrations: [
    { id: 14, name: '014_add_audit_logs', appliedAt: '2025-05-14T10:00:00Z', status: 'applied' },
    { id: 13, name: '013_add_order_status_index', appliedAt: '2025-05-10T08:00:00Z', status: 'applied' },
    { id: 12, name: '012_create_products_table', appliedAt: '2025-05-05T12:00:00Z', status: 'applied' },
    { id: 11, name: '011_add_user_preferences', appliedAt: '2025-04-28T09:00:00Z', status: 'applied' },
    { id: 10, name: '010_create_orders_table', appliedAt: '2025-04-20T14:00:00Z', status: 'applied' },
  ],
};

// ─── Utilities ────────────────────────────────────────────────
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function formatDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

function timeAgo(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function statusBadge(status) {
  const map = {
    active: 'success', deploying: 'info', stopped: 'neutral',
    success: 'success', failed: 'error', 'in-progress': 'info',
    applied: 'success', pending: 'warning',
    paid: 'success', overdue: 'error',
    banned: 'error',
  };
  const cls = map[status] || 'neutral';
  return `<span class="badge badge-${cls}">${status}</span>`;
}

function statusDot(status) {
  const map = { active: 'online', deploying: 'warning', stopped: 'idle', healthy: 'online', degraded: 'warning', down: 'offline' };
  return `<span class="status-dot ${map[status] || 'idle'}"></span>`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    Toast.show('Copied to clipboard', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    Toast.show('Copied to clipboard', 'success');
  });
}

// ─── Toast System ─────────────────────────────────────────────
const Toast = {
  container: null,

  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  },

  show(message, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: '\u2713', error: '\u2717', info: '\u24D8', warning: '\u26A0' };
    el.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
    this.container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 200);
    }, duration);
  },
};

// ─── Modal System ─────────────────────────────────────────────
const Modal = {
  overlay: null,

  init() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = '<div class="modal" id="modal-content"></div>';
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  },

  open(title, bodyHtml, footerHtml = '') {
    const content = $('#modal-content');
    content.innerHTML = `
      <div class="modal-header">
        <h2>${escapeHtml(title)}</h2>
        <button class="modal-close" onclick="Modal.close()">\u2715</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    `;
    this.overlay.classList.add('open');
  },

  close() {
    this.overlay.classList.remove('open');
  },
};

// ─── API Client ───────────────────────────────────────────────
const API = {
  projectId: null,

  setProject(id) {
    this.projectId = id;
    localStorage.setItem('vibekit_project_id', id);
  },

  getProject() {
    if (!this.projectId) {
      this.projectId = localStorage.getItem('vibekit_project_id') || MOCK.projects[0].id;
    }
    return this.projectId;
  },

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.projectId) headers[CONFIG.projectHeader] = this.projectId;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${CONFIG.apiBase}${path}`, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (err) {
      console.warn(`API ${method} ${path} failed, using mock data:`, err.message);
      return null;
    }
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  delete(path) { return this.request('DELETE', path); },
};

// ─── Simple Canvas Charts ─────────────────────────────────────
const Charts = {
  line(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, right: 10, bottom: 28, left: 40 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const max = Math.max(...data.values) * 1.15;
    const min = 0;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (ch / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      // Labels
      ctx.fillStyle = '#555';
      ctx.font = '10px Outfit';
      ctx.textAlign = 'right';
      const val = max - (max / 4) * i;
      ctx.fillText(val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val).toString(), pad.left - 6, y + 3);
    }

    // X labels
    ctx.fillStyle = '#555';
    ctx.font = '10px Outfit';
    ctx.textAlign = 'center';
    data.labels.forEach((label, i) => {
      const x = pad.left + (cw / (data.labels.length - 1)) * i;
      ctx.fillText(label, x, h - 6);
    });

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
    gradient.addColorStop(0, 'rgba(0, 163, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 163, 255, 0.0)');

    ctx.beginPath();
    data.values.forEach((v, i) => {
      const x = pad.left + (cw / (data.values.length - 1)) * i;
      const y = pad.top + ch - ((v - min) / (max - min)) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + cw, pad.top + ch);
    ctx.lineTo(pad.left, pad.top + ch);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.values.forEach((v, i) => {
      const x = pad.left + (cw / (data.values.length - 1)) * i;
      const y = pad.top + ch - ((v - min) / (max - min)) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = options.color || '#00A3FF';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots
    data.values.forEach((v, i) => {
      const x = pad.left + (cw / (data.values.length - 1)) * i;
      const y = pad.top + ch - ((v - min) / (max - min)) * ch;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = options.color || '#00A3FF';
      ctx.fill();
    });
  },

  bar(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, right: 10, bottom: 28, left: 40 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    const max = Math.max(...data.values) * 1.15;

    ctx.clearRect(0, 0, w, h);

    const barWidth = (cw / data.values.length) * 0.6;
    const gap = (cw / data.values.length) * 0.4;

    data.values.forEach((v, i) => {
      const x = pad.left + (cw / data.values.length) * i + gap / 2;
      const barH = (v / max) * ch;
      const y = pad.top + ch - barH;

      ctx.fillStyle = options.color || '#00A3FF';
      ctx.beginPath();
      const r = 3;
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barWidth - r, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
      ctx.lineTo(x + barWidth, pad.top + ch);
      ctx.lineTo(x, pad.top + ch);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.fill();

      ctx.fillStyle = '#555';
      ctx.font = '10px Outfit';
      ctx.textAlign = 'center';
      ctx.fillText(data.labels[i], x + barWidth / 2, h - 6);
    });
  },
};

// ─── State ────────────────────────────────────────────────────
const State = {
  currentPage: 'dashboard',
  selectedProject: null,
  projectDetailTab: 'overview',
  dbTab: 'tables',
  settingsTab: 'account',
  userSearchQuery: '',
  userFilterRole: 'all',
  currentUserPage: 1,
  usersPerPage: 5,
};

// ─── Router ───────────────────────────────────────────────────
const Router = {
  routes: {},

  register(name, renderFn) {
    this.routes[name] = renderFn;
  },

  navigate(page, params = {}) {
    State.currentPage = page;
    Object.assign(State, params);
    window.location.hash = page;
    this.render();
    window.scrollTo(0, 0);
  },

  render() {
    const page = State.currentPage;
    const main = $('#app-main');
    if (!main) return;

    // Update active nav link
    $$('.nav-link').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    const renderFn = this.routes[page];
    if (renderFn) {
      main.innerHTML = renderFn();
      this.afterRender(page);
    } else {
      main.innerHTML = `<div class="empty-state"><div class="empty-icon">\u2753</div><h3>Page not found</h3><p>The page "${escapeHtml(page)}" does not exist.</p></div>`;
    }
  },

  afterRender(page) {
    // Initialize charts and event handlers after DOM updates
    if (page === 'dashboard') initDashboardCharts();
    if (page === 'database') initDatabasePage();
    if (page === 'deployments') initDeploymentsPage();
  },

  init() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    State.currentPage = hash;
    this.render();

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '') || 'dashboard';
      State.currentPage = h;
      this.render();
    });
  },
};

// ─── Page: Dashboard ──────────────────────────────────────────
function renderDashboard() {
  const project = MOCK.projects.find(p => p.id === API.getProject()) || MOCK.projects[0];

  return `
    <div class="project-id-banner">
      <div class="banner-title">\u26A1 Active Project</div>
      <div class="project-id-row">
        <span class="project-id-display">${escapeHtml(project.id)}</span>
        <button class="copy-btn" onclick="copyToClipboard('${project.id}')">
          \u2398 Copy ID
        </button>
        <span class="text-muted text-sm" style="margin-left: 8px;">${escapeHtml(project.name)}</span>
        <button class="btn btn-ghost btn-sm" style="margin-left: auto;" onclick="openProjectSwitcher()">Switch Project</button>
      </div>
      <div class="project-id-instructions">
        <code>
          <span class="comment"># Use with Claude Code / VibeKit CLI:</span>
          <span class="key">vibekit</span> link ${project.id}
          <br>
          <span class="comment"># Or set the header in API requests:</span>
          <span class="key">X-Project-ID:</span> ${project.id}
          <br>
          <span class="comment"># Or set environment variable:</span>
          <span class="key">VIBEKIT_PROJECT_ID</span>=${project.id}
        </code>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Projects</div>
        <div class="stat-value">${MOCK.projects.length}</div>
        <div class="stat-change positive">\u2191 2 this month</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Users</div>
        <div class="stat-value">${MOCK.users.filter(u => u.status === 'active').length.toLocaleString()}</div>
        <div class="stat-change positive">\u2191 12% from last week</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Storage Used</div>
        <div class="stat-value">2.4 <span style="font-size:0.9rem;color:var(--text-secondary)">GB</span></div>
        <div class="stat-change negative">\u2191 340 MB this week</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">API Requests</div>
        <div class="stat-value">48.2<span style="font-size:0.9rem;color:var(--text-secondary)">k</span></div>
        <div class="stat-change positive">\u2191 8% from yesterday</div>
      </div>
    </div>

    <div class="grid-2 mb-6">
      <div class="card">
        <div class="card-header">
          <span class="card-title">API Requests (7 days)</span>
        </div>
        <div class="chart-container">
          <canvas id="chart-requests"></canvas>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Active Users (7 days)</span>
        </div>
        <div class="chart-container">
          <canvas id="chart-users"></canvas>
        </div>
      </div>
    </div>

    <div class="grid-2 mb-6">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Activity</span>
          <button class="btn btn-ghost btn-sm">View All</button>
        </div>
        <div class="activity-feed">
          ${MOCK.activity.map(a => `
            <div class="activity-item">
              <div class="activity-icon ${a.type}">
                ${{ deploy: '\u2191', user: '\u2713', error: '\u2717', db: '\u2630' }[a.type] || '\u2022'}
              </div>
              <div class="activity-content">
                <div class="activity-title">${escapeHtml(a.message)}</div>
                <div class="activity-time">${a.time}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        <div class="card mb-4">
          <div class="card-header">
            <span class="card-title">System Health</span>
          </div>
          <div class="health-grid">
            <div class="health-item">
              ${statusDot('active')}
              <span class="label">API Server</span>
              <span class="value" style="color:var(--success)">Healthy</span>
            </div>
            <div class="health-item">
              ${statusDot('active')}
              <span class="label">Database</span>
              <span class="value" style="color:var(--success)">Healthy</span>
            </div>
            <div class="health-item">
              ${statusDot('deploying')}
              <span class="label">Build Queue</span>
              <span class="value" style="color:var(--warning)">1 in queue</span>
            </div>
            <div class="health-item">
              ${statusDot('active')}
              <span class="label">Storage</span>
              <span class="value" style="color:var(--success)">Healthy</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Quick Actions</span>
          </div>
          <div class="quick-actions">
            <div class="quick-action" onclick="Router.navigate('projects')">
              <div class="qa-icon" style="background:var(--accent-muted);color:var(--accent);">\u2b2d</div>
              <span class="qa-label">New Project</span>
            </div>
            <div class="quick-action" onclick="Router.navigate('deployments')">
              <div class="qa-icon" style="background:var(--success-muted);color:var(--success);">\u2191</div>
              <span class="qa-label">Deploy</span>
            </div>
            <div class="quick-action" onclick="Router.navigate('database')">
              <div class="qa-icon" style="background:var(--warning-muted);color:var(--warning);">\u2630</div>
              <span class="qa-label">SQL Query</span>
            </div>
            <div class="quick-action" onclick="Router.navigate('deployments')">
              <div class="qa-icon" style="background:var(--error-muted);color:var(--error);">\u2261</div>
              <span class="qa-label">View Logs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initDashboardCharts() {
  const reqCanvas = $('#chart-requests');
  const usrCanvas = $('#chart-users');
  if (reqCanvas) {
    Charts.line(reqCanvas, {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      values: [6200, 7800, 7100, 8400, 9200, 5400, 4800],
    });
  }
  if (usrCanvas) {
    Charts.bar(usrCanvas, {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      values: [320, 410, 380, 450, 520, 280, 190],
    }, { color: '#6C5CE7' });
  }
}

function openProjectSwitcher() {
  const body = MOCK.projects.map(p => `
    <div class="file-list-item" onclick="selectProject('${p.id}')">
      <div style="flex:1">
        <div class="font-medium">${escapeHtml(p.name)}</div>
        <div class="text-xs text-muted text-mono">${p.id}</div>
      </div>
      ${statusBadge(p.status)}
      ${p.id === API.getProject() ? '<span class="badge badge-info">current</span>' : ''}
    </div>
  `).join('');
  Modal.open('Switch Project', body);
}

function selectProject(id) {
  API.setProject(id);
  Modal.close();
  Toast.show(`Switched to project ${id}`, 'success');
  Router.render();
}

// ─── Page: Projects ───────────────────────────────────────────
function renderProjects() {
  if (State.selectedProject) return renderProjectDetail();

  return `
    <div class="page-header">
      <div>
        <h1>Projects</h1>
        <p>Manage your VibeKit projects</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="openCreateProjectModal()">+ New Project</button>
      </div>
    </div>

    <div class="grid-auto">
      ${MOCK.projects.map(p => `
        <div class="card card-clickable" onclick="State.selectedProject='${p.id}'; Router.render();">
          <div class="card-header">
            <span class="card-title">${escapeHtml(p.name)}</span>
            ${statusBadge(p.status)}
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">Project ID</span>
              <span class="text-mono text-sm">${p.id}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">Region</span>
              <span class="text-sm">${p.region}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">Framework</span>
              <span class="text-sm">${p.framework}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">Last Deploy</span>
              <span class="text-sm">${timeAgo(p.lastDeployed)}</span>
            </div>
          </div>
          <div style="margin-top:var(--space-4)">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); copyToClipboard('${p.id}')">Copy ID</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderProjectDetail() {
  const p = MOCK.projects.find(pr => pr.id === State.selectedProject);
  if (!p) { State.selectedProject = null; return renderProjects(); }
  const tab = State.projectDetailTab;

  let tabContent = '';
  if (tab === 'overview') {
    tabContent = `
      <div class="project-id-banner">
        <div class="banner-title">\u26A1 Project ID for Claude Code Integration</div>
        <div class="project-id-row">
          <span class="project-id-display">${p.id}</span>
          <button class="copy-btn" onclick="copyToClipboard('${p.id}')">\u2398 Copy ID</button>
        </div>
        <div class="project-id-instructions">
          <code>
            <span class="comment"># Link this project in your terminal:</span>
            <span class="key">vibekit</span> link ${p.id}
            <br><br>
            <span class="comment"># Or set as environment variable:</span>
            <span class="key">export VIBEKIT_PROJECT_ID</span>="${p.id}"
            <br><br>
            <span class="comment"># Or pass as HTTP header:</span>
            curl -H "<span class="key">X-Project-ID: ${p.id}</span>" https://api.vibekit.dev/v1/...
          </code>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h3 class="card-title mb-4">Project Info</h3>
          <div class="flex flex-col gap-3">
            ${[['Name', p.name], ['Status', p.status], ['Region', p.region], ['Framework', p.framework], ['Plan', p.planTier], ['Last Deploy', formatDateTime(p.lastDeployed)]].map(([k, v]) => `
              <div class="flex items-center justify-between" style="padding:var(--space-2) 0;border-bottom:1px solid var(--border)">
                <span class="text-sm text-muted">${k}</span>
                <span class="text-sm font-medium">${escapeHtml(String(v))}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="card">
          <h3 class="card-title mb-4">Quick Stats</h3>
          <div class="flex flex-col gap-3">
            <div class="usage-meter">
              <div class="meter-header"><span class="meter-label">Storage</span><span class="meter-value">1.2 / 5.0 GB</span></div>
              <div class="usage-bar"><div class="usage-bar-fill" style="width:24%"></div></div>
            </div>
            <div class="usage-meter">
              <div class="meter-header"><span class="meter-label">Bandwidth</span><span class="meter-value">8.4 / 100 GB</span></div>
              <div class="usage-bar"><div class="usage-bar-fill" style="width:8.4%"></div></div>
            </div>
            <div class="usage-meter">
              <div class="meter-header"><span class="meter-label">API Requests</span><span class="meter-value">48,200 / 100,000</span></div>
              <div class="usage-bar"><div class="usage-bar-fill" style="width:48.2%"></div></div>
            </div>
            <div class="usage-meter">
              <div class="meter-header"><span class="meter-label">DB Rows</span><span class="meter-value">58,156 / 500,000</span></div>
              <div class="usage-bar"><div class="usage-bar-fill" style="width:11.6%"></div></div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (tab === 'settings') {
    tabContent = `
      <div class="settings-section">
        <h3>General Settings</h3>
        <div class="form-group"><label>Project Name</label><input type="text" value="${escapeHtml(p.name)}"></div>
        <div class="form-row">
          <div class="form-group"><label>Region</label><select><option ${p.region === 'us-east-1' ? 'selected' : ''}>us-east-1</option><option ${p.region === 'us-west-2' ? 'selected' : ''}>us-west-2</option><option ${p.region === 'eu-west-1' ? 'selected' : ''}>eu-west-1</option><option ${p.region === 'eu-central-1' ? 'selected' : ''}>eu-central-1</option><option ${p.region === 'ap-south-1' ? 'selected' : ''}>ap-south-1</option></select></div>
          <div class="form-group"><label>Framework</label><input type="text" value="${escapeHtml(p.framework)}" readonly></div>
        </div>
        <button class="btn btn-primary">Save Changes</button>
      </div>
    `;
  } else if (tab === 'environment') {
    tabContent = `
      <div class="settings-section">
        <h3>Environment Variables</h3>
        <p class="text-sm text-muted mb-4">These variables are injected at build and runtime.</p>
        ${[['DATABASE_URL', 'postgresql://...', 'production'], ['VIBEKIT_SECRET', 'vk_sec_...', 'all'], ['NODE_ENV', 'production', 'production'], ['SMTP_HOST', 'smtp.sendgrid.net', 'all']].map(([k, v, env]) => `
          <div class="settings-row">
            <div>
              <div class="text-mono text-sm font-medium">${k}</div>
              <div class="text-xs text-muted">${env}</div>
            </div>
            <div class="flex gap-2">
              <span class="api-key-value">${v}</span>
              <button class="btn btn-ghost btn-sm" onclick="Toast.show('Edit not available in demo', 'info')">Edit</button>
            </div>
          </div>
        `).join('')}
        <button class="btn btn-secondary mt-4" onclick="Toast.show('Feature coming soon', 'info')">+ Add Variable</button>
      </div>
    `;
  } else if (tab === 'deployments') {
    const deps = MOCK.deployments.filter(d => d.project === p.name);
    tabContent = `
      <div class="table-container">
        <div class="table-header">
          <h3>Deployment History</h3>
          <button class="btn btn-primary btn-sm" onclick="Toast.show('Deployment triggered', 'success')">Deploy Now</button>
        </div>
        <table>
          <thead><tr><th>Commit</th><th>Branch</th><th>Status</th><th>Duration</th><th>Time</th><th>Author</th></tr></thead>
          <tbody>
            ${deps.length ? deps.map(d => `<tr>
              <td class="text-mono">${d.commit}</td>
              <td>${escapeHtml(d.branch)}</td>
              <td>${statusBadge(d.status)}</td>
              <td>${d.duration}</td>
              <td>${timeAgo(d.createdAt)}</td>
              <td>${escapeHtml(d.author)}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:var(--space-8)">No deployments yet</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } else if (tab === 'danger') {
    tabContent = `
      <div class="danger-zone">
        <h3>\u26A0 Danger Zone</h3>
        <div class="danger-item">
          <div>
            <div class="font-medium">Transfer Project</div>
            <div class="text-sm text-muted">Transfer this project to another account</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="Toast.show('Transfer not available in demo', 'info')">Transfer</button>
        </div>
        <div class="danger-item">
          <div>
            <div class="font-medium">Pause Project</div>
            <div class="text-sm text-muted">Temporarily stop all services for this project</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="Toast.show('Project paused (demo)', 'warning')">Pause</button>
        </div>
        <div class="danger-item">
          <div>
            <div class="font-medium">Delete Project</div>
            <div class="text-sm text-muted">Permanently delete this project and all its data</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="Toast.show('Cannot delete in demo mode', 'error')">Delete Project</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="page-header">
      <div class="flex items-center gap-3">
        <button class="btn btn-ghost" onclick="State.selectedProject=null; Router.render();">\u2190 Back</button>
        <div>
          <h1>${escapeHtml(p.name)}</h1>
          <p class="text-mono text-sm">${p.id}</p>
        </div>
        ${statusBadge(p.status)}
      </div>
      <div class="page-actions">
        <button class="copy-btn" onclick="copyToClipboard('${p.id}')">\u2398 Copy Project ID</button>
        <button class="btn btn-primary" onclick="API.setProject('${p.id}'); Toast.show('Project set as active', 'success'); Router.navigate('dashboard');">Set as Active</button>
      </div>
    </div>

    <div class="tabs">
      ${['overview', 'settings', 'environment', 'deployments', 'danger'].map(t => `
        <div class="tab ${tab === t ? 'active' : ''}" onclick="State.projectDetailTab='${t}'; Router.render();">
          ${t === 'danger' ? 'Danger Zone' : t.charAt(0).toUpperCase() + t.slice(1)}
        </div>
      `).join('')}
    </div>

    ${tabContent}
  `;
}

function openCreateProjectModal() {
  Modal.open('Create New Project', `
    <div class="form-group">
      <label>Project Name</label>
      <input type="text" id="new-project-name" placeholder="my-awesome-project">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Region</label>
        <select id="new-project-region">
          <option value="us-east-1">US East (Virginia)</option>
          <option value="us-west-2">US West (Oregon)</option>
          <option value="eu-west-1">EU West (Ireland)</option>
          <option value="eu-central-1">EU Central (Frankfurt)</option>
          <option value="ap-south-1">Asia Pacific (Mumbai)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Framework</label>
        <select id="new-project-framework">
          <option value="Hono">Hono</option>
          <option value="Express">Express</option>
          <option value="Fastify">Fastify</option>
          <option value="Next.js">Next.js</option>
          <option value="Astro">Astro</option>
        </select>
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="createProject()">Create Project</button>
  `);
}

function createProject() {
  const name = $('#new-project-name')?.value;
  if (!name) { Toast.show('Project name is required', 'error'); return; }
  const id = 'proj_' + Math.random().toString(36).slice(2, 10);
  MOCK.projects.push({
    id, name, status: 'active',
    region: $('#new-project-region')?.value || 'us-east-1',
    framework: $('#new-project-framework')?.value || 'Hono',
    lastDeployed: null, planTier: 'free',
  });
  Modal.close();
  Toast.show(`Project "${name}" created with ID ${id}`, 'success');
  Router.render();
}

// ─── Page: Database ───────────────────────────────────────────
function renderDatabase() {
  const tab = State.dbTab;

  let tabContent = '';
  if (tab === 'tables') {
    tabContent = `
      <div class="table-container">
        <div class="table-header">
          <h3>Tables</h3>
          <div class="filter-group">
            <div class="search-bar">
              <span class="search-icon">\u2315</span>
              <input type="text" placeholder="Search tables...">
            </div>
          </div>
        </div>
        <table>
          <thead><tr><th>Table Name</th><th>Rows</th><th>Size</th><th>Last Modified</th><th></th></tr></thead>
          <tbody>
            ${MOCK.tables.map(t => `
              <tr>
                <td><span class="text-mono font-medium">${t.name}</span></td>
                <td>${t.rows.toLocaleString()}</td>
                <td>${t.size}</td>
                <td>${timeAgo(t.lastModified)}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="Toast.show('Table browser coming soon', 'info')">Browse</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card mt-6">
        <div class="card-header">
          <span class="card-title">Database Health</span>
        </div>
        <div class="health-grid">
          <div class="health-item">${statusDot('active')}<span class="label">Connection Pool</span><span class="value" style="color:var(--success)">12/20 active</span></div>
          <div class="health-item">${statusDot('active')}<span class="label">Replication</span><span class="value" style="color:var(--success)">In sync</span></div>
          <div class="health-item">${statusDot('active')}<span class="label">Uptime</span><span class="value">99.99%</span></div>
          <div class="health-item">${statusDot('active')}<span class="label">Size</span><span class="value">88.5 MB</span></div>
        </div>
      </div>
    `;
  } else if (tab === 'query') {
    tabContent = `
      <div class="code-editor">
        <div class="code-editor-header">
          <span class="file-name">SQL Query Editor</span>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sql-input').value = 'SELECT * FROM users LIMIT 10;'">Example</button>
            <button class="btn btn-primary btn-sm" id="run-query-btn" onclick="runMockQuery()">Run Query</button>
          </div>
        </div>
        <textarea id="sql-input" class="code-textarea" placeholder="SELECT * FROM users WHERE status = 'active' LIMIT 10;"
          spellcheck="false">SELECT id, email, name, role, status FROM users WHERE status = 'active' ORDER BY created_at DESC LIMIT 5;</textarea>
        <div id="sql-output" class="code-output" style="display:none;"></div>
      </div>
    `;
  } else if (tab === 'migrations') {
    tabContent = `
      <div class="table-container">
        <div class="table-header">
          <h3>Migration History</h3>
          <button class="btn btn-primary btn-sm" onclick="Toast.show('Run migration not available in demo', 'info')">Run Migration</button>
        </div>
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Applied At</th><th>Status</th></tr></thead>
          <tbody>
            ${MOCK.migrations.map(m => `
              <tr>
                <td class="text-mono">${m.id}</td>
                <td class="text-mono">${m.name}</td>
                <td>${formatDateTime(m.appliedAt)}</td>
                <td>${statusBadge(m.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="page-header">
      <div>
        <h1>Database</h1>
        <p>Browse tables, run queries, and manage migrations</p>
      </div>
    </div>

    <div class="tabs">
      ${[['tables', 'Tables'], ['query', 'SQL Editor'], ['migrations', 'Migrations']].map(([k, v]) => `
        <div class="tab ${tab === k ? 'active' : ''}" onclick="State.dbTab='${k}'; Router.render();">${v}</div>
      `).join('')}
    </div>

    ${tabContent}
  `;
}

function initDatabasePage() {
  // Keyboard shortcut for running queries
  const sqlInput = $('#sql-input');
  if (sqlInput) {
    sqlInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        runMockQuery();
      }
    });
  }
}

function runMockQuery() {
  const output = $('#sql-output');
  if (!output) return;
  output.style.display = 'block';
  output.textContent = 'Running query...\n';

  setTimeout(() => {
    const results = [
      { id: 'usr_a1', email: 'alice@example.com', name: 'Alice Chen', role: 'admin', status: 'active' },
      { id: 'usr_b2', email: 'bob@acme.io', name: 'Bob Martinez', role: 'member', status: 'active' },
      { id: 'usr_c3', email: 'carol@startup.dev', name: 'Carol Williams', role: 'member', status: 'active' },
      { id: 'usr_e5', email: 'eve@design.co', name: 'Eve Park', role: 'member', status: 'active' },
      { id: 'usr_f6', email: 'frank@dev.io', name: 'Frank Russo', role: 'admin', status: 'active' },
    ];
    const header = Object.keys(results[0]);
    const widths = header.map(h => Math.max(h.length, ...results.map(r => String(r[h]).length)));
    const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
    let table = header.map((h, i) => ` ${h.padEnd(widths[i])} `).join('|') + '\n';
    table += sep + '\n';
    results.forEach(r => {
      table += header.map((h, i) => ` ${String(r[h]).padEnd(widths[i])} `).join('|') + '\n';
    });
    table += `\n(5 rows returned in 12ms)`;
    output.textContent = table;
  }, 400);
}

// ─── Page: Auth/Users ─────────────────────────────────────────
function renderAuth() {
  const q = State.userSearchQuery.toLowerCase();
  const role = State.userFilterRole;
  let filtered = MOCK.users;
  if (q) filtered = filtered.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  if (role !== 'all') filtered = filtered.filter(u => u.role === role);

  const total = filtered.length;
  const pages = Math.ceil(total / State.usersPerPage);
  const page = Math.min(State.currentUserPage, pages || 1);
  const start = (page - 1) * State.usersPerPage;
  const pageUsers = filtered.slice(start, start + State.usersPerPage);

  return `
    <div class="page-header">
      <div>
        <h1>Users & Auth</h1>
        <p>Manage user accounts, roles, and sessions</p>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <div class="search-bar">
          <span class="search-icon">\u2315</span>
          <input type="text" placeholder="Search users..." value="${escapeHtml(State.userSearchQuery)}"
            oninput="State.userSearchQuery=this.value; State.currentUserPage=1; Router.render();">
        </div>
        <div class="filter-group">
          <select onchange="State.userFilterRole=this.value; State.currentUserPage=1; Router.render();">
            <option value="all" ${role === 'all' ? 'selected' : ''}>All Roles</option>
            <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="member" ${role === 'member' ? 'selected' : ''}>Member</option>
            <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option>
          </select>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>User</th><th>Role</th><th>Status</th><th>Sessions</th><th>Last Login</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${pageUsers.map(u => `
            <tr>
              <td>
                <div class="flex items-center gap-3">
                  <div class="nav-avatar" style="width:28px;height:28px;font-size:0.7rem;">${u.name.split(' ').map(n => n[0]).join('')}</div>
                  <div>
                    <div class="font-medium">${escapeHtml(u.name)}</div>
                    <div class="text-xs text-muted">${escapeHtml(u.email)}</div>
                  </div>
                </div>
              </td>
              <td>${statusBadge(u.role === 'admin' ? 'active' : u.role === 'viewer' ? 'stopped' : 'deploying').replace(/>.*</, `>${u.role}<`)}</td>
              <td>${statusBadge(u.status)}</td>
              <td>${u.sessions}</td>
              <td>${timeAgo(u.lastLogin)}</td>
              <td>
                <div class="flex gap-2">
                  <button class="btn btn-ghost btn-sm" onclick="openUserDetail('${u.id}')">View</button>
                  ${u.status === 'banned'
                    ? `<button class="btn btn-sm btn-secondary" onclick="toggleBan('${u.id}')">Unban</button>`
                    : `<button class="btn btn-sm btn-ghost" style="color:var(--error)" onclick="toggleBan('${u.id}')">Ban</button>`
                  }
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="pagination">
        <span class="pagination-info">Showing ${start + 1}-${Math.min(start + State.usersPerPage, total)} of ${total} users</span>
        <div class="pagination-controls">
          <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="State.currentUserPage=${page - 1}; Router.render();">\u2039</button>
          ${Array.from({ length: pages }, (_, i) => `
            <button class="pagination-btn ${i + 1 === page ? 'active' : ''}" onclick="State.currentUserPage=${i + 1}; Router.render();">${i + 1}</button>
          `).join('')}
          <button class="pagination-btn" ${page >= pages ? 'disabled' : ''} onclick="State.currentUserPage=${page + 1}; Router.render();">\u203A</button>
        </div>
      </div>
    </div>
  `;
}

function openUserDetail(id) {
  const u = MOCK.users.find(usr => usr.id === id);
  if (!u) return;
  Modal.open(`User: ${u.name}`, `
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-4 mb-4">
        <div class="nav-avatar" style="width:48px;height:48px;font-size:1.1rem;">${u.name.split(' ').map(n => n[0]).join('')}</div>
        <div>
          <div class="font-semibold" style="font-size:1.05rem;">${escapeHtml(u.name)}</div>
          <div class="text-sm text-muted">${escapeHtml(u.email)}</div>
        </div>
        ${statusBadge(u.status)}
      </div>

      <div class="settings-section" style="margin-bottom:0;">
        <h3 style="font-size:0.9rem;">Details</h3>
        ${[['User ID', u.id], ['Role', u.role], ['Created', formatDate(u.createdAt)], ['Last Login', formatDateTime(u.lastLogin)], ['Active Sessions', u.sessions]].map(([k, v]) => `
          <div class="settings-row">
            <span class="text-sm text-muted">${k}</span>
            <span class="text-sm text-mono">${v}</span>
          </div>
        `).join('')}
      </div>

      <div class="settings-section" style="margin-bottom:0;">
        <h3 style="font-size:0.9rem;">Audit Log</h3>
        <div class="activity-feed">
          <div class="activity-item"><div class="activity-icon user">\u2713</div><div class="activity-content"><div class="activity-title">Logged in from Chrome / macOS</div><div class="activity-time">${timeAgo(u.lastLogin)}</div></div></div>
          <div class="activity-item"><div class="activity-icon deploy">\u2191</div><div class="activity-content"><div class="activity-title">Updated profile settings</div><div class="activity-time">2 days ago</div></div></div>
          <div class="activity-item"><div class="activity-icon user">\u2713</div><div class="activity-content"><div class="activity-title">Password reset requested</div><div class="activity-time">5 days ago</div></div></div>
        </div>
      </div>
    </div>
  `);
}

function toggleBan(id) {
  const u = MOCK.users.find(usr => usr.id === id);
  if (!u) return;
  u.status = u.status === 'banned' ? 'active' : 'banned';
  Toast.show(`User ${u.name} ${u.status === 'banned' ? 'banned' : 'unbanned'}`, u.status === 'banned' ? 'warning' : 'success');
  Router.render();
}

// ─── Page: Storage ────────────────────────────────────────────
function renderStorage() {
  return `
    <div class="page-header">
      <div>
        <h1>Storage</h1>
        <p>Manage files, uploads, and storage usage</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="Toast.show('Upload not available in demo', 'info')">Upload File</button>
      </div>
    </div>

    <div class="stats-grid" style="margin-bottom:var(--space-6);">
      <div class="stat-card">
        <div class="stat-label">Total Storage</div>
        <div class="stat-value">2.4 <span style="font-size:0.9rem;color:var(--text-secondary)">GB</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Files</div>
        <div class="stat-value">1,247</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Bandwidth (30d)</div>
        <div class="stat-value">8.4 <span style="font-size:0.9rem;color:var(--text-secondary)">GB</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Storage Limit</div>
        <div class="stat-value">10 <span style="font-size:0.9rem;color:var(--text-secondary)">GB</span></div>
      </div>
    </div>

    <div class="usage-meter mb-6">
      <div class="meter-header"><span class="meter-label">Storage Usage</span><span class="meter-value">2.4 / 10.0 GB (24%)</span></div>
      <div class="usage-bar"><div class="usage-bar-fill" style="width:24%"></div></div>
    </div>

    <div class="grid-2">
      <div>
        <div class="file-browser">
          <div class="file-path-bar">
            <span class="file-path-segment" onclick="Toast.show('Navigation demo', 'info')">root</span>
            <span>/</span>
          </div>
          ${MOCK.files.map(f => `
            <div class="file-list-item" onclick="${f.type === 'folder' ? `Toast.show('Navigated to /${f.name}', 'info')` : `previewFile('${f.name}')`}">
              <span class="file-icon ${f.type === 'folder' ? 'folder' : f.type === 'image' ? 'image' : ''}">${f.type === 'folder' ? '\uD83D\uDCC1' : f.type === 'image' ? '\uD83D\uDDBC' : '\uD83D\uDCC4'}</span>
              <span class="file-name">${escapeHtml(f.name)}</span>
              <span class="file-size">${f.size || '--'}</span>
              <span class="file-date">${timeAgo(f.modified)}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div>
        <div class="dropzone" id="upload-dropzone">
          <div class="dropzone-icon">\u2191</div>
          <div class="dropzone-text">Drop files here to upload</div>
          <div class="dropzone-hint">or click to browse (max 50 MB per file)</div>
        </div>
        <div class="card mt-4" id="file-preview" style="display:none;">
          <div class="card-header">
            <span class="card-title">File Preview</span>
            <button class="btn btn-ghost btn-sm" onclick="$('#file-preview').style.display='none';">\u2715</button>
          </div>
          <div id="file-preview-content"></div>
        </div>
      </div>
    </div>
  `;
}

function previewFile(name) {
  const preview = $('#file-preview');
  const content = $('#file-preview-content');
  if (!preview || !content) return;
  preview.style.display = 'block';
  content.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="flex justify-between"><span class="text-sm text-muted">Name</span><span class="text-sm text-mono">${escapeHtml(name)}</span></div>
      <div class="flex justify-between"><span class="text-sm text-muted">Type</span><span class="text-sm">${name.split('.').pop().toUpperCase()}</span></div>
      <div class="flex justify-between"><span class="text-sm text-muted">Size</span><span class="text-sm">${MOCK.files.find(f => f.name === name)?.size || 'Unknown'}</span></div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-secondary btn-sm" onclick="Toast.show('Download not available in demo', 'info')">Download</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--error)" onclick="Toast.show('Delete not available in demo', 'error')">Delete</button>
      </div>
    </div>
  `;
}

// ─── Page: Deployments ────────────────────────────────────────
function renderDeployments() {
  return `
    <div class="page-header">
      <div>
        <h1>Deployments</h1>
        <p>Deploy, monitor, and roll back your services</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="Toast.show('Rollback not available in demo', 'info')">\u21BA Rollback</button>
        <button class="btn btn-primary" onclick="triggerDeploy()">Deploy Now</button>
      </div>
    </div>

    <div class="grid-2 mb-6">
      <div class="table-container">
        <div class="table-header">
          <h3>Deployment History</h3>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Project</th><th>Commit</th><th>Branch</th><th>Status</th><th>Duration</th><th>Time</th></tr></thead>
          <tbody>
            ${MOCK.deployments.map(d => `
              <tr onclick="showBuildLogs('${d.id}')" style="cursor:pointer;">
                <td class="text-mono text-xs">${d.id}</td>
                <td>${escapeHtml(d.project)}</td>
                <td class="text-mono">${d.commit}</td>
                <td>${escapeHtml(d.branch)}</td>
                <td>${statusBadge(d.status)}</td>
                <td>${d.duration}</td>
                <td>${timeAgo(d.createdAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div>
        <div class="card mb-4">
          <div class="card-header">
            <span class="card-title">Build Logs</span>
            <span class="badge badge-info" id="log-dep-id">dep_02</span>
          </div>
          <div class="log-viewer" id="build-log-viewer">
            ${MOCK.buildLogs.map(l => `
              <div class="log-line">
                <span class="timestamp">${l.time}</span>
                <span class="message ${l.level}">${escapeHtml(l.msg)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Deploy Stats</span></div>
          <div class="chart-container">
            <canvas id="chart-deploys"></canvas>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initDeploymentsPage() {
  const canvas = $('#chart-deploys');
  if (canvas) {
    Charts.bar(canvas, {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      values: [3, 5, 2, 7, 4, 1, 2],
    }, { color: '#00C853' });
  }
}

function triggerDeploy() {
  Toast.show('Deployment triggered for current project', 'success');
  const newDep = {
    id: 'dep_' + String(MOCK.deployments.length + 1).padStart(2, '0'),
    project: MOCK.projects.find(p => p.id === API.getProject())?.name || 'Unknown',
    commit: Math.random().toString(36).slice(2, 9),
    branch: 'main',
    status: 'in-progress',
    duration: '--',
    createdAt: new Date().toISOString(),
    author: 'You',
  };
  MOCK.deployments.unshift(newDep);
  Router.render();
}

function showBuildLogs(depId) {
  const label = $('#log-dep-id');
  if (label) label.textContent = depId;
  const viewer = $('#build-log-viewer');
  if (viewer) {
    viewer.innerHTML = MOCK.buildLogs.map(l => `
      <div class="log-line">
        <span class="timestamp">${l.time}</span>
        <span class="message ${l.level}">${escapeHtml(l.msg)}</span>
      </div>
    `).join('');
    viewer.scrollTop = viewer.scrollHeight;
  }
}

// ─── Page: Settings ───────────────────────────────────────────
function renderSettings() {
  const tab = State.settingsTab;

  let tabContent = '';
  if (tab === 'account') {
    tabContent = `
      <div class="settings-section">
        <h3>Account Settings</h3>
        <div class="form-group"><label>Display Name</label><input type="text" value="Alice Chen"></div>
        <div class="form-group"><label>Email</label><input type="email" value="alice@example.com"></div>
        <div class="form-group"><label>Timezone</label>
          <select>
            <option>America/New_York (UTC-5)</option>
            <option selected>America/Los_Angeles (UTC-8)</option>
            <option>Europe/London (UTC+0)</option>
            <option>Asia/Tokyo (UTC+9)</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="Toast.show('Settings saved', 'success')">Save Changes</button>
      </div>

      <div class="settings-section">
        <h3>Notifications</h3>
        ${[
          ['Deploy notifications', 'Get notified when deployments complete or fail', true],
          ['New user alerts', 'Receive alerts when new users sign up', true],
          ['Security alerts', 'Critical security notifications', true],
          ['Weekly digest', 'Weekly summary of project activity', false],
          ['Marketing emails', 'Product updates and announcements', false],
        ].map(([label, desc, on]) => `
          <div class="settings-row">
            <div>
              <div class="settings-label">${label}</div>
              <div class="settings-desc">${desc}</div>
            </div>
            <div class="toggle ${on ? 'on' : ''}" onclick="this.classList.toggle('on')"></div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (tab === 'apikeys') {
    tabContent = `
      <div class="settings-section">
        <h3>API Keys</h3>
        <p class="text-sm text-muted mb-4">Manage your API keys for programmatic access to VibeKit.</p>
        ${MOCK.apiKeys.map(k => `
          <div class="api-key-row">
            <div style="flex:1;">
              <div class="font-medium text-sm">${escapeHtml(k.name)}</div>
              <div class="text-xs text-muted">Created ${formatDate(k.createdAt)} \u2022 Last used ${timeAgo(k.lastUsed)}</div>
            </div>
            <span class="api-key-value">${escapeHtml(k.prefix)}</span>
            <button class="btn btn-ghost btn-sm" onclick="Toast.show('Reveal not available in demo', 'info')">Reveal</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--error)" onclick="Toast.show('Revoke not available in demo', 'error')">Revoke</button>
          </div>
        `).join('')}
        <button class="btn btn-secondary mt-4" onclick="Toast.show('Create key not available in demo', 'info')">+ Create New Key</button>
      </div>
    `;
  } else if (tab === 'billing') {
    tabContent = renderBilling();
  } else if (tab === 'permissions') {
    tabContent = `
      <div class="settings-section">
        <h3>Permissions & Roles</h3>
        <p class="text-sm text-muted mb-4">Configure role-based access control for your team.</p>
        ${[
          ['Admin', 'Full access to all resources and settings', 2],
          ['Member', 'Can manage projects, deploy, and access databases', 4],
          ['Viewer', 'Read-only access to projects and dashboards', 2],
        ].map(([role, desc, count]) => `
          <div class="settings-row">
            <div>
              <div class="settings-label font-medium">${role}</div>
              <div class="settings-desc">${desc}</div>
            </div>
            <div class="flex items-center gap-3">
              <span class="badge badge-neutral">${count} users</span>
              <button class="btn btn-ghost btn-sm" onclick="Toast.show('Edit role not available in demo', 'info')">Edit</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="page-header">
      <div>
        <h1>Settings</h1>
        <p>Manage your account, keys, billing, and permissions</p>
      </div>
    </div>

    <div class="tabs">
      ${[['account', 'Account'], ['apikeys', 'API Keys'], ['billing', 'Billing'], ['permissions', 'Permissions']].map(([k, v]) => `
        <div class="tab ${tab === k ? 'active' : ''}" onclick="State.settingsTab='${k}'; Router.render();">${v}</div>
      `).join('')}
    </div>

    ${tabContent}
  `;
}

// ─── Billing Section ──────────────────────────────────────────
function renderBilling() {
  return `
    <div class="settings-section">
      <h3>Current Plan</h3>
      <div class="plan-cards">
        <div class="plan-card">
          <div class="plan-name">Free</div>
          <div class="plan-price">$0 <span>/ month</span></div>
          <ul class="plan-features">
            <li>\u2713 1 Project</li>
            <li>\u2713 1 GB Storage</li>
            <li>\u2713 10,000 API Requests</li>
            <li>\u2713 Community Support</li>
          </ul>
          <button class="btn btn-secondary btn-sm" disabled>Downgrade</button>
        </div>
        <div class="plan-card current">
          <div class="plan-name">Pro</div>
          <div class="plan-price">$49 <span>/ month</span></div>
          <ul class="plan-features">
            <li>\u2713 10 Projects</li>
            <li>\u2713 10 GB Storage</li>
            <li>\u2713 100,000 API Requests</li>
            <li>\u2713 Priority Support</li>
            <li>\u2713 Custom Domains</li>
          </ul>
          <button class="btn btn-primary btn-sm">Current Plan</button>
        </div>
        <div class="plan-card">
          <div class="plan-name">Business</div>
          <div class="plan-price">$199 <span>/ month</span></div>
          <ul class="plan-features">
            <li>\u2713 Unlimited Projects</li>
            <li>\u2713 100 GB Storage</li>
            <li>\u2713 Unlimited API Requests</li>
            <li>\u2713 Dedicated Support</li>
            <li>\u2713 SLA Guarantee</li>
            <li>\u2713 SSO / SAML</li>
          </ul>
          <button class="btn btn-secondary btn-sm" onclick="Toast.show('Upgrade not available in demo', 'info')">Upgrade</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Usage This Billing Period</h3>
      <div class="flex flex-col gap-4">
        <div class="usage-meter">
          <div class="meter-header"><span class="meter-label">API Requests</span><span class="meter-value">48,200 / 100,000</span></div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:48.2%"></div></div>
        </div>
        <div class="usage-meter">
          <div class="meter-header"><span class="meter-label">Storage</span><span class="meter-value">2.4 / 10.0 GB</span></div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:24%"></div></div>
        </div>
        <div class="usage-meter">
          <div class="meter-header"><span class="meter-label">Bandwidth</span><span class="meter-value">8.4 / 100 GB</span></div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:8.4%"></div></div>
        </div>
        <div class="usage-meter">
          <div class="meter-header"><span class="meter-label">Database Rows</span><span class="meter-value">58,156 / 500,000</span></div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:11.6%"></div></div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Invoice History</h3>
      <table style="width:100%;">
        <thead><tr><th>Invoice</th><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${MOCK.invoices.map(inv => `
            <tr>
              <td class="text-mono text-sm">${inv.id}</td>
              <td>${formatDate(inv.date)}</td>
              <td>${inv.plan}</td>
              <td class="font-medium">${inv.amount}</td>
              <td>${statusBadge(inv.status)}</td>
              <td><button class="btn btn-ghost btn-sm" onclick="Toast.show('Download not available in demo', 'info')">PDF</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Register Routes ──────────────────────────────────────────
Router.register('dashboard', renderDashboard);
Router.register('projects', renderProjects);
Router.register('database', renderDatabase);
Router.register('auth', renderAuth);
Router.register('storage', renderStorage);
Router.register('deployments', renderDeployments);
Router.register('settings', renderSettings);

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Toast.init();
  Modal.init();
  API.getProject();
  Router.init();

  // Nav link clicks
  $$('.nav-link').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      // Reset sub-state when navigating
      State.selectedProject = null;
      State.projectDetailTab = 'overview';
      State.dbTab = 'tables';
      State.settingsTab = 'account';
      Router.navigate(page);
    });
  });

  // Responsive nav toggle
  const navToggle = $('#nav-toggle');
  const navLinks = $('#nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('nav-links-open');
    });
  }

  // Handle window resize for chart redraw
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      Router.afterRender(State.currentPage);
    }, 250);
  });
});
