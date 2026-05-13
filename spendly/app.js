/* =====================================================
   Spendly App — app.js
   Full offline-first expense tracker with Firebase sync
   ===================================================== */

/* =====================================================
   SECTION 1: CONSTANTS & CONFIG
   ===================================================== */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBzuJkT4Xi-GbLsyNZs7WSqQLPditJQ0Do",
  authDomain: "finance-tracker-c85f8.firebaseapp.com",
  projectId: "finance-tracker-c85f8",
  storageBucket: "finance-tracker-c85f8.firebasestorage.app",
  messagingSenderId: "555889482457",
  appId: "1:555889482457:web:c2ce8e03694c38ce747cc8",
  measurementId: "G-HV5LDL0C46"
};

const CATEGORIES = [
  { id: 'Food',          emoji: '<i class="fa-solid fa-burger"></i>',         color: '#f87171' },
  { id: 'Transport',     emoji: '<i class="fa-solid fa-car"></i>',            color: '#60a5fa' },
  { id: 'Shopping',      emoji: '<i class="fa-solid fa-bag-shopping"></i>',   color: '#f472b6' },
  { id: 'Health',        emoji: '<i class="fa-solid fa-pills"></i>',          color: '#34d399' },
  { id: 'Entertainment', emoji: '<i class="fa-solid fa-gamepad"></i>',        color: '#a78bfa' },
  { id: 'Bills',         emoji: '<i class="fa-solid fa-file-invoice"></i>',   color: '#fbbf24' },
  { id: 'Education',     emoji: '<i class="fa-solid fa-book"></i>',           color: '#2dd4bf' },
  { id: 'Travel',        emoji: '<i class="fa-solid fa-plane"></i>',          color: '#fb923c' },
  { id: 'Salary',        emoji: '<i class="fa-solid fa-briefcase"></i>',      color: '#10b981' },
  { id: 'Investment',    emoji: '<i class="fa-solid fa-chart-line"></i>',     color: '#6ee7b7' },
  { id: 'Gift',          emoji: '<i class="fa-solid fa-gift"></i>',           color: '#f9a8d4' },
  { id: 'Other',         emoji: '<i class="fa-solid fa-box"></i>',            color: '#94a3b8' },
];

const CAT_MAP        = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const LOCAL_KEY      = 'spendly_transactions';
const PREFS_KEY      = 'spendly_prefs';
const SYNC_QUEUE_KEY = 'spendly_sync_queue';

/* =====================================================
   SECTION 2: STATE
   ===================================================== */

let state = {
  user: null,
  transactions: [],
  currency: '$',
  balanceVisible: true,
  activeFilter: 'all',
  analyticsView: 'expense',
  analyticsPeriod: 'month',
  dashChartPeriod: 'week',
  editingId: null,
  transactionType: 'expense',
  selectedCategory: 'Food',
  isOnline: navigator.onLine,
  isSyncing: false,
  charts: {},
  firebaseReady: false,
  db: null,
  auth: null,
};

/* =====================================================
   SECTION 3: FIREBASE INIT
   ===================================================== */

function initFirebase() {
  try {
    const fb = window._firebase;
    if (!fb) return;

    if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId) {
      console.warn('[Spendly] Firebase config empty — running in local-only mode.');
      return;
    }

    const app  = fb.initializeApp(FIREBASE_CONFIG);
    state.auth = fb.getAuth(app);
    state.db   = fb.getFirestore(app);
    state.firebaseReady = true;

    fb.onAuthStateChanged(state.auth, user => {
      if (user) { onUserLoggedIn(user); }
      else      { showAuthScreen(); }
    });
  } catch (e) {
    console.error('[Firebase Init Error]', e);
  }
}

/* =====================================================
   SECTION 4: AUTH HANDLERS
   ===================================================== */

function switchAuthTab(tab) {
  // Only the two real tab buttons toggle active — forgot panel has no tab button
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'signup'));
  });
  document.getElementById('auth-login').classList.toggle('active',  tab === 'login');
  document.getElementById('auth-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('auth-forgot').classList.toggle('active', tab === 'forgot');
}

async function handleLogin() {
  if (!state.firebaseReady) { offlineModeLogin(); return; }
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-password').value;
  if (!email || !pw) { toast('Please fill all fields', 'warning'); return; }
  const btn = document.getElementById('login-btn');
  btn.innerHTML = '<div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div>';
  try {
    await window._firebase.signInWithEmailAndPassword(state.auth, email, pw);
  } catch (e) {
    toast(friendlyAuthError(e.code), 'error');
  } finally {
    btn.innerHTML = '<span>Sign In</span>';
  }
}

async function handleSignup() {
  if (!state.firebaseReady) { offlineModeLogin(); return; }
  const name  = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pw    = document.getElementById('signup-password').value;
  if (!name || !email || !pw) { toast('Please fill all fields', 'warning'); return; }
  if (pw.length < 6) { toast('Password must be at least 6 characters', 'warning'); return; }
  const btn = document.getElementById('signup-btn');
  btn.innerHTML = '<div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div>';
  try {
    const cred = await window._firebase.createUserWithEmailAndPassword(state.auth, email, pw);
    await window._firebase.updateProfile(cred.user, { displayName: name });
    toast('Welcome, ' + name + '!', 'success');
  } catch (e) {
    toast(friendlyAuthError(e.code), 'error');
  } finally {
    btn.innerHTML = '<span>Create Account</span>';
  }
}

