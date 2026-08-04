// =============================================================================
// reports.js — Monthly View, 3-Month Report, Today's Sheet + exports
// =============================================================================
//
// Assembles a neutral "report model" for the active view, renders it as an HTML
// table, and feeds the SAME model to the Excel / PDF / CSV / Print exporters so
// there's no duplicated table logic.
// -----------------------------------------------------------------------------

import { requireAuth, renderShell, setPageTitle } from "./auth.js";
import {
  getSettings,
  listBatches,
  listLabs,
  listStudents,
  getBatch,
  getDay,
  getDaysInRange,
} from "./data.js";
import {
  $,
  el,
  escapeHtml,
  todayLocal,
  prettyDate,
  parseLocalDate,
  monthLength,
  formatDateLocal,
  studentPercentage,
  round1,
  handleError,
  toast,
  showSpinner,
  hideSpinner,
  prefs,
} from "./utils.js";

let profile;
let settings;
let batches = [];
let labs = [];
let state = {
  batchId: "",
  labId: "",
  month: todayLocal().slice(0, 7), // "YYYY-MM"
  view: "monthly",
};

// The currently rendered report model (used by exporters).
let model = null;

const STATUS_SHORT = { present: "P", absent: "A", late: "L", leave: "V" };

init();

async function init() {
  profile = await requireAuth();
  settings = await renderShell(profile, "reports.html");
  setPageTitle("Reports");

  // Honor ?view= from dashboard quick buttons.
  const params = new URLSearchParams(location.search);
  const v = params.get("view");
  if (v === "monthly" || v === "three" || v === "today") state.view = v;
  if (v === "export") state.view = "monthly";

  $("#month-input").value = state.month;

  try {
    batches = await listBatches();
    if (batches.length === 0) {
      $("#report-area").innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">📭</div><p>No batches yet.</p></div>`;
      return;
    }
    state.batchId = pickDefault(batches, prefs.get("batchId"));
    populateSelect("#batch-select", batches, state.batchId);
    await loadLabs();
    wireEvents();
    setActiveTab(state.view);
    await refresh();
  } catch (err) {
    handleError(err, "reports init");
  }
}

function pickDefault(items, preferredId) {
  if (preferredId && items.some((i) => i.id === preferredId)) return preferredId;
  return items[0]?.id || "";
}
function populateSelect(sel, items, value) {
  const node = $(sel);
  node.innerHTML = "";
  for (const it of items)
    node.appendChild(el("option", { value: it.id }, it.name || it.id));
  if (value) node.value = value;
}

async function loadLabs() {
  labs = await listLabs(state.batchId);
  if (labs.length === 0) {
    $("#lab-select").innerHTML = "";
    return;
  }
  state.labId = pickDefault(labs, prefs.get("labId"));
  populateSelect("#lab-select", labs, state.labId);
}

function wireEvents() {
  $("#batch-select").addEventListener("change", async (e) => {
    state.batchId = e.target.value;
    prefs.set("batchId", state.batchId);
    await loadLabs();
    await refresh();
  });
  $("#lab-select").addEventListener("change", async (e) => {
    state.labId = e.target.value;
    prefs.set("labId", state.labId);
    await refresh();
  });
  $("#month-input").addEventListener("change", async (e) => {
    state.month = e.target.value || todayLocal().slice(0, 7);
    await refresh();
  });

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", async () => {
      state.view = tab.dataset.view;
      setActiveTab(state.view);
      await refresh();
    });
  }

  $("#export-xlsx").addEventListener("click", exportExcel);
  $("#export-pdf").addEventListener("click", exportPDF);
  $("#export-csv").addEventListener("click", exportCSV);
  $("#print-btn").addEventListener("click", () => window.print());
}

function setActiveTab(view) {
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.view === view;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  }
  // Month picker only relevant for monthly view.
  $("#month-field").style.display = view === "monthly" ? "" : "";
}

async function refresh() {
  if (labs.length === 0) {
    $("#report-area").innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">🧪</div><p>No labs in this batch.</p></div>`;
    model = null;
    return;
  }
  showSpinner("Building report…");
  try {
    if (state.view === "monthly") model = await buildMonthly();
    else if (state.view === "three") model = await buildThreeMonth();
    else model = await buildToday();
    renderModel(model);
  } catch (err) {
    handleError(err, "refresh report");
    $("#report-area").innerHTML = `<div class="empty-state"><p>Could not build report.</p></div>`;
  } finally {
    hideSpinner();
  }
}

// -----------------------------------------------------------------------------
// MODEL BUILDERS
// A model = { title, meta, columns, rows, footNote }
//   columns: [{key, label, class?}]
//   rows: [{cells:[{text, class?}], ...}]
// -----------------------------------------------------------------------------

