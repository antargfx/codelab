/**
 * admin.js — ExamPrep v3 Admin Panel
 *
 * Features:
 *  - Admin password gate (hardcoded; change ADMIN_PASSWORD below)
 *  - Add / Edit / Delete students in Firestore `students` collection
 *  - View all exam results from `exam_results` collection
 *  - Search & filter both tables
 *  - Light/dark theme toggle
 */

'use strict';

/* ════════════════════════════════════════════════════════════════
   CONFIG — Change this to your desired admin password
════════════════════════════════════════════════════════════════ */
const ADMIN_PASSWORD = 'admin@exam2024';

/* ════════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════ */
let allStudents = [];    // Full list fetched from Firestore
let allResults  = [];    // Full list of exam results
let resultSessions = []; // Results grouped by {subject, dateKey} — sorted, latest date first
let currentSession  = null; // The session object currently drilled into (null = list view)
let editingId   = null;  // Doc ID when editing a student
let pendingDeleteId = null;

/* ════════════════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════════════════ */
(function initTheme() {
  const saved = localStorage.getItem('examprep_theme');
  if (saved) applyTheme(saved);
})();

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  localStorage.setItem('examprep_theme', theme);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
});

/* ════════════════════════════════════════════════════════════════
   SCREEN MANAGEMENT
════════════════════════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab' + cap(tab)).classList.add('active');
  document.getElementById('nav' + cap(tab)).classList.add('active');
  const mobileNav = document.getElementById('mobileNav' + cap(tab));
  if (mobileNav) mobileNav.classList.add('active');
  if (tab === 'results') loadResults();
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ════════════════════════════════════════════════════════════════
   ADMIN LOGIN GATE
════════════════════════════════════════════════════════════════ */

// Toggle password visibility
document.getElementById('toggleAdminPw').addEventListener('click', () => {
  const inp  = document.getElementById('adminPw');
  const icon = document.getElementById('toggleAdminPwIcon');
  const isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  icon.className = isHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
});

document.getElementById('adminPw').addEventListener('keydown', e => {
  if (e.key === 'Enter') adminLogin();
});

function adminLogin() {
  const pw = document.getElementById('adminPw').value;
  const alertEl = document.getElementById('adminLoginAlert');

  if (pw === ADMIN_PASSWORD) {
    alertEl.classList.remove('show');
    document.body.classList.add('admin-authed');
    showScreen('adminDashboard');
    loadStudents();
  } else {
    alertEl.textContent = 'Incorrect admin password. Please try again.';
    alertEl.classList.add('show');
  }
}

function adminLogout() {
  document.getElementById('adminPw').value = '';
  document.body.classList.remove('admin-authed');
  showScreen('adminLoginScreen');
}

/* ════════════════════════════════════════════════════════════════
   STUDENTS — LOAD FROM FIRESTORE
════════════════════════════════════════════════════════════════ */

