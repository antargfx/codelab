// =============================================================================
// data.js — Shared Firestore data-access layer
// =============================================================================
//
// Centralizes all reads/writes so pages don't duplicate query logic. Every
// function is single-purpose and wraps its Firebase call so callers get clean
// data or a thrown error to handle with utils.handleError.
// -----------------------------------------------------------------------------

import { db } from "./firebase.js";
import { APP_CONFIG } from "./config.js";
import { paths, computeDayTotals } from "./utils.js";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const C = APP_CONFIG.collections;

// -----------------------------------------------------------------------------
// SETTINGS
// -----------------------------------------------------------------------------

export async function getSettings() {
  const ref = doc(db, C.settings, APP_CONFIG.settingsDocId);
  const snap = await getDoc(ref);
  return snap.exists()
    ? { id: snap.id, ...snap.data() }
    : {
        instituteName: "Training Institute",
        logoBase64: "",
        currentBatchId: "",
        courseDurationMonths: 3,
        theme: "light",
      };
}

export async function saveSettings(data) {
  const ref = doc(db, C.settings, APP_CONFIG.settingsDocId);
  await setDoc(ref, data, { merge: true });
}

// -----------------------------------------------------------------------------
// USERS (trainers/admins)
// -----------------------------------------------------------------------------

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, C.users, uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