async function handleForgotPassword() {
  if (!state.firebaseReady) {
    toast('Password reset requires Firebase — try again when online', 'warning');
    return;
  }
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { toast('Please enter your email address', 'warning'); return; }
  const btn = document.getElementById('forgot-btn');
  btn.innerHTML = '<div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div>';
  try {
    await window._firebase.sendPasswordResetEmail(state.auth, email);
    toast('Reset link sent! Check your inbox.', 'success');
    document.getElementById('forgot-email').value = '';
    switchAuthTab('login');
  } catch (e) {
    toast(friendlyAuthError(e.code), 'error');
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Send Reset Link</span>';
  }
}

function offlineModeLogin() {
  const name     = document.getElementById('signup-name')?.value.trim() || 'Demo User';
  const email    = document.getElementById('login-email')?.value.trim() || 'demo@spendly.app';
  const fakeUser = { uid: 'local_' + Date.now(), displayName: name || 'Demo User', email };
  toast('Running in offline mode', 'info');
  onUserLoggedIn(fakeUser);
}

async function handleLogout() {
  if (confirm('Sign out of Spendly?')) {
    try {
      if (state.firebaseReady && state.auth?.currentUser) await window._firebase.signOut(state.auth);
    } catch (e) { console.warn(e); }
    state.user         = null;
    state.transactions = [];
    showAuthScreen();
    toast('Signed out successfully', 'info');
  }
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-credential':   'Incorrect email or password.',
    'auth/email-already-in-use': 'Email already registered.',
    'auth/invalid-email':        'Invalid email address.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/too-many-requests':    'Too many attempts. Please try later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || 'Authentication error. Please try again.';
}

/* =====================================================
   SECTION 5: USER SESSION
   ===================================================== */

function onUserLoggedIn(user) {
  state.user = user;
  loadPrefs();
  loadLocalTransactions();
  renderApp();
  showAppScreen();
  loadProfilePic();   // after showAppScreen so elements are visible

  if (state.firebaseReady && state.isOnline) {
    syncFromFirestore();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  applyTheme();
  updateHeaderGreeting();
}

/* =====================================================
   SECTION 6: LOCAL STORAGE (CACHE MANAGER)
   ===================================================== */

function loadLocalTransactions() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY + '_' + state.user.uid);
    state.transactions = raw ? JSON.parse(raw) : [];
  } catch { state.transactions = []; }
}

function saveLocalTransactions() {
  try {
    localStorage.setItem(LOCAL_KEY + '_' + state.user.uid, JSON.stringify(state.transactions));
  } catch (e) { console.error('LocalStorage save failed', e); }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      state.currency       = p.currency || '$';
      state.balanceVisible = p.balanceVisible !== false;
      if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
    }
  } catch {}
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      currency:       state.currency,
      balanceVisible: state.balanceVisible,
      theme:          document.documentElement.getAttribute('data-theme')
    }));
  } catch {}
}

/* ---- Profile Picture ---- */

function getProfilePicKey() {
  return 'spendly_profile_pic_' + (state.user ? state.user.uid : 'local');
}

function loadProfilePic() {
  try {
    const pic = localStorage.getItem(getProfilePicKey());
    if (pic) applyProfilePic(pic);
  } catch {}
}

function applyProfilePic(base64) {
  const imgTag = '<img src="' + base64 + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;" />';
  var h = document.getElementById('header-avatar');
  var s = document.getElementById('settings-avatar');
  if (h) h.innerHTML = imgTag;
  if (s) s.innerHTML = imgTag;
}

function triggerProfilePicUpload() {
  var el = document.getElementById('profile-pic-input');
  if (el) el.click();
}

function handleProfilePicChange(e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please select an image file', 'warning'); return; }
  if (file.size > 5 * 1024 * 1024)    { toast('Image must be under 5 MB', 'warning');    return; }

  var reader = new FileReader();
  reader.onload = function(ev) {
    var base64 = ev.target.result;
    try {
      localStorage.setItem(getProfilePicKey(), base64);
      applyProfilePic(base64);
      toast('Profile picture updated!', 'success');
    } catch(err) {
      toast('Could not save image — storage may be full', 'error');
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function getSyncQueue() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY + '_' + state.user.uid) || '[]');
  } catch { return []; }
}

function saveSyncQueue(q) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY + '_' + state.user.uid, JSON.stringify(q));
  } catch {}
}

function addToSyncQueue(op) {
  const q   = getSyncQueue();
  const idx = q.findIndex(x => x.id === op.id && x.type === op.type);
  if (idx > -1) q.splice(idx, 1);
  q.push(Object.assign({}, op, { queuedAt: Date.now() }));
  saveSyncQueue(q);
}

function clearCache() {
  if (!confirm('Clear all local data? This cannot be undone.')) return;
  localStorage.removeItem(LOCAL_KEY      + '_' + state.user.uid);
  localStorage.removeItem(SYNC_QUEUE_KEY + '_' + state.user.uid);
  state.transactions = [];
  renderAll();
  toast('Local cache cleared', 'info');
}

/* =====================================================
   SECTION 7: FIRESTORE SYNC MANAGER
   ===================================================== */

