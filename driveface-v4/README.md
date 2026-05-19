# DriveFace Finder — Wedding Photographer Edition

> AI face recognition for Google Drive. Guests upload a selfie and instantly find every photo of themselves from your event. **No API key, no Google account, no login required for guests.**

---

## How It Works

```
Photographer (one-time setup)              Guest (every event)
──────────────────────────────             ──────────────────────────────
1. Deploy Apps Script (5 min)   →   1. Visit the app URL
2. Add URL to config.js         →   2. Paste the folder link
3. Upload photos to Drive       →   3. Upload a selfie
4. Share the app URL            →   4. Download their photos  ✓
```

No API keys. No Google account. No sign-in. Just a selfie.

---

## Photographer Setup (One Time, ~10 Minutes)

### Step 1 — Deploy the Google Apps Script

The Apps Script runs under **your** Google account and lets the app read your Drive folders without exposing any credentials to guests.

1. Go to [script.google.com](https://script.google.com) and sign in with your Google account
2. Click **New project** (top left)
3. Delete all existing code in the editor
4. Open `appsscript.gs` from this project and **paste the entire contents**
5. Click the **💾 Save** icon (or Ctrl+S)
6. Click **Deploy → New deployment**
7. Click the **⚙ gear icon** next to "Type" → choose **Web app**
8. Fill in the fields:
   - **Description:** DriveFace Finder API
   - **Execute as:** Me *(your Google account)*
   - **Who has access:** Anyone
9. Click **Deploy**
10. If prompted, click **Authorize access** and follow the OAuth steps
11. **Copy the Web App URL** — it looks like:
    ```
    https://script.google.com/macros/s/AKfycbx.../exec
    ```
12. Keep this URL safe — you'll need it in the next step

> 🔒 **Security note:** The script only exposes public folder contents — it cannot access private files. Guests get a list of file IDs; they cannot browse your Drive.

---

### Step 2 — Configure the App

Open `config.js` and fill in your details:

```javascript
const DRIVEFACE_CONFIG = {
  // REQUIRED: Paste your Apps Script URL from Step 1
  appsScriptUrl: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',

  // OPTIONAL: Pre-fill folder ID (great for single-event deployments)
  // Guests won't need to enter anything — the folder is pre-loaded
  defaultFolderId: '',  // e.g. '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'

  // OPTIONAL: Customize the label guests see
  folderLabel: 'Event Folder',

  // OPTIONAL: Your branding
  appName:  'DriveFace Finder',
  tagline:  'Find every photo of you — instantly.',
};
```

---

### Step 3 — Prepare Your Google Drive Folders

For each event:

1. Create a folder in Google Drive (e.g. "Smith Wedding - June 2025")
2. Upload all your edited photos to that folder
3. **Right-click the folder → Share → Change to "Anyone with the link" → Viewer**
4. Copy the folder URL — share this with guests alongside the app URL

The folder URL looks like:
```
https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs
```
Guests can paste this URL directly into the app, or you can pre-fill it in `config.js`.

---

### Step 4 — Deploy to GitHub Pages

1. Create a new GitHub repository (or use an existing one)
2. Upload all project files to the repository root:
   ```
   index.html
   style.css
   config.js
   utils.js
   drive.js
   face.js
   app.js
   appsscript.gs   ← (not served, just for reference)
   README.md
   ```
3. Go to **Settings → Pages → Source → Deploy from branch (main)**
4. Your app is live at: `https://YOUR_USERNAME.github.io/REPO_NAME/`

---

## Guest Instructions (What to Tell Guests)

Send guests this message along with their event folder link:

---

*"Hi! Your wedding photos are ready.*
*Visit [YOUR APP URL] to find your photos instantly.*
*Just paste this link: [FOLDER URL]*
*Then upload a selfie — the AI will find every photo of you in seconds!*
*You can download individual photos or all at once as a ZIP."*

---

## File Structure

```
driveface-finder/
├── index.html        All UI — hero, search, gallery, modals
├── style.css         Dark/light theme, responsive, animations
├── config.js         ← Photographer edits this file only
├── utils.js          Toast, IndexedDB cache, ZIP downloader
├── drive.js          Google Drive via Apps Script (no API key)
├── face.js           AI face detection & recognition
├── app.js            Main controller — events, workflow
├── appsscript.gs     Paste this into script.google.com
└── README.md         This file
```

---

## Settings (for guests)

Guests can tap **Settings (⚙)** to adjust:

| Setting | Default | What it does |
|---|---|---|
| Similarity Threshold | 0.55 | Lower = more results. Raise if strangers appear in results |
| Processing Quality | Balanced | Fast = quick scan; Accurate = better for dark/blurry photos |
| Max Images | 800 | Stops scanning after this many photos |

---

## Troubleshooting

### "Apps Script URL not configured"
→ Open Settings → paste the URL from Step 1.

### "Could not reach the Apps Script endpoint"
→ Make sure the script is deployed as a Web App with **"Anyone"** access.
→ Try re-deploying: Apps Script → Deploy → Manage deployments → create a new version.

### "No images found in this folder"
→ Make sure the folder is set to **"Anyone with the link" → Viewer**.
→ Make sure the folder actually contains JPEG/PNG/WebP images.

### "No face matches found"
→ Guest should use a clear, front-facing, well-lit photo.
→ Lower the Similarity Threshold in Settings (try 0.45).
→ Switch Processing Quality to "Accurate".

### Photos load slowly for guests
→ This is normal on first visit — face-api.js models download (~6MB) once.
→ Subsequent visits are instant (models are cached in the browser).
→ Face descriptors are also cached — repeat scans of the same folder are much faster.

### ZIP download is slow
→ Expected for large galleries. Progress is shown on the button.
→ Guests can also download individual photos by hovering → clicking the download icon.

---

## How Face Recognition Works

1. **Model loading** — Three TensorFlow.js models load from CDN (first visit only):
   - SSD MobileNetV1 — detects face bounding boxes
   - FaceLandmark68 — maps 68 facial landmark points
   - FaceRecognitionNet — produces a 128-dimensional face embedding

2. **User face** — Guest uploads/captures a selfie. The app extracts a 128-number descriptor vector representing their face geometry.

3. **Gallery scan** — For each photo in the Drive folder:
   - Image downloaded from Google's CDN
   - Face detected and descriptor extracted
   - Descriptor cached in IndexedDB (skipped on repeat scans)
   - Euclidean distance computed against guest's descriptor
   - If distance < threshold → match!

4. **Results** — Matches sorted by similarity. Guest can filter by confidence, download individually, or grab all as ZIP.

**Privacy:** All processing happens in the guest's browser. Face data never leaves their device. Descriptors cached in IndexedDB are cleared when they tap "Clear Face Cache" in Settings.

---

## License

MIT — Free to use commercially. Attribution appreciated but not required.
