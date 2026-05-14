import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  deleteDoc,
  onSnapshot,
  enableIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

'use strict';

const IMG_BB_API_KEY = 'e3d04bfe0caf2d378e1cce3d8d4407d6';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%236c3de8'/%3E%3Ccircle cx='20' cy='15' r='7' fill='white'/%3E%3Cellipse cx='20' cy='38' rx='12' ry='10' fill='white'/%3E%3C/svg%3E";
const FB_CONFIG = {
  apiKey: 'AIzaSyBzuJkT4Xi-GbLsyNZs7WSqQLPditJQ0Do',
  authDomain: 'finance-tracker-c85f8.firebaseapp.com',
  projectId: 'finance-tracker-c85f8',
  storageBucket: 'finance-tracker-c85f8.firebasestorage.app',
  messagingSenderId: '555889482457',
  appId: '1:555889482457:web:c2ce8e03694c38ce747cc8',
};

const CATEGORY_ICONS = {
  Food: 'fa-utensils',
  Shopping: 'fa-bag-shopping',
  Rent: 'fa-house',
  Fuel: 'fa-gas-pump',
  Health: 'fa-notes-medical',
  Education: 'fa-book-open',
  Entertainment: 'fa-film',
  Salary: 'fa-sack-dollar',
  Freelance: 'fa-laptop',
  Investment: 'fa-chart-line',
  Other: 'fa-layer-group',
  'Bank Savings': 'fa-building-columns',
};

let app;
let auth;
let db;
let fbReady = false;
let recordUnsub = null;
let profileUnsub = null;

let currentUser = null;
let records = [];
let currentProfile = {
  photoUrl: '',
  currency: localStorage.getItem('mb_currency') || '$',
  darkMode: localStorage.getItem('mb_dark') === 'true',
};