async function syncFromFirestore() {
  if (!state.firebaseReady || !state.db || !state.user) return;
  if (state.user.uid.startsWith('local_')) return;
  const { collection, query, orderBy, getDocs } = window._firebase;
  try {
    const q    = query(collection(state.db, 'users/' + state.user.uid + '/transactions'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    const remote = [];
    snap.forEach(d => remote.push(Object.assign({}, d.data(), { id: d.id, synced: true })));
    mergeSyncData(remote);
    saveLocalTransactions();
    updateSyncBadge();
  } catch (e) {
    console.error('[Sync from Firestore error]', e);
  }
}

function mergeSyncData(remote) {
  const localMap = {};
  state.transactions.forEach(t => { localMap[t.id] = t; });

  remote.forEach(r => {
    const local = localMap[r.id];
    if (!local) {
      if (!r.deleted) state.transactions.push(Object.assign({}, r, { synced: true }));
    } else {
      const remoteTs = (r.updatedAt && r.updatedAt.seconds) ? r.updatedAt.seconds : 0;
      const localTs  = local.updatedAt ? new Date(local.updatedAt).getTime() / 1000 : 0;
      if (remoteTs > localTs) {
        const idx = state.transactions.findIndex(t => t.id === r.id);
        if (idx > -1) {
          if (r.deleted) state.transactions.splice(idx, 1);
          else           state.transactions[idx] = Object.assign({}, r, { synced: true });
        }
      }
    }
  });

  const remoteIds = new Set(remote.map(r => r.id));
  state.transactions = state.transactions.filter(t => {
    if (t.synced && !remoteIds.has(t.id)) return false;
    return !t.deleted;
  });
}

async function syncNow() {
  // Guard: user may not be logged in yet (called from setOnlineStatus on boot)
  if (!state.user)         return;
  if (!state.isOnline)     { toast('You are offline — data saved locally', 'warning'); return; }
  if (!state.firebaseReady){ toast('Firebase not configured', 'warning'); return; }
  if (state.user.uid.startsWith('local_')) { toast('Running in offline demo mode', 'info'); return; }
  if (state.isSyncing)     { toast('Sync already in progress…', 'info'); return; }

  state.isSyncing = true;
  toast('Syncing…', 'info');
  try {
    await flushSyncQueue();
    await syncFromFirestore();
    renderAll();
    toast('Synced successfully', 'success');
  } catch (e) {
    toast('Sync failed: ' + e.message, 'error');
  } finally {
    state.isSyncing = false;
  }
}

async function flushSyncQueue() {
  if (!state.firebaseReady || !state.db) return;
  const queue = getSyncQueue();
  if (!queue.length) return;

  const { doc, setDoc, deleteDoc, serverTimestamp } = window._firebase;
  const remaining = [];

  for (const op of queue) {
    try {
      const ref = doc(state.db, 'users/' + state.user.uid + '/transactions', op.id);
      if (op.type === 'delete') {
        await deleteDoc(ref);
      } else {
        const data = Object.assign({}, op.data);
        delete data.synced;
        await setDoc(ref, Object.assign({}, data, { updatedAt: serverTimestamp() }), { merge: true });
      }
    } catch (e) {
      console.warn('[Sync queue error]', e);
      remaining.push(op);
    }
  }
  saveSyncQueue(remaining);
}

async function persistToFirestore(tx) {
  if (!state.firebaseReady || !state.db || !state.isOnline) return;
  if (state.user.uid.startsWith('local_')) return;
  try {
    const { doc, setDoc, serverTimestamp } = window._firebase;
    const ref  = doc(state.db, 'users/' + state.user.uid + '/transactions', tx.id);
    const data = Object.assign({}, tx);
    delete data.synced;
    await setDoc(ref, Object.assign({}, data, { updatedAt: serverTimestamp() }), { merge: true });
    const idx = state.transactions.findIndex(t => t.id === tx.id);
    if (idx > -1) state.transactions[idx].synced = true;
    saveLocalTransactions();
    updateSyncBadge();
  } catch (e) {
    console.warn('[Firestore persist error]', e);
    addToSyncQueue({ id: tx.id, type: 'upsert', data: tx });
    toast('Saved locally — will sync when online', 'warning');
  }
}

async function deleteFromFirestore(id) {
  if (!state.firebaseReady || !state.db || !state.isOnline) return;
  if (state.user.uid.startsWith('local_')) return;
  try {
    const { doc, deleteDoc } = window._firebase;
    await deleteDoc(doc(state.db, 'users/' + state.user.uid + '/transactions', id));
  } catch (e) {
    addToSyncQueue({ id: id, type: 'delete', data: null });
  }
}

function updateSyncBadge() {
  const queue = getSyncQueue();
  const badge = document.getElementById('settings-sync-badge');
  const desc  = document.getElementById('sync-status-desc');
  if (!badge) return;
  if (queue.length > 0) {
    badge.className = 'sync-badge pending';
    badge.innerHTML = '<i class="fa-solid fa-clock"></i> ' + queue.length + ' pending sync';
    if (desc) desc.textContent = queue.length + ' changes waiting to sync';
  } else {
    badge.className = 'sync-badge';
    badge.innerHTML = state.isOnline
      ? '<i class="fa-solid fa-circle-check"></i> All synced'
      : '<i class="fa-solid fa-plug-circle-xmark"></i> Offline';
    if (desc) desc.textContent = 'Sync local data with cloud';
  }
}

/* =====================================================
   SECTION 8: TRANSACTION CRUD
   ===================================================== */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function saveTransaction() {
  const amount  = parseFloat(document.getElementById('tx-amount').value);
  const title   = document.getElementById('tx-title').value.trim();
  const note    = document.getElementById('tx-note').value.trim();
  const dateVal = document.getElementById('tx-date').value;
  const editId  = document.getElementById('tx-edit-id').value;

  if (!amount || amount <= 0) { toast('Please enter a valid amount', 'warning'); return; }
  if (!title)                  { toast('Please enter a title', 'warning');        return; }

  const now = new Date().toISOString();
  const tx = {
    id:        editId || generateId(),
    type:      state.transactionType,
    amount:    parseFloat(amount.toFixed(2)),
    category:  state.selectedCategory,
    title:     title,
    note:      note,
    createdAt: editId ? ((state.transactions.find(t => t.id === editId) || {}).createdAt || now) : now,
    updatedAt: now,
    synced:    false,
    deleted:   false,
  };

  if (dateVal) tx.createdAt = new Date(dateVal).toISOString();

  if (editId) {
    const idx = state.transactions.findIndex(t => t.id === editId);
    if (idx > -1) state.transactions[idx] = tx;
    else          state.transactions.unshift(tx);
    toast('Transaction updated', 'success');
  } else {
    state.transactions.unshift(tx);
    toast('Transaction added', 'success');
  }

  saveLocalTransactions();
  addToSyncQueue({ id: tx.id, type: 'upsert', data: tx });
  persistToFirestore(tx);
  renderAll();
  closeModal();
}

function editTransaction(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  openModal('edit', tx);
}

async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.transactions.splice(idx, 1);
  saveLocalTransactions();
  addToSyncQueue({ id: id, type: 'delete', data: null });
  await deleteFromFirestore(id);
  renderAll();
  toast('Transaction deleted', 'info');
}

/* =====================================================
   SECTION 9: CALCULATIONS
   ===================================================== */

function getVisibleTransactions() {
  return state.transactions.filter(t => !t.deleted);
}

function calcTotals(txns) {
  return txns.reduce(function(acc, t) {
    if (t.type === 'income') acc.income  += t.amount;
    else                     acc.expense += t.amount;
    return acc;
  }, { income: 0, expense: 0 });
}

function fmt(amount) {
  const abs = Math.abs(amount);
  const formatted = abs >= 1000
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : abs.toFixed(2);
  return state.currency + formatted;
}

function getThisMonth() {
  const now = new Date();
  return getVisibleTransactions().filter(t => {
    const d = new Date(t.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
}

function getThisWeek() {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  return getVisibleTransactions().filter(t => new Date(t.createdAt) >= weekAgo);
}

function getCategoryBreakdown(txns, type) {
  const bd = {};
  txns.filter(t => t.type === type).forEach(t => {
    bd[t.category] = (bd[t.category] || 0) + t.amount;
  });
  return bd;
}

function getWeeklyData(type) {
  const days   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const totals = [0,0,0,0,0,0,0];
  const now    = new Date();
  const start  = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1);
  start.setHours(0, 0, 0, 0);

  getVisibleTransactions().filter(t => t.type === type).forEach(t => {
    const diff = Math.floor((new Date(t.createdAt) - start) / 86400000);
    if (diff >= 0 && diff < 7) totals[diff] += t.amount;
  });
  return { labels: days, data: totals };
}

function getMonthlyData(type) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const totals = [0,0,0,0,0,0,0,0,0,0,0,0];
  const year   = new Date().getFullYear();
  getVisibleTransactions().filter(t => t.type === type).forEach(t => {
    const d = new Date(t.createdAt);
    if (d.getFullYear() === year) totals[d.getMonth()] += t.amount;
  });
  return { labels: months, data: totals };
}

/* =====================================================
   SECTION 10: RENDER ENGINE
   ===================================================== */

function renderAll() {
  renderDashboard();
  renderAnalytics();
  renderTransactionsList();
  updateSyncBadge();
}

function renderDashboard() {
  const all    = getVisibleTransactions();
  const month  = getThisMonth();
  const totals = calcTotals(all);
  const mTotals = calcTotals(month);
  const savings = totals.income - totals.expense;

  document.getElementById('hero-balance').textContent  = fmt(Math.max(savings, 0));
  document.getElementById('hero-income').textContent   = fmt(totals.income);
  document.getElementById('hero-expense').textContent  = fmt(totals.expense);
  document.getElementById('hero-savings').textContent  = fmt(Math.max(savings, 0));
  document.getElementById('month-income').textContent  = fmt(mTotals.income);
  document.getElementById('month-expense').textContent = fmt(mTotals.expense);

  document.getElementById('balance-hero').classList.toggle('balance-hidden', !state.balanceVisible);

  renderTransactionCards('recent-transactions-list', getVisibleTransactions().slice(0, 8), true);
  renderDashChart();
}

function renderDashChart() {
  const period = state.dashChartPeriod;
  const expRes = period === 'week' ? getWeeklyData('expense')  : getMonthlyData('expense');
  const incRes = period === 'week' ? getWeeklyData('income')   : getMonthlyData('income');
  const canvas = document.getElementById('dash-chart');
  if (!canvas) return;
  if (state.charts.dash) state.charts.dash.destroy();

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gc     = isDark ? 'rgba(167,139,250,0.1)' : 'rgba(124,58,237,0.08)';
  const tc     = isDark ? 'rgba(245,240,255,0.5)' : 'rgba(26,8,51,0.5)';

  state.charts.dash = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: expRes.labels,
      datasets: [
        { label: 'Income',  data: incRes.data, backgroundColor: 'rgba(52,211,153,0.7)',  borderRadius: 6, borderSkipped: false },
        { label: 'Expense', data: expRes.data, backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 6, borderSkipped: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + state.currency + ctx.raw.toFixed(2) }}},
      scales: {
        x: { stacked: false, grid: { color: gc }, ticks: { color: tc, font: { size: 10 } } },
        y: { stacked: false, grid: { color: gc }, ticks: { color: tc, font: { size: 10 }, callback: v => state.currency + v } }
      }
    }
  });
}

