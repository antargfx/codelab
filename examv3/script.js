/**
 * script.js — ExamPrep v3
 *
 * Changes from v2:
 *  - Login: mobile number only (name & password remain)
 *  - Mobile validated against Firestore `students` collection
 *  - Student name auto-filled from database
 *  - Not-found → WhatsApp contact link shown
 *
 * Load order: config.js → firebase.js → script.js
 */

'use strict';

/* ════════════════════════════════════════════════════════════════
   CONSTANTS & STATE
════════════════════════════════════════════════════════════════ */

const LS_KEY = 'examprep_state_v3';

const exam = {
  data: null,
  questions: [],
  password: '',
  subject: '',
  examTimeMinutes: 0,
  totalMarks: 100,
  negativeMark: 0.25,

  studentName: '',
  studentMobile: '',

  answers: {},
  visited: new Set(),

  timerInterval: null,
  remainingSeconds: 0,

  startTime: null,
  submitTime: null,

  tabSwitchCount: 0,
  maxTabSwitches: 3,
};


/* ════════════════════════════════════════════════════════════════
   THEME TOGGLE
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


/* ════════════════════════════════════════════════════════════════
   SCREEN MANAGEMENT
════════════════════════════════════════════════════════════════ */

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}


/* ════════════════════════════════════════════════════════════════
   DATA LOADING
════════════════════════════════════════════════════════════════ */

async function loadExamData() {
  showScreen('loadingScreen');

  try {
    const response = await fetch('questions.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Could not fetch questions.json`);

    const data = await response.json();

    if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('questions.json is missing the "questions" array or it is empty.');
    }
    if (!data.password) throw new Error('questions.json is missing the "password" field.');

    exam.data            = data;
    exam.questions       = data.questions;
    exam.password        = String(data.password);
    exam.subject         = data.subject         || 'General';
    exam.examTimeMinutes = Number(data.examTime) || 60;
    exam.totalMarks      = Number(data.totalMarks) || exam.questions.length;
    exam.negativeMark    = Number(data.negativeMark) ?? 0.25;

    populateLoginInfo();
    showScreen('loginScreen');

  } catch (err) {
    console.error('[ExamPrep] Failed to load exam data:', err);
    document.getElementById('errorMessage').textContent = err.message;
    showScreen('errorScreen');
  }
}

function populateLoginInfo() {
  document.getElementById('loginSubject').textContent  = exam.subject;
  document.getElementById('loginDuration').textContent = `${exam.examTimeMinutes} minutes`;
  document.getElementById('loginMarks').textContent    = exam.totalMarks;
  document.getElementById('loginNegative').textContent =
    exam.negativeMark > 0 ? `-${exam.negativeMark} per wrong answer` : 'None';
}


/* ════════════════════════════════════════════════════════════════
   LOGIN — Mobile lookup + password check
════════════════════════════════════════════════════════════════ */

document.getElementById('togglePw').addEventListener('click', () => {
  const pwField = document.getElementById('examPassword');
  const icon    = document.getElementById('togglePwIcon');
  const isHidden = pwField.type === 'password';
  pwField.type = isHidden ? 'text' : 'password';
  icon.className = isHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
});

async function handleLogin() {
  const mobile   = document.getElementById('studentMobile').value.trim();
  const password = document.getElementById('examPassword').value.trim();

  clearLoginErrors();
  hideNotFound();

  let hasError = false;

  // Validate mobile format
  if (!mobile) {
    showFieldError('mobileError', 'Mobile number is required.');
    highlightInput('studentMobile');
    hasError = true;
  } else if (!/^\+?\d{7,15}$/.test(mobile)) {
    showFieldError('mobileError', 'Enter a valid mobile number (7–15 digits).');
    highlightInput('studentMobile');
    hasError = true;
  }

  // Validate password
  if (!password) {
    showFieldError('passwordError', 'Exam password is required.');
    highlightInput('examPassword');
    hasError = true;
  } else if (password !== exam.password) {
    showFieldError('passwordError', 'Incorrect password. Please check and try again.');
    highlightInput('examPassword');
    showLoginAlert('Incorrect exam password. Access denied.');
    hasError = true;
  }

  if (hasError) return;

  // Disable button while checking
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying…';

  // Lookup mobile in Firestore
  const { found, student, error } = await lookupStudent(mobile);

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Exam';

  if (error) {
    showLoginAlert('Could not verify your registration. Please try again.');
    return;
  }

  if (!found) {
    showNotFound();
    return;
  }

  // Student found — use their name from the database
  exam.studentName   = student.name || 'Student';
  exam.studentMobile = mobile;
  startExam();
}