let activePage = 'dashboard';
let activePeriod = 'week';
let balanceHidden = false;
let deleteTargetId = '';
let editingRecordId = '';
let currentTxnType = 'add';
let currentTxnKind = 'moneybag';
let currentBankMode = 'deposit';
let currentBankModalAction = 'deposit';
let chartDonut = null;
let chartBar = null;
let chartLine = null;
let booted = false;

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function $(id) { return document.getElementById(id); }
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(amount) {
  const n = Number(amount) || 0;
  return `${currentProfile.currency}${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toLocalISO(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function showToast(message, duration = 2400) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), duration);
}

function openModal(id) { $(id)?.classList.add('open'); }
function closeModal(id) { $(id)?.classList.remove('open'); }
function hideLoading() { $('loading-overlay')?.classList.add('hidden'); }
function showLoading() { $('loading-overlay')?.classList.remove('hidden'); }

function setOnlineStatus(online) {
  const el = $('online-status');
  if (!el) return;
  el.className = `status-badge ${online ? 'online' : 'offline'}`;
  el.innerHTML = online
    ? '<i class="fa-solid fa-wifi"></i> Online'
    : '<i class="fa-solid fa-wifi-slash"></i> Offline';
}

function setSyncStatus(state) {
  const el = $('sync-status');
  if (!el) return;
  const states = {
    idle: ['sync-idle', '<i class="fa-solid fa-rotate"></i> Synced'],
    pending: ['sync-pending', '<i class="fa-solid fa-clock"></i> Pending'],
    syncing: ['syncing', '<i class="fa-solid fa-rotate fa-spin"></i> Syncing…'],
  };
  const [cls, html] = states[state] || states.idle;
  el.className = `status-badge ${cls}`;
  el.innerHTML = html;
}

function setElText(id, value) {
  const el = $(id);
  if (el) el.textContent = value ?? '';
}

function setImg(id, src) {
  const el = $(id);
  if (el) el.src = src || DEFAULT_AVATAR;
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentProfile.darkMode ? 'dark' : 'light');
  const icon = $('theme-icon');
  if (icon) icon.className = currentProfile.darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  const sw = $('theme-toggle-switch');
  if (sw) sw.classList.toggle('on', currentProfile.darkMode);
}

function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem('mb_records') || '[]');
    records = Array.isArray(cache) ? cache.map(normalizeRecord) : [];
  } catch {
    records = [];
  }
  try {
    const profile = JSON.parse(localStorage.getItem('mb_profile') || '{}');
    currentProfile = {
      photoUrl: profile.photoUrl || '',
      currency: profile.currency || currentProfile.currency,
      darkMode: typeof profile.darkMode === 'boolean' ? profile.darkMode : currentProfile.darkMode,
    };
  } catch {
    // ignore
  }
}

function saveCache() {
  localStorage.setItem('mb_records', JSON.stringify(records));
  localStorage.setItem('mb_profile', JSON.stringify(currentProfile));
  localStorage.setItem('mb_currency', currentProfile.currency);
  localStorage.setItem('mb_dark', String(currentProfile.darkMode));
}

function normalizeRecord(raw) {
  const r = { ...raw };
  r.id = r.id || uid();
  r.amount = Number(r.amount) || 0;
  r.type = r.type === 'spend' ? 'spend' : 'add';
  r.kind = r.kind || 'moneybag';
  r.category = r.category || (r.kind === 'bank' || r.kind === 'transfer_to_bank' || r.kind === 'transfer_from_bank' ? 'Bank Savings' : 'Other');
  r.title = r.title || defaultRecordTitle(r);
  r.note = r.note || '';
  r.createdAt = Number(r.createdAt) || Date.now();
  r.updatedAt = Number(r.updatedAt) || r.createdAt;
  r.deleted = !!r.deleted;
  return r;
}

function defaultRecordTitle(r) {
  if (r.kind === 'bank') return 'Bank Deposit';
  if (r.kind === 'transfer_to_bank') return 'Moneybag → Bank';
  if (r.kind === 'transfer_from_bank') return 'Bank → Moneybag';
  return r.type === 'spend' ? 'Expense' : 'Income';
}

function recordIcon(record) {
  if (record.kind === 'bank') return 'fa-building-columns';
  if (record.kind === 'transfer_to_bank') return 'fa-arrow-right-arrow-left';
  if (record.kind === 'transfer_from_bank') return 'fa-arrow-right-arrow-left';
  return CATEGORY_ICONS[record.category] || 'fa-layer-group';
}

function recordLabel(record) {
  if (record.kind === 'bank') return 'Bank Deposit';
  if (record.kind === 'transfer_to_bank') return 'Moneybag → Bank';
  if (record.kind === 'transfer_from_bank') return 'Bank → Moneybag';
  return record.category || 'Other';
}

function calcStats() {
  const active = records.filter((r) => !r.deleted);

  let moneybagIncome = 0;
  let moneybagSpent = 0;
  let bankBalance = 0;

  for (const r of active) {
    const amount = Number(r.amount) || 0;
    if (r.kind === 'moneybag') {
      if (r.type === 'add') moneybagIncome += amount;
      else moneybagSpent += amount;
    } else if (r.kind === 'bank') {
      bankBalance += amount;
    } else if (r.kind === 'transfer_to_bank') {
      moneybagSpent += amount;
      bankBalance += amount;
    } else if (r.kind === 'transfer_from_bank') {
      moneybagIncome += amount;
      bankBalance -= amount;
    }
  }

  const balance = moneybagIncome - moneybagSpent;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const moneybagOnly = active.filter((r) => r.kind === 'moneybag' || r.kind === 'transfer_to_bank' || r.kind === 'transfer_from_bank');

  const filter = (type, since) => moneybagOnly
    .filter((r) => r.type === type && new Date(r.createdAt) >= since)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return {
    balance,
    bankBalance,
    totalAdded: moneybagIncome,
    totalSpent: moneybagSpent,
    weeklyAdded: filter('add', weekStart),
    weeklySpent: filter('spend', weekStart),
    monthlyAdded: filter('add', monthStart),
    monthlySpent: filter('spend', monthStart),
  };
}

function moneybagAdd(value) {
  return value.kind === 'moneybag' && value.type === 'add';
}

function moneybagSpend(value) {
  return value.kind === 'moneybag' && value.type === 'spend';
}

function moneybagRelevant(value) {
  return value.kind === 'moneybag' || value.kind === 'transfer_to_bank' || value.kind === 'transfer_from_bank';
}

function renderProfileUI() {
  const name = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User';
  const photo = currentProfile.photoUrl || currentUser?.photoURL || DEFAULT_AVATAR;
  setElText('dash-username', name);
  setElText('dash-username-card', name);
  setElText('settings-username', name);
  setElText('settings-email', currentUser?.email || '');
  setImg('dash-avatar', photo);
  setImg('settings-avatar', photo);
  const curSel = $('currency-select');
  if (curSel && curSel.value !== currentProfile.currency) curSel.value = currentProfile.currency;
  applyTheme();
}

function renderDashboard() {
  const stats = calcStats();
  const hidden = balanceHidden;

  setElText('dash-balance', hidden ? '••••••' : fmt(stats.balance));
  setElText('dash-total-added', hidden ? '••••' : fmt(stats.totalAdded));
  setElText('dash-total-spent', hidden ? '••••' : fmt(stats.totalSpent));
  setElText('dash-weekly-savings', hidden ? '••••' : fmt(Math.max(0, stats.weeklyAdded - stats.weeklySpent)));
  setElText('dash-monthly-savings', hidden ? '••••' : fmt(Math.max(0, stats.monthlyAdded - stats.monthlySpent)));
  setElText('bank-balance', hidden ? '••••••' : fmt(stats.bankBalance));

  const wp = stats.weeklyAdded > 0 ? Math.min(100, (Math.max(0, stats.weeklyAdded - stats.weeklySpent) / stats.weeklyAdded) * 100) : 0;
  const mp = stats.monthlyAdded > 0 ? Math.min(100, (Math.max(0, stats.monthlyAdded - stats.monthlySpent) / stats.monthlyAdded) * 100) : 0;
  const pw = $('pw-savings'); if (pw) pw.style.width = `${wp}%`;
  const pm = $('pm-savings'); if (pm) pm.style.width = `${mp}%`;

  const recent = [...records]
    .filter((r) => !r.deleted)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);
  const list = $('dash-recent-list');
  if (list) list.innerHTML = recent.length ? recent.map(txnHTML).join('') : emptyHTML();
  renderInsights(stats);
}

function emptyHTML() {
  return '<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No transactions yet</p></div>';
}

function txnHTML(r) {
  const sign = r.type === 'spend' ? '-' : '+';
  const cls = r.type === 'spend' ? 'spend' : 'add';
  const leftClass = r.kind === 'bank' ? 'bank' : r.kind === 'transfer_to_bank' ? 'transfer-out' : r.kind === 'transfer_from_bank' ? 'transfer-in' : r.type;
  const showEdit = r.kind === 'moneybag';
  return `
    <div class="txn-item" data-id="${escHtml(r.id)}">
      <div class="txn-cat-icon type-${leftClass}"><i class="fa-solid ${recordIcon(r)}"></i></div>
      <div class="txn-info">
        <div class="txn-title">${escHtml(r.title || recordLabel(r))}</div>
        <div class="txn-meta">${escHtml(recordLabel(r))} · ${fmtDate(r.createdAt)}</div>
        ${r.note ? `<div class="txn-meta txn-note">${escHtml(r.note)}</div>` : ''}
      </div>
      <div class="txn-right">
        <div class="txn-amount ${cls}">${sign}${fmt(r.amount)}</div>
        <div class="txn-actions">
          ${showEdit ? `<button class="txn-act-btn edit" onclick="editRecord('${escHtml(r.id)}')"><i class="fa-solid fa-pen"></i></button>` : ''}
          <button class="txn-act-btn del" onclick="confirmDelete('${escHtml(r.id)}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
}

