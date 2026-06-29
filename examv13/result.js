/**
 * result.js — ExamPrep Public Results Page
 *
 * Loads all exam_results once and powers two views:
 *  1. Browse Exams  — sessions grouped by subject + date (latest date first),
 *     each opening into a leaderboard sorted by highest score first.
 *     Mobile numbers are never shown here.
 *  2. Find My Results — a student types their mobile number and sees every
 *     exam they've taken, with their rank in each one.
 */

/* ════════════════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('examprep_theme');
  if (saved) applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  localStorage.setItem('examprep_theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'light' ? 'dark' : 'light');
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);
initTheme();

/* ════════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════ */
let allResults     = [];   // every exam_results doc, fetched once
let allStudents    = [];   // all registered students (active only used for absentee calc)
let resultSessions = [];   // grouped into {subject, dateKey, entries[]}, latest date first
let currentSession = null; // session currently drilled into (browse mode), null = list view

/* ════════════════════════════════════════════════════════════════
   MODE SWITCHING
════════════════════════════════════════════════════════════════ */
function switchMode(mode) {
  document.getElementById('modeTabBrowse').classList.toggle('active', mode === 'browse');
  document.getElementById('modeTabSearch').classList.toggle('active', mode === 'search');
  document.getElementById('browsePanel').classList.toggle('active', mode === 'browse');
  document.getElementById('searchPanel').classList.toggle('active', mode === 'search');
}

