// =============================================================================
// config.js — Firebase Web Configuration
// =============================================================================
//
// IMPORTANT: This config is PUBLIC by design. The apiKey, projectId, etc. are
// NOT secrets. Firebase web apps are meant to ship this config in client code,
// and committing it to a public GitHub repo is normal and expected.
//
// What actually protects your data is firestore.rules (see the repo root),
// NOT hiding this config. Anyone can read these values from the deployed site;
// the security rules are what stop them from reading/writing data they
// shouldn't.
//
// Optional later hardening: Firebase App Check can block traffic that isn't
// coming from your real app, but it is not required for correctness.
//
// -----------------------------------------------------------------------------
// SETUP: Replace the placeholder values below with YOUR project's config,
// found in Firebase Console → Project Settings → General → "Your apps" →
// SDK setup and configuration → Config.
// -----------------------------------------------------------------------------

export const firebaseConfig = {
    apiKey: "AIzaSyBsYWqwPnrCzwtnY02_bfXm-6ugfp04KTs",
    authDomain: "attendance-tracker-e48ed.firebaseapp.com",
    projectId: "attendance-tracker-e48ed",
    storageBucket: "attendance-tracker-e48ed.firebasestorage.app",
    messagingSenderId: "923978111292",
    appId: "1:923978111292:web:f2985e3bf4f55c991d2639",
};

// -----------------------------------------------------------------------------
// App-wide constants. These are safe defaults; most institute-specific values
// live in the Firestore settings/general document and are editable in-app.
// Nothing here hard-codes batch count, lab count, or student count.
// -----------------------------------------------------------------------------

export const APP_CONFIG = {
  // Firebase JS SDK version loaded from the CDN. Keep in sync with firebase.js.
  sdkVersion: "10.12.2",

  // Local timezone offset handling: date document IDs are always derived from
  // the LOCAL calendar date (see utils.formatDateLocal), never from
  // Date.toISOString(), which would convert to UTC and shift dates near
  // midnight.
  attendanceStatuses: ["present", "absent", "late", "leave"],
  defaultStatus: "absent",

  // Firestore document paths / collection names, centralized to avoid typos.
  collections: {
    users: "users",
    batches: "batches",
    labs: "labs",
    students: "students",
    attendance: "attendance",
    days: "days",
    settings: "settings",
    activityLog: "activityLog",
  },

  settingsDocId: "general",

  // Bangladeshi mobile number validation: 11 digits, starts with 01, third
  // digit 3-9 (operator prefixes). e.g. 017XXXXXXXX.
  phoneRegex: /^01[3-9]\d{8}$/,
};