async function loadStudents() {
  if (!db) { showToast('Firebase not available', 'error'); return; }

  const tbody = document.getElementById('studentTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-row"><div class="spinner-sm"></div> Loading students…</td></tr>';

  try {
    const snap = await db.collection('students').orderBy('name').get();
    allStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStudentTable(allStudents);
  } catch (err) {
    console.error('[Admin] loadStudents error:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row" style="color:var(--clr-danger)">
      <i class="fa-solid fa-triangle-exclamation"></i> Failed to load students: ${err.message}
    </td></tr>`;
  }
}

function renderStudentTable(students) {
  const tbody = document.getElementById('studentTableBody');
  const count = document.getElementById('studentCount');
  count.textContent = `${students.length} student${students.length !== 1 ? 's' : ''} found`;

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row"><i class="fa-solid fa-inbox"></i> No students found. Add one above.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(s.name || '—')}</strong></td>
      <td>${s.mobile
        ? `<a class="mobile-link" href="${toWhatsAppLink(s.mobile)}" target="_blank" rel="noopener" title="Chat on WhatsApp"><i class="fa-brands fa-whatsapp"></i> ${esc(s.mobile)}</a>`
        : '—'}</td>
      <td>${s.admissionDate ? formatDate(s.admissionDate) : '—'}</td>
      <td>${esc(s.batch || '—')}</td>
      <td>${esc(s.email || '—')}</td>
      <td><span class="badge ${s.status === 'inactive' ? 'badge-inactive' : 'badge-active'}">${s.status || 'active'}</span></td>
      <td>
        <div class="row-actions">
          <button class="action-btn" title="Edit" onclick="openEditModal('${s.id}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="action-btn delete" title="Delete" onclick="openDeleteModal('${s.id}', '${esc(s.name)}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterStudents() {
  const q = document.getElementById('studentSearch').value.toLowerCase();
  if (!q) { renderStudentTable(allStudents); return; }
  const filtered = allStudents.filter(s =>
    (s.name   || '').toLowerCase().includes(q) ||
    (s.mobile || '').toLowerCase().includes(q) ||
    (s.batch  || '').toLowerCase().includes(q) ||
    (s.email  || '').toLowerCase().includes(q)
  );
  renderStudentTable(filtered);
}

/* ════════════════════════════════════════════════════════════════
   ADD / EDIT STUDENT MODAL
════════════════════════════════════════════════════════════════ */

function openAddModal() {
  editingId = null;
  document.getElementById('modalStudentTitle').innerHTML =
    '<i class="fa-solid fa-user-plus"></i> Add Student';
  clearStudentForm();
  document.getElementById('studentModal').classList.add('open');
}

function openEditModal(id) {
  editingId = id;
  const s = allStudents.find(x => x.id === id);
  if (!s) return;

  document.getElementById('modalStudentTitle').innerHTML =
    '<i class="fa-solid fa-pen"></i> Edit Student';

  document.getElementById('sName').value       = s.name       || '';
  document.getElementById('sMobile').value     = s.mobile     || '';
  document.getElementById('sAdmission').value  = s.admissionDate || '';
  document.getElementById('sBatch').value      = s.batch      || '';
  document.getElementById('sEmail').value      = s.email      || '';
  document.getElementById('sStatus').value     = s.status     || 'active';
  document.getElementById('sNotes').value      = s.notes      || '';

  clearModalAlert();
  clearFormErrors();
  document.getElementById('studentModal').classList.add('open');
}

function closeAddModal() {
  document.getElementById('studentModal').classList.remove('open');
  clearStudentForm();
  editingId = null;
}

function clearStudentForm() {
  ['sName','sMobile','sAdmission','sBatch','sEmail','sNotes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('sStatus').value = 'active';
  clearModalAlert();
  clearFormErrors();
}

function clearFormErrors() {
  ['sNameErr','sMobileErr'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
}

function clearModalAlert() {
  const el = document.getElementById('modalAlert');
  el.textContent = '';
  el.classList.remove('show');
}

function showModalAlert(msg) {
  const el = document.getElementById('modalAlert');
  el.textContent = msg;
  el.classList.add('show');
}

async function saveStudent() {
  clearFormErrors();
  clearModalAlert();

  const name       = document.getElementById('sName').value.trim();
  const mobile     = document.getElementById('sMobile').value.trim();
  const admission  = document.getElementById('sAdmission').value;
  const batch      = document.getElementById('sBatch').value.trim();
  const email      = document.getElementById('sEmail').value.trim();
  const status     = document.getElementById('sStatus').value;
  const notes      = document.getElementById('sNotes').value.trim();

  let hasError = false;

  if (!name) {
    document.getElementById('sNameErr').textContent = 'Full name is required.';
    document.getElementById('sName').classList.add('input-error');
    hasError = true;
  }

  if (!mobile) {
    document.getElementById('sMobileErr').textContent = 'Mobile number is required.';
    document.getElementById('sMobile').classList.add('input-error');
    hasError = true;
  } else if (!/^\+?\d{7,15}$/.test(mobile)) {
    document.getElementById('sMobileErr').textContent = 'Enter a valid mobile number (7–15 digits).';
    document.getElementById('sMobile').classList.add('input-error');
    hasError = true;
  }

  if (hasError) return;

  // Check for duplicate mobile (exclude self when editing)
  const duplicate = allStudents.find(s =>
    s.mobile === mobile && s.id !== editingId
  );
  if (duplicate) {
    document.getElementById('sMobileErr').textContent = `This mobile is already registered under "${duplicate.name}".`;
    document.getElementById('sMobile').classList.add('input-error');
    return;
  }

  const btn = document.getElementById('saveStudentBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

  const payload = { name, mobile, admissionDate: admission, batch, email, status, notes,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

  try {
    if (editingId) {
      await db.collection('students').doc(editingId).update(payload);
      showToast('Student updated successfully!', 'success');
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('students').add(payload);
      showToast('Student added successfully!', 'success');
    }

    closeAddModal();
    await loadStudents();
  } catch (err) {
    console.error('[Admin] saveStudent error:', err);
    showModalAlert('Failed to save: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Student';
  }
}

/* ════════════════════════════════════════════════════════════════
   DELETE STUDENT
════════════════════════════════════════════════════════════════ */

function openDeleteModal(id, name) {
  pendingDeleteId = id;
  document.getElementById('deleteModalMsg').textContent =
    `Are you sure you want to delete "${name}"? This action cannot be undone.`;
  document.getElementById('deleteModal').classList.add('open');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('deleteModal').classList.remove('open');
}

async function confirmDelete() {
  if (!pendingDeleteId) return;

  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting…';

  try {
    await db.collection('students').doc(pendingDeleteId).delete();
    showToast('Student deleted.', 'info');
    closeDeleteModal();
    await loadStudents();
  } catch (err) {
    console.error('[Admin] deleteStudent error:', err);
    showToast('Delete failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-trash"></i> Yes, Delete';
  }
}

/* ════════════════════════════════════════════════════════════════
   RESULTS — LOAD FROM FIRESTORE, GROUPED BY SUBJECT + DATE
════════════════════════════════════════════════════════════════ */

/**
 * Fetches all exam results + all students fresh from Firestore,
 * then rebuilds the subject+date session groupings.
 */
async function fetchResultsAndStudents() {
  const [resultsSnap, studentsSnap] = await Promise.all([
    db.collection('exam_results').orderBy('timestamp', 'desc').get(),
    db.collection('students').orderBy('name').get()
  ]);
  allResults  = resultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  allStudents = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  buildSessions();
}

async function loadResults() {
  if (!db) { showToast('Firebase not available', 'error'); return; }

  const container = document.getElementById('resultsContainer');
  container.innerHTML = `<div class="empty-row" style="padding:40px;text-align:center"><div class="spinner-sm"></div> Loading results…</div>`;

  try {
    await fetchResultsAndStudents();
    currentSession = null;
    document.getElementById('resultSearch').value = '';
    renderResultsView();
  } catch (err) {
    console.error('[Admin] loadResults error:', err);
    container.innerHTML = `<div class="empty-row" style="padding:40px;text-align:center;color:var(--clr-danger)">
      <i class="fa-solid fa-triangle-exclamation"></i> Failed to load results: ${err.message}
    </div>`;
  }
}

/** Returns the YYYY-MM-DD calendar date (local time) a result was submitted on. */
function getResultDateKey(r) {
  let d = null;
  if (r.submitTime) {
    const parsed = new Date(r.submitTime);
    if (!isNaN(parsed)) d = parsed;
  }
  if (!d && r.timestamp && typeof r.timestamp.toDate === 'function') {
    d = r.timestamp.toDate();
  }
  if (!d) return 'unknown';

  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Groups allResults into {subject, dateKey, entries[]} sessions, newest date first. */
function buildSessions() {
  const groups = {};
  allResults.forEach(r => {
    const subject = r.subject || 'Unknown Subject';
    const dateKey = getResultDateKey(r);
    const key = subject + '|' + dateKey;
    if (!groups[key]) groups[key] = { subject, dateKey, entries: [] };
    groups[key].entries.push(r);
  });

  resultSessions = Object.values(groups).sort((a, b) => {
    const ka = a.dateKey === 'unknown' ? '0000-00-00' : a.dateKey;
    const kb = b.dateKey === 'unknown' ? '0000-00-00' : b.dateKey;
    if (ka !== kb) return ka < kb ? 1 : -1; // descending — latest date on top
    return a.subject.localeCompare(b.subject);
  });
}

/** Active students who are NOT among a session's attendees (by mobile number). */
function getAbsentees(session) {
  const attended = new Set(session.entries.map(r => (r.mobile || '').trim()));
  return allStudents.filter(s => s.status !== 'inactive' && !attended.has((s.mobile || '').trim()));
}

function formatSessionDate(dateKey) {
  if (!dateKey || dateKey === 'unknown') return 'Unknown date';
  try {
    return new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', weekday: 'short'
    });
  } catch { return dateKey; }
}

function renderResultsView() {
  if (currentSession) renderSessionDetail();
  else renderSessionList(resultSessions);
}

/* ── LIST VIEW: one card per subject + date ───────────────────── */
function renderSessionList(sessions) {
  document.getElementById('sessionBackRow').style.display = 'none';
  document.getElementById('resultSearch').placeholder = 'Search by subject or date…';

  const container = document.getElementById('resultsContainer');
  const countEl   = document.getElementById('resultCount');
  countEl.textContent = `${sessions.length} exam session${sessions.length !== 1 ? 's' : ''} found`;

  if (sessions.length === 0) {
    container.innerHTML = `<div class="empty-row" style="padding:40px;text-align:center"><i class="fa-solid fa-inbox"></i> No exam results found.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="session-list">
      ${sessions.map(s => {
        const absentCount = getAbsentees(s).length;
        return `
          <button class="session-card" onclick="openSessionDetail('${esc(s.subject)}','${s.dateKey}')">
            <div class="session-card-icon"><i class="fa-solid fa-book-open"></i></div>
            <div class="session-card-main">
              <span class="session-card-subject">${esc(s.subject)}</span>
              <span class="session-card-date"><i class="fa-regular fa-calendar"></i> ${formatSessionDate(s.dateKey)}</span>
            </div>
            <div class="session-card-stats">
              <span class="session-stat session-stat-attended"><i class="fa-solid fa-user-check"></i> ${s.entries.length} attended</span>
              <span class="session-stat session-stat-absent"><i class="fa-solid fa-user-xmark"></i> ${absentCount} absent</span>
            </div>
            <i class="fa-solid fa-chevron-right session-card-arrow"></i>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function openSessionDetail(subject, dateKey) {
  currentSession = resultSessions.find(s => s.subject === subject && s.dateKey === dateKey) || null;
  document.getElementById('resultSearch').value = '';
  renderResultsView();
}

function closeSessionDetail() {
  currentSession = null;
  document.getElementById('resultSearch').value = '';
  renderResultsView();
}

/* ── DETAIL VIEW: attendees table + absentee table for one session ── */
function renderSessionDetail() {
  const session = currentSession;
  document.getElementById('sessionBackRow').style.display = 'block';
  document.getElementById('resultSearch').placeholder = 'Search by name or mobile…';

  const q = document.getElementById('resultSearch').value.toLowerCase();
  const entries = sortResults(session.entries).filter(r =>
    !q || (r.name || '').toLowerCase().includes(q) || (r.mobile || '').toLowerCase().includes(q)
  );
  const absentees = getAbsentees(session).filter(s =>
    !q || (s.name || '').toLowerCase().includes(q) || (s.mobile || '').toLowerCase().includes(q)
  );

  const countEl = document.getElementById('resultCount');
  countEl.textContent = `${session.entries.length} result${session.entries.length !== 1 ? 's' : ''} · ${getAbsentees(session).length} active student${getAbsentees(session).length !== 1 ? 's' : ''} absent`;

  const rows = entries.map((r, i) => {
    const pct    = Number(r.percentage) || 0;
    const passed = pct >= 40;
    const ts     = r.submitTime ? new Date(r.submitTime).toLocaleString() : '—';
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${esc(r.name || '—')}</strong></td>
        <td>${esc(r.mobile || '—')}</td>
        <td><span class="${passed ? 'score-pass' : 'score-fail'}">${r.score ?? '—'}</span></td>
        <td style="color:var(--clr-success)">${r.correct ?? '—'}</td>
        <td style="color:var(--clr-danger)">${r.wrong ?? '—'}</td>
        <td style="color:var(--clr-text-faint)">${r.untouched ?? '—'}</td>
        <td><span class="${passed ? 'score-pass' : 'score-fail'}">${pct}%</span></td>
        <td>${esc(r.duration || '—')}</td>
        <td style="white-space:nowrap;font-size:0.8rem;color:var(--clr-text-muted)">${ts}</td>
        <td>
          <button class="action-btn delete" title="Delete result" onclick="openDeleteResultModal('${r.id}', '${esc(r.name || 'this result')}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  const absentRows = absentees.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(s.name || '—')}</strong></td>
      <td>${esc(s.mobile || '—')}</td>
      <td>${esc(s.batch || '—')}</td>
    </tr>
  `).join('');

  const container = document.getElementById('resultsContainer');
  container.innerHTML = `
    <div class="session-detail-header">
      <i class="fa-solid fa-book-open"></i>
      <div>
        <h3>${esc(session.subject)}</h3>
        <span><i class="fa-regular fa-calendar"></i> ${formatSessionDate(session.dateKey)}</span>
      </div>
    </div>

    <div class="subject-group">
      <div class="subject-group-header">
        <i class="fa-solid fa-circle-check" style="color:var(--clr-success)"></i>
        <span>Attended</span>
        <span class="subject-count">${entries.length} of ${session.entries.length}</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>Mobile</th><th>Score</th><th>Correct</th>
              <th>Wrong</th><th>Skipped</th><th>%</th><th>Duration</th><th>Submitted</th><th>Action</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="11" class="empty-row">No matching results.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="subject-group">
      <div class="subject-group-header danger-header">
        <i class="fa-solid fa-user-xmark"></i>
        <span>Absent — Active students who didn't attend</span>
        <span class="subject-count">${absentees.length}</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr><th>#</th><th>Name</th><th>Mobile</th><th>Batch / Class</th></tr>
          </thead>
          <tbody>${absentRows || '<tr><td colspan="4" class="empty-row"><i class="fa-solid fa-circle-check" style="color:var(--clr-success)"></i> All active students attended this exam.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function sortResults(results) {
  return [...results].sort((a, b) => {
    const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (Number(b.correct) || 0) - (Number(a.correct) || 0);
  });
}

function filterResults() {
  if (currentSession) {
    renderSessionDetail();
    return;
  }
  const q = document.getElementById('resultSearch').value.toLowerCase();
  if (!q) { renderSessionList(resultSessions); return; }
  const filtered = resultSessions.filter(s =>
    s.subject.toLowerCase().includes(q) ||
    formatSessionDate(s.dateKey).toLowerCase().includes(q) ||
    s.dateKey.includes(q)
  );
  renderSessionList(filtered);
}

/* ════════════════════════════════════════════════════════════════
   DELETE RESULT
════════════════════════════════════════════════════════════════ */

let pendingDeleteResultId = null;

function openDeleteResultModal(id, name) {
  pendingDeleteResultId = id;
  document.getElementById('deleteResultModalMsg').textContent =
    `Are you sure you want to delete the result for "${name}"? This cannot be undone.`;
  document.getElementById('deleteResultModal').classList.add('open');
}

function closeDeleteResultModal() {
  pendingDeleteResultId = null;
  document.getElementById('deleteResultModal').classList.remove('open');
}

async function confirmDeleteResult() {
  if (!pendingDeleteResultId) return;

  const btn = document.getElementById('confirmDeleteResultBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting…';

  try {
    await db.collection('exam_results').doc(pendingDeleteResultId).delete();
    showToast('Result deleted.', 'info');
    closeDeleteResultModal();

    const sessionKey = currentSession
      ? { subject: currentSession.subject, dateKey: currentSession.dateKey }
      : null;

    await fetchResultsAndStudents();

    currentSession = sessionKey
      ? resultSessions.find(s => s.subject === sessionKey.subject && s.dateKey === sessionKey.dateKey) || null
      : null;
    renderResultsView();
  } catch (err) {
    console.error('[Admin] deleteResult error:', err);
    showToast('Delete failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-trash"></i> Yes, Delete';
  }
}

/* ════════════════════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════════════════════ */

let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.className = `toast toast-${type} show`;
  const icon = type === 'success' ? 'circle-check' : type === 'error' ? 'triangle-exclamation' : 'circle-info';
  toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${msg}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch { return dateStr; }
}

/** Converts a stored mobile number into a wa.me WhatsApp chat link. */
function toWhatsAppLink(mobile) {
  if (!mobile) return null;
  let digits = String(mobile).trim().replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) digits = digits.slice(2);            // 0088... -> 88...
  else if (digits.startsWith('0')) digits = '880' + digits.slice(1); // local 01XXXXXXXXX -> 880XXXXXXXXX
  else if (digits.length === 10) digits = '880' + digits;            // bare 10-digit local -> add country code

  return `https://wa.me/${digits}`;
}

// Clear input-error on typing
document.querySelectorAll('#sName, #sMobile').forEach(el => {
  el.addEventListener('input', () => el.classList.remove('input-error'));
});
