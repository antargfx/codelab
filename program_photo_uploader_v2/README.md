# Program Photos — Photo Upload Website

A simple, public webpage where anyone can select photographs from their phone
or computer and upload them straight into **one shared Google Drive folder**
that you create ahead of time. No accounts, no app to install, nothing to pay
for beyond what's already free in Google Drive and GitHub Pages.

---

## 1. How it works (architecture)

```
Person's phone or computer
        │  opens your GitHub Pages URL
        ▼
GitHub Pages (static site: index.html, style.css, app.js)
        │  sends each selected photo as a POST request
        ▼
Google Apps Script Web App (Code.gs)
        │  saves the file exactly as received
        ▼
Your one Google Drive folder
```

Nothing sensitive ever touches GitHub. The frontend only ever knows your
Apps Script Web App URL — no passwords, no API keys, no service account
credentials. The Drive folder ID and the (optional) upload code live only
inside Google Apps Script, on Google's servers.

Every photo lands directly in the one folder you configure. The site never
creates a subfolder, a per-user folder, or a per-date folder.

---

## 2. What's in this project

| File | Purpose |
|---|---|
| `index.html` | The page structure |
| `style.css` | All visual styling |
| `app.js` | All frontend logic (selection, preview, upload, progress) |
| `Code.gs` | The Google Apps Script backend that writes to Drive |
| `README.md` | This file |

Only `index.html`, `style.css`, and `app.js` go on GitHub. `Code.gs` goes
into a separate Google Apps Script project — it is **not** part of the
GitHub repository.

---

## 3. Features

- Select multiple photos at once, from a phone gallery or a computer
- Drag-and-drop on desktop
- Thumbnail previews with filename, file size, and a remove button
- Uploads the **original file, byte-for-byte** — nothing is resized,
  cropped, compressed, or converted
- Per-photo and overall progress, with clear Waiting / Uploading /
  Uploaded / Failed states
- Automatically renames a photo if its filename already exists in the
  folder, instead of overwriting the existing one
- Retry button for any photos that failed, without reselecting everything
- Optional access code (PIN), checked on the server
- Works on Android Chrome, iPhone Safari, desktop Chrome/Firefox/Edge
- No frameworks, no build step, no npm — just three static files

---

## 4. Setup — Part A: Google Drive

**Step 1 — Create the folder.** In Google Drive, create a new folder,
e.g. `Program Photos`.

**Step 2 — Copy its folder ID.** Open the folder and look at the URL:

```
https://drive.google.com/drive/folders/1lA62w9U1jQRTkXZI9M4xmOJxXC36Ekq0
                                        └──────────── this part ─────────┘
```

That string after `/folders/` is the folder ID. You'll paste it into
`Code.gs` in a moment.

---

## 5. Setup — Part B: Google Apps Script (the backend)

