// =============================================================================
// utils.js — Shared helpers (dates, math, toasts, dialogs, errors, logging)
// =============================================================================
//
// Single home for logic reused across pages. No page-specific behavior here.
// -----------------------------------------------------------------------------

import { db } from "./firebase.js";
import { APP_CONFIG } from "./config.js";
import {
  doc,
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// -----------------------------------------------------------------------------
// DATE HELPERS
// Date document IDs and all "today" logic use the LOCAL calendar date, never
// toISOString() (which is UTC and can shift the day near midnight).
// -----------------------------------------------------------------------------

/** Format a Date as "YYYY-MM-DD" using LOCAL time components. */
export function formatDateLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's local date as "YYYY-MM-DD". */
export function todayLocal() {
  return formatDateLocal(new Date());
}

/** Parse "YYYY-MM-DD" into a local Date at midnight (no UTC shift). */
export function parseLocalDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Human-friendly date, e.g. "Tue, 04 Aug 2026". */
export function prettyDate(str) {
  const dt = typeof str === "string" ? parseLocalDate(str) : str;
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Returns "YYYY-MM" for a given date string or Date. */
export function monthKey(dateOrStr) {
  const dt =
    typeof dateOrStr === "string" ? parseLocalDate(dateOrStr) : dateOrStr;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

/** All "YYYY-MM-DD" dates in a given month (year, monthIndex 0-11). */
export function daysInMonth(year, monthIndex) {
  const out = [];
  const last = new Date(year, monthIndex + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    out.push(formatDateLocal(new Date(year, monthIndex, d)));
  }
  return out;
}

/** Number of calendar days in a month. */
export function monthLength(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// -----------------------------------------------------------------------------
// PERCENTAGE / TOTALS MATH
// A "counted" day is any non-holiday day that has a recorded status.
// Percentage = (present + late) / countedDays * 100, rounded to 1 decimal.
// Late counts as attended-but-flagged; leave and absent do not count as present.
// -----------------------------------------------------------------------------

/**
 * Compute totals from a records map { studentId: { status } }.
 * Returns { present, absent, late, leave, counted, percentage }.
 */
export function computeDayTotals(records = {}) {
  let present = 0,
    absent = 0,
    late = 0,
    leave = 0;
  for (const key in records) {
    const s = records[key]?.status;
    if (s === "present") present++;
    else if (s === "absent") absent++;
    else if (s === "late") late++;
    else if (s === "leave") leave++;
  }
  const counted = present + absent + late + leave;
  const percentage = counted
    ? round1(((present + late) / counted) * 100)
    : 0;
  return { present, absent, late, leave, counted, percentage };
}

/**
 * Per-student attendance percentage across many days.
 * `dayDocs` is an array of day documents (each with isHoliday + records).
 * Holidays are excluded. A student not present in a day's records is treated
 * as not-counted for that day (they may have joined later / been in another lab).
 */
export function studentPercentage(studentId, dayDocs) {
  let present = 0,
    absent = 0,
    late = 0,
    leave = 0;
  for (const day of dayDocs) {
    if (day.isHoliday) continue;
    const rec = day.records?.[studentId];
    if (!rec) continue;
    if (rec.status === "present") present++;
    else if (rec.status === "absent") absent++;
    else if (rec.status === "late") late++;
    else if (rec.status === "leave") leave++;
  }
  const counted = present + absent + late + leave;
  const percentage = counted
    ? round1(((present + late) / counted) * 100)
    : 0;
  return { present, absent, late, leave, counted, percentage };
}

/** Round to 1 decimal place. */
export function round1(n) {
  return Math.round(n * 10) / 10;
}

// -----------------------------------------------------------------------------
// DOM / UI HELPERS
// -----------------------------------------------------------------------------

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) =>
  Array.from(root.querySelectorAll(sel));

/** Create an element with attributes and children. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset")
      Object.entries(v).forEach(([dk, dv]) => (node.dataset[dk] = dv));
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/** Escape untrusted text for safe innerHTML insertion. */
export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -----------------------------------------------------------------------------
// TOAST NOTIFICATIONS
// A single toast container is created lazily and reused.
// -----------------------------------------------------------------------------

function toastContainer() {
  let c = document.getElementById("toast-container");
  if (!c) {
    c = el("div", { id: "toast-container", class: "toast-container" });
    document.body.appendChild(c);
  }
  return c;
}

/** type: "success" | "error" | "info" | "warn" */
export function toast(message, type = "info", timeout = 3500) {
  const t = el(
    "div",
    { class: `toast toast-${type}`, role: "status", "aria-live": "polite" },
    el("span", { class: "toast-msg" }, message),
    el(
      "button",
      {
        class: "toast-close",
        "aria-label": "Dismiss notification",
        onClick: () => t.remove(),
      },
      "×"
    )
  );
  toastContainer().appendChild(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
  return t;
}

// -----------------------------------------------------------------------------
// LOADING SPINNER (full-screen overlay)
// -----------------------------------------------------------------------------

export function showSpinner(label = "Loading…") {
  let s = document.getElementById("global-spinner");
  if (!s) {
    s = el(
      "div",
      { id: "global-spinner", class: "spinner-overlay", role: "alert", "aria-busy": "true" },
      el("div", { class: "spinner" }),
      el("div", { class: "spinner-label" }, label)
    );
    document.body.appendChild(s);
  } else {
    s.querySelector(".spinner-label").textContent = label;
    s.style.display = "flex";
  }
}

export function hideSpinner() {
  const s = document.getElementById("global-spinner");
  if (s) s.style.display = "none";
}

// -----------------------------------------------------------------------------
// CONFIRMATION DIALOG (promise-based) — used before destructive actions.
// -----------------------------------------------------------------------------

export function confirmDialog({
  title = "Are you sure?",
  message = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = true,
} = {}) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
    const box = el(
      "div",
      { class: "modal" },
      el("h3", { class: "modal-title" }, title),
      message ? el("p", { class: "modal-message" }, message) : null,
      el(
        "div",
        { class: "modal-actions" },
        el(
          "button",
          {
            class: "btn btn-ghost",
            onClick: () => {
              overlay.remove();
              resolve(false);
            },
          },
          cancelText
        ),
        el(
          "button",
          {
            class: danger ? "btn btn-danger" : "btn btn-primary",
            onClick: () => {
              overlay.remove();
              resolve(true);
            },
          },
          confirmText
        )
      )
    );
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
    document.addEventListener(
      "keydown",
      function onKey(e) {
        if (e.key === "Escape") {
          overlay.remove();
          document.removeEventListener("keydown", onKey);
          resolve(false);
        }
      }
    );
    document.body.appendChild(overlay);
    box.querySelector("button:last-child").focus();
  });
}

// -----------------------------------------------------------------------------
// ERROR HANDLING
// Translate raw Firebase errors into friendly messages + toast them.
// -----------------------------------------------------------------------------

export function friendlyError(err) {
  const code = err?.code || "";
  const map = {
    "permission-denied":
      "You don't have permission to do that. Check your role or assigned batches.",
    unavailable:
      "Network unavailable. Your change was queued and will sync when you're back online.",
    "not-found": "That record no longer exists.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/too-many-requests":
      "Too many attempts. Please wait a moment and try again.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-email": "That email address looks invalid.",
    "auth/network-request-failed":
      "Network error. Check your connection and try again.",
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}

export function handleError(err, context = "") {
  console.error(context, err);
  toast(friendlyError(err), "error", 5000);
}

// -----------------------------------------------------------------------------
// ACTIVITY LOG — best-effort, never blocks the primary action.
// -----------------------------------------------------------------------------

export async function logActivity(uid, action, targetPath = "", details = {}) {
  try {
    await addDoc(collection(db, APP_CONFIG.collections.activityLog), {
      uid: uid || null,
      action,
      targetPath,
      details,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    // Logging must never break the app; just warn.
    console.warn("Activity log failed:", err?.message || err);
  }
}

// -----------------------------------------------------------------------------
// THEME (light/dark) — persisted in localStorage (a non-critical UI pref).
// -----------------------------------------------------------------------------

const THEME_KEY = "ams.theme";

export function applyTheme(theme) {
  const t = theme || localStorage.getItem(THEME_KEY) || preferredTheme();
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  return t;
}

export function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") || preferredTheme();
  return applyTheme(current === "dark" ? "light" : "dark");
}

function preferredTheme() {
  return window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// -----------------------------------------------------------------------------
// SMALL LOCALSTORAGE PREFS (last-selected batch/lab). Never the source of
// truth for attendance — only UI convenience.
// -----------------------------------------------------------------------------

export const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem("ams.pref." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("ams.pref." + key, JSON.stringify(value));
    } catch {
      /* ignore quota / privacy mode */
    }
  },
};

// -----------------------------------------------------------------------------
// VALIDATION
// -----------------------------------------------------------------------------

export function isValidPhone(phone) {
  return APP_CONFIG.phoneRegex.test(String(phone || "").trim());
}

export function isNonEmpty(str) {
  return String(str || "").trim().length > 0;
}

// -----------------------------------------------------------------------------
// FIRESTORE PATH BUILDERS (centralized to avoid typos)
// -----------------------------------------------------------------------------

export const paths = {
  studentsCol: (batchId, labId) =>
    `${APP_CONFIG.collections.batches}/${batchId}/${APP_CONFIG.collections.labs}/${labId}/${APP_CONFIG.collections.students}`,
  labsCol: (batchId) =>
    `${APP_CONFIG.collections.batches}/${batchId}/${APP_CONFIG.collections.labs}`,
  dayDoc: (batchId, labId, date) =>
    `${APP_CONFIG.collections.attendance}/${batchId}/${APP_CONFIG.collections.labs}/${labId}/${APP_CONFIG.collections.days}/${date}`,
  daysCol: (batchId, labId) =>
    `${APP_CONFIG.collections.attendance}/${batchId}/${APP_CONFIG.collections.labs}/${labId}/${APP_CONFIG.collections.days}`,
};

// Convenience: doc ref from a slash path.
export function docRef(path) {
  return doc(db, path);
}