function metaBlock(batch, lab) {
  return {
    instituteName: settings.instituteName || "Training Institute",
    batch: batch?.name || state.batchId,
    lab: lab?.name || state.labId,
    trainer: profile.displayName || profile.email,
    generated: prettyDate(todayLocal()),
  };
}

async function buildMonthly() {
  const [batch, students] = await Promise.all([
    getBatch(state.batchId),
    listStudents(state.batchId, state.labId),
  ]);
  const lab = labs.find((l) => l.id === state.labId);
  const [yStr, mStr] = state.month.split("-");
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const numDays = monthLength(year, monthIdx);
  const start = formatDateLocal(new Date(year, monthIdx, 1));
  const end = formatDateLocal(new Date(year, monthIdx, numDays));

  const dayDocs = await getDaysInRange(state.batchId, state.labId, start, end);
  const byDate = {};
  for (const d of dayDocs) byDate[d.date] = d;

  // Columns: Roll, Name, Day 1..N, P, A, L, V, %
  const columns = [
    { key: "roll", label: "Roll" },
    { key: "name", label: "Name" },
  ];
  const dateList = [];
  for (let d = 1; d <= numDays; d++) {
    const ds = formatDateLocal(new Date(year, monthIdx, d));
    dateList.push(ds);
    const holiday = byDate[ds]?.isHoliday;
    columns.push({
      key: "d" + d,
      label: String(d),
      class: holiday ? "col-holiday" : "col-day",
    });
  }
  columns.push(
    { key: "p", label: "P", class: "col-total" },
    { key: "a", label: "A", class: "col-total" },
    { key: "l", label: "L", class: "col-total" },
    { key: "v", label: "V", class: "col-total" },
    { key: "pct", label: "%", class: "col-total" }
  );

  const rows = [];
  for (const s of students) {
    const cells = [
      { text: String(s.rollNumber) },
      { text: s.fullName + (s.isActive === false ? " (inactive)" : "") },
    ];
    for (const ds of dateList) {
      const day = byDate[ds];
      if (day?.isHoliday) {
        cells.push({ text: "H", class: "cell-holiday" });
      } else {
        const st = day?.records?.[s.id]?.status;
        cells.push({
          text: st ? STATUS_SHORT[st] : "",
          class: st ? "cell-" + st : "cell-empty",
        });
      }
    }
    const tot = studentPercentage(s.id, dayDocs);
    cells.push(
      { text: String(tot.present), class: "cell-total" },
      { text: String(tot.absent), class: "cell-total" },
      { text: String(tot.late), class: "cell-total" },
      { text: String(tot.leave), class: "cell-total" },
      { text: `${tot.percentage}%`, class: "cell-total cell-pct" }
    );
    rows.push({ cells });
  }

  const monthName = parseLocalDate(start).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return {
    kind: "monthly",
    title: `Monthly Attendance — ${monthName}`,
    meta: metaBlock(batch, lab),
    columns,
    rows,
    footNote:
      "H = Holiday (excluded from %). P=Present, A=Absent, L=Late, V=Leave. % = (Present+Late)/counted days.",
  };
}

async function buildThreeMonth() {
  const [batch, students] = await Promise.all([
    getBatch(state.batchId),
    listStudents(state.batchId, state.labId),
  ]);
  const lab = labs.find((l) => l.id === state.labId);

  // Three months ending with the batch's course window if available, else the
  // three months ending this month.
  const durMonths = Number(
    batch?.durationMonths || settings.courseDurationMonths || 3
  );
  const monthsToShow = Math.min(3, durMonths) || 3;

  // Determine the 3 month windows relative to batch start (or current month).
  let baseYear, baseMonthIdx;
  if (batch?.startDate) {
    const sd = parseLocalDate(batch.startDate);
    baseYear = sd.getFullYear();
    baseMonthIdx = sd.getMonth();
  } else {
    const now = new Date();
    baseYear = now.getFullYear();
    baseMonthIdx = now.getMonth() - (monthsToShow - 1);
  }

  const windows = [];
  for (let i = 0; i < monthsToShow; i++) {
    const y = baseYear;
    const m = baseMonthIdx + i;
    const dt = new Date(y, m, 1);
    const start = formatDateLocal(new Date(dt.getFullYear(), dt.getMonth(), 1));
    const end = formatDateLocal(
      new Date(dt.getFullYear(), dt.getMonth(), monthLength(dt.getFullYear(), dt.getMonth()))
    );
    windows.push({
      label: dt.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      start,
      end,
    });
  }

  // Fetch all days per window.
  const windowDocs = await Promise.all(
    windows.map((w) =>
      getDaysInRange(state.batchId, state.labId, w.start, w.end)
    )
  );

  const columns = [
    { key: "roll", label: "Roll" },
    { key: "name", label: "Name" },
  ];
  windows.forEach((w, i) =>
    columns.push({ key: "m" + i, label: `${w.label} %`, class: "col-total" })
  );
  columns.push(
    { key: "P", label: "Present", class: "col-total" },
    { key: "A", label: "Absent", class: "col-total" },
    { key: "L", label: "Late", class: "col-total" },
    { key: "V", label: "Leave", class: "col-total" },
    { key: "overall", label: "Overall %", class: "col-total" }
  );

  const allDocs = windowDocs.flat();
  const rows = [];
  for (const s of students) {
    const cells = [
      { text: String(s.rollNumber) },
      { text: s.fullName + (s.isActive === false ? " (inactive)" : "") },
    ];
    windowDocs.forEach((docs) => {
      const t = studentPercentage(s.id, docs);
      cells.push({ text: `${t.percentage}%`, class: "cell-total" });
    });
    const overall = studentPercentage(s.id, allDocs);
    cells.push(
      { text: String(overall.present), class: "cell-total" },
      { text: String(overall.absent), class: "cell-total" },
      { text: String(overall.late), class: "cell-total" },
      { text: String(overall.leave), class: "cell-total" },
      { text: `${overall.percentage}%`, class: "cell-total cell-pct" }
    );
    rows.push({ cells });
  }

  return {
    kind: "three",
    title: "3-Month Attendance Report",
    meta: metaBlock(batch, lab),
    columns,
    rows,
    footNote:
      "Per-month and overall percentages exclude holidays. % = (Present+Late)/counted days.",
  };
}

