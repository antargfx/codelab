/**
 * firebase.js — ExamPrep v3
 *
 * Handles:
 *  - Firebase init
 *  - lookupStudent(mobile)   → checks students collection
 *  - saveExamResult(data)    → saves to exam_results collection
 *
 * Requires config.js to be loaded first.
 * Uses Firebase v9 compat SDK.
 */

let db = null;

function initFirebase() {
  try {
    if (firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    console.log('[Firebase] Initialised.');
  } catch (err) {
    console.error('[Firebase] Init failed:', err);
    db = null;
  }
}

/**
 * Look up a student by mobile number.
 * Searches the `students` collection for a document where `mobile === mobileNumber`.
 *
 * @param {string} mobileNumber
 * @returns {Promise<{found: boolean, student: object|null, error: string|null}>}
 */
async function lookupStudent(mobileNumber) {
  if (!db) return { found: false, student: null, error: 'Database not available.' };

  try {
    const snap = await db.collection('students')
      .where('mobile', '==', mobileNumber.trim())
      .limit(1)
      .get();

    if (snap.empty) {
      return { found: false, student: null, error: null };
    }

    const doc = snap.docs[0];
    return { found: true, student: { id: doc.id, ...doc.data() }, error: null };
  } catch (err) {
    console.error('[Firebase] lookupStudent error:', err);
    return { found: false, student: null, error: err.message };
  }
}

/**
 * Save an exam result to the `exam_results` collection.
 *
 * @param {Object} resultData
 * @returns {Promise<boolean>}
 */
async function saveExamResult(resultData) {
  if (!db) {
    console.warn('[Firebase] Firestore not available. Result not saved.');
    return false;
  }
  try {
    const payload = {
      ...resultData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('exam_results').add(payload);
    console.log('[Firebase] Result saved. Doc ID:', ref.id);
    return true;
  } catch (err) {
    console.error('[Firebase] saveExamResult error:', err);
    return false;
  }
}

// Initialise on load
initFirebase();
