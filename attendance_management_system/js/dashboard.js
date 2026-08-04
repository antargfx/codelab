// =============================================================================
// dashboard.js — Dashboard page (stat cards, quick actions, lab summary)
// =============================================================================

import { requireAuth, renderShell, setPageTitle, isAdmin } from "./auth.js";
import {
  getSettings,
  listBatches,
  getBatch,
  listLabs,
  listStudents,
  getDay,
} from "./data.js";
import {
  $,
  el,
  escapeHtml,
  todayLocal,
  prettyDate,
  round1,
  handleError,
  toast,
  prefs,
} from "./utils.js";

let profile;
let settings;
let batches = [];
let currentBatchId = "";

init();

async function init() {
  profile = await requireAuth();
  settings = await renderShell(profile, "dashboard.html");
  setPageTitle("Dashboard");

  try {
    batches = await listBatches();
    if (batches.length === 0) {
      renderEmpty();
      return;
    }
    currentBatchId =
      prefs.get("batchId") ||
      settings.currentBatchId ||
      batches[0].id;
    if (!batches.some((b) => b.id === currentBatchId))
      currentBatchId = batches[0].id;

    populateBatchSelect();
    renderQuickActions();
    await loadStats();
  } catch (err) {
    handleError(err, "dashboard init");
  }
}

function populateBatchSelect() {
  const sel = $("#batch-select");
  sel.innerHTML = "";
  for (const b of batches) {
    sel.appendChild(
      el("option", { value: b.id }, `${b.name || b.id}${b.isActive === false ? " (archived)" : ""}`)
    );
  }
  sel.value = currentBatchId;
  sel.addEventListener("change", async () => {
    currentBatchId = sel.value;
    prefs.set("batchId", currentBatchId);
    await loadStats();
  });
}

function renderQuickActions() {
  const actions = [
    { href: "attendance.html", label: "Take Attendance", icon: "✅" },
    { href: "reports.html?view=monthly", label: "Monthly Report", icon: "📅" },
    { href: "reports.html?view=three", label: "3-Month Report", icon: "📆" },
    { href: "reports.html?view=export", label: "Export Excel", icon: "⬇️" },
    { href: "students.html", label: "Manage Students", icon: "👥" },
  ];
  if (isAdmin())
    actions.push({ href: "settings.html", label: "Settings", icon: "⚙️" });

  const wrap = $("#quick-actions");
  wrap.innerHTML = "";
  for (const a of actions) {
    wrap.appendChild(
      el(
        "a",
        { href: a.href, class: "quick-btn" },
        el("span", { class: "quick-icon", "aria-hidden": "true" }, a.icon),
        el("span", { class: "quick-label" }, a.label)
      )
    );
  }
}

