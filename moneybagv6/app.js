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
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ═══════════════════════════════════════════════════════════
   MONEYBAG TRACKER — app.js
   Pure Vanilla JS · Firebase v10 · Offline-first
═══════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════ STATE ══════════════ */
let currentUser = null;
let records = [];          // working copy
let pendingSync = [];      // offline queue
let deleteTargetId = null;
let importBuffer = [];
let balanceHidden = false;
let activePage = 'dashboard';
let activePeriod = 'week';
let currency = localStorage.getItem('mb_currency') || '$';
let darkMode = localStorage.getItem('mb_dark') === 'true';
let userPhoto = localStorage.getItem('mb_photo') || '';
let bankBalance = Number(localStorage.getItem('mb_bank_balance') || 0);
let bankTransferMode = 'deposit';

let chartDonut = null;
let chartBar = null;
let chartLine = null;

// Default avatar SVG (base64 encoded inline)
const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%236c3de8'/%3E%3Ccircle cx='20' cy='15' r='7' fill='white'/%3E%3Cellipse cx='20' cy='38' rx='12' ry='10' fill='white'/%3E%3C/svg%3E";

/* ══════════════ FIREBASE INIT ══════════════ */
const firebaseConfig = {
  apiKey: "AIzaSyBzuJkT4Xi-GbLsyNZs7WSqQLPditJQ0Do",
  authDomain: "finance-tracker-c85f8.firebaseapp.com",
  projectId: "finance-tracker-c85f8",
  storageBucket: "finance-tracker-c85f8.firebasestorage.app",
  messagingSenderId: "555889482457",
  appId: "1:555889482457:web:c2ce8e03694c38ce747cc8"
};

const IMGBB_API_KEY = window.IMGBB_API_KEY || localStorage.getItem('mb_imgbb_key') || 'YOUR_IMGBB_API_KEY';

let db = null, auth = null, fbAvailable = false;
let profileUnsub = null;

try {
  if (!firebaseConfig?.apiKey) {
    console.warn('Firebase config empty – running in local-only mode');
  } else {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    fbAvailable = true;

    onAuthStateChanged(auth, user => {
      if (user) {
        currentUser = user;
        afterLogin();
      } else {
        showAuth();
      }
      hideLoading();
    });
  }
} catch (e) {
  console.error('Firebase init error:', e);
  hideLoading();
  showAuth();
}

/* ══════════════ HELPERS ══════════════ */