function showFieldError(id, msg) {
  document.getElementById(id).textContent = msg;
}

function highlightInput(id) {
  const el = document.getElementById(id);
  el.classList.add('input-error');
  el.addEventListener('input', () => el.classList.remove('input-error'), { once: true });
}

function showLoginAlert(msg) {
  const el = document.getElementById('loginAlert');
  el.textContent = msg;
  el.classList.add('show');
}

function clearLoginErrors() {
  ['mobileError', 'passwordError'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
  const alert = document.getElementById('loginAlert');
  alert.textContent = '';
  alert.classList.remove('show');
}

function showNotFound() {
  document.getElementById('notFoundAlert').style.display = 'flex';
  document.getElementById('startBtn').style.display = 'none';
}

function hideNotFound() {
  document.getElementById('notFoundAlert').style.display = 'none';
  document.getElementById('startBtn').style.display = '';
}

document.getElementById('loginForm').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

// Reset not-found banner when user edits the mobile field
document.getElementById('studentMobile').addEventListener('input', hideNotFound);


/* ════════════════════════════════════════════════════════════════
   EXAM INITIALISATION
════════════════════════════════════════════════════════════════ */

function startExam() {
  const restored = restoreFromLocalStorage();

  if (!restored) {
    exam.answers          = {};
    exam.visited          = new Set();
    exam.tabSwitchCount   = 0;
    exam.remainingSeconds = exam.examTimeMinutes * 60;
    exam.startTime        = new Date().toISOString();
  }

  document.getElementById('topbarSubject').textContent = exam.subject;
  document.getElementById('topbarStudent').textContent = exam.studentName;
  document.getElementById('totalQNum').textContent     = exam.questions.length;

  renderAllQuestions();
  startTimer();
  registerAntiCheat();
  window.addEventListener('beforeunload', handleBeforeUnload);

  showScreen('examScreen');
  updateStats();
}


/* ════════════════════════════════════════════════════════════════
   RENDER ALL QUESTIONS (scrollable)
════════════════════════════════════════════════════════════════ */

function renderAllQuestions() {
  const container = document.getElementById('examScrollBody');
  container.innerHTML = '';

  exam.questions.forEach((q, i) => {
    const card = document.createElement('div');
    card.className  = 'question-card';
    card.id         = `qcard-${q.id}`;
    card.setAttribute('data-qid', q.id);

    card.innerHTML = `
      <div class="question-card-header">
        <span class="q-badge">Q${i + 1}</span>
        <span class="q-category">Multiple Choice</span>
        <span class="q-status-icon" id="qstatus-${q.id}">
          <i class="fa-regular fa-circle"></i>
        </span>
      </div>
      <p class="question-text">${q.question}</p>
      <div class="options-grid" id="opts-${q.id}"></div>
    `;

    container.appendChild(card);
    renderOptions(q, document.getElementById(`opts-${q.id}`));
  });

  // Restore previously selected answers
  Object.entries(exam.answers).forEach(([qId, key]) => {
    updateOptionUI(parseInt(qId, 10), key);
    updateCardState(parseInt(qId, 10), true);
  });

  updateStats();
}

function renderOptions(q, grid) {
  grid.innerHTML = '';
  const savedAns = exam.answers[q.id];

  Object.entries(q.options).forEach(([key, text]) => {
    const isSelected = savedAns === key;
    const label = document.createElement('label');
    label.className  = 'option-label' + (isSelected ? ' selected' : '');
    label.setAttribute('role', 'radio');
    label.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    label.setAttribute('tabindex', '0');
    label.setAttribute('data-key', key);
    label.setAttribute('data-qid', q.id);

    label.innerHTML = `
      <input type="radio" name="q${q.id}" value="${key}" ${isSelected ? 'checked' : ''} />
      <span class="omr-bubble">${key}</span>
      <span class="option-text">${text}</span>
    `;

    label.addEventListener('click', () => selectOption(q.id, key));
    label.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectOption(q.id, key); }
    });

    grid.appendChild(label);
  });
}

function selectOption(qId, key) {
  exam.visited.add(qId);
  exam.answers[qId] = key;
  updateOptionUI(qId, key);
  updateCardState(qId, true);
  updateStats();
  saveToLocalStorage();
}

function updateOptionUI(qId, selectedKey) {
  const grid = document.getElementById(`opts-${qId}`);
  if (!grid) return;
  grid.querySelectorAll('.option-label').forEach(label => {
    const radio  = label.querySelector('input[type="radio"]');
    const isThis = label.getAttribute('data-key') === selectedKey;
    label.classList.toggle('selected', isThis);
    label.setAttribute('aria-checked', isThis ? 'true' : 'false');
    if (radio) radio.checked = isThis;
  });
}

