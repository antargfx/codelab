/**
 * config.js — DriveFace Finder · Photographer Configuration
 *
 * ╔══════════════════════════════════════════════════════════╗
 * ║  PHOTOGRAPHER: Edit only this file before deploying.    ║
 * ║  Guests never touch this — they just upload a selfie.   ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * SETUP IN 5 MINUTES:
 * ───────────────────
 * 1. Follow the Apps Script setup in README.md
 * 2. Paste your Apps Script URL below (APPS_SCRIPT_URL)
 * 3. Optionally fill in your branding / default event
 * 4. Deploy to GitHub Pages — done!
 */

const DRIVEFACE_CONFIG = {

  /**
   * Your Google Apps Script web app URL.
   * Get this by following README.md → "Apps Script Setup".
   * Looks like: https://script.google.com/macros/s/AKfy.../exec
   *
   * Leave blank → the app will prompt the photographer to set it.
   */
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbx5_J-FgGSFzZ8eo8o3VcQ8tcnJno5OCkGd8O_cbQrRQf7XmSHfW7XS_fCNsv_BpG23pg/exec',

  /**
   * Optional: Pre-fill a specific folder ID so guests don't
   * have to type anything (great for a single-event deployment).
   * Example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'
   * Leave blank → guests enter the folder ID themselves.
   */
  defaultFolderId: '',

  /**
   * Optional: A label shown next to the folder field.
   * e.g. 'Event Code', 'Table Number', 'Wedding Folder'
   */
  folderLabel: 'Event Folder',

  /**
   * Branding — shown in the header and browser tab.
   */
  appName: 'DriveFace Finder',
  tagline: 'Find every photo of you.',

  /**
   * Default similarity threshold (0.30 – 0.85).
   * 0.55 is a good balance for well-lit wedding photos.
   * Lower = more results (more false positives).
   */
  defaultThreshold: 0.55,

  /**
   * Maximum images to scan per session.
   * Keeps scan time reasonable for large galleries.
   */
  maxImages: 800,

  /**
   * Processing quality: 'fast' | 'balanced' | 'accurate'
   * 'balanced' works well for most wedding galleries.
   */
  defaultQuality: 'balanced',
};