function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmt(amount) {
  return `${currency}${Math.abs(Number(amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setOnlineStatus(online) {
  const el = document.getElementById('online-status');
  if (!el) return;
  el.className = 'status-badge ' + (online ? 'online' : 'offline');
  el.innerHTML = online ? '<i class="fa-solid fa-wifi"></i> Online' : '<i class="fa-solid fa-wifi-slash"></i> Offline';
}

function setSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const states = {
    idle:    ['sync-idle',    '<i class="fa-solid fa-rotate"></i> Synced'],
    pending: ['sync-pending', '<i class="fa-solid fa-clock"></i> Pending'],
    syncing: ['syncing',      '<i class="fa-solid fa-rotate fa-spin"></i> Syncing…'],
  };
  const [cls, html] = states[state] || states.idle;
  el.className = 'status-badge ' + cls;
  el.innerHTML = html;
}

function getCategoryIcon(cat) {
  const map = {
    Food: 'fa-solid fa-burger',
    Shopping: 'fa-solid fa-bag-shopping',
    Rent: 'fa-solid fa-house',
    Fuel: 'fa-solid fa-gas-pump',
    Health: 'fa-solid fa-notes-medical',
    Education: 'fa-solid fa-book',
    Entertainment: 'fa-solid fa-film',
    Salary: 'fa-solid fa-sack-dollar',
    Freelance: 'fa-solid fa-laptop-code',
    Investment: 'fa-solid fa-chart-line',
    Other: 'fa-solid fa-box-open',
  };
  return map[cat] || 'fa-solid fa-box-open';
}

/* ══════════════ THEME ══════════════ */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  const sw = document.getElementById('theme-toggle-switch');
  if (sw) darkMode ? sw.classList.add('on') : sw.classList.remove('on');
  const ic = document.getElementById('theme-icon');
  if (ic) { ic.className = darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon'; }
}
applyTheme();

/* ══════════════ LOCAL STORAGE ══════════════ */
function saveLocal() {
  localStorage.setItem('mb_records', JSON.stringify(records));
  localStorage.setItem('mb_pending', JSON.stringify(pendingSync));
  saveProfileLocal();
}

function loadLocal() {
  try { records = JSON.parse(localStorage.getItem('mb_records') || '[]'); } catch { records = []; }
  try { pendingSync = JSON.parse(localStorage.getItem('mb_pending') || '[]'); } catch { pendingSync = []; }
}

function saveProfileLocal() {
  localStorage.setItem('mb_bank_balance', String(bankBalance));
  localStorage.setItem('mb_photo', userPhoto || '');
  localStorage.setItem('mb_currency', currency);
  localStorage.setItem('mb_dark', String(darkMode));
}

function applyProfileData(data = {}) {
  if (data && typeof data === 'object') {
    if (data.bankBalance !== undefined && data.bankBalance !== null) bankBalance = Number(data.bankBalance) || 0;
    if (typeof data.photoURL === 'string') userPhoto = data.photoURL;
    else if (typeof data.photo === 'string') userPhoto = data.photo;
    if (typeof data.currency === 'string' && data.currency) currency = data.currency;
    if (typeof data.darkMode === 'boolean') darkMode = data.darkMode;
  }
  saveProfileLocal();
  applyTheme();
  updateProfileUI();
  updateBankUI();
  if (activePage === 'dashboard') renderDashboard();
  if (activePage === 'analytics') renderAnalytics();
}

async function saveProfileState() {
  if (!fbAvailable || !currentUser) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'profile', 'main');
    await setDoc(ref, {
      bankBalance,
      photoURL: userPhoto || '',
      currency,
      darkMode,
      updatedAt: Date.now(),
    }, { merge: true });
  } catch (e) {
    console.error('Profile save error:', e);
  }
}

async function syncProfileFromFirestore() {
  if (!fbAvailable || !currentUser) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'profile', 'main');
    const snap = await getDoc(ref);

    if (snap.exists()) {
      applyProfileData(snap.data());
    } else {
      await setDoc(ref, {
        bankBalance,
        photoURL: userPhoto || '',
        currency,
        darkMode,
        updatedAt: Date.now(),
      }, { merge: true });
    }

    if (profileUnsub) profileUnsub();
    profileUnsub = onSnapshot(ref, docSnap => {
      if (!docSnap.exists()) return;
      applyProfileData(docSnap.data());
      const syncDetail = document.getElementById('sync-detail');
      if (syncDetail) syncDetail.textContent = 'Profile synced';
    });
  } catch (e) {
    console.error('Profile sync error:', e);
  }
}

/* ══════════════ AUTH ══════════════ */
function showAuth() {
  document.getElementById('auth-screen').classList.add('active');
  document.getElementById('app-screen').classList.remove('active');
  hideLoading();
}

function showApp() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
}

async function afterLogin() {
  loadLocal();
  updateProfileUI();
  updateBankUI();
  if (fbAvailable) {
    await syncFromFirestore();
    await syncProfileFromFirestore();
  }
  showApp();
  navigate('dashboard');
  updateFilterCategories();
  if (pendingSync.length) setSyncStatus('pending');
}

/* ══════════════ FIREBASE CRUD ══════════════ */
async function syncFromFirestore() {
  if (!fbAvailable || !currentUser) return;
  try {
    setSyncStatus('syncing');
    const col = collection(db, 'users', currentUser.uid, 'moneybagRecords');
    const snap = await getDocs(col);
    const remoteRecords = [];
    snap.forEach(d => remoteRecords.push(d.data()));

    // Merge: local wins for same id if updatedAt is newer
    const merged = {};
    [...remoteRecords, ...records].forEach(r => {
      if (!merged[r.id] || r.updatedAt > merged[r.id].updatedAt) {
        merged[r.id] = r;
      }
    });
    records = Object.values(merged).filter(r => !r.deleted);
    saveLocal();

    // Push local pending items
    await flushPendingSync();
    setSyncStatus('idle');
    document.getElementById('sync-detail').textContent = 'Last synced: just now';
  } catch (e) {
    console.error('Sync error:', e);
    setSyncStatus('pending');
  }
}

async function flushPendingSync() {
  if (!fbAvailable || !currentUser || !navigator.onLine) return;
  const toSync = [...pendingSync];
  for (const op of toSync) {
    try {
      if (op.type === 'upsert') {
        const ref = doc(db, 'users', currentUser.uid, 'moneybagRecords', op.record.id);
        await setDoc(ref, op.record);
      } else if (op.type === 'delete') {
        const ref = doc(db, 'users', currentUser.uid, 'moneybagRecords', op.id);
        await deleteDoc(ref);
      }
      pendingSync = pendingSync.filter(p => p !== op);
    } catch (e) {
      console.error('Flush error:', e);
    }
  }
  saveLocal();
}

async function upsertRecord(record) {
  record.updatedAt = Date.now();
  record.synced = false;

  // Update in local array
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);

  pendingSync.push({ type: 'upsert', record });
  saveLocal();

  if (navigator.onLine && fbAvailable) {
    await flushPendingSync();
    setSyncStatus('idle');
  } else {
    setSyncStatus('pending');
  }
}

async function deleteRecord(id) {
  records = records.filter(r => r.id !== id);
  pendingSync.push({ type: 'delete', id });
  saveLocal();

  if (navigator.onLine && fbAvailable) {
    await flushPendingSync();
    setSyncStatus('idle');
  } else {
    setSyncStatus('pending');
  }
}


/* ══════════════ BANK SYSTEM ══════════════ */
function updateBankUI() {
  setElText('bank-balance', balanceHidden ? '••••' : fmt(bankBalance));
}

function openBankTransferModal(mode) {
  bankTransferMode = mode === 'withdraw' ? 'withdraw' : 'deposit';
  const modal = document.getElementById('modal-bank-transfer');
  const title = document.getElementById('bank-transfer-title');
  const subtitle = document.getElementById('bank-transfer-subtitle');
  const amountInput = document.getElementById('bank-transfer-amount');
  const helper = document.getElementById('bank-transfer-helper');
  const submitBtn = document.getElementById('btn-submit-bank-transfer');
  const icon = document.getElementById('bank-transfer-icon');
  const maxBtn = document.getElementById('btn-bank-transfer-max');

  if (!modal || !title || !subtitle || !amountInput || !helper || !submitBtn || !icon || !maxBtn) return;

  if (bankTransferMode === 'deposit') {
    title.textContent = 'Deposit to Bank';
    subtitle.textContent = 'Move money from Moneybag into your bank savings.';
    icon.className = 'fa-solid fa-building-columns';
    submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-arrow-left"></i> Deposit';
    helper.textContent = `Available in Moneybag: ${fmt(calcStats().balance)}`;
    maxBtn.textContent = 'Use Max Moneybag';
    amountInput.max = String(Math.max(0, calcStats().balance));
  } else {
    title.textContent = 'Collect from Bank';
    subtitle.textContent = 'Move money from your bank savings back to Moneybag.';
    icon.className = 'fa-solid fa-hand-holding-dollar';
    submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-arrow-left"></i> Collect';
    helper.textContent = `Available in Bank: ${fmt(bankBalance)}`;
    maxBtn.textContent = 'Use Max Bank';
    amountInput.max = String(Math.max(0, bankBalance));
  }

  amountInput.value = '';
  amountInput.min = '0';
  amountInput.step = '0.01';
  openModal('modal-bank-transfer');
  setTimeout(() => amountInput.focus(), 50);
}

function closeBankTransferModal() {
  closeModal('modal-bank-transfer');
}

async function submitBankTransfer() {
  const amountInput = document.getElementById('bank-transfer-amount');
  const amount = parseFloat(amountInput?.value);
  if (!amount || amount <= 0) {
    showToast('Enter a valid amount');
    return;
  }

  const stats = calcStats();
  if (bankTransferMode === 'deposit') {
    if (amount > stats.balance) {
      showToast('Not enough Moneybag balance');
      return;
    }
    bankBalance += amount;
    await upsertRecord({
      id: uid(),
      title: 'Bank Deposit',
      category: 'Bank',
      amount,
      type: 'spend',
      note: 'Transferred to bank savings',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      synced: false,
    });
    showToast('Money deposited to bank');
  } else {
    if (amount > bankBalance) {
      showToast('Not enough balance in bank');
      return;
    }
    bankBalance -= amount;
    await upsertRecord({
      id: uid(),
      title: 'Bank Collect',
      category: 'Bank',
      amount,
      type: 'add',
      note: 'Collected from bank savings',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      synced: false,
    });
    showToast('Money collected from bank');
  }

  saveLocal();
  await saveProfileState();
  updateBankUI();
  closeBankTransferModal();
  renderDashboard();
  renderRecords();
  renderAnalytics();
}

/* ══════════════ NAVIGATION ══════════════ */
function navigate(page) {
  activePage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  if (page === 'dashboard') renderDashboard();
  if (page === 'analytics') renderAnalytics();
  if (page === 'records') renderRecords();
  if (page === 'settings') renderSettings();
}
window.navigate = navigate;

/* ══════════════ PROFILE UI ══════════════ */
function updateProfileUI() {
  if (!currentUser) return;
  const name = currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
  const photo = userPhoto || currentUser.photoURL || DEFAULT_AVATAR;

  setElText('dash-username', name);
  setElText('dash-username-card', name);
  setElText('settings-username', name);
  setElText('settings-email', currentUser.email);
  setImg('dash-avatar', photo);
  setImg('settings-avatar', photo);
}

function setElText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setImg(id, src) { const el = document.getElementById(id); if (el) el.src = src; }

/* ══════════════ CALCULATIONS ══════════════ */
function calcStats() {
  const active = records.filter(r => !r.deleted);
  const totalAdded = active.filter(r => r.type === 'add').reduce((s, r) => s + Number(r.amount), 0);
  const totalSpent = active.filter(r => r.type === 'spend').reduce((s, r) => s + Number(r.amount), 0);
  const balance = totalAdded - totalSpent;

  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  function filter(type, since) {
    return active.filter(r => r.type === type && new Date(r.createdAt) >= since)
                 .reduce((s, r) => s + Number(r.amount), 0);
  }

  return {
    balance, totalAdded, totalSpent,
    weeklySpent: filter('spend', weekStart),
    weeklyAdded: filter('add', weekStart),
    monthlySpent: filter('spend', monthStart),
    monthlyAdded: filter('add', monthStart),
    get weeklySavings() { return Math.max(0, this.weeklyAdded - this.weeklySpent); },
    get monthlySavings() { return Math.max(0, this.monthlyAdded - this.monthlySpent); },
  };
}

/* ══════════════ DASHBOARD ══════════════ */
function renderDashboard() {
  const stats = calcStats();
  const hidden = balanceHidden;

  setElText('dash-balance', hidden ? '••••••' : fmt(stats.balance));
  setElText('dash-total-added', hidden ? '••••' : fmt(stats.totalAdded));
  setElText('dash-total-spent', hidden ? '••••' : fmt(stats.totalSpent));
  setElText('dash-weekly-savings', hidden ? '••••' : fmt(stats.weeklySavings));
  setElText('dash-monthly-savings', hidden ? '••••' : fmt(stats.monthlySavings));
  setElText('bank-balance', hidden ? '••••' : fmt(bankBalance));

  // Progress bars (relative to income)
  const wPct = stats.weeklyAdded > 0 ? Math.min(100, (stats.weeklySavings / stats.weeklyAdded) * 100) : 0;
  const mPct = stats.monthlyAdded > 0 ? Math.min(100, (stats.monthlySavings / stats.monthlyAdded) * 100) : 0;
  const pwEl = document.getElementById('pw-savings');
  const pmEl = document.getElementById('pm-savings');
  if (pwEl) pwEl.style.width = wPct + '%';
  if (pmEl) pmEl.style.width = mPct + '%';

  // Recent 5 transactions
  const recent = [...records].filter(r => !r.deleted).sort((a,b) => b.createdAt - a.createdAt).slice(0, 5);
  const list = document.getElementById('dash-recent-list');
  if (list) list.innerHTML = recent.length ? recent.map(txnHTML).join('') : emptyHTML();

  // Insights
  renderInsights(stats);
}

function emptyHTML() {
  return `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No transactions yet</p></div>`;
}

function txnHTML(r) {
  const sign = r.type === 'add' ? '+' : '-';
  const cls = r.type === 'add' ? 'add' : 'spend';
  return `
    <div class="txn-item" data-id="${r.id}">
      <div class="txn-cat-icon type-${r.type}"><i class="${getCategoryIcon(r.category)}"></i></div>
      <div class="txn-info">
        <div class="txn-title">${escHtml(r.title || r.category)}</div>
        <div class="txn-meta">${escHtml(r.category)} · ${fmtDate(r.createdAt)}</div>
        ${r.note ? `<div class="txn-meta" style="font-style:italic">${escHtml(r.note)}</div>` : ''}
      </div>
      <div class="txn-right">
        <div class="txn-amount ${cls}">${sign}${fmt(r.amount)}</div>
        <div class="txn-actions">
          <button class="txn-act-btn edit" onclick="editRecord('${r.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="txn-act-btn del" onclick="confirmDelete('${r.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderInsights(stats) {
  const container = document.getElementById('insights-container');
  if (!container) return;

  const tips = [];

  if (stats.weeklySpent > 0) {
    const now = Date.now();
    const weekMs = 7 * 24 * 3600 * 1000;
    const lastWeekSpent = records.filter(r => !r.deleted && r.type === 'spend' && r.createdAt >= now - 2 * weekMs && r.createdAt < now - weekMs)
      .reduce((s, r) => s + Number(r.amount), 0);
    if (lastWeekSpent > 0) {
      const diff = stats.weeklySpent - lastWeekSpent;
      if (diff > 0) tips.push({ icon: 'fa-solid fa-arrow-trend-up', text: `You spent ${fmt(diff)} more this week than last week.` });
      else if (diff < 0) tips.push({ icon: 'fa-solid fa-arrow-trend-down', text: `Great! You spent ${fmt(-diff)} less this week than last week.` });
    }
  }

  if (stats.monthlySavings > 0) {
    tips.push({ icon: 'fa-solid fa-coins', text: `Your monthly savings so far: ${fmt(stats.monthlySavings)}. Keep it up!` });
  }

  const spendByCategory = {};
  records.filter(r => !r.deleted && r.type === 'spend').forEach(r => {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + Number(r.amount);
  });
  const topCat = Object.entries(spendByCategory).sort((a, b) => b[1] - a[1])[0];
  if (topCat) tips.push({ icon: 'fa-solid fa-chart-pie', text: `Biggest expense category: ${topCat[0]} (${fmt(topCat[1])})` });

  const oldest = Math.min(...records.filter(r => !r.deleted && r.type === 'spend').map(r => r.createdAt));
  if (isFinite(oldest)) {
    const days = Math.max(1, Math.ceil((Date.now() - oldest) / 86400000));
    tips.push({ icon: 'fa-solid fa-calendar-days', text: `Average daily expense: ${fmt(stats.totalSpent / days)}` });
  }

  if (!tips.length) {
    container.innerHTML = `<div class="insight-item"><i class="fa-solid fa-lightbulb"></i><p>Add transactions to see your financial insights here.</p></div>`;
    return;
  }

  container.innerHTML = tips.map(t => `
    <div class="insight-item">
      <i class="${t.icon}"></i>
      <p>${escHtml(t.text)}</p>
    </div>`).join('');
}

/* ══════════════ ANALYTICS ══════════════ */

function renderAnalytics() {
  const stats = calcStats();
  setElText('analytics-balance', fmt(stats.balance));

  renderDonutChart();
  renderBarChart();
  renderLineChart();
  renderSmartReview(stats);
  renderCategoryLegend();
}

const CHART_COLORS = ['#6c3de8','#f5c518','#10b981','#ef4444','#3b82f6','#14b8a6','#f97316','#8b5cf6','#ec4899','#84cc16','#06b6d4'];

function getChartDefaults() {
  const dark = darkMode;
  return {
    color: dark ? '#a78bfa' : '#6b7280',
    gridColor: dark ? 'rgba(139,92,246,0.1)' : 'rgba(0,0,0,0.05)',
  };
}

function renderDonutChart() {
  const ctx = document.getElementById('chart-donut');
  if (!ctx) return;

  const spendByCategory = {};
  records.filter(r => !r.deleted && r.type === 'spend').forEach(r => {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + Number(r.amount);
  });

  const labels = Object.keys(spendByCategory);
  const data = Object.values(spendByCategory);

  if (chartDonut) chartDonut.destroy();
  chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      cutout: '72%', responsive: false,
      plugins: { legend: { display: false } },
      animation: { duration: 600 }
    }
  });
}