function updateCardState(qId, answered) {
  const card = document.getElementById(`qcard-${qId}`);
  if (!card) return;
  card.classList.toggle('answered', answered);

  const statusIcon = document.getElementById(`qstatus-${qId}`);
  if (!statusIcon) return;
  statusIcon.innerHTML = answered
    ? '<i class="fa-solid fa-circle-check answered"></i>'
    : '<i class="fa-regular fa-circle"></i>';
  statusIcon.className = 'q-status-icon' + (answered ? ' answered' : '');
}


/* ════════════════════════════════════════════════════════════════
   STATS BAR
════════════════════════════════════════════════════════════════ */

function updateStats() {
  const total      = exam.questions.length;
  const answered   = Object.keys(exam.answers).length;
  const visited    = exam.visited.size;
  const unanswered = Math.max(0, visited - answered);
  const remaining  = total - visited;

  document.getElementById('statAnswered').textContent    = answered;
  document.getElementById('statAnsweredBar').textContent = answered;
  document.getElementById('statUnanswered').textContent  = unanswered;
  document.getElementById('statRemaining').textContent   = remaining;
}


/* ════════════════════════════════════════════════════════════════
   TIMER
════════════════════════════════════════════════════════════════ */

function startTimer() {
  updateTimerDisplay();
  exam.timerInterval = setInterval(() => {
    exam.remainingSeconds--;
    updateTimerDisplay();
    saveToLocalStorage();
    if (exam.remainingSeconds <= 0) {
      clearInterval(exam.timerInterval);
      submitExam(true);
    }
  }, 1000);
}

function updateTimerDisplay() {
  const secs    = Math.max(0, exam.remainingSeconds);
  const mins    = Math.floor(secs / 60);
  const remSecs = secs % 60;
  document.getElementById('timerDisplay').textContent =
    `${String(mins).padStart(2,'0')}:${String(remSecs).padStart(2,'0')}`;

  const block = document.getElementById('timerBlock');
  block.classList.remove('timer-warning', 'timer-critical');
  const pct = secs / (exam.examTimeMinutes * 60);
  if (pct <= 0.1)       block.classList.add('timer-critical');
  else if (pct <= 0.25) block.classList.add('timer-warning');
}

function stopTimer() {
  if (exam.timerInterval) { clearInterval(exam.timerInterval); exam.timerInterval = null; }
}


/* ════════════════════════════════════════════════════════════════
   SUBMIT FLOW
════════════════════════════════════════════════════════════════ */

function openSubmitModal() {
  const total      = exam.questions.length;
  const answered   = Object.keys(exam.answers).length;
  const unanswered = total - answered;

  document.getElementById('modalStats').innerHTML = `
    <div class="modal-stat">
      <span class="modal-stat-num clr-success">${answered}</span>
      <span class="modal-stat-lbl">Answered</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-num clr-danger">${unanswered}</span>
      <span class="modal-stat-lbl">Unanswered</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-num clr-muted">${total}</span>
      <span class="modal-stat-lbl">Total</span>
    </div>
  `;
  document.getElementById('submitModal').classList.add('open');
}

function closeSubmitModal() {
  document.getElementById('submitModal').classList.remove('open');
}

async function submitExam(autoSubmit = false) {
  closeSubmitModal();
  stopTimer();
  window.removeEventListener('beforeunload', handleBeforeUnload);

  exam.submitTime = new Date().toISOString();
  const result = scoreExam();

  displayResult(result);
  renderAnswerReview();

  const savePayload = {
    name:           exam.studentName,
    mobile:         exam.studentMobile,
    subject:        exam.subject,
    score:          result.score,
    totalQuestions: result.total,
    correct:        result.correct,
    wrong:          result.wrong,
    untouched:      result.untouched,
    percentage:     result.percentage,
    startTime:      exam.startTime,
    submitTime:     exam.submitTime,
    duration:       result.duration,
    autoSubmitted:  autoSubmit,
    tabSwitches:    exam.tabSwitchCount
  };

  const saveStatusEl = document.getElementById('saveStatus');
  saveStatusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving result…';

  const saved = await saveExamResult(savePayload);
  saveStatusEl.innerHTML = saved
    ? '<i class="fa-solid fa-circle-check" style="color:var(--clr-success)"></i> Result saved successfully.'
    : '<i class="fa-solid fa-triangle-exclamation" style="color:var(--clr-warning)"></i> Could not save remotely.';

  clearLocalStorage();
}


