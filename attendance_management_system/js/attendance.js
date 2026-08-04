// =============================================================================
// attendance.js — Core attendance-taking (instant upsert, holidays, totals)
// =============================================================================

import {
  requireAuth,
  renderShell,
  setPageTitle,
  canWriteBatch,
} from "./auth.js";
import {
  listBatches,
  listLabs,
  listStudents,
  getDay,
  setStudentStatus,
  setHoliday,
} from "./data.js";
import { APP_CONFIG } from "./config.js";
import {
  $,
  el,
  escapeHtml,
  todayLocal,
  computeDayTotals,
  round1,
  handleError,
  toast,
  logActivity,
  prefs,
  paths,
} from "./utils.js";

const STATUSES = APP_CONFIG.attendanceStatuses; // present, absent, late, leave
const STATUS_LABEL = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  leave: "Leave",
};

let profile;
let batches = [];
let labs = [];
let students = [];
let day = null; // current day-document (may be null before first mark)

let state = {
  batchId: "",
  labId: "",
  date: todayLocal(),
};

init();

async function init() {
  profile = await requireAuth();
  await renderShell(profile, "attendance.html");
  setPageTitle("Take Attendance");

  $("#date-input").value = state.date;

  try {
    batches = await listBatches({ activeOnly: true });
    if (batches.length === 0) {
      $("#attendance-body").innerHTML =
        `<tr><td colspan="4" class="cell-muted">No active batches. Create one in Settings.</td></tr>`;
      return;
    }
    state.batchId = pickDefault(batches, prefs.get("batchId"));
    populateSelect("#batch-select", batches, state.batchId);
    await loadLabs();
    wireEvents();
  } catch (err) {
    handleError(err, "attendance init");
  }
}

function pickDefault(items, preferredId) {
  if (preferredId && items.some((i) => i.id === preferredId)) return preferredId;
  return items[0]?.id || "";
}

function populateSelect(sel, items, value) {
  const node = $(sel);
  node.innerHTML = "";
  for (const it of items) {
    node.appendChild(el("option", { value: it.id }, it.name || it.id));
  }
  if (value) node.value = value;
}

async function loadLabs() {
  labs = await listLabs(state.batchId);
  if (labs.length === 0) {
    $("#lab-select").innerHTML = "";
    students = [];
    render();
    return;
  }
  state.labId = pickDefault(labs, prefs.get("labId"));
  populateSelect("#lab-select", labs, state.labId);
  await loadRoster();
}

async function loadRoster() {
  const body = $("#attendance-body");
  body.innerHTML = `<tr><td colspan="4"><div class="row-skeletons">${skelRows(
    6
  )}</div></td></tr>`;
  try {
    [students, day] = await Promise.all([
      listStudents(state.batchId, state.labId, { activeOnly: true }),
      getDay(state.batchId, state.labId, state.date),
    ]);
    $("#holiday-toggle").checked = !!day?.isHoliday;
    render();
  } catch (err) {
    handleError(err, "loadRoster");
    body.innerHTML = `<tr><td colspan="4" class="cell-muted">Could not load roster.</td></tr>`;
  }
}

function wireEvents() {
  $("#batch-select").addEventListener("change", async (e) => {
    state.batchId = e.target.value;
    prefs.set("batchId", state.batchId);
    await loadLabs();
  });

  $("#lab-select").addEventListener("change", async (e) => {
    state.labId = e.target.value;
    prefs.set("labId", state.labId);
    await loadRoster();
  });

  $("#date-input").addEventListener("change", async (e) => {
    state.date = e.target.value || todayLocal();
    await loadRoster();
  });

  $("#search-input").addEventListener("input", (e) =>
    filterRows(e.target.value.trim().toLowerCase())
  );

  $("#holiday-toggle").addEventListener("change", onHolidayToggle);
}

async function onHolidayToggle(e) {
  const isHoliday = e.target.checked;
  if (!canWriteBatch(state.batchId)) {
    e.target.checked = !isHoliday;
    toast("You can't edit attendance for this batch.", "warn");
    return;
  }
  try {
    await setHoliday({
      batchId: state.batchId,
      labId: state.labId,
      date: state.date,
      isHoliday,
      markedBy: profile.uid,
    });
    day = day || { records: {} };
    day.isHoliday = isHoliday;
    await logActivity(profile.uid, "holiday_toggle", paths.dayDoc(
      state.batchId,
      state.labId,
      state.date
    ), { isHoliday });
    render();
    toast(
      isHoliday ? "Marked as holiday." : "Holiday removed.",
      "success"
    );
  } catch (err) {
    e.target.checked = !isHoliday;
    handleError(err, "holiday toggle");
  }
}

