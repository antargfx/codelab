# Attendance Management System

A complete, backend-less **Attendance Management System** for a training
institute. Runs entirely as a static website on **GitHub Pages** — no server,
no build step, no npm. Data lives in **Firebase Firestore**; sign-in uses
**Firebase Authentication (Email/Password)**.

Built with HTML5, CSS3, and vanilla JavaScript (ES6 modules). Every library
loads from a CDN.

---

## ✨ Features

- **Roles:** Admin (full access) and Trainer (write only for assigned batches).
- **Batches → Labs → Students**, all managed in-app. Nothing (batch/lab/student
  count) is hard-coded.
- **Attendance:** per lab, per day. Present / Absent / Late / Leave. Clicking a
  status saves **instantly** (no Save button). "Mark as Holiday" toggle excludes
  a date from all percentages.
- **Reports:** Monthly View (spreadsheet-style), 3-Month Report, Today's Sheet,
  Lab Summary, Dashboard stats.
- **Exports:** Excel (bordered/styled via `xlsx-js-style`), PDF (`jsPDF` +
  AutoTable), CSV, and a dedicated print stylesheet.
- **Import** students from Excel (validates duplicate roll numbers).
- **Student lifecycle:** add / edit / transfer between labs / **deactivate**
  (never hard-delete — history is preserved).
- **Activity log**, offline support (Firestore local cache), and **PWA**
  (installable).
- Light/Dark themes, toasts, spinners, skeletons, empty states, confirmation
  dialogs, keyboard-operable attendance buttons, ARIA labels.

---

## 📁 Project structure

```
/
  index.html          login.html         dashboard.html
  attendance.html     students.html      reports.html
  settings.html       seed.html          manifest.json
  service-worker.js
  css/   variables.css  components.css  style.css  print.css
  js/    config.js  firebase.js  utils.js  data.js  auth.js
         dashboard.js  attendance.js  students.js  reports.js
         settings.js  seed.js
  assets/  logo.png   icons/
  firestore.rules     firestore.indexes.json
```

> `data.js` is a shared Firestore data-access layer (added to keep query logic
> DRY across pages). `firestore.rules` and `firestore.indexes.json` are not
> served by GitHub Pages — they live in the repo for deploying to Firebase.

All in-app paths are **relative**, so the site works from a GitHub Pages project
sub-path (`username.github.io/repo-name/`).

---

## 🚀 Setup (one time)

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> → **Add project**.
2. In the project, open **Build → Authentication → Get started**, then enable
   the **Email/Password** provider.
3. Open **Build → Firestore Database → Create database**. Choose a location
   (e.g. `asia-south1` for Bangladesh/South Asia) and start in **production
   mode** (the rules below will secure it).

### 2. Add your Firebase web config
1. In Firebase Console → **Project Settings (gear) → General → Your apps**, add
   a **Web app** (`</>`). Copy the `firebaseConfig` object.
2. Paste those values into **`js/config.js`** (replace the placeholders).

> **Is it safe to commit `config.js`?** Yes. The Firebase web config
> (`apiKey`, `projectId`, …) is **public by design** — it identifies your
> project, it is not a secret, and committing it to a public GitHub repo is
> normal and expected. What actually protects your data is
> **`firestore.rules`**, not hiding the config. (Optionally, enable **Firebase
> App Check** later to block traffic that isn't coming from your real app.)

### 3. Deploy the security rules & indexes
You can paste them in the console or use the Firebase CLI.

**Console:** Firestore → **Rules** tab → paste the contents of
`firestore.rules` → **Publish**.

**CLI:**
```bash
npm install -g firebase-tools     # one time, on your machine only
firebase login
firebase init firestore           # point it at this folder; keep the file names
firebase deploy --only firestore:rules,firestore:indexes
```
> The Monthly / 3-Month reports run a date-range query. The first time it runs,
> Firestore may print a link asking you to create a composite index — accept it,
> or just deploy `firestore.indexes.json` as above.

### 4. Bootstrap the first Admin (manual, one time)
There is **no public sign-up**. The very first admin must be created by hand:

1. Firebase Console → **Authentication → Users → Add user**. Enter an email +
   password (e.g. `admin@institute.edu`). Copy the generated **User UID**.
2. Firebase Console → **Firestore → Start collection** → collection ID
   `users`. Add a document whose **Document ID is exactly that UID**, with
   fields:
   ```
   email:           "admin@institute.edu"   (string)
   displayName:     "Institute Admin"       (string)
   role:            "admin"                 (string)
   assignedBatches: []                      (array, empty)
   isActive:        true                    (boolean)
   ```
3. That's it — you can now log in as admin and create everything else (batches,
   labs, students, and **trainer accounts**) from inside the app.

### 5. (Optional) Load demo data
1. Deploy the site (or run it locally over http — see below) and **sign in as
   the admin** at `login.html`.