/* ════════════════════════════════════════════════════════════════
   LOAD DATA (once) AND BUILD SESSIONS
════════════════════════════════════════════════════════════════ */
async function loadAllResults() {
  const container = document.getElementById('sessionsContainer');

  if (!db) {
    container.innerHTML = `<div class="empty-row"><i class="fa-solid fa-triangle-exclamation"></i> Could not connect to the database.</div>`;
    return;
  }

  try {
    const [resultsSnap, studentsSnap] = await Promise.all([
      db.collection('exam_results').orderBy('timestamp', 'desc').get(),
      db.collection('students').orderBy('name').get()
    ]);
    allResults  = resultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    allStudents = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    buildSessions();
    renderResultsView();
  } catch (err) {
    console.error('[Results] loadAllResults error:', err);
    container.innerHTML = `<div class="empty-row" style="color:var(--clr-danger)">
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

  // Pre-sort each session's entries by score (then correct) descending, highest first
  resultSessions.forEach(s => { s.entries = sortByScore(s.entries); });
}

/** Active students who did NOT submit a result for this session (matched by mobile). */
function getAbsentees(session) {
  const attended = new Set(session.entries.map(r => (r.mobile || '').trim()));
  return allStudents.filter(s => s.status !== 'inactive' && !attended.has((s.mobile || '').trim()));
}

function sortByScore(results) {
  return [...results].sort((a, b) => {
    const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (Number(b.correct) || 0) - (Number(a.correct) || 0);
  });
}

function formatSessionDate(dateKey) {
  if (!dateKey || dateKey === 'unknown') return 'Unknown date';
  try {
    return new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', weekday: 'short'
    });
  } catch { return dateKey; }
}

/* ════════════════════════════════════════════════════════════════
   BROWSE MODE — list view + leaderboard detail view
════════════════════════════════════════════════════════════════ */
function renderResultsView() {
  if (currentSession) renderSessionDetail();
  else renderSessionList(resultSessions);
}

function renderSessionList(sessions) {
  document.getElementById('sessionBackRow').style.display = 'none';
  document.getElementById('browseSearch').placeholder = 'Search by subject or date…';

  const container = document.getElementById('sessionsContainer');
  const countEl   = document.getElementById('sessionCount');
  countEl.textContent = `${sessions.length} exam${sessions.length !== 1 ? 's' : ''} found`;

  if (sessions.length === 0) {
    container.innerHTML = `<div class="empty-row"><i class="fa-solid fa-inbox"></i> No results published yet.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="session-list">
      ${sessions.map(s => {
        const topScore = s.entries.length ? (Number(s.entries[0].percentage) || 0) : 0;
        return `
          <button class="session-card" onclick="openSessionDetail('${esc(s.subject)}','${s.dateKey}')">
            <div class="session-card-icon"><i class="fa-solid fa-book-open"></i></div>
            <div class="session-card-main">
              <span class="session-card-subject">${esc(s.subject)}</span>
              <span class="session-card-date"><i class="fa-regular fa-calendar"></i> ${formatSessionDate(s.dateKey)}</span>
            </div>
            <div class="session-card-stats">
              <span class="session-stat session-stat-count"><i class="fa-solid fa-users"></i> ${s.entries.length} result${s.entries.length !== 1 ? 's' : ''}</span>
              <span class="session-stat session-stat-top"><i class="fa-solid fa-crown"></i> Top ${topScore}%</span>
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
  document.getElementById('browseSearch').value = '';
  renderResultsView();
}

function closeSessionDetail() {
  currentSession = null;
  document.getElementById('browseSearch').value = '';
  renderResultsView();
}

function renderSessionDetail() {
  const session = currentSession;
  document.getElementById('sessionBackRow').style.display = 'block';
  document.getElementById('browseSearch').placeholder = 'Search by name…';

  const q = document.getElementById('browseSearch').value.toLowerCase();
  const entries   = session.entries.filter(r => !q || (r.name || '').toLowerCase().includes(q));
  const absentees = getAbsentees(session).filter(s =>
    !q || (s.name || '').toLowerCase().includes(q)
  );

  const countEl = document.getElementById('sessionCount');
  const absentTotal = getAbsentees(session).length;
  countEl.textContent = `${session.entries.length} result${session.entries.length !== 1 ? 's' : ''}` +
    (absentTotal > 0 ? ` · ${absentTotal} absent` : '');

  const rows = entries.map(r => {
    const rank   = session.entries.indexOf(r) + 1;
    const pct    = Number(r.percentage) || 0;
    const passed = pct >= 40;
    return `
      <tr>
        <td>${rankBadge(rank)}</td>
        <td><strong>${esc(r.name || '—')}</strong></td>
        <td>${r.score ?? '—'}${r.totalQuestions ? ' / ' + r.totalQuestions : ''}</td>
        <td><span class="${passed ? 'score-pass' : 'score-fail'}">${pct}%</span></td>
        <td style="color:var(--clr-success)">${r.correct ?? '—'}</td>
        <td style="color:var(--clr-danger)">${r.wrong ?? '—'}</td>
        <td style="color:var(--clr-text-faint)">${r.untouched ?? '—'}</td>
        <td>${esc(r.duration || '—')}</td>
      </tr>
    `;
  }).join('');

  // Only render absent section if there are absentees
  const absentSection = absentees.length > 0 ? `
    <div class="session-detail-absent">
      <div class="absent-header">
        <i class="fa-solid fa-user-xmark"></i>
        <span>Didn't Attend</span>
        <span class="absent-count">${absentees.length}</span>
      </div>
      <div class="absent-list">
        ${absentees.map(s => `
          <div class="absent-chip">
            <i class="fa-solid fa-circle-user"></i>
            <span>${esc(s.name || '—')}</span>
            ${s.batch ? `<span class="absent-batch">${esc(s.batch)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const container = document.getElementById('sessionsContainer');
  container.innerHTML = `
    <div class="session-detail-header">
      <i class="fa-solid fa-book-open"></i>
      <div>
        <h3>${esc(session.subject)}</h3>
        <span><i class="fa-regular fa-calendar"></i> ${formatSessionDate(session.dateKey)}</span>
      </div>
    </div>

    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Rank</th><th>Name</th><th>Score</th><th>%</th>
            <th>Correct</th><th>Wrong</th><th>Skipped</th><th>Duration</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-row">No matching results.</td></tr>'}</tbody>
      </table>
    </div>

    ${absentSection}
  `;
}

function rankBadge(rank) {
  const cls = rank <= 3 ? ` rank-${rank}` : '';
  const icon = rank === 1 ? '<i class="fa-solid fa-crown"></i>' : '';
  return `<span class="rank-badge${cls}">${icon}${rank}</span>`;
}

function filterBrowseView() {
  if (currentSession) { renderSessionDetail(); return; }
  const q = document.getElementById('browseSearch').value.toLowerCase();
  if (!q) { renderSessionList(resultSessions); return; }
  const filtered = resultSessions.filter(s =>
    s.subject.toLowerCase().includes(q) ||
    formatSessionDate(s.dateKey).toLowerCase().includes(q) ||
    s.dateKey.includes(q)
  );
  renderSessionList(filtered);
}

/* ════════════════════════════════════════════════════════════════
   FIND MY RESULTS — search by mobile number
════════════════════════════════════════════════════════════════ */

/** Normalizes a mobile number down to its core subscriber digits for matching. */
function normalizeMobile(m) {
  let d = String(m || '').trim().replace(/[^\d]/g, '');
  if (d.startsWith('880')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return d;
}

document.getElementById('lookupMobile').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchMyResults();
});
document.getElementById('lookupMobile').addEventListener('input', () => {
  document.getElementById('lookupError').textContent = '';
});

function searchMyResults() {
  const raw = document.getElementById('lookupMobile').value;
  const errorEl = document.getElementById('lookupError');
  const container = document.getElementById('myResultsContainer');
  errorEl.textContent = '';

  const target = normalizeMobile(raw);
  if (!target || target.length < 6) {
    errorEl.textContent = 'Please enter a valid mobile number.';
    container.innerHTML = '';
    return;
  }

  if (!allResults.length && resultSessions.length === 0) {
    // Data may still be loading on a slow connection
    container.innerHTML = `<div class="empty-row"><div class="spinner-sm"></div> Still loading results, please try again in a moment…</div>`;
    return;
  }

  const matches = allResults.filter(r => normalizeMobile(r.mobile) === target);

  if (matches.length === 0) {
    container.innerHTML = `<div class="empty-row"><i class="fa-solid fa-circle-info"></i> No exam results found for this mobile number.</div>`;
    return;
  }

  // Sort the student's own results latest exam first
  const sorted = [...matches].sort((a, b) => {
    const ka = getResultDateKey(a), kb = getResultDateKey(b);
    if (ka !== kb) return ka < kb ? 1 : -1;
    return 0;
  });

  container.innerHTML = `
    <p class="record-count">${matches.length} result${matches.length !== 1 ? 's' : ''} found for ${esc(sorted[0].name || 'this number')}</p>
    ${sorted.map(r => {
      const dateKey  = getResultDateKey(r);
      const session  = resultSessions.find(s => s.subject === (r.subject || 'Unknown Subject') && s.dateKey === dateKey);
      const rank     = session ? session.entries.indexOf(r) + 1 : null;
      const total    = session ? session.entries.length : null;
      const pct      = Number(r.percentage) || 0;
      const passed   = pct >= 40;
      return `
        <div class="my-result-card">
          <div class="my-result-icon"><i class="fa-solid fa-book-open"></i></div>
          <div class="my-result-main">
            <div class="my-result-subject">${esc(r.subject || 'Unknown Subject')}</div>
            <div class="my-result-date"><i class="fa-regular fa-calendar"></i> ${formatSessionDate(dateKey)}</div>
          </div>
          <div class="my-result-stats">
            <span class="my-result-score ${passed ? 'score-pass' : 'score-fail'}">${r.score ?? '—'}${r.totalQuestions ? '/' + r.totalQuestions : ''} (${pct}%)</span>
            ${rank ? `<span class="my-result-rank">Rank ${rank} of ${total}</span>` : ''}
          </div>
        </div>
      `;
    }).join('')}
  `;
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

/* ════════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════════ */
loadAllResults();