function renderInsights(stats) {
  const container = $('insights-container');
  if (!container) return;

  const tips = [];
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const thisWeekMoneybagSpends = records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend' && r.createdAt >= now - weekMs).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const lastWeekMoneybagSpends = records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend' && r.createdAt >= now - 2 * weekMs && r.createdAt < now - weekMs).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (lastWeekMoneybagSpends > 0) {
    const diff = thisWeekMoneybagSpends - lastWeekMoneybagSpends;
    if (diff > 0) tips.push(`You spent ${fmt(diff)} more this week than last week.`);
    else if (diff < 0) tips.push(`You spent ${fmt(-diff)} less this week than last week.`);
  }
  if (stats.monthlyAdded > stats.monthlySpent) tips.push(`Your monthly savings so far: ${fmt(stats.monthlyAdded - stats.monthlySpent)}.`);

  const spendByCategory = {};
  records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend').forEach((r) => {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + (Number(r.amount) || 0);
  });
  const top = Object.entries(spendByCategory).sort((a, b) => b[1] - a[1])[0];
  if (top) tips.push(`Biggest expense category: ${top[0]} (${fmt(top[1])}).`);

  const spends = records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend');
  const oldest = spends.length ? Math.min(...spends.map((r) => r.createdAt)) : NaN;
  if (Number.isFinite(oldest)) {
    const days = Math.max(1, Math.ceil((Date.now() - oldest) / 86400000));
    tips.push(`Average daily expense: ${fmt(stats.totalSpent / days)}.`);
  }

  if (!tips.length) {
    container.innerHTML = '<div class="insight-item"><i class="fa-solid fa-lightbulb"></i><p>Add transactions to see your financial insights here.</p></div>';
    return;
  }
  container.innerHTML = tips.map((t) => `<div class="insight-item"><i class="fa-solid fa-lightbulb"></i><p>${escHtml(t)}</p></div>`).join('');
}

const CHART_COLORS = ['#6c3de8', '#f5c518', '#10b981', '#ef4444', '#3b82f6', '#14b8a6', '#f97316', '#8b5cf6', '#ec4899', '#84cc16', '#06b6d4'];

function chartDefaults() {
  return {
    color: currentProfile.darkMode ? '#a78bfa' : '#6b7280',
    gridColor: currentProfile.darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(0,0,0,0.05)',
  };
}