2. Open **`seed.html`** and click **Run Seed**. It creates:
   - "Bright Future Training Institute" settings
   - **Batch 7** with **Lab A / B / C**, **25 students each (75 total)** — every
     name and phone number unique and realistic
   - ~3 months of attendance history (80–95% present, occasional holidays)
   - A demo **trainer** account.

**Demo logins after seeding:**

| Role    | Email                    | Password      |
|---------|--------------------------|---------------|
| Admin   | *(the one you created in step 4)* | *(your choice)* |
| Trainer | `trainer@institute.edu`  | `trainer123`  |

> The seed's admin credentials are whatever you set in step 4. Everything the
> seed creates remains fully editable in-app.

---

## 🌐 Deploy to GitHub Pages

1. Create a GitHub repo and push all these files to it.
2. Repo **Settings → Pages → Build and deployment** → Source: **Deploy from a
   branch** → pick `main` and `/ (root)` → **Save**.
3. Your site appears at `https://<username>.github.io/<repo-name>/` within a
   minute or two. GitHub Pages serves over **HTTPS**, which the service worker
   (PWA) requires — no extra setup needed.
4. In Firebase Console → **Authentication → Settings → Authorized domains**, add
   your `*.github.io` domain so sign-in works there.

> Because it's a project sub-path, all paths in this app are relative. Never use
> root-absolute paths like `/js/config.js` — they 404 on GitHub Pages.

### Running locally
ES modules + service workers need `http://`, not `file://`. From this folder:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## 🔐 How security works

- **Client-side redirects** (sending logged-out users to `login.html`) are a UX
  nicety only — anyone can open dev tools and call Firestore directly.
- **`firestore.rules` is the real boundary.** It enforces: signed-in users can
  read structure/attendance; only admins write batches/labs/settings/roles;
  trainers write students + attendance only for their `assignedBatches`; users
  can read but **never write** their own `users/{uid}` doc (so a trainer can't
  promote themselves to admin).
- **Roles come from Firestore** (`users/{uid}.role`), not custom claims —
  custom claims need the Admin SDK (a backend), which this project avoids.
- **Creating a trainer never logs the admin out:** the app creates the new
  account on a temporary secondary Firebase app instance and signs that instance
  out immediately, leaving the admin's session untouched.

---

## 🗃️ Data model (Firestore)

```
users/{uid}                       email, displayName, role, assignedBatches, isActive, createdAt
batches/{batchId}                 name, startDate, durationMonths, isActive
  labs/{labId}                    name
    students/{studentId}          rollNumber, fullName, phone, isActive, currentLabId, joinedAt
attendance/{batchId}/labs/{labId}/days/{date}   (date = "YYYY-MM-DD", local)
    date, batchId, labId, isHoliday, markedBy, updatedAt,
    records: { studentId: { status } },  totals: { present, absent, late, leave, percentage }
settings/general                  instituteName, logoBase64, currentBatchId, courseDurationMonths, theme
activityLog/{logId}               uid, action, targetPath, timestamp, details
```

**Why one day-document per lab (records map) instead of one doc per student per
day?** ~230 documents for a 3-month course instead of ~6,000 — far kinder to
Firestore free-tier quotas. Marking attendance is always a **merge** on that one
day-document, so duplicate records are structurally impossible; totals are
stored on write so dashboards read one small doc. Lab sits above date in the
path because every report queries "all of one lab's days."

**Logo storage:** stored as a compressed Base64 string inside `settings/general`
(comfortably within Firestore's 1 MB document limit). This avoids **Firebase
Storage**, which as of 2026 requires the pay-as-you-go Blaze plan even for free
usage. You may instead commit a static `assets/logo.png`.

---

## 📊 Percentage math

A day counts toward a student's percentage only if it is **not a holiday** and
has a recorded status. `% = (present + late) / counted days × 100`, rounded to
one decimal. Holidays are excluded everywhere (attendance page, monthly,
3-month, dashboard).

---

## 🧩 Libraries (all via CDN, no build)

- Firebase JS SDK v10 (App, Auth, Firestore)
- [`xlsx-js-style`](https://github.com/gitbrent/xlsx-js-style) — SheetJS-
  compatible fork with border/fill/font support for styled Excel export
- SheetJS (`xlsx`) — Excel **import** + CSV (`sheet_to_csv`)
- `jsPDF` + `jspdf-autotable` — PDF export

> Plain community SheetJS can't render borders/fills on export (that's a Pro
> feature), which is why styled exports use `xlsx-js-style`. If that fork is ever
> unmaintained, `ExcelJS` (also free, also CDN-loadable) is the fallback.

---

## ♿ Accessibility & UX

Semantic HTML, ARIA labels on icon-only buttons, visible keyboard-focus states,
keyboard-operable attendance buttons, sufficient contrast in both themes, toast
notifications, loading spinners, skeleton loaders, empty states, and
confirmation dialogs before destructive actions.
