// =============================================================================
// firebase.js — Firebase initialization (Auth + Firestore)
// =============================================================================
//
// Loads the Firebase JS SDK v10 (modular) straight from the CDN via ES module
// imports. No npm, no build step. Exports ready-to-use `auth` and `db`
// singletons plus a helper for creating a temporary secondary app instance
// (used when an admin creates a trainer without logging themselves out).
//
// Offline persistence: we use Firestore's built-in local cache
// (persistentLocalCache) so writes made offline are queued and synced on
// reconnect automatically. This is the SDK-recommended replacement for the
// older enableIndexedDbPersistence() call.
// -----------------------------------------------------------------------------

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./config.js";

// -----------------------------------------------------------------------------
// Initialize the primary app exactly once (guards against double-import).
// -----------------------------------------------------------------------------
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// -----------------------------------------------------------------------------
// Auth. Default to LOCAL persistence ("Remember Login") so the session
// survives browser restarts. Firebase's persistence API has changed across
// SDK versions; in v10 this is setPersistence(auth, browserLocalPersistence).
// -----------------------------------------------------------------------------
export const auth = getAuth(app);

// Set persistence early. Wrapped in try/catch because some privacy modes
// disallow storage; auth still works in-memory as a fallback.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Could not set auth persistence:", err?.message || err);
});

// -----------------------------------------------------------------------------
// Firestore with persistent local cache + multi-tab coordination.
// initializeFirestore must run before any getFirestore() call, so we do it here
// and fall back to a plain getFirestore() if the cache init throws (e.g. the
// browser blocks IndexedDB).
// -----------------------------------------------------------------------------
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (err) {
  console.warn(
    "Persistent Firestore cache unavailable, using memory cache:",
    err?.message || err
  );
  _db = getFirestore(app);
}
export const db = _db;

export { app };

// -----------------------------------------------------------------------------
// createSecondaryAuth()
// Returns { secondaryAuth, cleanup }. Used to create trainer accounts without
// disturbing the admin's primary session. Firebase's
// createUserWithEmailAndPassword() signs the CURRENT app instance into the new
// account — so we do it on a throwaway "Secondary" app, then delete it.
// -----------------------------------------------------------------------------
export async function createSecondaryAuth() {
  const { deleteApp } = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
  );
  // Unique name so repeated calls don't collide.
  const name = "Secondary-" + Date.now();
  const secondaryApp = initializeApp(firebaseConfig, name);
  const secondaryAuth = getAuth(secondaryApp);
  const cleanup = async () => {
    try {
      await secondaryAuth.signOut();
    } catch (_) {
      /* ignore */
    }
    try {
      await deleteApp(secondaryApp);
    } catch (_) {
      /* ignore */
    }
  };
  return { secondaryAuth, cleanup };
}