function renderAnalytics() {
  const type   = state.analyticsView;
  const period = state.analyticsPeriod;
  let txns;
  if      (period === 'week')  txns = getThisWeek().filter(t  => t.type === type);
  else if (period === 'month') txns = getThisMonth().filter(t => t.type === type);
  else                         txns = getVisibleTransactions().filter(t => t.type === type);

  const total = txns.reduce((s, t) => s + t.amount, 0);
  document.getElementById('analytics-total').textContent = fmt(total);

  const barRes = period === 'week' ? getWeeklyData(type) : getMonthlyData(type);
  renderAnalyticsBar(barRes.labels, barRes.data);

  const bd = getCategoryBreakdown(getVisibleTransactions(), type);
  renderAnalyticsPie(bd);
  renderCategoryLegend(bd, total > 0 ? total : 1);
  renderTransactionCards('analytics-recent-list', txns.slice(0, 5), true);
}

function renderAnalyticsBar(labels, data) {
  const canvas = document.getElementById('analytics-bar-chart');
  if (!canvas) return;
  if (state.charts.analyticsBar) state.charts.analyticsBar.destroy();

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gc     = isDark ? 'rgba(167,139,250,0.1)' : 'rgba(124,58,237,0.08)';
  const tc     = isDark ? 'rgba(245,240,255,0.5)' : 'rgba(26,8,51,0.5)';

  state.charts.analyticsBar = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: state.analyticsView === 'expense' ? 'Expenses' : 'Income',
        data:  data,
        backgroundColor: state.analyticsView === 'expense' ? 'rgba(167,139,250,0.8)' : 'rgba(52,211,153,0.8)',
        borderRadius: 8, borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + state.currency + ctx.raw.toFixed(2) }}},
      scales: {
        x: { grid: { color: gc }, ticks: { color: tc, font: { size: 10 } } },
        y: { grid: { color: gc }, ticks: { color: tc, font: { size: 10 }, callback: v => state.currency + v } }
      }
    }
  });
}