function renderBarChart() {
  const ctx = document.getElementById('chart-bar');
  if (!ctx) return;
  const defaults = getChartDefaults();

  const labels = [], incomeData = [], expenseData = [];
  const now = new Date();

  if (activePeriod === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = d.toLocaleDateString('en-US', { weekday: 'short' });
      labels.push(key);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + 86400000;
      incomeData.push(records.filter(r => !r.deleted && r.type === 'add' && r.createdAt >= dayStart && r.createdAt < dayEnd).reduce((s,r) => s+Number(r.amount), 0));
      expenseData.push(records.filter(r => !r.deleted && r.type === 'spend' && r.createdAt >= dayStart && r.createdAt < dayEnd).reduce((s,r) => s+Number(r.amount), 0));
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
      const mStart = m.getTime();
      labels.push(m.toLocaleDateString('en-US', { month: 'short' }));
      incomeData.push(records.filter(r => !r.deleted && r.type === 'add' && r.createdAt >= mStart && r.createdAt < mEnd).reduce((s,r) => s+Number(r.amount), 0));
      expenseData.push(records.filter(r => !r.deleted && r.type === 'spend' && r.createdAt >= mStart && r.createdAt < mEnd).reduce((s,r) => s+Number(r.amount), 0));
    }
  }

  if (chartBar) chartBar.destroy();
  chartBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: incomeData, backgroundColor: 'rgba(16,185,129,0.8)', borderRadius: 6 },
        { label: 'Expense', data: expenseData, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: defaults.color, font: { family: 'DM Sans', size: 12 } } } },
      scales: {
        x: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } },
        y: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } }
      },
      animation: { duration: 500 }
    }
  });
}

