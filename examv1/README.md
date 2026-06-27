# ExamPrep — MCQ Online Examination Platform

A complete, production-ready MCQ exam preparation web application built with **pure vanilla JavaScript**, **HTML5**, **CSS3**, and **Firebase Firestore**. No frameworks, no jQuery, no Bootstrap.

---

## Features

| Feature | Detail |
|---|---|
| **Dynamic JSON loading** | All exam content (questions, timer, marks, password) from `questions.json` |
| **Login with validation** | Name, mobile, password — validated client-side |
| **OMR-style options** | Bubble-fill interface replicating a physical OMR sheet |
| **Countdown timer** | Visual countdown with warning (yellow) and critical (red pulsing) states |
| **Question palette** | Color-coded grid: gray (not visited), red (visited), green (answered), blue (current) |
| **Live stats bar** | Answered / Unanswered / Remaining counts in real time |
| **Auto-submit** | Exam submits automatically when timer reaches zero |
| **Anti-cheat** | Right-click disabled, DevTools shortcuts blocked, tab-switch detection (auto-submit after 3 switches) |
| **Local Storage** | Answers and timer state persist across accidental page refreshes |
| **Firebase Firestore** | Every attempt saved to `exam_results` collection |
| **Result scorecard** | Score circle, pass/fail verdict, per-question breakdown |
| **Negative marking** | Configurable via JSON |
| **Fully responsive** | Mobile, tablet, desktop |

---

## Project Structure

```
exam_app/
├── index.html       — App shell; all screens in one HTML file
├── style.css        — All styles; no framework
├── script.js        — All exam logic; no framework
├── firebase.js      — Firebase init + saveExamResult()
├── config.js        — Firebase credentials (edit this)
├── questions.json   — Exam content (edit this to change exam)
└── README.md        — This file
```

---

## Quick Start

### 1. Serve locally

You **must** serve the files via HTTP (not file:///) because `fetch()` requires a server.

**Option A — VS Code Live Server**
Install the "Live Server" extension and click "Go Live".

**Option B — Python**
```bash
cd exam_app
python3 -m http.server 8080
# Visit http://localhost:8080
```

**Option C — Node.js**
```bash
npx serve exam_app
```

---

### 2. Set up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use an existing one)
3. Go to **Project Settings → Your Apps → Web App**
4. Copy your Firebase config and paste it into `config.js`:

```js
// config.js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

5. In the Firebase Console, go to **Firestore Database → Create database**
6. Choose **Start in test mode** (or configure rules for production)
7. Results will be saved to the `exam_results` collection automatically

> ⚠️ If Firebase config is not set up, the app still works — it just logs a warning and skips remote save.

---

### 3. Customise the exam

Edit `questions.json` only — no JavaScript changes needed:

```json
{
  "password": "mypassword",
  "subject": "Chemistry",
  "examTime": 45,
  "totalMarks": 100,
  "negativeMark": 0.25,
  "questions": [
    {
      "id": 1,
      "question": "What is the atomic number of Carbon?",
      "options": {
        "A": "4",
        "B": "6",
        "C": "8",
        "D": "12"
      },
      "answer": "B"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `password` | string | Exam access password shown on login |
| `subject` | string | Subject name displayed throughout |
| `examTime` | number | Duration in **minutes** |
| `totalMarks` | number | Maximum marks for this exam |
| `negativeMark` | number | Marks deducted per wrong answer (set `0` for no penalty) |
| `questions` | array | List of question objects |
| `questions[].id` | number | Unique question identifier |
| `questions[].question` | string | Question text (supports Unicode) |
| `questions[].options` | object | Keys must be `A`, `B`, `C`, `D` |
| `questions[].answer` | string | Correct option key: `A`, `B`, `C`, or `D` |

---

## Scoring Formula

```
marks_per_question = totalMarks / total_questions
final_score = (correct × marks_per_question) − (wrong × negativeMark × marks_per_question)
final_score = max(0, final_score)          ← score cannot go below zero
percentage  = (final_score / totalMarks) × 100
```

Pass threshold: **40%** (configurable in `script.js` → `passThreshold` constant).

---

## Firebase Firestore Schema

**Collection:** `exam_results`

Each submitted attempt creates one document:

```json
{
  "name": "John Doe",
  "mobile": "9876543210",
  "subject": "Physics",
  "score": 78.5,
  "totalQuestions": 20,
  "correct": 16,
  "wrong": 3,
  "untouched": 1,
  "percentage": 78.5,
  "startTime": "2025-06-15T09:00:00.000Z",
  "submitTime": "2025-06-15T09:45:23.000Z",
  "duration": "45m 23s",
  "autoSubmitted": false,
  "tabSwitches": 0,
  "timestamp": "<Firestore ServerTimestamp>"
}
```

---

## Anti-Cheat Measures

| Measure | Behaviour |
|---|---|
| Right-click | Disabled on the entire page |
| F12 / DevTools shortcuts | Blocked (`Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+U`) |
| Tab switch | Detected via `visibilitychange` event; warning shown after each switch |
| 3+ tab switches | Exam auto-submitted immediately |
| Page refresh | Browser `beforeunload` warning shown |
| Accidental refresh | Answers & timer restored from `localStorage` |

---

## Keyboard Shortcuts (during exam)

| Key | Action |
|---|---|
| `→` / `↓` | Next question |
| `←` / `↑` | Previous question |
| `1` | Select option A |
| `2` | Select option B |
| `3` | Select option C |
| `4` | Select option D |

---

## Browser Support

| Browser | Supported |
|---|---|
| Chrome 88+ | ✅ |
| Firefox 85+ | ✅ |
| Safari 14+ | ✅ |
| Edge 88+ | ✅ |
| IE 11 | ❌ |

---

## Production Checklist

- [ ] Replace placeholder values in `config.js` with real Firebase credentials
- [ ] Set up Firestore security rules (restrict writes to exam_results only)
- [ ] Replace sample questions in `questions.json` with real exam questions
- [ ] Change the exam password in `questions.json`
- [ ] Host on a static server (Netlify, Vercel, Firebase Hosting, etc.)
- [ ] Enable HTTPS (required for Firebase)
- [ ] Adjust `passThreshold` in `script.js` if needed (default: 40%)

---

## Customisation

### Change pass percentage
In `script.js`, find:
```js
const passThreshold = 40; // percentage needed to pass
```
Change `40` to your desired threshold.

### Add more question options (E, F…)
The options renderer in `script.js` → `renderOptions()` uses `Object.entries(q.options)`, so it automatically handles any number of options.

### Change colours / theme
Edit the CSS custom properties in `style.css` → `:root { … }`.

---

## License
MIT — free to use, modify, and distribute.