/* ════════════════════════════════════════════════════════════════
   SCORING
════════════════════════════════════════════════════════════════ */

function scoreExam() {
  let correct = 0, wrong = 0, untouched = 0;

  exam.questions.forEach(q => {
    const given = exam.answers[q.id];
    if (given === undefined || given === null) untouched++;
    else if (given === q.answer)               correct++;
    else                                       wrong++;
  });

  const perQuestion = exam.totalMarks / exam.questions.length;
  const rawScore    = (correct * perQuestion) - (wrong * exam.negativeMark * perQuestion);
  const score       = Math.max(0, parseFloat(rawScore.toFixed(2)));
  const percentage  = parseFloat(((score / exam.totalMarks) * 100).toFixed(1));

  const diffSecs = Math.floor((new Date(exam.submitTime) - new Date(exam.startTime)) / 1000);
  const duration = `${Math.floor(diffSecs / 60)}m ${diffSecs % 60}s`;

  return { total: exam.questions.length, correct, wrong, untouched, score, percentage, duration };
}


/* ════════════════════════════════════════════════════════════════
   RESULT DISPLAY
════════════════════════════════════════════════════════════════ */

function displayResult(result) {
  const passed      = result.percentage >= 40;
  const resultIcon  = document.getElementById('resultIcon');
  const iconEl      = document.getElementById('resultIconEl');

  resultIcon.className = passed ? 'result-icon pass-icon' : 'result-icon fail-icon';
  iconEl.className     = passed ? 'fa-solid fa-trophy' : 'fa-solid fa-face-frown';

  document.getElementById('resultVerdict').textContent = passed ? 'PASS' : 'FAIL';
  document.getElementById('resultVerdict').className   = 'result-verdict ' + (passed ? 'pass' : 'fail');
  document.getElementById('resultSubject').textContent = exam.subject;

  const pct = Math.min(100, result.percentage);
  document.getElementById('scoreCircle').style.setProperty('--score-pct', `${pct}%`);
  document.getElementById('scoreNumber').textContent  = result.score;
  document.getElementById('scoreTotal').textContent   = `/ ${exam.totalMarks}`;
  document.getElementById('scorePercentage').textContent = `${result.percentage}%`;

  document.getElementById('resultName').textContent     = exam.studentName;
  document.getElementById('resultMobile').textContent   = exam.studentMobile;
  document.getElementById('resultStart').textContent    = formatDateTime(exam.startTime);
  document.getElementById('resultEnd').textContent      = formatDateTime(exam.submitTime);
  document.getElementById('resultDuration').textContent = result.duration;

  document.getElementById('breakdownCorrect').textContent   = result.correct;
  document.getElementById('breakdownWrong').textContent     = result.wrong;
  document.getElementById('breakdownUntouched').textContent = result.untouched;

  showScreen('resultScreen');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}


/* ════════════════════════════════════════════════════════════════
   ANSWER REVIEW
════════════════════════════════════════════════════════════════ */

function renderAnswerReview() {
  const list = document.getElementById('reviewList');
  list.innerHTML = '';

  exam.questions.forEach((q, i) => {
    const userAnswer    = exam.answers[q.id];
    const correctAnswer = q.answer;
    const isCorrect     = userAnswer === correctAnswer;
    const isSkipped     = userAnswer === undefined || userAnswer === null;
    const isWrong       = !isCorrect && !isSkipped;

    let itemClass = 'review-item ';
    let statusIcon = '';
    if (isCorrect)      { itemClass += 'review-correct';  statusIcon = '<i class="fa-solid fa-circle-check"></i>'; }
    else if (isWrong)   { itemClass += 'review-wrong';    statusIcon = '<i class="fa-solid fa-circle-xmark"></i>'; }
    else                { itemClass += 'review-skipped';  statusIcon = '<i class="fa-regular fa-circle-dot"></i>'; }

    const item = document.createElement('div');
    item.className = itemClass;

    let html = `
      <div class="review-item-header">
        <span class="review-q-num">Q${i + 1}</span>
        <span class="review-question-text">${q.question}</span>
        <span class="review-status-icon">${statusIcon}</span>
      </div>
      <div class="review-options">
    `;

    Object.entries(q.options).forEach(([key, text]) => {
      const isCorrectOpt = key === correctAnswer;
      const isUserWrong  = key === userAnswer && isWrong;
      let optClass = 'review-option';
      let tagHTML  = '';
      if (isCorrectOpt)  { optClass += ' opt-correct';    tagHTML = '<span class="review-option-tag">Correct</span>'; }
      else if (isUserWrong) { optClass += ' opt-wrong-user'; tagHTML = '<span class="review-option-tag">Your Answer</span>'; }

      html += `
        <div class="${optClass}">
          <span class="review-option-bubble">${key}</span>
          <span class="review-option-text">${text}</span>
          ${tagHTML}
        </div>
      `;
    });

    html += '</div>';
    if (isSkipped) {
      html += `<p class="review-skipped-note">
        <i class="fa-solid fa-circle-minus"></i>
        Not attempted — correct answer is <strong>${correctAnswer}: ${q.options[correctAnswer]}</strong>
      </p>`;
    }

    item.innerHTML = html;
    list.appendChild(item);
  });
}


