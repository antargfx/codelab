/**
 * script.js — ExamPrep MCQ Platform
 *
 * Architecture: pure vanilla JS, no framework.
 * All state is held in the `exam` object. Functions are grouped by concern.
 *
 * Load order: config.js → firebase.js → script.js
 */

'use strict';

/* ════════════════════════════════════════════════════════════════
   CONSTANTS & STATE
════════════════════════════════════════════════════════════════ */

/** Key used for localStorage persistence */
const LS_KEY = 'examprep_state';

/**
 * Central exam state — the single source of truth.
 * Never mutate directly outside the functions below.
 */
const exam = {
  // Data loaded from questions.json
  data: null,           // Raw JSON object
  questions: [],        // Array of question objects
  password: '',
  subject: '',
  examTimeMinutes: 0,
  totalMarks: 100,
  negativeMark: 0.25,

  // Student info (filled at login)
  studentName: '',
  studentMobile: '',

  // Exam progress
  currentIndex: 0,      // 0-based index of the visible question
  answers: {},          // { questionId: selectedOption } e.g. { 1: 'B' }
  visited: new Set(),   // Set of question IDs that have been viewed

  // Timer
  timerInterval: null,
  remainingSeconds: 0,

  // Timestamps
  startTime: null,
  submitTime: null,

  // Anti-cheat
  tabSwitchCount: 0,
  maxTabSwitches: 3,
};


/* ════════════════════════════════════════════════════════════════
   SCREEN MANAGEMENT
════════════════════════════════════════════════════════════════ */

/**
 * Shows one screen and hides all others.
 * @param {string} screenId - The id of the screen element to show.
 */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}


/* ════════════════════════════════════════════════════════════════
   DATA LOADING
════════════════════════════════════════════════════════════════ */

/**
 * Fetches questions.json, validates it, then shows the login screen.
 * On failure, shows the error screen with a descriptive message.
 */