function renderAnalytics() {
  const stats = calcStats();
  setElText('analytics-balance', fmt(stats.balance));
  renderDonutChart();
  renderBarChart();
  renderLineChart();
  renderSmartReview(stats);
  renderCategoryLegend();
}

function renderDonutChart() {
  const canvas = $('chart-donut');
  if (!canvas || typeof Chart === 'undefined') return;
  const spendByCategory = {};
  records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend').forEach((r) => {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + (Number(r.amount) || 0);
  });
  const labels = Object.keys(spendByCategory);
  const data = Object.values(spendByCategory);
  if (chartDonut) chartDonut.destroy();
  chartDonut = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 0, hoverOffset: 8 }] },
    options: { cutout: '72%', responsive: false, plugins: { legend: { display: false } }, animation: { duration: 500 } },
  });
}

function renderBarChart() {
  const canvas = $('chart-bar');
  if (!canvas || typeof Chart === 'undefined') return;
  const defaults = chartDefaults();
  const labels = [];
  const incomeData = [];
  const expenseData = [];
  const now = new Date();

  if (activePeriod === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + 86400000;
      labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
      const day = records.filter((r) => !r.deleted && r.kind !== 'bank' && r.createdAt >= dayStart && r.createdAt < dayEnd);
      incomeData.push(day.filter((r) => r.type === 'add').reduce((s, r) => s + (Number(r.amount) || 0), 0));
      expenseData.push(day.filter((r) => r.type === 'spend').reduce((s, r) => s + (Number(r.amount) || 0), 0));
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStart = m.getTime();
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
      labels.push(m.toLocaleDateString('en-US', { month: 'short' }));
      const month = records.filter((r) => !r.deleted && r.kind !== 'bank' && r.createdAt >= mStart && r.createdAt < mEnd);
      incomeData.push(month.filter((r) => r.type === 'add').reduce((s, r) => s + (Number(r.amount) || 0), 0));
      expenseData.push(month.filter((r) => r.type === 'spend').reduce((s, r) => s + (Number(r.amount) || 0), 0));
    }
  }

  if (chartBar) chartBar.destroy();
  chartBar = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: incomeData, backgroundColor: 'rgba(16,185,129,0.8)', borderRadius: 6 },
        { label: 'Expense', data: expenseData, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: defaults.color, font: { family: 'DM Sans', size: 12 } } } },
      scales: {
        x: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } },
        y: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } },
      },
      animation: { duration: 500 },
    },
  });
}

function renderLineChart() {
  const canvas = $('chart-line');
  if (!canvas || typeof Chart === 'undefined') return;
  const defaults = chartDefaults();
  const labels = [];
  const savingsData = [];
  const expenseData = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mStart = m.getTime();
    const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
    labels.push(m.toLocaleDateString('en-US', { month: 'short' }));
    const month = records.filter((r) => !r.deleted && r.kind !== 'bank' && r.createdAt >= mStart && r.createdAt < mEnd);
    const inc = month.filter((r) => r.type === 'add').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const exp = month.filter((r) => r.type === 'spend').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    savingsData.push(Math.max(0, inc - exp));
    expenseData.push(exp);
  }

  if (chartLine) chartLine.destroy();
  chartLine = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Savings', data: savingsData, borderColor: '#6c3de8', backgroundColor: 'rgba(108,61,232,0.1)', tension: 0.4, fill: true, pointBackgroundColor: '#6c3de8' },
        { label: 'Expenses', data: expenseData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)', tension: 0.4, fill: true, pointBackgroundColor: '#ef4444' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: defaults.color, font: { family: 'DM Sans', size: 12 } } } },
      scales: {
        x: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } },
        y: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } },
      },
      animation: { duration: 500 },
    },
  });
}