function renderLineChart() {
  const ctx = document.getElementById('chart-line');
  if (!ctx) return;
  const defaults = getChartDefaults();

  const labels = [], savingsData = [], expenseData = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
    const mStart = m.getTime();
    labels.push(m.toLocaleDateString('en-US', { month: 'short' }));
    const inc = records.filter(r => !r.deleted && r.type === 'add' && r.createdAt >= mStart && r.createdAt < mEnd).reduce((s,r) => s+Number(r.amount), 0);
    const exp = records.filter(r => !r.deleted && r.type === 'spend' && r.createdAt >= mStart && r.createdAt < mEnd).reduce((s,r) => s+Number(r.amount), 0);
    expenseData.push(exp);
    savingsData.push(Math.max(0, inc - exp));
  }

  if (chartLine) chartLine.destroy();
  chartLine = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Savings', data: savingsData, borderColor: '#6c3de8', backgroundColor: 'rgba(108,61,232,0.1)', tension: 0.4, fill: true, pointBackgroundColor: '#6c3de8' },
        { label: 'Expenses', data: expenseData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)', tension: 0.4, fill: true, pointBackgroundColor: '#ef4444' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: defaults.color, font: { family: 'DM Sans', size: 12 } } } },
      scales: {
        x: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } },
        y: { ticks: { color: defaults.color }, grid: { color: defaults.gridColor } }
      },
      animation: { duration: 500 }
    }
  });
}