**Step 3 — Create the Apps Script project.**
Go to [script.google.com](https://script.google.com) → **New project**.

**Step 4 — Paste the code.**
Delete the placeholder `function myFunction() {}` content and paste in the
entire contents of `Code.gs` from this project.

**Step 5 — Folder ID.**
`Code.gs` already has your folder ID (`1lA62w9U1jQRTkXZI9M4xmOJxXC36Ekq0`) baked in — nothing to edit here.

*(Optional)* Set `UPLOAD_PIN: "123456"` (or any code you like) if you want
visitors to enter a code before uploading. Leave it as `""` to allow anyone
with the link to upload with no code. See **§10 About the optional PIN**
below — this is a deterrent for casual link-sharing, not real security.

**Step 6 — Deploy as a Web App.**
Click **Deploy → New deployment**. Click the gear icon next to "Select
type" and choose **Web app**. Then set:

- **Execute as:** `Me` — the script always runs using *your* Google
  account's Drive access, regardless of who visits the page. This is what
  lets anonymous visitors upload into a folder they don't have access to.
- **Who has access:** `Anyone` — this makes the URL work for anyone with
  the link, without requiring them to sign in to Google. (This is required
  for a public upload page. If you choose a more restrictive option,
  visitors without matching Google accounts will get a permission error
  instead of the upload form.)

Click **Deploy**.

**Step 7 — Authorize permissions.**
The first deployment will prompt you to authorize the script. Choose your
Google account, click **Advanced** if you see an "unverified app" warning
(this is expected for a script you wrote yourself), then **Go to
[project name] (unsafe)** → **Allow**. This grants the script permission
to create files in your Drive — it cannot do anything else.

**Step 8 — Copy the Web App URL.**
After deploying, you'll see a URL like:

```
https://script.google.com/macros/s/AKfycbz.../exec
```

Copy it — you'll need it in the next section.

> **Redeploying after edits:** if you change `Code.gs` later, use
> **Deploy → Manage deployments → Edit (pencil icon) → New version →
> Deploy**. Editing the code alone does not update the live URL's
> behavior until you deploy a new version.

---

## 6. Setup — Part C: the frontend

**Step 9 — Paste the Web App URL into `app.js`.**
Open `app.js` and find:

```javascript
const CONFIG = {
  UPLOAD_ENDPOINT: "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL",
  REQUIRE_PIN: false,
  ...
```

Replace `YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL` with the URL from Step 8.
If you set an `UPLOAD_PIN` in `Code.gs`, also set `REQUIRE_PIN: true` here
so the page shows the code field.

**Step 10 — Upload the frontend files to GitHub.**
Create a new GitHub repository (e.g. `program-photo-uploader`) and add
`index.html`, `style.css`, and `app.js` to it. **Do not add `Code.gs`** —
it belongs only in Apps Script.

**Step 11 — Enable GitHub Pages.**
In the repository: **Settings → Pages → Source**, choose the branch
(usually `main`) and the root folder, then save. GitHub will give you a
URL like:

```
https://USERNAME.github.io/program-photo-uploader/
```

**Step 12 — Test it.**
Open that URL on your phone, select a few photos, and upload. Then check
that they appear directly inside your Drive folder — not in a subfolder.

---

## 7. How CORS works here (and why the upload method matters)

Your page is served from `github.io` and talks to a script hosted on
`script.google.com` — a cross-origin request. Two things make this work
reliably:

1. **The frontend sends each photo as `multipart/form-data`** (via the
   browser's `FormData` object), not as JSON. Browsers treat a plain
   `multipart/form-data` POST with no custom headers as a "simple
   request," so it skips the CORS preflight (`OPTIONS`) step entirely.
2. **Apps Script web apps don't reliably answer CORS preflight
   requests.** If you sent JSON instead (`Content-Type: application/json`),
   the browser would first send an `OPTIONS` request, and Apps Script has
   no clean way to respond to it — uploads would fail in the browser
   console with a CORS error, even though the script itself is fine.

This is why `app.js` deliberately builds a `FormData` object and never
sets a `Content-Type` header manually — the browser sets the correct
multipart boundary automatically, and the request qualifies as "simple."

---

## 8. Upload limits — please read this before a big event

Being honest about limits, rather than promising something unlimited:

- **Per-file size:** This project's frontend defaults to rejecting files
  over 45 MB (`MAX_FILE_SIZE_MB` in both `app.js` and `Code.gs`), which
  comfortably covers ordinary phone and camera photos (typically 2–15 MB
  each, occasionally 20–30 MB for high-resolution or RAW-adjacent
  formats). Apps Script web apps can accept substantially larger POST
  bodies than this, but reliability drops for very large uploads on slow
  mobile connections, so 45 MB is a deliberately conservative, tested
  ceiling — raise it in both files (they must match) if you specifically
  need larger files, and test on your slowest expected connection first.
- **One photo per request.** Each photo is uploaded as its own POST
  request (not bundled together), which keeps each request small,
  makes per-photo progress and retry possible, and avoids the much
  lower combined-payload risk of sending many large files in a single
  request.
- **Execution time.** Each Apps Script call has a maximum runtime (a
  few minutes). A single photo upload finishes in well under this on
  any reasonable connection; this limit does not affect selecting and
  uploading many photos, since each is a separate call.
- **Daily quotas.** Google Apps Script accounts (especially free/consumer
  Gmail accounts, as opposed to Google Workspace) have daily quotas on
  total script runtime and Drive operations. For normal event-scale usage
  (dozens to low hundreds of photos in a day) this is not a practical
  concern; for a very large, all-day public event, keep an eye on it.
- **Drive storage.** Every uploaded photo counts against your Google
  account's Drive storage quota, same as any other file you'd add
  yourself. There is no way around this — the system does not compress
  or shrink photos to save space, per your requirement to preserve
  original quality.
- **Concurrency.** The page uploads up to 3 photos at once
  (`MAX_CONCURRENT_UPLOADS` in `app.js`) to balance speed against
  reliability on mobile networks. You can lower this for flakier
  connections or raise it for faster wifi-only use.

**Nothing about this system is "unlimited."** It is well-suited to
typical program/event photo collection (tens to a few hundred photos per
event); it is not a substitute for enterprise file-transfer infrastructure.

---

## 9. How duplicate filenames are handled

Two different phones very often produce photos with the same name (like
`IMG_0001.jpg`). To avoid one person's photo silently overwriting
someone else's:

1. Before saving, the backend checks whether a file with that exact name
   already exists in the target folder.
2. If it does, it tries `IMG_0001 (1).jpg`, then `IMG_0001 (2).jpg`, and
   so on, until it finds a name that isn't taken.
3. The original filename is always preserved as the base — only a
   `(n)` suffix is added, and only when necessary.

Nothing is ever overwritten.

---

## 10. About the optional PIN

You can set an `UPLOAD_PIN` in `Code.gs` so visitors need a short code to
upload. Two important honesty notes:

- **A PIN baked into frontend JavaScript is never truly secret** — anyone
  can view your page's source and read it. That's why this project does
  **not** rely on a frontend-only check.
- **The real check happens on the server.** `app.js` sends whatever the
  visitor typed to `Code.gs`, and `Code.gs` is the only place that
  decides whether it's correct:

  ```
  Frontend → (PIN typed by visitor) → Apps Script → validate on server → Drive
  ```

  Even if someone inspects the page and finds the expected PIN value, all
  that tells them is *what to type* — it doesn't let them bypass the
  Apps Script check, because the script itself, not the browser, makes
  the decision.

Treat the PIN as a way to keep the link from being casually shared or
stumbled upon (e.g., paired with a QR code only attendees see), not as
protection against a determined attacker who already knows the code.

---

## 11. Security summary

- No Google credentials, service account keys, or OAuth secrets are ever
  present in the GitHub-hosted frontend.
- The Drive folder ID lives only in `Code.gs`, on Google's servers.
- The script runs "as you" (Step 6), so visitors never need — and never
  get — direct access to your Drive.
- Every upload is validated server-side: must be an image
  (`Content-Type` starting with `image/`), must be under the configured
  size limit, and (if enabled) must include the correct PIN.
- A simple global rate limiter (`MAX_UPLOADS_PER_MINUTE` in `Code.gs`)
  blunts accidental floods or runaway scripts. It is **not** a per-person
  or per-IP limit — Apps Script web apps don't reliably expose the
  caller's IP address, so this is a best-effort shared guard, not a
  precise one.

---

## 12. Testing checklist

- [ ] Select 5–10 photos on a phone → preview shows correct thumbnails,
      names, and sizes
- [ ] Remove one photo before uploading → it disappears from the list
- [ ] Upload → progress bar and per-file status update correctly
- [ ] Check Drive: all photos appear directly in the folder, no subfolder
- [ ] Compare an uploaded photo's file size/dimensions to the original
      on your phone — they should match exactly
- [ ] Upload two photos with the same filename (e.g. rename a copy) →
      the second is saved as `name (1).ext`, not overwritten
- [ ] Turn off wifi mid-upload → failed photos are marked clearly, and
      "Retry failed uploads" successfully resends only those
- [ ] Try selecting a non-image file → it's rejected with a clear message
- [ ] Try a very large photo (if you have one) → confirm it's accepted
      or clearly rejected as expected for your configured size limit
- [ ] Test on Android Chrome, iPhone Safari, and a desktop browser
- [ ] Test with a wrong PIN (if enabled) → upload is rejected

---

## 13. Troubleshooting

**"Sorry, unable to open the file at this time" / the Google Drive-branded error page**
This is Google Drive's own "not found or no access" page — it means the URL
you opened isn't a live, deployed Web App `/exec` URL. It shows up when:
- You opened the Apps Script **editor** URL (`script.google.com/d/...`)
  or the **project home** URL instead of the deployment URL. The only
  URL that should go in `app.js` is the one shown after you click
  **Deploy → New deployment**, which looks like
  `https://script.google.com/macros/s/AKfycbz.../exec`.
- You copied a URL ending in something other than `/exec` (e.g. an
  editor link, or a `/dev` "test deployment" link that requires you to
  be signed in as a tester).
- The deployment was never actually completed — go to **Deploy → Manage
  deployments** in the Apps Script editor and confirm there's an
  **Active** Web app deployment. If not, redo Step 6.

To verify your URL is correct: paste it directly into a browser address
bar (not the folder link — the Apps Script `/exec` URL). You should see
plain text like `{"success":false,"message":"This endpoint only accepts
photo uploads via POST."}`. If you instead see the Drive-branded error
page, the URL is wrong or the deployment isn't active — go back to
Step 6–8 and redeploy, making sure to copy the URL from the deployment
success dialog itself.

**Uploads fail right after fixing the URL above**
Confirm you pasted that exact `/exec` URL into `UPLOAD_ENDPOINT` in
`app.js` (Step 9), then re-uploaded `app.js` to GitHub and given GitHub
Pages a minute to rebuild before testing again.

**"This page hasn't been configured yet" banner / uploads don't start**
`UPLOAD_ENDPOINT` in `app.js` still has its placeholder value. Paste in
your actual Web App URL from Step 8.

**Every upload fails immediately with a network/CORS error**
- Confirm the Web App URL ends in `/exec`, not `/dev`.
- Confirm the deployment's "Who has access" is set to `Anyone`.
- Confirm you deployed a **new version** after any edits to `Code.gs`
  (see the note at the end of §5).

**"Server is not configured: DRIVE_FOLDER_ID is missing"**
`DRIVE_FOLDER_ID` in `Code.gs` still has its placeholder value, or you
edited it but didn't deploy a new version.

**"Invalid Drive folder ID, or this account cannot access it"**
Double-check you copied only the ID portion of the folder URL (no slashes
or extra text), and that the folder exists in the same Google account
you used to create and deploy the Apps Script project.

**Photos upload but land in "My Drive" root, not the folder**
This means the folder ID is wrong (it's pointing at nothing, so
`DriveApp.getFolderById` is silently resolving somewhere unexpected) —
recheck Step 2 and Step 5 carefully.

**Uploads work on desktop but fail on mobile data**
Very large photos on a slow connection can exceed
`UPLOAD_TIMEOUT_MS` in `app.js` (default 2 minutes per photo). Ask the
person to switch to wifi, or raise the timeout for your event.

**"Incorrect or missing access code"**
`REQUIRE_PIN` is `true` in `app.js` but the visitor hasn't entered the
code yet, or `UPLOAD_PIN` in `Code.gs` doesn't match what they typed.
Remember both values must match exactly (case-sensitive).

**I don't see my changes after editing `Code.gs`**
Apps Script requires a **new deployment version** to publish changes to
the live `/exec` URL — see the note at the end of §5.

---

## 14. Customizing

- Page title/subtitle: edit `EVENT_TITLE` and `EVENT_SUBTITLE` at the top
  of `app.js` (no need to touch `index.html`).
- Colors: edit the CSS custom properties at the top of `style.css`
  (`--bg`, `--accent`, etc.).
- Concurrency/timeouts/size limits: edit the `CONFIG` block at the top of
  `app.js`, and keep `MAX_FILE_SIZE_MB` in sync with `Code.gs`.

---

## 15. What this project intentionally does *not* do

- Does not create subfolders of any kind (per-user, per-date, per-event)
- Does not resize, crop, compress, or convert uploaded photographs
- Does not require visitors to sign in with a Google account
- Does not store any secrets in the GitHub-hosted frontend
- Is not a general-purpose file host — it only accepts image files