function renderAnalyticsPie(breakdown) {
  const canvas = document.getElementById('analytics-pie-chart');
  if (!canvas) return;
  if (state.charts.pie) state.charts.pie.destroy();
  const cats   = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const labels = cats.map(c => c[0]);
  const data   = cats.map(c => c[1]);
  const colors = cats.map(c => (CAT_MAP[c[0]] || {}).color || '#94a3b8');
  if (!data.length) return;
  state.charts.pie = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 2, borderColor: 'transparent', hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + state.currency + ctx.raw.toFixed(2) + ' (' + ((ctx.raw / data.reduce((a,b)=>a+b,0))*100).toFixed(1) + '%)' }}
      }
    }
  });
}

function renderCategoryLegend(breakdown, total) {
  const container = document.getElementById('category-legend');
  if (!container) return;
  const cats = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  if (!cats.length) { container.innerHTML = '<div class="empty-state"><div class="empty-desc">No data</div></div>'; return; }
  container.innerHTML = cats.map(function(entry) {
    var id  = entry[0], val = entry[1];
    var cat = CAT_MAP[id] || { emoji: '<i class="fa-solid fa-box"></i>', color: '#94a3b8' };
    var pct = Math.round((val / total) * 100);
    return '<div class="legend-item" style="flex-direction:column;align-items:stretch;gap:6px">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:1rem;width:20px;text-align:center">' + cat.emoji + '</span>'
      + '<span class="legend-label">' + id + '</span>'
      + '<span class="legend-value">' + fmt(val) + '</span>'
      + '<span class="badge badge-purple">' + pct + '%</span>'
      + '</div>'
      + '<div class="legend-bar"><div class="legend-bar-fill" style="width:' + pct + '%;background:' + cat.color + '"></div></div>'
      + '</div>';
  }).join('');
}

function renderTransactionsList() {
  const search = (document.getElementById('tx-search') ? document.getElementById('tx-search').value : '').toLowerCase();
  const filter = state.activeFilter;
  var txns     = getVisibleTransactions();

  if (search) {
    txns = txns.filter(t =>
      t.title.toLowerCase().includes(search) ||
      t.category.toLowerCase().includes(search) ||
      (t.note || '').toLowerCase().includes(search)
    );
  }
  if (filter !== 'all') {
    if (filter === 'income' || filter === 'expense') txns = txns.filter(t => t.type === filter);
    else                                              txns = txns.filter(t => t.category === filter);
  }

  const groups = {};
  txns.forEach(t => {
    const d   = new Date(t.createdAt);
    const key = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday'
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  const container = document.getElementById('all-transactions-list');
  if (!container) return;

  if (!Object.keys(groups).length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div><div class="empty-title">No transactions found</div><div class="empty-desc">Try a different search or filter</div></div>';
    return;
  }
  container.innerHTML = Object.entries(groups).map(function(entry) {
    var date = entry[0], list = entry[1];
    return '<div class="mb-3"><div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;padding:0 2px">' + date + '</div>'
      + list.map(t => transactionCardHTML(t, true)).join('') + '</div>';
  }).join('');
}

function renderTransactionCards(containerId, txns, showActions) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!txns.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-money-bill-transfer"></i></div><div class="empty-title">No transactions yet</div><div class="empty-desc">Tap the + button to add your first transaction</div></div>';
    return;
  }
  container.innerHTML = txns.map(t => transactionCardHTML(t, showActions)).join('');
}

function transactionCardHTML(tx, showActions) {
  const cat      = CAT_MAP[tx.category] || { emoji: '<i class="fa-solid fa-box"></i>', color: '#94a3b8' };
  const d        = new Date(tx.createdAt);
  const timeStr  = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const sign     = tx.type === 'income' ? '+' : '-';
  const syncIcon = tx.synced ? '' : '<span title="Pending sync" style="font-size:0.7rem;opacity:0.5"><i class="fa-solid fa-clock"></i></span>';
  return '<div class="transaction-card ' + tx.type + '" onclick="editTransaction(\'' + tx.id + '\')">'
    + '<div class="transaction-icon" style="background:' + cat.color + '22">' + cat.emoji + '</div>'
    + '<div class="transaction-info">'
    + '<div class="transaction-title">' + escHtml(tx.title) + '</div>'
    + '<div class="transaction-meta"><span class="transaction-cat-badge">' + tx.category + '</span><span>' + timeStr + '</span>' + syncIcon + '</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">'
    + '<div class="transaction-amount ' + tx.type + '">' + sign + fmt(tx.amount) + '</div>'
    + '<div class="transaction-actions" onclick="event.stopPropagation()">'
    + '<button class="tx-action-btn" onclick="editTransaction(\'' + tx.id + '\')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>'
    + '<button class="tx-action-btn del" onclick="deleteTransaction(\'' + tx.id + '\')" title="Delete"><i class="fa-solid fa-trash-can"></i></button>'
    + '</div></div></div>';
}

