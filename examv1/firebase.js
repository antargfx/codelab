/**
 * firebase.js
 * Handles all Firebase Firestore interactions.
 * Initializes the Firebase app and exposes saveExamResult().
 *
 * Requires config.js to be loaded first (provides `firebaseConfig` global).
 * Uses the Firebase v9 compat SDK loaded via CDN in index.html.
 */

// ─── Initialize Firebase App ─────────────────────────────────────────────────

let db = null; // Firestore database instance

/**
 * Initialises Firebase using the config defined in config.js.
 * Safe to call multiple times — only initialises once.
 */
function initFirebase() {
  try {
    // Prevent re-initialisation
    if (firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    console.log("[Firebase] Initialised successfully.");
  } catch (error) {
    console.error("[Firebase] Initialisation failed:", error);
    db = null;
  }
}

// ─── Save Exam Result ─────────────────────────────────────────────────────────

/**
 * Saves an exam result to the Firestore `exam_results` collection.
 *
 * @param {Object} resultData - The exam result payload to save.
 * @param {string} resultData.name          - Student's full name.
 * @param {string} resultData.mobile        - Student's mobile number.
 * @param {string} resultData.subject       - Exam subject name.
 * @param {number} resultData.score         - Final calculated score (with negatives).
 * @param {number} resultData.totalQuestions - Total number of questions.
 * @param {number} resultData.correct       - Count of correct answers.
 * @param {number} resultData.wrong         - Count of wrong answers.
 * @param {number} resultData.untouched     - Count of unanswered questions.
 * @param {number} resultData.percentage    - Score as a percentage of total marks.
 * @param {string} resultData.startTime     - ISO string of when the exam started.
 * @param {string} resultData.submitTime    - ISO string of when the exam was submitted.
 * @param {string} resultData.duration      - Human-readable duration (e.g., "45m 30s").
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function saveExamResult(resultData) {
  if (!db) {
    console.warn("[Firebase] Firestore not available. Result not saved remotely.");
    return false;
  }

  try {
    const payload = {
      ...resultData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection("exam_results").add(payload);
    console.log("[Firebase] Result saved. Document ID:", docRef.id);
    return true;
  } catch (error) {
    console.error("[Firebase] Failed to save result:", error);
    return false;
  }
}

// Initialise on load
initFirebase();
