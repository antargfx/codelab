// =============================================================================
// auth.js — Authentication, session guarding, role resolution, shared shell
// =============================================================================

import { auth } from "./firebase.js";
import { getUserProfile, getSettings } from "./data.js";
import {
  applyTheme,
  toggleTheme,
  toast,
  handleError,
  logActivity,
  escapeHtml,
} from "./utils.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// In-memory cache of the resolved profile for the current page load.
let _profile = null;

// -----------------------------------------------------------------------------
// AUTH ACTIONS
// -----------------------------------------------------------------------------

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );
  await logActivity(cred.user.uid, "login", `users/${cred.user.uid}`, {
    email: cred.user.email,
  });
  return cred.user;
}

export async function signOutUser() {
  const uid = auth.currentUser?.uid;
  await logActivity(uid, "logout", uid ? `users/${uid}` : "");
  await signOut(auth);
}

export async function sendReset(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

// -----------------------------------------------------------------------------
// SESSION GUARD
// requireAuth(allowedRoles) resolves with the user profile, or redirects to
// login. Pass e.g. ["admin"] to restrict a page to admins only.
// Returns a Promise<profile>.
// -----------------------------------------------------------------------------

export function requireAuth(allowedRoles = null) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) {
        redirectToLogin();
        return;
      }
      try {
        const profile = await getUserProfile(user.uid);
        if (!profile) {
          toast(
            "Your account has no profile document yet. Ask an admin to set up your access.",
            "error",
            6000
          );
          await signOut(auth);
          redirectToLogin();
          return;
        }
        if (profile.isActive === false) {
          toast("Your account has been deactivated.", "error", 6000);
          await signOut(auth);
          redirectToLogin();
          return;
        }
        if (allowedRoles && !allowedRoles.includes(profile.role)) {
          toast("You don't have access to that page.", "error", 5000);
          window.location.replace("dashboard.html");
          return;
        }
        _profile = { ...profile, uid: user.uid, email: user.email };
        resolve(_profile);
      } catch (err) {
        handleError(err, "requireAuth");
        redirectToLogin();
      }
    });
  });
}

function redirectToLogin() {
  // Relative path — safe under GitHub Pages project sub-paths.
  window.location.replace("login.html");
}

export function currentProfile() {
  return _profile;
}

export function isAdmin() {
  return _profile?.role === "admin";
}

export function canWriteBatch(batchId) {
  if (!_profile) return false;
  if (_profile.role === "admin") return true;
  return (
    _profile.role === "trainer" &&
    Array.isArray(_profile.assignedBatches) &&
    _profile.assignedBatches.includes(batchId)
  );
}

// -----------------------------------------------------------------------------
// SHARED SHELL (sidebar + top nav) — injected into every protected page so the
// layout isn't duplicated in each HTML file.
// -----------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: "dashboard.html", label: "Dashboard", icon: "🏠" },
  { href: "attendance.html", label: "Attendance", icon: "✅" },
  { href: "students.html", label: "Students", icon: "👥" },
  { href: "reports.html", label: "Reports", icon: "📊" },
  { href: "settings.html", label: "Settings", icon: "⚙️", adminOnly: true },
];

/**
 * Render the shell into #app-shell and move existing <main> content inside.
 * activePage = the href of the current page (e.g. "dashboard.html").
 */
export async function renderShell(profile, activePage) {
  applyTheme();
  let settings = {};
  try {
    settings = await getSettings();
    if (settings.theme) applyTheme(settings.theme);
  } catch (_) {
    /* settings optional for shell */
  }

  const instituteName = escapeHtml(settings.instituteName || "Attendance System");
  const logo = settings.logoBase64
    ? `<img src="${settings.logoBase64}" alt="Institute logo" class="brand-logo"/>`
    : `<span class="brand-logo brand-logo-fallback" aria-hidden="true">🎓</span>`;

  const navHtml = NAV_ITEMS.filter(
    (i) => !i.adminOnly || profile.role === "admin"
  )
    .map(
      (i) =>
        `<a href="${i.href}" class="nav-link${
          i.href === activePage ? " active" : ""
        }"${i.href === activePage ? ' aria-current="page"' : ""}>
           <span class="nav-icon" aria-hidden="true">${i.icon}</span>
           <span class="nav-label">${i.label}</span>
         </a>`
    )
    .join("");

  const shell = document.createElement("div");
  shell.className = "layout";
  shell.innerHTML = `
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="brand">${logo}<span class="brand-name">${instituteName}</span></div>
      <nav class="nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <button class="btn btn-ghost btn-block" id="logout-btn" type="button">↩ Logout</button>
      </div>
    </aside>
    <div class="main-area">
      <header class="topnav">
        <button class="icon-btn" id="menu-toggle" aria-label="Toggle menu" type="button">☰</button>
        <div class="topnav-title" id="page-title"></div>
        <div class="topnav-actions">
          <button class="icon-btn" id="theme-toggle" aria-label="Toggle dark mode" type="button">🌓</button>
          <div class="user-chip" title="${escapeHtml(profile.email || "")}">
            <span class="user-avatar" aria-hidden="true">${escapeHtml(
              (profile.displayName || profile.email || "?")[0].toUpperCase()
            )}</span>
            <span class="user-meta">
              <span class="user-name">${escapeHtml(
                profile.displayName || profile.email
              )}</span>
              <span class="user-role badge badge-${profile.role}">${escapeHtml(
    profile.role
  )}</span>
            </span>
          </div>
        </div>
      </header>
      <main class="content" id="content"></main>
    </div>
  `;

  // Move whatever was in <main> (the page's own markup) into the shell content.
  const existingMain = document.querySelector("main");
  const container = document.getElementById("app-shell") || document.body;
  const contentSlot = shell.querySelector("#content");
  if (existingMain) {
    while (existingMain.firstChild)
      contentSlot.appendChild(existingMain.firstChild);
    existingMain.remove();
  }
  container.prepend(shell);

  // Wire shell interactions.
  shell.querySelector("#logout-btn").addEventListener("click", async () => {
    try {
      await signOutUser();
      window.location.replace("login.html");
    } catch (err) {
      handleError(err, "logout");
    }
  });
  shell.querySelector("#theme-toggle").addEventListener("click", () =>
    toggleTheme()
  );
  shell.querySelector("#menu-toggle").addEventListener("click", () =>
    document.getElementById("sidebar").classList.toggle("open")
  );

  return settings;
}

/** Set the top-nav page title. */
export function setPageTitle(title) {
  const t = document.getElementById("page-title");
  if (t) t.textContent = title;
  document.title = `${title} · Attendance System`;
}