/* =====================================================
   SECTION 11: MODAL MANAGEMENT
   ===================================================== */

function openModal(mode, tx) {
  tx = tx || null;
  const overlay = document.getElementById('modal-overlay');
  const title   = document.getElementById('modal-title');

  document.getElementById('tx-amount').value  = '';
  document.getElementById('tx-title').value   = '';
  document.getElementById('tx-note').value    = '';
  document.getElementById('tx-edit-id').value = '';
  document.getElementById('tx-date').value    = new Date().toISOString().slice(0, 16);

  buildCategoryGrid();

  if (mode === 'edit' && tx) {
    title.textContent = 'Edit Transaction';
    document.getElementById('tx-edit-id').value = tx.id;
    document.getElementById('tx-amount').value  = tx.amount;
    document.getElementById('tx-title').value   = tx.title;
    document.getElementById('tx-note').value    = tx.note || '';
    document.getElementById('tx-date').value    = new Date(tx.createdAt).toISOString().slice(0, 16);
    state.transactionType  = tx.type;
    state.selectedCategory = tx.category;
    setTransactionType(tx.type, false);
    highlightCategory(tx.category);
  } else {
    title.textContent = 'Add Transaction';
    state.transactionType  = 'expense';
    state.selectedCategory = 'Food';
    setTransactionType('expense', false);
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function() { document.getElementById('tx-amount').focus(); }, 300);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function setTransactionType(type, rebuild) {
  if (rebuild === undefined) rebuild = true;
  state.transactionType = type;
  document.getElementById('type-expense').classList.toggle('active', type === 'expense');
  document.getElementById('type-income').classList.toggle('active',  type === 'income');
  if (rebuild) buildCategoryGrid();
}

function buildCategoryGrid() {
  const grid = document.getElementById('cat-grid');
  if (!grid) return;
  grid.innerHTML = CATEGORIES.map(c =>
    '<button class="cat-btn' + (c.id === state.selectedCategory ? ' selected' : '') + '" onclick="selectCategory(\'' + c.id + '\')">'
    + '<span>' + c.emoji + '</span><span>' + c.id + '</span></button>'
  ).join('');
}

function selectCategory(id) {
  state.selectedCategory = id;
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('selected', b.textContent.includes(id));
  });
}

function highlightCategory(id) {
  state.selectedCategory = id;
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('selected', b.textContent.includes(id));
  });
}

/* =====================================================
   SECTION 12: NAVIGATION
   ===================================================== */

function navigate(page) {
  document.querySelectorAll('.page').forEach(p     => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  var pg = document.getElementById('page-' + page);
  var nv = document.getElementById('nav-'  + page);
  if (pg) pg.classList.add('active');
  if (nv) nv.classList.add('active');
  if (page === 'analytics')    renderAnalytics();
  if (page === 'transactions') renderTransactionsList();
  if (page === 'home')         renderDashboard();
}

/* =====================================================
   SECTION 13: HEADER & UI HELPERS
   ===================================================== */

function updateHeaderGreeting() {
  const hour = new Date().getHours();
  const g    = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (state.user && state.user.displayName)
    ? state.user.displayName
    : (state.user && state.user.email ? state.user.email.split('@')[0] : 'User');
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  document.getElementById('greeting-time').textContent = g + '!';
  document.getElementById('greeting-name').textContent = name;
  document.getElementById('hero-username').textContent = (state.user && state.user.email) ? state.user.email : 'Local Mode';
  document.getElementById('settings-name').textContent  = name;
  document.getElementById('settings-email').textContent = (state.user && state.user.email) ? state.user.email : 'Offline Mode';

  // Only set initials when no profile picture is saved — avoids wiping the avatar image
  var savedPic = state.user ? localStorage.getItem(getProfilePicKey()) : null;
  if (!savedPic) {
    var ha = document.getElementById('header-avatar');
    var sa = document.getElementById('settings-avatar');
    if (ha) ha.textContent = initials;
    if (sa) sa.textContent = initials;
  }
}

function renderApp() {
  buildCategoryGrid();
  renderAll();
  updateHeaderGreeting();
  applyPrefsUI();
}

function applyPrefsUI() {
  document.getElementById('currency-select').value = state.currency;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  document.getElementById('theme-toggle').checked = isDark;
}

function toggleBalanceVisibility() {
  state.balanceVisible = !state.balanceVisible;
  document.getElementById('balance-hero').classList.toggle('balance-hidden', !state.balanceVisible);
  document.getElementById('eye-btn').innerHTML = state.balanceVisible
    ? '<i class="fa-solid fa-eye"></i>'
    : '<i class="fa-solid fa-eye-slash"></i>';
  savePrefs();
}

function toggleTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  savePrefs();
  setTimeout(function() { renderDashChart(); renderAnalytics(); }, 100);
}

function applyTheme() {
  // Wrapped in try/catch — corrupted localStorage must not crash the app
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) {
      const p = JSON.parse(stored);
      if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
    }
  } catch(e) {}
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = isDark;
}

function setCurrency(val) {
  state.currency = val;
  savePrefs();
  renderAll();
  toast('Currency set to ' + val, 'info');
}

/* =====================================================
   SECTION 14: FILTER & SEARCH
   ===================================================== */

function setFilter(f, el) {
  state.activeFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderTransactionsList();
}

function filterTransactions() { renderTransactionsList(); }