function renderCategoryLegend() {
  const el = document.getElementById('category-legend');
  if (!el) return;
  const cats = [...new Set(records.filter(r => !r.deleted && r.type === 'spend').map(r => r.category))];
  el.innerHTML = cats.map((c, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></div>
      ${escHtml(c)}
    </div>`).join('');
}

function renderSmartReview(stats) {
  const el = document.getElementById('smart-review');
  if (!el) return;

  const tips = [];
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;

  const lastWeekSpent = records.filter(r => !r.deleted && r.type === 'spend' && r.createdAt >= now - 2 * weekMs && r.createdAt < now - weekMs).reduce((s, r) => s + Number(r.amount), 0);
  const lastMonthSpent = (() => {
    const lm = new Date(); lm.setMonth(lm.getMonth() - 1);
    const lmS = new Date(lm.getFullYear(), lm.getMonth(), 1).getTime();
    const lmE = new Date(lm.getFullYear(), lm.getMonth() + 1, 1).getTime();
    return records.filter(r => !r.deleted && r.type === 'spend' && r.createdAt >= lmS && r.createdAt < lmE).reduce((s, r) => s + Number(r.amount), 0);
  })();

  if (lastWeekSpent) {
    const d = stats.weeklySpent - lastWeekSpent;
    tips.push({ icon: d > 0 ? 'fa-solid fa-arrow-trend-up' : 'fa-solid fa-arrow-trend-down', text: d > 0 ? `You spent ${fmt(d)} more this week than last week` : `You spent ${fmt(-d)} less this week than last week` });
  }
  if (lastMonthSpent) {
    const d = stats.monthlySpent - lastMonthSpent;
    tips.push({ icon: d > 0 ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check', text: d > 0 ? `Monthly expenses up by ${fmt(d)} vs last month` : `Monthly expenses down by ${fmt(-d)} vs last month` });
  }
  if (stats.monthlySavings > 0) {
    tips.push({ icon: 'fa-solid fa-coins', text: `Your savings improved this month: ${fmt(stats.monthlySavings)} saved` });
  }

  const cats = {};
  records.filter(r => !r.deleted && r.type === 'spend').forEach(r => { cats[r.category] = (cats[r.category] || 0) + Number(r.amount); });
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  if (top) tips.push({ icon: 'fa-solid fa-trophy', text: `Biggest expense category: ${top[0]} (${fmt(top[1])})` });

  if (!tips.length) tips.push({ icon: 'fa-solid fa-face-smile', text: 'Add more transactions to see your smart financial review!' });

  el.innerHTML = tips.map(t => `
    <div class="review-item">
      <span class="review-icon"><i class="${t.icon}"></i></span>
      <span class="review-text">${escHtml(t.text)}</span>
    </div>`).join('');
}

/* ══════════════ RECORDS PAGE ══════════════ */

function renderRecords() {
  updateFilterCategories();
  applyRecordFilters();
}

function updateFilterCategories() {
  const sel = document.getElementById('filter-category');
  if (!sel) return;
  const cats = [...new Set(records.filter(r => !r.deleted).map(r => r.category))].sort();
  sel.innerHTML = `<option value="">All Categories</option>` + cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

function applyRecordFilters() {
  const list = document.getElementById('records-list');
  if (!list) return;

  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const type = document.getElementById('filter-type')?.value || '';
  const cat = document.getElementById('filter-category')?.value || '';
  const dateVal = document.getElementById('filter-date')?.value || '';

  let filtered = records.filter(r => !r.deleted);
  if (search) filtered = filtered.filter(r => (r.title+r.category+r.note).toLowerCase().includes(search));
  if (type) filtered = filtered.filter(r => r.type === type);
  if (cat) filtered = filtered.filter(r => r.category === cat);
  if (dateVal) {
    const d = new Date(dateVal); const dS = d.getTime(); const dE = dS + 86400000;
    filtered = filtered.filter(r => r.createdAt >= dS && r.createdAt < dE);
  }

  filtered.sort((a,b) => b.createdAt - a.createdAt);
  list.innerHTML = filtered.length ? filtered.map(txnHTML).join('') : emptyHTML();
}

/* ══════════════ SETTINGS PAGE ══════════════ */
function renderSettings() {
  updateProfileUI();
  applyTheme();
}

/* ══════════════ TRANSACTION MODAL ══════════════ */
let currentTxnType = 'add';

function openAddModal(prefillType) {
  currentTxnType = prefillType || 'add';
  document.getElementById('edit-record-id').value = '';
  document.getElementById('txn-amount').value = '';
  document.getElementById('txn-title').value = '';
  document.getElementById('txn-category').value = 'Food';
  document.getElementById('txn-note').value = '';
  document.getElementById('txn-date').value = toLocalISO(new Date());
  document.getElementById('modal-title').textContent = 'Add Transaction';
  setTypeBtns(currentTxnType);
  openModal('modal-transaction');
}

function editRecord(id) {
  const r = records.find(r => r.id === id);
  if (!r) return;
  currentTxnType = r.type;
  document.getElementById('edit-record-id').value = r.id;
  document.getElementById('txn-amount').value = r.amount;
  document.getElementById('txn-title').value = r.title || '';
  document.getElementById('txn-category').value = r.category || 'Other';
  document.getElementById('txn-note').value = r.note || '';
  document.getElementById('txn-date').value = toLocalISO(new Date(r.createdAt));
  document.getElementById('modal-title').textContent = 'Edit Transaction';
  setTypeBtns(r.type);
  openModal('modal-transaction');
}
window.editRecord = editRecord;

function setTypeBtns(type) {
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
}

function confirmDelete(id) {
  deleteTargetId = id;
  openModal('modal-confirm');
}
window.confirmDelete = confirmDelete;

function toLocalISO(d) {
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ══════════════ CSV EXPORT ══════════════ */
function exportCSV() {
  const headers = 'id,type,amount,category,title,note,createdAt,updatedAt,synced';
  const rows = records.filter(r => !r.deleted).map(r =>
    [r.id, r.type, r.amount, r.category, `"${(r.title||'').replace(/"/g,'""')}"`,
     `"${(r.note||'').replace(/"/g,'""')}"`, r.createdAt, r.updatedAt, r.synced].join(',')
  );
  const csv = [headers, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `moneybag_${Date.now()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV exported!');
}

/* ══════════════ CSV IMPORT ══════════════ */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i]?.trim() || '');
    return obj;
  }).filter(r => r.id && r.type && r.amount);
}

function handleCSVImport(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const rows = parseCSV(e.target.result);
    if (!rows.length) { showToast('No valid rows found'); return; }
    importBuffer = rows;
    const existing = new Set(records.map(r => r.id));
    const newRows = rows.filter(r => !existing.has(r.id));
    document.getElementById('import-summary').textContent =
      `Found ${rows.length} rows · ${newRows.length} new · ${rows.length - newRows.length} duplicates will be skipped`;
    document.getElementById('import-preview').textContent = rows.slice(0, 5).map(r =>
      `${r.type.toUpperCase()} | ${r.amount} | ${r.category} | ${r.title}`).join('\n');
    openModal('modal-import');
  };
  reader.readAsText(file);
}

async function confirmImport() {
  if (!importBuffer.length) return;
  const existing = new Set(records.map(r => r.id));
  const newRows = importBuffer.filter(r => !existing.has(r.id));
  for (const r of newRows) {
    const record = {
      id: r.id || uid(), type: r.type, amount: parseFloat(r.amount) || 0,
      category: r.category || 'Other', title: r.title || '', note: r.note || '',
      createdAt: parseInt(r.createdAt) || Date.now(), updatedAt: Date.now(), synced: false
    };
    await upsertRecord(record);
  }
  importBuffer = [];
  closeModal('modal-import');
  showToast(`Imported ${newRows.length} records`);
  renderDashboard();
}

/* ══════════════ EVENT LISTENERS ══════════════ */

document.addEventListener('DOMContentLoaded', () => {

  // If firebase is not configured, start in local mode
  if (!fbAvailable) {
    setTimeout(() => {
      loadLocal();
      showAuth();
      hideLoading();
    }, 500);
  }

  // ── Auth tabs ──
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + '-form').classList.add('active');
      document.getElementById('auth-error').textContent = '';
    });
  });

  // ── Login ──
  document.getElementById('btn-login')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!email || !pass) { errEl.textContent = 'Please fill in all fields.'; return; }

    if (!fbAvailable) {
      // Local mode login
      currentUser = { uid: 'local', email, displayName: email.split('@')[0] };
      afterLogin();
      return;
    }
    try {
      showLoading();
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      hideLoading();
      showToast('Passwords or Email maybe wrong');
      errEl.textContent = 'Passwords or Email maybe wrong';
    }
  });

  // ── Signup ──
  document.getElementById('btn-signup')?.addEventListener('click', async () => {
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pass = document.getElementById('signup-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!name || !email || !pass) { errEl.textContent = 'Please fill in all fields.'; return; }
    if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

    if (!fbAvailable) {
      currentUser = { uid: 'local', email, displayName: name };
      afterLogin();
      return;
    }
    try {
      showLoading();
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      currentUser = cred.user;
    } catch (e) {
      hideLoading();
      errEl.textContent = e.message.replace('Firebase: ', '').replace(/\(.*\)/, '').trim();
    }
  });

  // ── Nav buttons ──
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });

  // ── FAB buttons ──
  document.getElementById('fab-main')?.addEventListener('click', () => openAddModal('spend'));
  document.getElementById('fab-nav')?.addEventListener('click', () => openAddModal('spend'));
  document.getElementById('btn-bank-deposit')?.addEventListener('click', () => openBankTransferModal('deposit'));
  document.getElementById('btn-bank-withdraw')?.addEventListener('click', () => openBankTransferModal('withdraw'));
  document.getElementById('btn-submit-bank-transfer')?.addEventListener('click', submitBankTransfer);
  document.getElementById('btn-bank-transfer-max')?.addEventListener('click', () => {
    const amountInput = document.getElementById('bank-transfer-amount');
    if (!amountInput) return;
    amountInput.value = bankTransferMode === 'deposit' ? Math.max(0, calcStats().balance).toFixed(2) : Math.max(0, bankBalance).toFixed(2);
  });

  // ── Type selector in modal ──
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTxnType = btn.dataset.type;
      setTypeBtns(currentTxnType);
    });
  });

  // ── Save transaction ──
  document.getElementById('btn-save-txn')?.addEventListener('click', async () => {
    const amountEl = document.getElementById('txn-amount');
    const amount = parseFloat(amountEl.value);
    if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }

    const dateEl = document.getElementById('txn-date');
    const createdAt = dateEl.value ? new Date(dateEl.value).getTime() : Date.now();
    const editId = document.getElementById('edit-record-id').value;

    const record = {
      id: editId || uid(),
      type: currentTxnType,
      amount,
      category: document.getElementById('txn-category').value,
      title: document.getElementById('txn-title').value.trim() || document.getElementById('txn-category').value,
      note: document.getElementById('txn-note').value.trim(),
      createdAt,
      updatedAt: Date.now(),
      synced: false,
    };

    await upsertRecord(record);
    closeModal('modal-transaction');
    showToast('Transaction saved!');
    updateFilterCategories();
    if (activePage === 'dashboard') renderDashboard();
    if (activePage === 'records') renderRecords();
    if (activePage === 'analytics') renderAnalytics();
  });

  // ── Confirm delete ──
  document.getElementById('btn-confirm-delete')?.addEventListener('click', async () => {
    if (!deleteTargetId) return;
    await deleteRecord(deleteTargetId);
    deleteTargetId = null;
    closeModal('modal-confirm');
    showToast('Deleted');
    if (activePage === 'dashboard') renderDashboard();
    if (activePage === 'records') renderRecords();
    if (activePage === 'analytics') renderAnalytics();
  });

  // ── Modal close buttons ──
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // ── Balance toggle ──
  document.getElementById('btn-toggle-balance')?.addEventListener('click', () => {
    balanceHidden = !balanceHidden;
    const icon = document.getElementById('balance-eye-icon');
    if (icon) icon.className = balanceHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    renderDashboard();
  });

  // ── Period tabs ──
  document.querySelectorAll('.period-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePeriod = btn.dataset.period;
      renderBarChart();
    });
  });

  // ── Search & filters ──
  document.getElementById('search-input')?.addEventListener('input', applyRecordFilters);
  document.getElementById('filter-type')?.addEventListener('change', applyRecordFilters);
  document.getElementById('filter-category')?.addEventListener('change', applyRecordFilters);
  document.getElementById('filter-date')?.addEventListener('change', applyRecordFilters);

  // ── Settings: theme ──
  document.getElementById('btn-theme-toggle')?.addEventListener('click', async () => {
    darkMode = !darkMode;
    saveProfileLocal();
    applyTheme();
    await saveProfileState();
    if (activePage === 'analytics') { renderBarChart(); renderLineChart(); }
  });

  // ── Settings: currency ──
  document.getElementById('currency-select')?.addEventListener('change', async e => {
    currency = e.target.value;
    saveProfileLocal();
    await saveProfileState();
    if (activePage === 'dashboard') renderDashboard();
    if (activePage === 'analytics') renderAnalytics();
  });
  // Set saved currency
  const curSel = document.getElementById('currency-select');
  if (curSel) curSel.value = currency;

  // ── Settings: export ──
  document.getElementById('btn-export')?.addEventListener('click', exportCSV);
  document.getElementById('btn-export-mini')?.addEventListener('click', exportCSV);

  // ── Settings: import ──
  document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });
  document.getElementById('csv-file-input')?.addEventListener('change', e => {
    if (e.target.files[0]) handleCSVImport(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-confirm-import')?.addEventListener('click', confirmImport);

  // ── Settings: clear cache ──
  document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
    if (!confirm('Clear all local data? This cannot be undone.')) return;
    localStorage.removeItem('mb_records');
    localStorage.removeItem('mb_pending');
    localStorage.removeItem('mb_bank_balance');
    localStorage.removeItem('mb_photo');
    localStorage.removeItem('mb_currency');
    localStorage.removeItem('mb_dark');
    records = []; pendingSync = [];
    bankBalance = 0;
    userPhoto = '';
    showToast('Local cache cleared');
    renderDashboard();
  });

  // ── Settings: manual sync ──
  document.getElementById('btn-manual-sync')?.addEventListener('click', async () => {
    if (!navigator.onLine) { showToast('You are offline'); return; }
    await syncFromFirestore();
    showToast('Synced!');
    if (activePage === 'dashboard') renderDashboard();
  });

  // ── Settings: logout ──
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to logout?')) return;
    saveLocal();
    if (profileUnsub) {
      profileUnsub();
      profileUnsub = null;
    }
    if (fbAvailable && auth) {
      await signOut(auth);
    }
    currentUser = null;
    showAuth();
    showToast('Logged out');
  });

  // ── Profile photo ──
  document.getElementById('btn-change-photo')?.addEventListener('click', () => {
    document.getElementById('photo-file-input').click();
  });
  document.getElementById('photo-file-input')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      showToast('Picture Upload Failed. Please Use A image smaller than 1MB');
      e.target.value = '';
      return;
    }

    if (!fbAvailable || !currentUser) {
      showToast('Photo sync is unavailable');
      e.target.value = '';
      return;
    }

    if (!IMGBB_API_KEY || IMGBB_API_KEY === 'YOUR_IMGBB_API_KEY') {
      showToast('ImgBB API key missing');
      e.target.value = '';
      return;
    }

    const btn = document.getElementById('btn-change-photo');
    const originalHtml = btn ? btn.innerHTML : '';

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      }

      const cleanName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const formData = new FormData();
      formData.append('image', file);
      formData.append('name', cleanName);

      const resp = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMGBB_API_KEY)}`, {
        method: 'POST',
        body: formData,
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json || !json.success || !json.data) {
        throw new Error(json?.error?.message || 'ImgBB upload failed');
      }

      userPhoto = json.data.display_url || json.data.url || '';
      saveProfileLocal();
      await saveProfileState();
      updateProfileUI();
      showToast('Photo updated!');
    } catch (err) {
      console.error('Photo upload failed:', err);
      showToast('Picture Upload Failed. Please Use A image smaller than 1MB');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml || '<i class="fa-solid fa-camera"></i>';
      }
      e.target.value = '';
    }
  });

  // ── Online/Offline detection ──
  setOnlineStatus(navigator.onLine);
  window.addEventListener('online', async () => {
    setOnlineStatus(true);
    if (currentUser) {
      await flushPendingSync();
      setSyncStatus('idle');
      showToast('Back online — synced!');
    }
  });
  window.addEventListener('offline', () => {
    setOnlineStatus(false);
    setSyncStatus('pending');
    showToast('You are offline');
  });

  // ── Pull to refresh (mobile) ──
  let touchStartY = 0;
  document.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].clientY - touchStartY;
    if (diff > 80 && activePage === 'dashboard') {
      if (navigator.onLine && fbAvailable && currentUser) {
        syncFromFirestore().then(() => {
          renderDashboard();
          showToast('Refreshed');
        });
      } else {
        renderDashboard();
      }
    }
  }, { passive: true });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openAddModal('spend');
    }
  });

});