// -----------------------------------------------------------------------------
// RENDER
// -----------------------------------------------------------------------------

function render() {
  renderTotals();
  renderTable();
}

function renderTotals() {
  const bar = $("#totals-bar");
  if (day?.isHoliday) {
    bar.innerHTML = `<span class="badge badge-holiday">Holiday — excluded from attendance %</span>`;
    return;
  }
  const records = day?.records || {};
  const t = computeDayTotals(records);
  bar.innerHTML = "";
  bar.append(
    totalPill("Present", t.present, "present"),
    totalPill("Absent", t.absent, "absent"),
    totalPill("Late", t.late, "late"),
    totalPill("Leave", t.leave, "leave"),
    totalPill("Attendance %", `${t.percentage}%`, "pct")
  );
}

function totalPill(label, value, kind) {
  return el(
    "div",
    { class: `total-pill total-${kind}` },
    el("span", { class: "total-value" }, String(value)),
    el("span", { class: "total-label" }, label)
  );
}

function renderTable() {
  const body = $("#attendance-body");
  body.innerHTML = "";

  if (labs.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="cell-muted">No labs in this batch. Add one in Settings.</td></tr>`;
    return;
  }
  if (students.length === 0) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon" aria-hidden="true">👤</div><p>No active students in this lab. Add students on the Students page.</p></div></td></tr>`;
    return;
  }

  const records = day?.records || {};
  const holiday = !!day?.isHoliday;
  const writable = canWriteBatch(state.batchId);

  for (const s of students) {
    const current = records[s.id]?.status || APP_CONFIG.defaultStatus;
    const tr = el(
      "tr",
      {
        class: "attendance-row" + (holiday ? " row-disabled" : ""),
        dataset: {
          search: `${s.rollNumber} ${s.fullName}`.toLowerCase(),
          sid: s.id,
        },
      },
      el("td", { class: "cell-roll" }, escapeHtml(String(s.rollNumber))),
      el("td", { class: "cell-name" }, escapeHtml(s.fullName)),
      el("td", { class: "cell-phone" }, escapeHtml(s.phone || "—")),
      el("td", { class: "status-col" }, buildStatusGroup(s, current, holiday, writable))
    );
    body.appendChild(tr);
  }
}

function buildStatusGroup(student, current, holiday, writable) {
  const group = el("div", {
    class: "status-group",
    role: "group",
    "aria-label": `Attendance status for ${student.fullName}`,
  });
  for (const status of STATUSES) {
    const btn = el(
      "button",
      {
        type: "button",
        class:
          "status-btn status-" +
          status +
          (current === status ? " active" : ""),
        "aria-pressed": current === status ? "true" : "false",
        disabled: holiday || !writable ? "" : null,
        dataset: { status, sid: student.id },
        onClick: () => onStatusClick(student, status, group),
      },
      STATUS_LABEL[status]
    );
    if (!(holiday || !writable)) btn.removeAttribute("disabled");
    group.appendChild(btn);
  }
  return group;
}

async function onStatusClick(student, status, group) {
  if (!canWriteBatch(state.batchId)) {
    toast("You can't edit attendance for this batch.", "warn");
    return;
  }
  if (day?.isHoliday) {
    toast("This date is marked as a holiday.", "warn");
    return;
  }

  // Optimistic UI: reflect selection immediately.
  const prevActive = group.querySelector(".status-btn.active");
  for (const b of group.querySelectorAll(".status-btn")) {
    const on = b.dataset.status === status;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }

  try {
    const totals = await setStudentStatus({
      batchId: state.batchId,
      labId: state.labId,
      date: state.date,
      studentId: student.id,
      status,
      markedBy: profile.uid,
    });
    // Update local cache of the day doc.
    day = day || {
      records: {},
      isHoliday: false,
      batchId: state.batchId,
      labId: state.labId,
      date: state.date,
    };
    day.records = day.records || {};
    day.records[student.id] = { status };
    day.totals = totals;
    renderTotals();
    await logActivity(
      profile.uid,
      "attendance_mark",
      paths.dayDoc(state.batchId, state.labId, state.date),
      { studentId: student.id, status }
    );
  } catch (err) {
    // Roll back the optimistic selection on failure.
    if (prevActive) {
      for (const b of group.querySelectorAll(".status-btn")) {
        const on = b === prevActive;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    handleError(err, "mark status");
  }
}

function filterRows(term) {
  for (const tr of document.querySelectorAll("#attendance-body .attendance-row")) {
    const hay = tr.dataset.search || "";
    tr.style.display = !term || hay.includes(term) ? "" : "none";
  }
}

function skelRows(n) {
  return Array.from({ length: n })
    .map(() => `<div class="skeleton skeleton-row"></div>`)
    .join("");
}