/* ════════════════════════════════════════════════════════════════
   RESTART
════════════════════════════════════════════════════════════════ */

function restartExam() {
  exam.currentIndex   = 0;
  exam.answers        = {};
  exam.visited        = new Set();
  exam.tabSwitchCount = 0;
  exam.studentName    = '';
  exam.studentMobile  = '';
  exam.startTime      = null;
  exam.submitTime     = null;

  stopTimer();
  clearLocalStorage();

  document.getElementById('studentMobile').value = '';
  document.getElementById('examPassword').value  = '';
  clearLoginErrors();
  hideNotFound();

  showScreen('loginScreen');
}


/* ════════════════════════════════════════════════════════════════
   LOCAL STORAGE
════════════════════════════════════════════════════════════════ */

function saveToLocalStorage() {
  try {
    const state = {
      subject:          exam.subject,
      studentName:      exam.studentName,
      studentMobile:    exam.studentMobile,
      answers:          exam.answers,
      visited:          Array.from(exam.visited),
      remainingSeconds: exam.remainingSeconds,
      startTime:        exam.startTime,
      tabSwitchCount:   exam.tabSwitchCount
    };
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[ExamPrep] Could not save to localStorage:', e);
  }
}

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (state.subject !== exam.subject) return false;

    exam.answers          = state.answers          ?? {};
    exam.visited          = new Set(state.visited  ?? []);
    exam.remainingSeconds = state.remainingSeconds ?? (exam.examTimeMinutes * 60);
    exam.startTime        = state.startTime        ?? new Date().toISOString();
    exam.tabSwitchCount   = state.tabSwitchCount   ?? 0;
    if (state.studentName)   exam.studentName   = state.studentName;
    if (state.studentMobile) exam.studentMobile = state.studentMobile;

    return true;
  } catch (e) {
    console.warn('[ExamPrep] Could not restore from localStorage:', e);
    return false;
  }
}

function clearLocalStorage() {
  localStorage.removeItem(LS_KEY);
}


/* ════════════════════════════════════════════════════════════════
   ANTI-CHEAT
════════════════════════════════════════════════════════════════ */

function registerAntiCheat() {
  document.addEventListener('contextmenu', preventEvent);
  document.addEventListener('keydown', blockShortcuts);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function unregisterAntiCheat() {
  document.removeEventListener('contextmenu', preventEvent);
  document.removeEventListener('keydown', blockShortcuts);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

function preventEvent(e) { e.preventDefault(); return false; }

function blockShortcuts(e) {
  const blocked =
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
    (e.ctrlKey && (e.key === 'u' || e.key === 'U'));
  if (blocked) { e.preventDefault(); return false; }
}

function handleVisibilityChange() {
  if (!document.getElementById('examScreen').classList.contains('active')) return;
  if (document.visibilityState === 'hidden') {
    exam.tabSwitchCount++;
    saveToLocalStorage();
    if (exam.tabSwitchCount >= exam.maxTabSwitches) {
      closeTabWarning();
      submitExam(true);
    } else {
      showTabWarning();
    }
  }
}

function showTabWarning() {
  const remaining = exam.maxTabSwitches - exam.tabSwitchCount;
  document.getElementById('tabWarningMsg').textContent =
    `You left the exam tab. This has been recorded (Switch ${exam.tabSwitchCount}/${exam.maxTabSwitches}).`;
  const sub = document.querySelector('.tab-warning-sub');
  if (sub) sub.textContent = remaining > 0
    ? `You have ${remaining} warning(s) remaining before auto-submit.`
    : 'Your exam will be auto-submitted on the next switch.';
  document.getElementById('tabWarningModal').classList.add('open');
}

function closeTabWarning() {
  document.getElementById('tabWarningModal').classList.remove('open');
}

function handleBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = 'Your exam is in progress. Leaving will not submit your answers.';
  return e.returnValue;
}


/* ════════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadExamData();
});