export async function listUsers() {
  const snap = await getDocs(collection(db, C.users));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function createUserProfile(uid, data) {
  await setDoc(doc(db, C.users, uid), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function updateUserProfile(uid, data) {
  await updateDoc(doc(db, C.users, uid), data);
}

// -----------------------------------------------------------------------------
// BATCHES
// -----------------------------------------------------------------------------

export async function listBatches({ activeOnly = false } = {}) {
  const snap = await getDocs(collection(db, C.batches));
  let out = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (activeOnly) out = out.filter((b) => b.isActive !== false);
  return out.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export async function getBatch(batchId) {
  const snap = await getDoc(doc(db, C.batches, batchId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveBatch(batchId, data) {
  await setDoc(doc(db, C.batches, batchId), data, { merge: true });
}

export async function archiveBatch(batchId) {
  await updateDoc(doc(db, C.batches, batchId), { isActive: false });
}

// -----------------------------------------------------------------------------
// LABS
// -----------------------------------------------------------------------------

export async function listLabs(batchId) {
  const snap = await getDocs(collection(db, paths.labsCol(batchId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export async function saveLab(batchId, labId, data) {
  await setDoc(doc(db, paths.labsCol(batchId), labId), data, { merge: true });
}

export async function deleteLab(batchId, labId) {
  // Guard: refuse if the lab still has active students.
  const students = await listStudents(batchId, labId, { activeOnly: true });
  if (students.length > 0) {
    throw new Error(
      `Cannot delete this lab: it still has ${students.length} active student(s). Transfer or deactivate them first.`
    );
  }
  await deleteDoc(doc(db, paths.labsCol(batchId), labId));
}

// -----------------------------------------------------------------------------
// STUDENTS
// -----------------------------------------------------------------------------

export async function listStudents(batchId, labId, { activeOnly = false } = {}) {
  const snap = await getDocs(collection(db, paths.studentsCol(batchId, labId)));
  let out = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (activeOnly) out = out.filter((s) => s.isActive !== false);
  return out.sort((a, b) =>
    String(a.rollNumber).localeCompare(String(b.rollNumber), undefined, {
      numeric: true,
    })
  );
}

export async function getStudent(batchId, labId, studentId) {
  const snap = await getDoc(
    doc(db, paths.studentsCol(batchId, labId), studentId)
  );
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Create a student, validating a unique roll number within the lab first. */
export async function createStudent(batchId, labId, data) {
  const existing = await listStudents(batchId, labId);
  if (
    existing.some(
      (s) => String(s.rollNumber).trim() === String(data.rollNumber).trim()
    )
  ) {
    throw new Error(`Roll number "${data.rollNumber}" already exists in this lab.`);
  }
  const ref = doc(collection(db, paths.studentsCol(batchId, labId)));
  await setDoc(ref, {
    ...data,
    currentLabId: labId,
    isActive: true,
    joinedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateStudent(batchId, labId, studentId, data) {
  await updateDoc(doc(db, paths.studentsCol(batchId, labId), studentId), data);
}

export async function deactivateStudent(batchId, labId, studentId) {
  await updateDoc(doc(db, paths.studentsCol(batchId, labId), studentId), {
    isActive: false,
  });
}

export async function reactivateStudent(batchId, labId, studentId) {
  await updateDoc(doc(db, paths.studentsCol(batchId, labId), studentId), {
    isActive: true,
  });
}

/**
 * Transfer a student from one lab to another within the same batch.
 * Past attendance stays attributed to the OLD lab (it lives in that lab's day
 * documents). Only future attendance uses the new lab. Implemented as: copy the
 * student doc into the new lab, then deactivate the old record so historical
 * reports can still resolve their name by reading the old lab roster.
 */
export async function transferStudent(batchId, fromLabId, toLabId, studentId) {
  const student = await getStudent(batchId, fromLabId, studentId);
  if (!student) throw new Error("Student not found.");

  // Ensure roll number is unique in the destination lab.
  const destStudents = await listStudents(batchId, toLabId);
  if (
    destStudents.some(
      (s) =>
        String(s.rollNumber).trim() === String(student.rollNumber).trim() &&
        s.isActive !== false
    )
  ) {
    throw new Error(
      `Destination lab already has an active student with roll number "${student.rollNumber}".`
    );
  }

  const batch = writeBatch(db);
  // New active record in destination lab.
  const newRef = doc(collection(db, paths.studentsCol(batchId, toLabId)));
  batch.set(newRef, {
    rollNumber: student.rollNumber,
    fullName: student.fullName,
    phone: student.phone,
    isActive: true,
    currentLabId: toLabId,
    joinedAt: serverTimestamp(),
    transferredFrom: fromLabId,
  });
  // Old record: keep for history but deactivate.
  batch.update(doc(db, paths.studentsCol(batchId, fromLabId), studentId), {
    isActive: false,
    transferredTo: toLabId,
  });
  await batch.commit();
  return newRef.id;
}

/** Bulk create students (Excel import). Returns { created, skipped }. */
export async function bulkCreateStudents(batchId, labId, rows) {
  const existing = await listStudents(batchId, labId);
  const existingRolls = new Set(
    existing.map((s) => String(s.rollNumber).trim())
  );
  const batch = writeBatch(db);
  let created = 0;
  const skipped = [];
  for (const row of rows) {
    const roll = String(row.rollNumber).trim();
    if (!roll || existingRolls.has(roll)) {
      skipped.push(roll || "(blank)");
      continue;
    }
    existingRolls.add(roll);
    const ref = doc(collection(db, paths.studentsCol(batchId, labId)));
    batch.set(ref, {
      rollNumber: roll,
      fullName: String(row.fullName || "").trim(),
      phone: String(row.phone || "").trim(),
      isActive: true,
      currentLabId: labId,
      joinedAt: serverTimestamp(),
    });
    created++;
  }
  if (created > 0) await batch.commit();
  return { created, skipped };
}

// -----------------------------------------------------------------------------
// ATTENDANCE — one day-document per lab per day (records map + totals).
// -----------------------------------------------------------------------------

export async function getDay(batchId, labId, date) {
  const snap = await getDoc(doc(db, paths.dayDoc(batchId, labId, date)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Upsert a single student's status onto the day-document. Recomputes and stores
 * totals in the same write. Always a merge — never a new duplicate document.
 */
export async function setStudentStatus({
  batchId,
  labId,
  date,
  studentId,
  status,
  markedBy,
}) {
  const ref = doc(db, paths.dayDoc(batchId, labId, date));
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : {};
  const records = { ...(current.records || {}) };
  records[studentId] = { status };
  const totals = computeDayTotals(records);
  await setDoc(
    ref,
    {
      date,
      batchId,
      labId,
      isHoliday: current.isHoliday || false,
      records,
      totals,
      markedBy: markedBy || current.markedBy || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return totals;
}

/** Toggle holiday flag for a date. Keeps records but they're excluded from math. */
export async function setHoliday({ batchId, labId, date, isHoliday, markedBy }) {
  const ref = doc(db, paths.dayDoc(batchId, labId, date));
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : {};
  await setDoc(
    ref,
    {
      date,
      batchId,
      labId,
      isHoliday: !!isHoliday,
      records: current.records || {},
      totals: current.totals || computeDayTotals(current.records || {}),
      markedBy: markedBy || current.markedBy || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Fetch all day-documents for a lab within an inclusive date range.
 * Uses a range query on the "date" field; Firestore may request a composite
 * index the first time — accept it and commit firestore.indexes.json.
 */
export async function getDaysInRange(batchId, labId, startDate, endDate) {
  const col = collection(db, paths.daysCol(batchId, labId));
  const q = query(
    col,
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** All day-documents for a lab (used by 3-month/whole-course reports). */
export async function getAllDays(batchId, labId) {
  const col = collection(db, paths.daysCol(batchId, labId));
  const q = query(col, orderBy("date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