async function loadExamData() {
  showScreen('loadingScreen');

  try {
    const response = await fetch('questions.json');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Could not fetch questions.json`);
    }

    const data = await response.json();

    // Basic validation
    if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('questions.json is missing the "questions" array or it is empty.');
    }
    if (!data.password) {
      throw new Error('questions.json is missing the "password" field.');
    }

    // Populate exam state from JSON
    exam.data           = data;
    exam.questions      = data.questions;
    exam.password       = String(data.password);
    exam.subject        = data.subject        || 'General';
    exam.examTimeMinutes= Number(data.examTime) || 60;
    exam.totalMarks     = Number(data.totalMarks) || exam.questions.length;
    exam.negativeMark   = Number(data.negativeMark) ?? 0.25;

    populateLoginInfo();
    showScreen('loginScreen');

  } catch (err) {
    console.error('[ExamPrep] Failed to load exam data:', err);
    document.getElementById('errorMessage').textContent = err.message;
    showScreen('errorScreen');
  }
}

/**
 * Populates the login screen's exam-info card with data from JSON.
 */
function populateLoginInfo() {
  document.getElementById('loginSubject').textContent  = exam.subject;
  document.getElementById('loginDuration').textContent = `${exam.examTimeMinutes} minutes`;
  document.getElementById('loginMarks').textContent    = exam.totalMarks;
  document.getElementById('loginNegative').textContent =
    exam.negativeMark > 0 ? `-${exam.negativeMark} per wrong answer` : 'None';
}


/* ════════════════════════════════════════════════════════════════
   LOGIN
════════════════════════════════════════════════════════════════ */

/** Toggle password input visibility */
document.getElementById('togglePw').addEventListener('click', () => {
  const pwField = document.getElementById('examPassword');
  const isHidden = pwField.type === 'password';
  pwField.type = isHidden ? 'text' : 'password';
  document.getElementById('togglePw').textContent = isHidden ? '🙈' : '👁';
});

/**
 * Validates the login form. Shows inline errors. On success, starts the exam.
 */
function handleLogin() {
  const name     = document.getElementById('studentName').value.trim();
  const mobile   = document.getElementById('studentMobile').value.trim();
  const password = document.getElementById('examPassword').value.trim();

  // Clear previous errors
  clearLoginErrors();

  let hasError = false;

  if (!name) {
    showFieldError('nameError', 'Full name is required.');
    highlightInput('studentName');
    hasError = true;
  }

  if (!mobile) {
    showFieldError('mobileError', 'Mobile number is required.');
    highlightInput('studentMobile');
    hasError = true;
  } else if (!/^\+?\d{7,15}$/.test(mobile)) {
    showFieldError('mobileError', 'Enter a valid mobile number (7–15 digits).');
    highlightInput('studentMobile');
    hasError = true;
  }

  if (!password) {
    showFieldError('passwordError', 'Exam password is required.');
    highlightInput('examPassword');
    hasError = true;
  } else if (password !== exam.password) {
    showFieldError('passwordError', 'Incorrect password. Please check and try again.');
    highlightInput('examPassword');
    showLoginAlert('❌ Incorrect exam password. Access denied.');
    hasError = true;
  }

  if (hasError) return;

  // All good — store student info and start
  exam.studentName   = name;
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
  ['nameError','mobileError','passwordError'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
  const alert = document.getElementById('loginAlert');
  alert.textContent = '';
  alert.classList.remove('show');
}

// Allow Enter key to submit the login form
document.getElementById('loginForm').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});


/* ════════════════════════════════════════════════════════════════
   EXAM INITIALISATION
════════════════════════════════════════════════════════════════ */

/**
 * Starts the exam: restores any saved state, renders the first question,
 * starts the timer, and registers anti-cheat listeners.
 */
function startExam() {
  // Restore saved answers / state if a previous session exists
  const restored = restoreFromLocalStorage();

  if (!restored) {
    // Fresh start
    exam.currentIndex    = 0;
    exam.answers         = {};
    exam.visited         = new Set();
    exam.tabSwitchCount  = 0;
    exam.remainingSeconds = exam.examTimeMinutes * 60;
    exam.startTime       = new Date().toISOString();
  }

  // Populate top-bar
  document.getElementById('topbarSubject').textContent = exam.subject;
  document.getElementById('topbarStudent').textContent = exam.studentName;
  document.getElementById('totalQNum').textContent     = exam.questions.length;

  // Build palette
  buildPalette();

  // Render first (or restored) question
  renderQuestion(exam.currentIndex);

  // Start timer
  startTimer();

  // Anti-cheat hooks
  registerAntiCheat();

  // Warn on page refresh / close
  window.addEventListener('beforeunload', handleBeforeUnload);

  showScreen('examScreen');
  updateStats();
}


/* ════════════════════════════════════════════════════════════════
   QUESTION RENDERING
════════════════════════════════════════════════════════════════ */

/**
 * Renders the question at `index` with a smooth transition.
 * @param {number} index - 0-based question index.
 */
function renderQuestion(index) {
  const q       = exam.questions[index];
  const qId     = q.id;
  const wrapper = document.getElementById('questionTransition');

  // Mark as visited
  exam.visited.add(qId);
  exam.currentIndex = index;

  // Trigger fade-out then update content
  wrapper.classList.add('fade-out');

  setTimeout(() => {
    // Update header badges
    document.getElementById('qBadge').textContent = `Q${index + 1}`;
    document.getElementById('currentQNum').textContent = index + 1;

    // Update question text
    document.getElementById('questionText').textContent = q.question;

    // Render options
    renderOptions(q);

    // Fade back in
    wrapper.classList.remove('fade-out');
  }, 220);

  // Update navigation button states
  document.getElementById('prevBtn').disabled = index === 0;
  document.getElementById('nextBtn').disabled = index === exam.questions.length - 1;

  // Update palette highlights
  updatePalette();
  updateStats();
  saveToLocalStorage();
}

/**
 * Builds the OMR-style options for a question.
 * @param {Object} q - Question object from JSON.
 */
function renderOptions(q) {
  const grid    = document.getElementById('optionsGrid');
  const savedAns = exam.answers[q.id];

  grid.innerHTML = '';

  Object.entries(q.options).forEach(([key, text]) => {
    const isSelected = savedAns === key;

    const label = document.createElement('label');
    label.className  = 'option-label' + (isSelected ? ' selected' : '');
    label.setAttribute('role', 'radio');
    label.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    label.setAttribute('tabindex', '0');

    label.innerHTML = `
      <input type="radio" name="q${q.id}" value="${key}" ${isSelected ? 'checked' : ''} />
      <span class="omr-bubble">${key}</span>
      <span class="option-text">${text}</span>
    `;

    // Click handler
    label.addEventListener('click', () => selectOption(q.id, key));

    // Keyboard accessibility — Space/Enter selects
    label.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        selectOption(q.id, key);
      }
    });

    grid.appendChild(label);
  });
}

/**
 * Handles option selection: stores answer, updates UI.
 * @param {number|string} qId  - Question id.
 * @param {string}        key  - Selected option key (A/B/C/D).
 */
function selectOption(qId, key) {
  exam.answers[qId] = key;

  // Update all option labels in the grid
  document.querySelectorAll('.option-label').forEach(label => {
    const radio = label.querySelector('input[type="radio"]');
    const isThis = radio && radio.value === key;
    label.classList.toggle('selected', isThis);
    label.setAttribute('aria-checked', isThis ? 'true' : 'false');
    if (radio) radio.checked = isThis;
  });

  updatePalette();
  updateStats();
  saveToLocalStorage();
}


/* ════════════════════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════════════════════ */

function navigatePrev() {
  if (exam.currentIndex > 0) {
    renderQuestion(exam.currentIndex - 1);
  }
}

function navigateNext() {
  if (exam.currentIndex < exam.questions.length - 1) {
    renderQuestion(exam.currentIndex + 1);
  }
}

/**
 * Jumps directly to a question by its 0-based index.
 * Called by the palette buttons.
 * @param {number} index
 */
function jumpToQuestion(index) {
  renderQuestion(index);
}


/* ════════════════════════════════════════════════════════════════
   QUESTION PALETTE
════════════════════════════════════════════════════════════════ */

/** Builds the initial palette grid. */
function buildPalette() {
  const grid = document.getElementById('paletteGrid');
  grid.innerHTML = '';

  exam.questions.forEach((q, i) => {
    const btn = document.createElement('button');
    btn.className   = 'palette-btn';
    btn.textContent = i + 1;
    btn.setAttribute('aria-label', `Go to question ${i + 1}`);
    btn.addEventListener('click', () => jumpToQuestion(i));
    grid.appendChild(btn);
  });
}

/** Updates all palette button colours to reflect current state. */
function updatePalette() {
  const buttons = document.querySelectorAll('.palette-btn');

  buttons.forEach((btn, i) => {
    const q   = exam.questions[i];
    const qId = q.id;

    btn.className = 'palette-btn'; // reset

    if (i === exam.currentIndex) {
      btn.classList.add('state-current');
    } else if (exam.answers[qId] !== undefined) {
      btn.classList.add('state-answered');
    } else if (exam.visited.has(qId)) {
      btn.classList.add('state-visited');
    }
    // else: default (not-visited) style
  });
}


/* ════════════════════════════════════════════════════════════════
   STATS BAR
════════════════════════════════════════════════════════════════ */

/** Recalculates and displays answered / unanswered / remaining counts. */
function updateStats() {
  const total    = exam.questions.length;
  const answered = Object.keys(exam.answers).length;
  const visited  = exam.visited.size;

  // "Unanswered" = visited but not answered
  const unanswered = Math.max(0, visited - answered);
  // "Remaining" = not visited at all
  const remaining  = total - visited;

  document.getElementById('statAnswered').textContent   = answered;
  document.getElementById('statUnanswered').textContent = unanswered;
  document.getElementById('statRemaining').textContent  = remaining;
}


/* ════════════════════════════════════════════════════════════════
   TIMER
════════════════════════════════════════════════════════════════ */

/** Starts the countdown timer. Updates the display every second. */
function startTimer() {
  updateTimerDisplay();

  exam.timerInterval = setInterval(() => {
    exam.remainingSeconds--;
    updateTimerDisplay();
    saveToLocalStorage(); // persist remaining time

    if (exam.remainingSeconds <= 0) {
      clearInterval(exam.timerInterval);
      submitExam(true); // auto-submit
    }
  }, 1000);
}

/** Updates the timer display element and applies warning/critical CSS classes. */
function updateTimerDisplay() {
  const secs    = Math.max(0, exam.remainingSeconds);
  const mins    = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const display = `${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;

  document.getElementById('timerDisplay').textContent = display;

  const block = document.getElementById('timerBlock');
  block.classList.remove('timer-warning', 'timer-critical');

  const totalSecs = exam.examTimeMinutes * 60;
  const pct       = secs / totalSecs;

  if (pct <= 0.1) {
    block.classList.add('timer-critical');
  } else if (pct <= 0.25) {
    block.classList.add('timer-warning');
  }
}

/** Stops the countdown timer. */
function stopTimer() {
  if (exam.timerInterval) {
    clearInterval(exam.timerInterval);
    exam.timerInterval = null;
  }
}


/* ════════════════════════════════════════════════════════════════
   SUBMIT FLOW
════════════════════════════════════════════════════════════════ */

/** Opens the submit confirmation modal with a summary of answers. */
function openSubmitModal() {
  const total    = exam.questions.length;
  const answered = Object.keys(exam.answers).length;
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

/** Closes the submit confirmation modal. */
function closeSubmitModal() {
  document.getElementById('submitModal').classList.remove('open');
}

/**
 * Submits the exam: stops timer, scores answers, saves result, shows result screen.
 * @param {boolean} [autoSubmit=false] - If true, triggered by timer expiry or tab-switch limit.
 */
async function submitExam(autoSubmit = false) {
  closeSubmitModal();
  stopTimer();
  window.removeEventListener('beforeunload', handleBeforeUnload);

  exam.submitTime = new Date().toISOString();

  const result = scoreExam();

  // Show result screen
  displayResult(result);

  // Save to Firestore
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

  document.getElementById('saveStatus').textContent = '⏳ Saving result…';

  const saved = await saveExamResult(savePayload);
  document.getElementById('saveStatus').textContent = saved
    ? '✅ Result saved successfully.'
    : '⚠️ Result could not be saved remotely (check Firebase config).';

  // Clear local storage after successful submission
  clearLocalStorage();
}


/* ════════════════════════════════════════════════════════════════
   SCORING
════════════════════════════════════════════════════════════════ */

/**
 * Compares exam.answers to the JSON answer keys and calculates the result.
 * Scoring: correct = +1 mark, wrong = -negativeMark, untouched = 0.
 * @returns {Object} result object with score, correct, wrong, untouched, percentage, duration.
 */
function scoreExam() {
  let correct   = 0;
  let wrong     = 0;
  let untouched = 0;

  exam.questions.forEach(q => {
    const given   = exam.answers[q.id];
    const correct_ans = q.answer;

    if (given === undefined || given === null) {
      untouched++;
    } else if (given === correct_ans) {
      correct++;
    } else {
      wrong++;
    }
  });

  // Each correct = (totalMarks / totalQuestions) if proportional,
  // but per spec: Correct = +1, Wrong = -negativeMark
  // We scale to totalMarks using per-question marks
  const perQuestion = exam.totalMarks / exam.questions.length;
  const rawScore    = (correct * perQuestion) - (wrong * exam.negativeMark * perQuestion);
  const score       = Math.max(0, parseFloat(rawScore.toFixed(2)));
  const percentage  = parseFloat(((score / exam.totalMarks) * 100).toFixed(1));

  // Duration
  const startMs  = new Date(exam.startTime).getTime();
  const endMs    = new Date(exam.submitTime).getTime();
  const diffSecs = Math.floor((endMs - startMs) / 1000);
  const dMins    = Math.floor(diffSecs / 60);
  const dSecs    = diffSecs % 60;
  const duration = `${dMins}m ${dSecs}s`;

  return {
    total: exam.questions.length,
    correct,
    wrong,
    untouched,
    score,
    percentage,
    duration
  };
}


/* ════════════════════════════════════════════════════════════════
   RESULT DISPLAY
════════════════════════════════════════════════════════════════ */

/**
 * Populates and shows the result screen.
 * @param {Object} result - Output of scoreExam().
 */
function displayResult(result) {
  const passThreshold = 40; // percentage needed to pass
  const passed        = result.percentage >= passThreshold;

  // Verdict
  document.getElementById('resultIcon').textContent    = passed ? '🎉' : '😔';
  document.getElementById('resultVerdict').textContent = passed ? 'PASS' : 'FAIL';
  document.getElementById('resultVerdict').className   = 'result-verdict ' + (passed ? 'pass' : 'fail');
  document.getElementById('resultSubject').textContent = exam.subject;

  // Score circle — set CSS custom property for the conic-gradient
  const pct = Math.min(100, result.percentage);
  document.getElementById('scoreCircle').style.setProperty('--score-pct', `${pct}%`);
  document.getElementById('scoreNumber').textContent  = result.score;
  document.getElementById('scoreTotal').textContent   = `/ ${exam.totalMarks}`;
  document.getElementById('scorePercentage').textContent = `${result.percentage}%`;

  // Student details
  document.getElementById('resultName').textContent    = exam.studentName;
  document.getElementById('resultMobile').textContent  = exam.studentMobile;
  document.getElementById('resultStart').textContent   = formatDateTime(exam.startTime);
  document.getElementById('resultEnd').textContent     = formatDateTime(exam.submitTime);
  document.getElementById('resultDuration').textContent = result.duration;

  // Breakdown
  document.getElementById('breakdownCorrect').textContent   = result.correct;
  document.getElementById('breakdownWrong').textContent     = result.wrong;
  document.getElementById('breakdownUntouched').textContent = result.untouched;

  showScreen('resultScreen');
}

/**
 * Formats an ISO date string into a human-readable local time.
 * @param {string} iso
 * @returns {string}
 */
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}


/* ════════════════════════════════════════════════════════════════
   RESTART
════════════════════════════════════════════════════════════════ */

/** Resets all exam state and goes back to the login screen. */
function restartExam() {
  // Reset state
  exam.data           = exam.data; // keep loaded data
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

  // Clear login fields
  document.getElementById('studentName').value  = '';
  document.getElementById('studentMobile').value = '';
  document.getElementById('examPassword').value  = '';
  clearLoginErrors();

  showScreen('loginScreen');
}


/* ════════════════════════════════════════════════════════════════
   LOCAL STORAGE — AUTO SAVE & RESTORE
════════════════════════════════════════════════════════════════ */

/** Persists current exam progress to localStorage. */
function saveToLocalStorage() {
  try {
    const state = {
      subject:          exam.subject,
      studentName:      exam.studentName,
      studentMobile:    exam.studentMobile,
      currentIndex:     exam.currentIndex,
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

/**
 * Attempts to restore a previous exam session from localStorage.
 * Only restores if the subject matches the loaded JSON.
 * @returns {boolean} True if state was successfully restored.
 */
function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;

    const state = JSON.parse(raw);

    // Only restore if it's the same exam subject
    if (state.subject !== exam.subject) return false;

    exam.currentIndex     = state.currentIndex    ?? 0;
    exam.answers          = state.answers          ?? {};
    exam.visited          = new Set(state.visited  ?? []);
    exam.remainingSeconds = state.remainingSeconds ?? (exam.examTimeMinutes * 60);
    exam.startTime        = state.startTime        ?? new Date().toISOString();
    exam.tabSwitchCount   = state.tabSwitchCount   ?? 0;

    // If student names were saved (they are), restore them
    if (state.studentName)   exam.studentName   = state.studentName;
    if (state.studentMobile) exam.studentMobile = state.studentMobile;

    console.log('[ExamPrep] Restored previous session from localStorage.');
    return true;
  } catch (e) {
    console.warn('[ExamPrep] Could not restore from localStorage:', e);
    return false;
  }
}

/** Removes the saved exam state from localStorage. */
function clearLocalStorage() {
  localStorage.removeItem(LS_KEY);
}


/* ════════════════════════════════════════════════════════════════
   ANTI-CHEAT
════════════════════════════════════════════════════════════════ */

/** Registers all anti-cheat event listeners and context menu blocking. */
function registerAntiCheat() {
  // Disable right-click context menu
  document.addEventListener('contextmenu', preventEvent);

  // Disable certain keyboard shortcuts
  document.addEventListener('keydown', blockShortcuts);

  // Detect tab visibility change
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

/** Unregisters anti-cheat listeners (called after submission). */
function unregisterAntiCheat() {
  document.removeEventListener('contextmenu', preventEvent);
  document.removeEventListener('keydown', blockShortcuts);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

function preventEvent(e) {
  e.preventDefault();
  return false;
}

/**
 * Blocks DevTools shortcuts and Ctrl+U (view source).
 * @param {KeyboardEvent} e
 */
function blockShortcuts(e) {
  const blocked =
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
    (e.ctrlKey && e.key === 'u') ||
    (e.ctrlKey && e.key === 'U');

  if (blocked) {
    e.preventDefault();
    return false;
  }
}

/**
 * Handles tab visibility changes (tab switch detection).
 * Warns the student and auto-submits after maxTabSwitches.
 */
function handleVisibilityChange() {
  // Only run during active exam
  if (!document.getElementById('examScreen').classList.contains('active')) return;

  if (document.visibilityState === 'hidden') {
    exam.tabSwitchCount++;
    saveToLocalStorage();

    if (exam.tabSwitchCount >= exam.maxTabSwitches) {
      // Auto-submit
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
  if (sub) {
    sub.textContent = remaining > 0
      ? `You have ${remaining} warning(s) remaining before your exam is auto-submitted.`
      : 'Your exam will be auto-submitted on the next switch.';
  }

  document.getElementById('tabWarningModal').classList.add('open');
}

function closeTabWarning() {
  document.getElementById('tabWarningModal').classList.remove('open');
}

/**
 * Warn before accidental page refresh / close (only during active exam).
 * @param {BeforeUnloadEvent} e
 */
function handleBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = 'Your exam is in progress. Leaving will not submit your answers.';
  return e.returnValue;
}


/* ════════════════════════════════════════════════════════════════
   KEYBOARD NAVIGATION (Exam Screen)
════════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  // Only active during exam
  if (!document.getElementById('examScreen').classList.contains('active')) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigateNext();
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigatePrev();

  // Number keys 1-4 select options
  if (['1','2','3','4'].includes(e.key)) {
    const options = ['A','B','C','D'];
    const key     = options[parseInt(e.key, 10) - 1];
    const q       = exam.questions[exam.currentIndex];
    if (q && q.options[key]) selectOption(q.id, key);
  }
});


/* ════════════════════════════════════════════════════════════════
   INITIALISE ON PAGE LOAD
════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  loadExamData();
});