async function buildToday() {
  const [batch, students] = await Promise.all([
    getBatch(state.batchId),
    listStudents(state.batchId, state.labId, { activeOnly: true }),
  ]);
  const lab = labs.find((l) => l.id === state.labId);
  const date = todayLocal();
  const day = await getDay(state.batchId, state.labId, date);

  const columns = [
    { key: "roll", label: "Roll" },
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "status", label: "Status", class: "col-total" },
  ];
  const rows = [];
  for (const s of students) {
    const st = day?.records?.[s.id]?.status || "absent";
    rows.push({
      cells: [
        { text: String(s.rollNumber) },
        { text: s.fullName },
        { text: s.phone || "" },
        {
          text: st.charAt(0).toUpperCase() + st.slice(1),
          class: "cell-" + st,
        },
      ],
    });
  }

  return {
    kind: "today",
    title: `Today's Attendance — ${prettyDate(date)}`,
    meta: metaBlock(batch, lab),
    columns,
    rows,
    footNote: day?.isHoliday ? "This date is marked as a HOLIDAY." : "",
  };
}

// -----------------------------------------------------------------------------
// RENDER (HTML)
// -----------------------------------------------------------------------------

function renderModel(m) {
  if (!m) return;
  const area = $("#report-area");
  area.innerHTML = "";

  const header = el(
    "div",
    { class: "report-header" },
    el("div", { class: "report-institute" }, m.meta.instituteName),
    el("h3", { class: "report-title" }, m.title),
    el(
      "div",
      { class: "report-meta" },
      metaLine("Batch", m.meta.batch),
      metaLine("Lab", m.meta.lab),
      metaLine("Trainer", m.meta.trainer),
      metaLine("Generated", m.meta.generated)
    )
  );

  const table = el("table", { class: "data-table report-table" });
  const thead = el("thead");
  const htr = el("tr");
  for (const c of m.columns)
    htr.appendChild(el("th", { scope: "col", class: c.class || "" }, c.label));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = el("tbody");
  if (m.rows.length === 0) {
    tbody.appendChild(
      el(
        "tr",
        {},
        el(
          "td",
          { colspan: String(m.columns.length), class: "cell-muted" },
          "No students to report."
        )
      )
    );
  } else {
    for (const r of m.rows) {
      const tr = el("tr");
      for (const cell of r.cells)
        tr.appendChild(el("td", { class: cell.class || "" }, cell.text));
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);

  const wrap = el("div", { class: "table-wrapper" }, table);
  area.append(header, wrap);
  if (m.footNote)
    area.appendChild(el("p", { class: "report-foot" }, m.footNote));
}

function metaLine(label, value) {
  return el(
    "span",
    { class: "meta-line" },
    el("span", { class: "meta-label" }, label + ": "),
    el("span", { class: "meta-value" }, value)
  );
}

// -----------------------------------------------------------------------------
// EXPORTERS — consume the current `model`.
// -----------------------------------------------------------------------------

function requireModel() {
  if (!model || model.rows.length === 0) {
    toast("Nothing to export yet.", "warn");
    return false;
  }
  return true;
}

/** Build a 2D array-of-arrays including a meta header block + table. */
function modelToAOA(m) {
  const aoa = [];
  aoa.push([m.meta.instituteName]);
  aoa.push([m.title]);
  aoa.push([`Batch: ${m.meta.batch}`, `Lab: ${m.meta.lab}`, `Trainer: ${m.meta.trainer}`, `Generated: ${m.meta.generated}`]);
  aoa.push([]); // spacer
  aoa.push(m.columns.map((c) => c.label));
  for (const r of m.rows) aoa.push(r.cells.map((c) => c.text));
  if (m.footNote) {
    aoa.push([]);
    aoa.push([m.footNote]);
  }
  return aoa;
}

function exportExcel() {
  if (!requireModel()) return;
  if (typeof XLSX === "undefined") {
    toast("Excel library failed to load.", "error");
    return;
  }
  const m = model;
  const aoa = modelToAOA(m);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const numCols = m.columns.length;
  const headerRowIdx = 4; // 0-based row where column labels sit
  const lastRowIdx = headerRowIdx + m.rows.length;

  // Column widths (auto-ish).
  ws["!cols"] = m.columns.map((c, i) => {
    if (i === 1) return { wch: 26 }; // name column
    if (i === 0) return { wch: 10 };
    return { wch: Math.max(6, c.label.length + 2) };
  });

  // Merge the title rows across all columns for a clean header.
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } },
  ];

  // --- Styling (xlsx-js-style) ---
  const border = {
    top: { style: "thin", color: { rgb: "FF999999" } },
    bottom: { style: "thin", color: { rgb: "FF999999" } },
    left: { style: "thin", color: { rgb: "FF999999" } },
    right: { style: "thin", color: { rgb: "FF999999" } },
  };
  const setStyle = (r, c, style) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = style;
  };

  // Institute title.
  setStyle(0, 0, {
    font: { bold: true, sz: 15, color: { rgb: "FF1E3A8A" } },
    alignment: { horizontal: "center" },
  });
  // Report title.
  setStyle(1, 0, {
    font: { bold: true, sz: 12 },
    alignment: { horizontal: "center" },
  });

  // Column header row.
  for (let c = 0; c < numCols; c++) {
    setStyle(headerRowIdx, c, {
      font: { bold: true, color: { rgb: "FFFFFFFF" } },
      fill: { fgColor: { rgb: "FF2563EB" } },
      alignment: { horizontal: "center", vertical: "center" },
      border,
    });
  }

  // Body cells with borders + centered totals.
  for (let r = headerRowIdx + 1; r <= lastRowIdx; r++) {
    for (let c = 0; c < numCols; c++) {
      setStyle(r, c, {
        border,
        alignment: {
          horizontal: c <= 1 ? "left" : "center",
          vertical: "center",
        },
      });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName(m));
  XLSX.writeFile(wb, filename(m, "xlsx"));
  toast("Excel exported.", "success");
}