async function loadStats() {
  const cards = $("#stat-cards");
  const labWrap = $("#lab-summary");
  cards.innerHTML = skeletons(7);
  labWrap.innerHTML = skeletons(3);

  try {
    const batch = await getBatch(currentBatchId);
    const labs = await listLabs(currentBatchId);
    const today = todayLocal();

    // Gather per-lab rosters + today's day docs in parallel.
    const perLab = await Promise.all(
      labs.map(async (lab) => {
        const [students, day] = await Promise.all([
          listStudents(currentBatchId, lab.id, { activeOnly: true }),
          getDay(currentBatchId, lab.id, today),
        ]);
        return { lab, students, day };
      })
    );

    let totalStudents = 0;
    let presentToday = 0;
    let absentToday = 0;
    let lateToday = 0;
    let leaveToday = 0;
    let countedToday = 0;

    for (const { students, day } of perLab) {
      totalStudents += students.length;
      if (day && !day.isHoliday && day.totals) {
        presentToday += day.totals.present || 0;
        absentToday += day.totals.absent || 0;
        lateToday += day.totals.late || 0;
        leaveToday += day.totals.leave || 0;
        countedToday += day.totals.counted || 0;
      }
    }

    const pct = countedToday
      ? round1(((presentToday + lateToday) / countedToday) * 100)
      : 0;

    cards.innerHTML = "";
    cards.append(
      statCard("Current Batch", batch?.name || currentBatchId, "🎓"),
      statCard("Today", prettyDate(today), "📅"),
      statCard("Total Labs", String(labs.length), "🧪"),
      statCard("Total Students", String(totalStudents), "👥"),
      statCard("Present Today", String(presentToday + lateToday), "🟢"),
      statCard("Absent Today", String(absentToday + leaveToday), "🔴"),
      statCard("Attendance %", `${pct}%`, "📈")
    );

    // Lab summary cards.
    labWrap.innerHTML = "";
    if (labs.length === 0) {
      labWrap.appendChild(emptyState("No labs in this batch yet."));
    } else {
      for (const { lab, students, day } of perLab) {
        const t = day && !day.isHoliday ? day.totals || {} : {};
        const labPresent = (t.present || 0) + (t.late || 0);
        const labAbsent = (t.absent || 0) + (t.leave || 0);
        const labPct = t.counted
          ? round1((labPresent / t.counted) * 100)
          : 0;
        labWrap.appendChild(
          labCard(
            lab.name || lab.id,
            students.length,
            labPresent,
            labAbsent,
            labPct,
            day?.isHoliday
          )
        );
      }
    }
  } catch (err) {
    handleError(err, "loadStats");
    cards.innerHTML = "";
    cards.appendChild(emptyState("Could not load stats."));
  }
}

// -----------------------------------------------------------------------------
// Small render helpers
// -----------------------------------------------------------------------------

function statCard(label, value, icon) {
  return el(
    "div",
    { class: "stat-card" },
    el("div", { class: "stat-icon", "aria-hidden": "true" }, icon),
    el(
      "div",
      { class: "stat-body" },
      el("div", { class: "stat-value" }, value),
      el("div", { class: "stat-label" }, label)
    )
  );
}

function labCard(name, total, present, absent, pct, holiday) {
  const card = el(
    "div",
    { class: "stat-card lab-card" },
    el(
      "div",
      { class: "lab-card-head" },
      el("h4", { class: "lab-card-title" }, name),
      holiday
        ? el("span", { class: "badge badge-holiday" }, "Holiday")
        : el("span", { class: "badge" }, `${pct}%`)
    ),
    el(
      "div",
      { class: "lab-card-stats" },
      miniStat("Students", total),
      miniStat("Present", present),
      miniStat("Absent", absent)
    )
  );
  return card;
}

function miniStat(label, value) {
  return el(
    "div",
    { class: "mini-stat" },
    el("div", { class: "mini-value" }, String(value)),
    el("div", { class: "mini-label" }, label)
  );
}

function skeletons(n) {
  return Array.from({ length: n })
    .map(() => `<div class="stat-card skeleton" style="height:96px"></div>`)
    .join("");
}

function emptyState(msg) {
  return el(
    "div",
    { class: "empty-state" },
    el("div", { class: "empty-icon", "aria-hidden": "true" }, "📭"),
    el("p", {}, msg)
  );
}

function renderEmpty() {
  const cards = $("#stat-cards");
  cards.innerHTML = "";
  cards.appendChild(
    el(
      "div",
      { class: "empty-state wide" },
      el("div", { class: "empty-icon", "aria-hidden": "true" }, "🚀"),
      el("h3", {}, "No batches yet"),
      el(
        "p",
        {},
        isAdmin()
          ? "Create your first batch in Settings, or run the seed script to load demo data."
          : "No batches have been set up yet. Ask an admin to create one."
      ),
      isAdmin()
        ? el("a", { href: "settings.html", class: "btn btn-primary" }, "Go to Settings")
        : null
    )
  );
  $("#quick-actions").innerHTML = "";
  $("#lab-summary").innerHTML = "";
}