function renderCategoryLegend() {
  const el = $('category-legend');
  if (!el) return;
  const cats = [...new Set(records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend').map((r) => r.category))];
  el.innerHTML = cats.map((c, i) => `<div class="legend-item"><div class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></div>${escHtml(c)}</div>`).join('');
}

function renderSmartReview(stats) {
  const el = $('smart-review');
  if (!el) return;
  const tips = [];
  if (stats.weeklySpent || stats.monthlySpent) {
    if (stats.weeklySpent > stats.monthlySpent / 4) tips.push('Your weekly expense pace is moving fast.');
  }
  if (stats.monthlyAdded > stats.monthlySpent) tips.push(`You are saving ${fmt(stats.monthlyAdded - stats.monthlySpent)} this month.`);
  const categories = {};
  records.filter((r) => !r.deleted && r.kind === 'moneybag' && r.type === 'spend').forEach((r) => {
    categories[r.category] = (categories[r.category] || 0) + (Number(r.amount) || 0);
  });
  const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  if (top) tips.push(`Largest expense category: ${top[0]} (${fmt(top[1])}).`);
  if (!tips.length) tips.push('Add records to see smarter analysis.');
  el.innerHTML = tips.map((t) => `<div class="review-item"><span class="review-icon"><i class="fa-solid fa-chart-line"></i></span><span class="review-text">${escHtml(t)}</span></div>`).join('');
}

function renderRecords() {
  updateFilterCategories();
  applyRecordFilters();
}

function updateFilterCategories() {
  const sel = $('filter-category');
  if (!sel) return;
  const cats = [...new Set(records.filter((r) => !r.deleted).map((r) => r.category))].sort();
  sel.innerHTML = '<option value="">All Categories</option>' + cats.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

function applyRecordFilters() {
  const list = $('records-list');
  if (!list) return;
  const search = ($('search-input')?.value || '').toLowerCase();
  const type = $('filter-type')?.value || '';
  const cat = $('filter-category')?.value || '';
  const dateVal = $('filter-date')?.value || '';

  let filtered = records.filter((r) => !r.deleted);
  if (search) filtered = filtered.filter((r) => `${r.title} ${r.category} ${r.note} ${recordLabel(r)}`.toLowerCase().includes(search));
  if (type) filtered = filtered.filter((r) => r.type === type);
  if (cat) filtered = filtered.filter((r) => r.category === cat);
  if (dateVal) {
    const d = new Date(dateVal);
    const start = d.getTime();
    const end = start + 86400000;
    filtered = filtered.filter((r) => r.createdAt >= start && r.createdAt < end);
  }
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  list.innerHTML = filtered.length ? filtered.map(txnHTML).join('') : emptyHTML();
}

function renderSettings() {
  renderProfileUI();
  applyTheme();
}

function navigate(page) {
  activePage = page;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (page === 'dashboard') renderDashboard();
  if (page === 'analytics') renderAnalytics();
  if (page === 'records') renderRecords();
  if (page === 'settings') renderSettings();
}
window.navigate = navigate;

function openAddModal(prefillType = 'spend') {
  currentTxnType = prefillType === 'add' ? 'add' : 'spend';
  currentTxnKind = 'moneybag';
  editingRecordId = '';
  $('modal-title').textContent = 'Add Transaction';
  $('edit-record-id').value = '';
  $('txn-kind').value = 'moneybag';
  $('txn-amount').value = '';
  $('txn-title').value = '';
  $('txn-category').value = 'Food';
  $('txn-note').value = '';
  $('txn-date').value = toLocalISO(new Date());
  setTypeBtns(currentTxnType);
  openModal('modal-transaction');
}
window.openAddModal = openAddModal;

function editRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  editingRecordId = id;
  currentTxnType = r.type;
  currentTxnKind = r.kind || 'moneybag';
  $('modal-title').textContent = 'Edit Transaction';
  $('edit-record-id').value = r.id;
  $('txn-kind').value = currentTxnKind;
  $('txn-amount').value = r.amount;
  $('txn-title').value = r.title || '';
  $('txn-category').value = r.category || 'Other';
  $('txn-note').value = r.note || '';
  $('txn-date').value = toLocalISO(new Date(r.createdAt));
  setTypeBtns(currentTxnType);
  openModal('modal-transaction');
}
window.editRecord = editRecord;

function setTypeBtns(type) {
  document.querySelectorAll('.type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
}

function confirmDelete(id) {
  deleteTargetId = id;
  openModal('modal-confirm');
}
window.confirmDelete = confirmDelete;

function openBankModal(mode) {
  currentBankMode = mode || 'deposit';
  $('bank-amount').value = '';
  $('bank-note').value = '';
  setBankMode(currentBankMode);
  openModal('modal-bank');
}
window.openBankModal = openBankModal;

function setBankMode(mode) {
  currentBankMode = mode;
  document.querySelectorAll('.transfer-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const titleMap = {
    deposit: 'Add to Bank',
    tobank: 'Moneybag → Bank',
    frombank: 'Bank → Moneybag',
  };
  const descMap = {
    deposit: 'Adds money to Bank without changing Moneybag balance.',
    tobank: 'Moves money out of Moneybag and into Bank.',
    frombank: 'Moves money from Bank into Moneybag.',
  };
  $('bank-modal-title').textContent = titleMap[mode] || 'Bank Savings';
  $('bank-modal-desc').textContent = descMap[mode] || '';
}

async function saveTransaction() {
  const amount = parseFloat($('txn-amount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }
  const createdAt = $('txn-date').value ? new Date($('txn-date').value).getTime() : Date.now();
  const id = $('edit-record-id').value || uid();
  const kind = $('txn-kind').value || 'moneybag';
  const record = normalizeRecord({
    id,
    type: currentTxnType,
    kind,
    amount,
    category: $('txn-category').value || 'Other',
    title: $('txn-title').value.trim() || ($('txn-category').value || 'Other'),
    note: $('txn-note').value.trim(),
    createdAt,
    updatedAt: Date.now(),
  });

  if (kind === 'transfer_to_bank') {
    const stats = calcStats();
    if (stats.balance < amount) { showToast('Not enough Moneybag balance'); return; }
  }
  if (kind === 'transfer_from_bank') {
    const stats = calcStats();
    if (stats.bankBalance < amount) { showToast('Not enough Bank balance'); return; }
  }

  await setDoc(doc(db, 'users', currentUser.uid, 'moneybagRecords', id), record, { merge: true });
  closeModal('modal-transaction');
  showToast('Transaction saved');
}

async function deleteRecord(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'moneybagRecords', id));
}

async function saveBankAction() {
  const amount = parseFloat($('bank-amount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }
  const note = $('bank-note').value.trim();
  const id = uid();

  let type = 'add';
  let kind = 'bank';
  let title = 'Bank Deposit';
  let category = 'Bank Savings';

  if (currentBankMode === 'tobank') {
    const stats = calcStats();
    if (stats.balance < amount) { showToast('Not enough Moneybag balance'); return; }
    type = 'spend';
    kind = 'transfer_to_bank';
    title = 'Moneybag → Bank';
  } else if (currentBankMode === 'frombank') {
    const stats = calcStats();
    if (stats.bankBalance < amount) { showToast('Not enough Bank balance'); return; }
    type = 'add';
    kind = 'transfer_from_bank';
    title = 'Bank → Moneybag';
  }

  const record = normalizeRecord({
    id,
    type,
    kind,
    amount,
    category,
    title,
    note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await setDoc(doc(db, 'users', currentUser.uid, 'moneybagRecords', id), record);
  closeModal('modal-bank');
  showToast('Bank entry saved');
}

function uploadToImgBB(file) {
  return new Promise(async (resolve, reject) => {
    try {
      const base64 = await fileToBase64(file);
      const body = new URLSearchParams();
      body.set('image', base64.split(',')[1] || base64);
      const resp = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMG_BB_API_KEY)}`, {
        method: 'POST',
        body,
      });
      const json = await resp.json();
      if (!resp.ok || !json?.success) throw new Error(json?.error?.message || 'Upload failed');
      resolve(json.data.display_url || json.data.url);
    } catch (e) {
      reject(e);
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handlePhotoChange(file) {
  if (!file) return;
  if (file.size > MAX_IMAGE_BYTES) {
    showToast('Picture Upload Failed. Please Use A image smaller than 10MB');
    return;
  }
  const btn = $('btn-change-photo');
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }
  try {
    const url = await uploadToImgBB(file);
    currentProfile.photoUrl = url;
    await setDoc(doc(db, 'users', currentUser.uid, 'profile', 'main'), {
      photoUrl: url,
      photoUpdatedAt: Date.now(),
    }, { merge: true });
    renderProfileUI();
    showToast('Picture updated');
  } catch (e) {
    showToast('Photo upload failed');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

async function ensureProfileDoc() {
  const ref = doc(db, 'users', currentUser.uid, 'profile', 'main');
  await setDoc(ref, {
    currency: currentProfile.currency,
    darkMode: currentProfile.darkMode,
    photoUrl: currentProfile.photoUrl || '',
    updatedAt: Date.now(),
  }, { merge: true });
}

function startRealtimeListeners() {
  if (!fbReady || !currentUser) return;
  if (recordUnsub) recordUnsub();
  if (profileUnsub) profileUnsub();

  const recordsRef = collection(db, 'users', currentUser.uid, 'moneybagRecords');
  const profileRef = doc(db, 'users', currentUser.uid, 'profile', 'main');

  recordUnsub = onSnapshot(recordsRef, (snap) => {
    records = snap.docs.map((d) => normalizeRecord({ id: d.id, ...d.data() })).filter((r) => !r.deleted);
    saveCache();
    if (currentUser) {
      renderDashboard();
      renderRecords();
      renderAnalytics();
      updateFilterCategories();
    }
    setSyncStatus('idle');
    const syncDetail = $('sync-detail');
    if (syncDetail) syncDetail.textContent = 'Live sync active';
  }, (err) => {
    console.error(err);
    setSyncStatus('pending');
  });

  profileUnsub = onSnapshot(profileRef, (snap) => {
    const data = snap.exists() ? snap.data() : {};
    currentProfile = {
      photoUrl: data.photoUrl || currentProfile.photoUrl || '',
      currency: data.currency || currentProfile.currency || '$',
      darkMode: typeof data.darkMode === 'boolean' ? data.darkMode : currentProfile.darkMode,
    };
    saveCache();
    renderProfileUI();
    renderDashboard();
    renderSettings();
  }, (err) => console.error(err));
}

function stopRealtimeListeners() {
  if (recordUnsub) recordUnsub();
  if (profileUnsub) profileUnsub();
  recordUnsub = null;
  profileUnsub = null;
}

async function bootFirebase() {
  app = initializeApp(FB_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
  try {
    await enableIndexedDbPersistence(db);
  } catch {
    // ignore persistence failures (multiple tabs / unsupported browser)
  }
  fbReady = true;

  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    if (currentUser) {
      await ensureProfileDoc();
      startRealtimeListeners();
      showApp();
      renderProfileUI();
      renderDashboard();
      navigate('dashboard');
      hideLoading();
    } else {
      stopRealtimeListeners();
      currentUser = null;
      showAuth();
      hideLoading();
    }
  });
}

function showAuth() {
  $('auth-screen')?.classList.add('active');
  $('app-screen')?.classList.remove('active');
}

function showApp() {
  $('auth-screen')?.classList.remove('active');
  $('app-screen')?.classList.add('active');
}

function handleAuthError(error) {
  const raw = String(error?.code || error?.message || '').toLowerCase();
  if (raw.includes('wrong-password') || raw.includes('invalid-credential') || raw.includes('user-not-found') || raw.includes('invalid-login-credentials')) {
    showToast('Passwords or Email maybe wrong');
    return;
  }
  if (raw.includes('email-already-in-use')) {
    showToast('Email already in use');
    return;
  }
  showToast('Authentication failed');
}

function exportCSV() {
  const headers = ['id', 'type', 'kind', 'amount', 'category', 'title', 'note', 'createdAt', 'updatedAt'];
  const rows = records.filter((r) => !r.deleted).map((r) => [
    r.id,
    r.type,
    r.kind,
    r.amount,
    r.category,
    JSON.stringify(r.title || ''),
    JSON.stringify(r.note || ''),
    r.createdAt,
    r.updatedAt,
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `moneybag_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSV exported');
}

let importBuffer = [];
function handleCSVImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '').trim();
    if (!text) { showToast('Empty CSV file'); return; }
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines.shift()?.split(',').map((s) => s.trim()) || [];
    const rows = lines.map((line) => csvRowToObject(header, splitCSV(line))).filter(Boolean);
    importBuffer = rows.map((r) => normalizeRecord({
      id: r.id || uid(),
      type: r.type || 'add',
      kind: r.kind || 'moneybag',
      amount: parseFloat(r.amount) || 0,
      category: r.category || 'Other',
      title: r.title || '',
      note: r.note || '',
      createdAt: parseInt(r.createdAt) || Date.now(),
      updatedAt: parseInt(r.updatedAt) || Date.now(),
    }));
    $('import-summary').textContent = `${importBuffer.length} rows ready to import`;
    const preview = $('import-preview');
    if (preview) preview.innerHTML = importBuffer.slice(0, 5).map((r) => `<div class="import-row">${escHtml(r.title)} — ${fmt(r.amount)}</div>`).join('');
    openModal('modal-import');
  };
  reader.readAsText(file);
}

function splitCSV(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvRowToObject(headers, values) {
  if (!headers.length) return null;
  const obj = {};
  headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
  return obj;
}

async function confirmImport() {
  for (const r of importBuffer) {
    await setDoc(doc(db, 'users', currentUser.uid, 'moneybagRecords', r.id), r, { merge: true });
  }
  importBuffer = [];
  closeModal('modal-import');
  showToast('Import completed');
}

function updateCurrencyAndThemeToCloud() {
  if (!currentUser) return;
  return setDoc(doc(db, 'users', currentUser.uid, 'profile', 'main'), {
    currency: currentProfile.currency,
    darkMode: currentProfile.darkMode,
    updatedAt: Date.now(),
  }, { merge: true });
}

function wireEvents() {
  document.querySelectorAll('.auth-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab + '-form')?.classList.add('active');
      $('auth-error').textContent = '';
    });
  });

  $('btn-login')?.addEventListener('click', async () => {
    const email = $('login-email').value.trim();
    const pass = $('login-password').value;
    const err = $('auth-error');
    err.textContent = '';
    if (!email || !pass) { err.textContent = 'Please fill in all fields.'; return; }
    try {
      showLoading();
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      hideLoading();
      err.textContent = 'Passwords or Email maybe wrong';
      showToast('Passwords or Email maybe wrong');
    }
  });

  $('btn-signup')?.addEventListener('click', async () => {
    const name = $('signup-name').value.trim();
    const email = $('signup-email').value.trim();
    const pass = $('signup-password').value;
    const err = $('auth-error');
    err.textContent = '';
    if (!name || !email || !pass) { err.textContent = 'Please fill in all fields.'; return; }
    if (pass.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
    try {
      showLoading();
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, 'users', cred.user.uid, 'profile', 'main'), {
        currency: currentProfile.currency,
        darkMode: currentProfile.darkMode,
        photoUrl: '',
        updatedAt: Date.now(),
      }, { merge: true });
    } catch (e) {
      hideLoading();
      handleAuthError(e);
      err.textContent = 'Authentication failed';
    }
  });

  document.querySelectorAll('.nav-btn[data-page]').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.page)));
  $('fab-main')?.addEventListener('click', () => openAddModal('spend'));
  $('fab-nav')?.addEventListener('click', () => openAddModal('spend'));

  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTxnType = btn.dataset.type === 'add' ? 'add' : 'spend';
      setTypeBtns(currentTxnType);
    });
  });

  $('btn-save-txn')?.addEventListener('click', saveTransaction);
  $('btn-confirm-delete')?.addEventListener('click', async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    deleteTargetId = '';
    await deleteRecord(id);
    closeModal('modal-confirm');
    showToast('Deleted');
  });

  $('btn-bank-deposit')?.addEventListener('click', () => openBankModal('deposit'));
  $('btn-bank-transfer')?.addEventListener('click', () => openBankModal('tobank'));
  $('btn-bank-collect')?.addEventListener('click', () => openBankModal('frombank'));
  $('btn-open-bank')?.addEventListener('click', () => openBankModal('deposit'));
  $('btn-bank-save')?.addEventListener('click', saveBankAction);
  document.querySelectorAll('.transfer-btn').forEach((btn) => btn.addEventListener('click', () => setBankMode(btn.dataset.mode)));

  document.querySelectorAll('[data-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  $('btn-toggle-balance')?.addEventListener('click', () => {
    balanceHidden = !balanceHidden;
    const icon = $('balance-eye-icon');
    if (icon) icon.className = balanceHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    renderDashboard();
  });

  document.querySelectorAll('.period-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activePeriod = btn.dataset.period;
      renderBarChart();
    });
  });

  $('search-input')?.addEventListener('input', applyRecordFilters);
  $('filter-type')?.addEventListener('change', applyRecordFilters);
  $('filter-category')?.addEventListener('change', applyRecordFilters);
  $('filter-date')?.addEventListener('change', applyRecordFilters);

  $('btn-theme-toggle')?.addEventListener('click', async () => {
    currentProfile.darkMode = !currentProfile.darkMode;
    saveCache();
    applyTheme();
    await updateCurrencyAndThemeToCloud();
    if (activePage === 'analytics') { renderBarChart(); renderLineChart(); }
  });

  $('currency-select')?.addEventListener('change', async (e) => {
    currentProfile.currency = e.target.value;
    saveCache();
    await updateCurrencyAndThemeToCloud();
    renderDashboard();
    if (activePage === 'analytics') renderAnalytics();
  });

  $('btn-export')?.addEventListener('click', exportCSV);
  $('btn-export-mini')?.addEventListener('click', exportCSV);
  $('btn-import-trigger')?.addEventListener('click', () => $('csv-file-input')?.click());
  $('csv-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleCSVImport(file);
    e.target.value = '';
  });
  $('btn-confirm-import')?.addEventListener('click', confirmImport);

  $('btn-clear-cache')?.addEventListener('click', () => {
    if (!confirm('Clear local cache only?')) return;
    localStorage.removeItem('mb_records');
    localStorage.removeItem('mb_profile');
    showToast('Local cache cleared');
  });

  $('btn-manual-sync')?.addEventListener('click', () => showToast('Live sync is on'));

  $('btn-logout')?.addEventListener('click', async () => {
    try {
      await signOut(auth);
      showToast('Logged out');
    } catch {
      showToast('Logout failed');
    }
  });

  $('btn-change-photo')?.addEventListener('click', () => $('photo-file-input')?.click());
  $('photo-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await handlePhotoChange(file);
    e.target.value = '';
  });

  $('btn-notif')?.addEventListener('click', () => showToast('Notifications are not configured yet'));

  window.addEventListener('online', () => {
    setOnlineStatus(true);
    setSyncStatus('idle');
  });
  window.addEventListener('offline', () => {
    setOnlineStatus(false);
    setSyncStatus('pending');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openAddModal('spend');
    }
  });
}

function boot() {
  if (booted) return;
  booted = true;
  loadCache();
  applyTheme();
  renderProfileUI();
  renderDashboard();
  setOnlineStatus(navigator.onLine);
  setSyncStatus('idle');
  showAuth();
  wireEvents();
  bootFirebase().catch((err) => {
    console.error(err);
    hideLoading();
    showToast('Firebase failed to initialize');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