function switchDashChart(period, btn) {
  state.dashChartPeriod = period;
  btn.closest('.chart-tabs').querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderDashChart();
}

function switchAnalyticsView(view, btn) {
  state.analyticsView = view;
  btn.closest('.analytics-toggle').querySelectorAll('.analytics-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAnalytics();
}

function switchAnalyticsPeriod(period, btn) {
  state.analyticsPeriod = period;
  btn.closest('.chart-tabs').querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAnalytics();
}

/* =====================================================
   SECTION 15: CSV IMPORT / EXPORT
   ===================================================== */

function exportCSV() {
  const txns = getVisibleTransactions();
  if (!txns.length) { toast('No transactions to export', 'warning'); return; }

  const headers = ['id','type','amount','category','title','note','createdAt','updatedAt','synced'];
  const rows = txns.map(t =>
    headers.map(h => {
      const v = (t[h] !== undefined && t[h] !== null) ? t[h] : '';
      const s = String(v).replace(/"/g, '""');
      return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) ? '"' + s + '"' : s;
    }).join(',')
  );

  const csv  = [headers.join(',')].concat(rows).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = 'spendly_export_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);
  toast('Exported ' + txns.length + ' transactions', 'success');
}

function triggerImport() {
  document.getElementById('csv-import-input').click();
}

function handleImport(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try { parseAndImportCSV(ev.target.result); }
    catch(err) { toast('Import failed: ' + err.message, 'error'); }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
}

function parseAndImportCSV(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(Boolean);
  if (lines.length < 2) { toast('CSV file is empty', 'warning'); return; }

  const headers  = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const required = ['type','amount','category','title'];
  if (!required.every(r => headers.indexOf(r) !== -1)) {
    toast('CSV missing required columns: type, amount, category, title', 'error');
    return;
  }

  const imported = [], errors = [];
  for (var i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      const row    = {};
      headers.forEach(function(h, idx) { row[h] = (values[idx] || '').trim(); });
      if (['income','expense'].indexOf(row.type) === -1) { errors.push(i+1); continue; }
      const amount = parseFloat(row.amount);
      if (!amount || amount <= 0) { errors.push(i+1); continue; }
      const now = new Date().toISOString();
      imported.push({
        id: row.id || generateId(), type: row.type, amount: amount,
        category: row.category || 'Other', title: row.title || 'Imported',
        note: row.note || '', createdAt: row.createdAt || now,
        updatedAt: now, synced: false, deleted: false,
      });
    } catch(e) { errors.push(i+1); }
  }

  if (!imported.length) { toast('No valid rows found in CSV', 'error'); return; }
  const existingIds = {};
  state.transactions.forEach(t => { existingIds[t.id] = true; });
  const newTxns = imported.filter(t => !existingIds[t.id]);
  state.transactions = newTxns.concat(state.transactions);
  saveLocalTransactions();
  newTxns.forEach(t => addToSyncQueue({ id: t.id, type: 'upsert', data: t }));
  renderAll();
  toast('Imported ' + newTxns.length + ' transactions' + (errors.length ? ' (' + errors.length + ' rows skipped)' : ''), 'success');
  if (state.isOnline && state.firebaseReady) setTimeout(flushSyncQueue, 2000);
}

function parseCSVLine(line) {
  const result = [];
  var cur = '', inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/* =====================================================
   SECTION 16: ONLINE / OFFLINE DETECTION
   ===================================================== */

function setOnlineStatus(online) {
  state.isOnline = online;
  const indicator = document.getElementById('status-indicator');
  const text      = document.getElementById('status-text');
  if (!indicator) return;
  indicator.className = 'status-indicator ' + (online ? 'online' : 'offline');
  if (text) text.textContent = online ? 'Online' : 'Offline';

  if (online) {
    if (state.user) toast('Back online — syncing…', 'success');
    syncNow(); // syncNow() guards against null user
  } else {
    if (state.user) toast('You are offline — changes saved locally', 'warning');
  }
}

window.addEventListener('online',  function() { setOnlineStatus(true); });
window.addEventListener('offline', function() { setOnlineStatus(false); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'TRIGGER_SYNC') syncNow();
  });
}

/* =====================================================
   SECTION 17: PWA REGISTRATION
   ===================================================== */

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(function(reg) { console.log('[SW] Registered:', reg.scope); })
      .catch(function(e)  { console.warn('[SW] Registration failed:', e); });
  }
}

/* =====================================================
   SECTION 18: TOAST NOTIFICATIONS
   ===================================================== */

function toast(message, type, duration) {
  type     = type     || 'info';
  duration = duration || 3500;
  const icons = {
    success: '<i class="fa-solid fa-circle-check"></i>',
    error:   '<i class="fa-solid fa-circle-xmark"></i>',
    warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
    info:    '<i class="fa-solid fa-circle-info"></i>'
  };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = '<span class="toast-icon">' + (icons[type] || icons.info) + '</span><span class="toast-msg">' + escHtml(message) + '</span>';
  container.appendChild(el);
  setTimeout(function() {
    el.classList.add('removing');
    el.addEventListener('animationend', function() { el.remove(); });
  }, duration);
}

/* =====================================================
   SECTION 19: UTILITY HELPERS
   ===================================================== */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isToday(d) {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function isYesterday(d) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear();
}

/* =====================================================
   SECTION 20: KEYBOARD SHORTCUTS
   ===================================================== */

document.addEventListener('keydown', function(e) {
  var appScreen = document.getElementById('app-screen');
  if (!appScreen || appScreen.classList.contains('hidden')) return;
  if (e.key === 'Escape') { closeModal(); }
  if (e.key === 'n' && !e.target.matches('input,textarea,select') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); openModal('add');
  }
  if (!e.target.matches('input,textarea,select')) {
    if (e.key === '1') navigate('home');
    if (e.key === '2') navigate('analytics');
    if (e.key === '3') navigate('transactions');
    if (e.key === '4') navigate('settings');
  }
});