function exportPDF() {
  if (!requireModel()) return;
  const jsPDFCtor = window.jspdf?.jsPDF;
  if (!jsPDFCtor) {
    toast("PDF library failed to load.", "error");
    return;
  }
  const m = model;
  const landscape = m.columns.length > 6;
  const doc = new jsPDFCtor({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(14);
  doc.setTextColor(30, 58, 138);
  doc.text(m.meta.instituteName, pageWidth / 2, 30, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(m.title, pageWidth / 2, 46, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Batch: ${m.meta.batch}   Lab: ${m.meta.lab}   Trainer: ${m.meta.trainer}   Generated: ${m.meta.generated}`,
    pageWidth / 2,
    60,
    { align: "center" }
  );

  doc.autoTable({
    head: [m.columns.map((c) => c.label)],
    body: m.rows.map((r) => r.cells.map((c) => c.text)),
    startY: 72,
    styles: { fontSize: 7, cellPadding: 2, lineColor: [160, 160, 160], lineWidth: 0.4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, halign: "center" },
    columnStyles: { 0: { halign: "left" }, 1: { halign: "left" } },
    theme: "grid",
    margin: { left: 20, right: 20 },
  });

  if (m.footNote) {
    const y = doc.lastAutoTable.finalY + 14;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(m.footNote, 20, y, { maxWidth: pageWidth - 40 });
  }

  doc.save(filename(m, "pdf"));
  toast("PDF exported.", "success");
}

function exportCSV() {
  if (!requireModel()) return;
  if (typeof XLSX === "undefined") {
    toast("CSV library failed to load.", "error");
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet(modelToAOA(model));
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename(model, "csv") });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("CSV exported.", "success");
}

function sheetName(m) {
  return (m.kind === "monthly" ? "Monthly" : m.kind === "three" ? "3-Month" : "Today").slice(0, 28);
}

function filename(m, ext) {
  const safe = (s) => String(s).replace(/[^\w\-]+/g, "_");
  return `attendance_${safe(m.meta.batch)}_${safe(m.meta.lab)}_${m.kind}.${ext}`;
}