/* =====================================================
   SECTION 21: SAMPLE DATA (demo / first run)
   ===================================================== */

function seedDemoData(uid) {
  const key = 'spendly_seeded_' + uid;
  if (localStorage.getItem(key)) return;

  const now = new Date();
  function d(daysAgo, h, m) {
    h = h || 12; m = m || 0;
    const dt = new Date(now);
    dt.setDate(dt.getDate() - daysAgo);
    dt.setHours(h, m, 0, 0);
    return dt.toISOString();
  }

  const demo = [
    { id: generateId(), type:'income',  amount:3200, category:'Salary',       title:'Monthly Salary',       note:'August paycheck', createdAt:d(0,9),  updatedAt:d(0,9),  synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:85,   category:'Food',          title:'Grocery Shopping',     note:'Whole Foods',     createdAt:d(0,11), updatedAt:d(0,11), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:1200, category:'Bills',         title:'Rent Payment',         note:'August rent',     createdAt:d(1,10), updatedAt:d(1,10), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:35,   category:'Transport',     title:'Uber Ride',            note:'',               createdAt:d(1,18), updatedAt:d(1,18), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:120,  category:'Shopping',      title:'New Clothes',          note:'Zara',           createdAt:d(2,14), updatedAt:d(2,14), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:15,   category:'Entertainment', title:'Netflix Subscription', note:'Monthly',        createdAt:d(2,9),  updatedAt:d(2,9),  synced:false, deleted:false },
    { id: generateId(), type:'income',  amount:450,  category:'Investment',    title:'Dividend Income',      note:'Q2 dividends',   createdAt:d(3,10), updatedAt:d(3,10), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:62,   category:'Health',        title:'Gym Membership',       note:'',               createdAt:d(3,16), updatedAt:d(3,16), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:230,  category:'Travel',        title:'Flight Tickets',       note:'Weekend trip',   createdAt:d(5,11), updatedAt:d(5,11), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:42,   category:'Food',          title:'Restaurant Dinner',    note:'Date night',     createdAt:d(5,19), updatedAt:d(5,19), synced:false, deleted:false },
    { id: generateId(), type:'expense', amount:320,  category:'Education',     title:'Online Course',        note:'Udemy course',   createdAt:d(6,10), updatedAt:d(6,10), synced:false, deleted:false },
    { id: generateId(), type:'income',  amount:800,  category:'Gift',          title:'Birthday Gift Money',  note:'From family',    createdAt:d(7,12), updatedAt:d(7,12), synced:false, deleted:false },
  ];

  state.transactions = demo.concat(state.transactions);
  saveLocalTransactions();
  localStorage.setItem(key, '1');
}

/* =====================================================
   SECTION 22: BOOTSTRAP
   ===================================================== */

function bootstrap() {
  if (window._firebase && FIREBASE_CONFIG.apiKey) {
    initFirebase();
  } else {
    console.log('[Spendly] No Firebase config — local mode');
    showAuthScreen();
    document.getElementById('login-btn').onclick = function() {
      const name  = 'Demo User';
      const email = document.getElementById('login-email').value || 'demo@spendly.app';
      const fake  = { uid: 'local_demo', displayName: name, email: email };
      onUserLoggedIn(fake);
      seedDemoData('local_demo');
      renderAll();
    };
    document.getElementById('signup-btn').onclick = function() {
      const name  = document.getElementById('signup-name').value.trim()  || 'New User';
      const email = document.getElementById('signup-email').value.trim() || 'user@spendly.app';
      const fake  = { uid: 'local_' + Date.now(), displayName: name, email: email };
      onUserLoggedIn(fake);
      seedDemoData(fake.uid);
      renderAll();
    };
  }
  registerSW();
  setOnlineStatus(navigator.onLine);
}

function waitForChartJS(cb, attempts) {
  attempts = attempts || 0;
  if (window.Chart) { cb(); return; }
  if (attempts > 30) { console.warn('Chart.js not loaded'); cb(); return; }
  setTimeout(function() { waitForChartJS(cb, attempts + 1); }, 200);
}

document.addEventListener('DOMContentLoaded', function() {
  waitForChartJS(bootstrap);
});

/* =====================================================
   EXPOSE GLOBALS (HTML onclick handlers)
   ===================================================== */
window.switchAuthTab           = switchAuthTab;
window.handleLogin             = handleLogin;
window.handleSignup            = handleSignup;
window.handleForgotPassword    = handleForgotPassword;
window.handleLogout            = handleLogout;
window.navigate                = navigate;
window.openModal               = openModal;
window.closeModal              = closeModal;
window.closeModalOnOverlay     = closeModalOnOverlay;
window.setTransactionType      = setTransactionType;
window.selectCategory          = selectCategory;
window.saveTransaction         = saveTransaction;
window.editTransaction         = editTransaction;
window.deleteTransaction       = deleteTransaction;
window.setFilter               = setFilter;
window.filterTransactions      = filterTransactions;
window.switchDashChart         = switchDashChart;
window.switchAnalyticsView     = switchAnalyticsView;
window.switchAnalyticsPeriod   = switchAnalyticsPeriod;
window.toggleBalanceVisibility = toggleBalanceVisibility;
window.toggleTheme             = toggleTheme;
window.setCurrency             = setCurrency;
window.exportCSV               = exportCSV;
window.triggerImport           = triggerImport;
window.handleImport            = handleImport;
window.syncNow                 = syncNow;
window.clearCache              = clearCache;
window.triggerProfilePicUpload = triggerProfilePicUpload;
window.handleProfilePicChange  = handleProfilePicChange;
