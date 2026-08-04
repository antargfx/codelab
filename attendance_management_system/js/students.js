// =============================================================================
// students.js — Student management (add/edit/transfer/deactivate, import)
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
  getStudent,
  createStudent,
  updateStudent,
  deactivateStudent,
  reactivateStudent,
  transferStudent,
  bulkCreateStudents,
} from "./data.js";
import {
  $,
  el,
  escapeHtml,
  handleError,
  toast,
  showSpinner,
  hideSpinner,
  confirmDialog,
  isValidPhone,
  isNonEmpty,
  logActivity,
  prefs,
  paths,
} from "./utils.js";

let profile;
let batches = [];
let labs = [];
let students = [];
let state = { batchId: "", labId: "", showInactive: false, search: "" };

init();

async function init() {
  profile = await requireAuth();
  await renderShell(profile, "students.html");
  setPageTitle("Students");

  try {
    batches = await listBatches();
    if (batches.length === 0) {
      $("#students-body").innerHTML = `<tr><td colspan="5" class="cell-muted">No batches yet. Create one in Settings.</td></tr>`;
      return;
    }
    state.batchId = pickDefault(batches, prefs.get("batchId"));
    populateSelect("#batch-select", batches, state.batchId);
    await loadLabs();
    wireEvents();
  } catch (err) {
    handleError(err, "students init");
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
    students = [];
    renderTable();
    return;
  }
  state.labId = pickDefault(labs, prefs.get("labId"));
  populateSelect("#lab-select", labs, state.labId);
  await loadStudents();
}

async function loadStudents() {
  const body = $("#students-body");
  body.innerHTML = `<tr><td colspan="5"><div class="row-skeletons">${skelRows(6)}</div></td></tr>`;
  try {
    students = await listStudents(state.batchId, state.labId);
    renderTable();
  } catch (err) {
    handleError(err, "loadStudents");
    body.innerHTML = `<tr><td colspan="5" class="cell-muted">Could not load students.</td></tr>`;
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
    await loadStudents();
  });
  $("#show-inactive").addEventListener("change", (e) => {
    state.showInactive = e.target.checked;
    renderTable();
  });
  $("#search-input").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderTable();
  });
  $("#add-btn").addEventListener("click", () => openStudentForm());
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", onImportFile);
  $("#template-btn").addEventListener("click", downloadTemplate);
}

// -----------------------------------------------------------------------------
// RENDER
// -----------------------------------------------------------------------------

function renderTable() {
  const body = $("#students-body");
  body.innerHTML = "";

  if (labs.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="cell-muted">No labs in this batch. Add one in Settings.</td></tr>`;
    return;
  }

  let rows = students.filter((s) =>
    state.showInactive ? true : s.isActive !== false
  );
  if (state.search) {
    rows = rows.filter((s) =>
      `${s.rollNumber} ${s.fullName}`.toLowerCase().includes(state.search)
    );
  }

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon" aria-hidden="true">👤</div><p>No students found. ${
      canWriteBatch(state.batchId) ? "Add one with the button above." : ""
    }</p></div></td></tr>`;
    return;
  }

  const writable = canWriteBatch(state.batchId);
  for (const s of rows) {
    const inactive = s.isActive === false;
    const tr = el(
      "tr",
      { class: inactive ? "row-inactive" : "" },
      el("td", { class: "cell-roll" }, escapeHtml(String(s.rollNumber))),
      el("td", { class: "cell-name" }, escapeHtml(s.fullName)),
      el("td", { class: "cell-phone" }, escapeHtml(s.phone || "—")),
      el(
        "td",
        {},
        inactive
          ? el("span", { class: "badge badge-inactive" }, "Inactive")
          : el("span", { class: "badge badge-active" }, "Active")
      ),
      el("td", { class: "actions-col" }, buildActions(s, inactive, writable))
    );
    body.appendChild(tr);
  }
}

function buildActions(student, inactive, writable) {
  const wrap = el("div", { class: "row-actions" });
  if (!writable) {
    wrap.appendChild(el("span", { class: "cell-muted" }, "—"));
    return wrap;
  }
  wrap.appendChild(
    iconAction("✏️", "Edit", () => openStudentForm(student))
  );
  if (labs.length > 1 && !inactive) {
    wrap.appendChild(iconAction("🔀", "Transfer", () => openTransferForm(student)));
  }
  if (inactive) {
    wrap.appendChild(
      iconAction("♻️", "Reactivate", () => onReactivate(student))
    );
  } else {
    wrap.appendChild(
      iconAction("🚫", "Deactivate", () => onDeactivate(student))
    );
  }
  return wrap;
}

function iconAction(icon, label, onClick) {
  return el(
    "button",
    {
      type: "button",
      class: "icon-btn small",
      title: label,
      "aria-label": label,
      onClick,
    },
    icon
  );
}

// -----------------------------------------------------------------------------
// ADD / EDIT FORM (modal)
// -----------------------------------------------------------------------------

function openStudentForm(student = null) {
  if (!canWriteBatch(state.batchId)) {
    toast("You can't edit students for this batch.", "warn");
    return;
  }
  const isEdit = !!student;
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: "modal modal-form" });
  box.innerHTML = `
    <h3 class="modal-title">${isEdit ? "Edit Student" : "Add Student"}</h3>
    <form id="student-form" class="modal-body" novalidate>
      <label class="field">
        <span class="field-label">Roll Number *</span>
        <input type="text" id="f-roll" value="${escapeHtml(String(student?.rollNumber || ""))}" required />
      </label>
      <label class="field">
        <span class="field-label">Full Name *</span>
        <input type="text" id="f-name" value="${escapeHtml(student?.fullName || "")}" required />
      </label>
      <label class="field">
        <span class="field-label">Phone Number *</span>
        <input type="tel" id="f-phone" value="${escapeHtml(student?.phone || "")}" placeholder="017XXXXXXXX" required />
        <span class="field-hint">Bangladeshi format: 11 digits starting with 01.</span>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="f-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Add"}</button>
      </div>
    </form>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  box.querySelector("#f-cancel").addEventListener("click", () => overlay.remove());
  box.querySelector("#f-roll").focus();

  box.querySelector("#student-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const rollNumber = box.querySelector("#f-roll").value.trim();
    const fullName = box.querySelector("#f-name").value.trim();
    const phone = box.querySelector("#f-phone").value.trim();

    if (!isNonEmpty(rollNumber) || !isNonEmpty(fullName)) {
      toast("Roll number and name are required.", "warn");
      return;
    }
    if (!isValidPhone(phone)) {
      toast("Enter a valid Bangladeshi phone number (e.g. 017XXXXXXXX).", "warn", 5000);
      return;
    }

    showSpinner(isEdit ? "Saving…" : "Adding…");
    try {
      if (isEdit) {
        await updateStudent(state.batchId, state.labId, student.id, {
          rollNumber,
          fullName,
          phone,
        });
        await logActivity(profile.uid, "student_edit", paths.studentsCol(state.batchId, state.labId) + "/" + student.id, { rollNumber });
        toast("Student updated.", "success");
      } else {
        const id = await createStudent(state.batchId, state.labId, {
          rollNumber,
          fullName,
          phone,
        });
        await logActivity(profile.uid, "student_add", paths.studentsCol(state.batchId, state.labId) + "/" + id, { rollNumber });
        toast("Student added.", "success");
      }
      overlay.remove();
      await loadStudents();
    } catch (err) {
      handleError(err, "save student");
    } finally {
      hideSpinner();
    }
  });
}

// -----------------------------------------------------------------------------
// TRANSFER FORM
// -----------------------------------------------------------------------------

function openTransferForm(student) {
  const otherLabs = labs.filter((l) => l.id !== state.labId);
  if (otherLabs.length === 0) {
    toast("No other lab to transfer to.", "warn");
    return;
  }
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: "modal modal-form" });
  const options = otherLabs
    .map((l) => `<option value="${l.id}">${escapeHtml(l.name || l.id)}</option>`)
    .join("");
  box.innerHTML = `
    <h3 class="modal-title">Transfer Student</h3>
    <div class="modal-body">
      <p class="modal-message">Move <strong>${escapeHtml(student.fullName)}</strong> (Roll ${escapeHtml(String(student.rollNumber))}) to another lab. Past attendance stays with the current lab; only future attendance uses the new lab.</p>
      <label class="field">
        <span class="field-label">Destination lab</span>
        <select id="t-lab">${options}</select>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="t-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="t-confirm">Transfer</button>
      </div>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  box.querySelector("#t-cancel").addEventListener("click", () => overlay.remove());
  box.querySelector("#t-confirm").addEventListener("click", async () => {
    const toLabId = box.querySelector("#t-lab").value;
    showSpinner("Transferring…");
    try {
      await transferStudent(state.batchId, state.labId, toLabId, student.id);
      await logActivity(profile.uid, "student_transfer", paths.studentsCol(state.batchId, state.labId) + "/" + student.id, { toLabId });
      overlay.remove();
      toast("Student transferred.", "success");
      await loadStudents();
    } catch (err) {
      handleError(err, "transfer");
    } finally {
      hideSpinner();
    }
  });
}

// -----------------------------------------------------------------------------
// DEACTIVATE / REACTIVATE
// -----------------------------------------------------------------------------

async function onDeactivate(student) {
  const ok = await confirmDialog({
    title: "Deactivate student?",
    message: `${student.fullName} will be hidden from new attendance-taking but kept in historical reports. You can reactivate later.`,
    confirmText: "Deactivate",
  });
  if (!ok) return;
  showSpinner("Deactivating…");
  try {
    await deactivateStudent(state.batchId, state.labId, student.id);
    await logActivity(profile.uid, "student_deactivate", paths.studentsCol(state.batchId, state.labId) + "/" + student.id, {});
    toast("Student deactivated.", "success");
    await loadStudents();
  } catch (err) {
    handleError(err, "deactivate");
  } finally {
    hideSpinner();
  }
}

async function onReactivate(student) {
  showSpinner("Reactivating…");
  try {
    await reactivateStudent(state.batchId, state.labId, student.id);
    await logActivity(profile.uid, "student_reactivate", paths.studentsCol(state.batchId, state.labId) + "/" + student.id, {});
    toast("Student reactivated.", "success");
    await loadStudents();
  } catch (err) {
    handleError(err, "reactivate");
  } finally {
    hideSpinner();
  }
}

// -----------------------------------------------------------------------------
// EXCEL IMPORT / TEMPLATE
// -----------------------------------------------------------------------------

async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = ""; // reset so re-selecting the same file re-triggers
  if (!file) return;
  if (!canWriteBatch(state.batchId)) {
    toast("You can't import students for this batch.", "warn");
    return;
  }
  if (typeof XLSX === "undefined") {
    toast("Excel library failed to load. Check your connection.", "error");
    return;
  }

  showSpinner("Reading file…");
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    // Map flexible column headers to our fields.
    const rows = raw
      .map((r) => ({
        rollNumber: String(
          r["Roll Number"] ?? r["Roll"] ?? r["rollNumber"] ?? r["roll"] ?? ""
        ).trim(),
        fullName: String(
          r["Student Name"] ?? r["Full Name"] ?? r["Name"] ?? r["fullName"] ?? ""
        ).trim(),
        phone: String(
          r["Phone Number"] ?? r["Phone"] ?? r["phone"] ?? ""
        ).trim(),
      }))
      .filter((r) => r.rollNumber || r.fullName);

    if (rows.length === 0) {
      hideSpinner();
      toast("No rows found. Use columns: Roll Number, Student Name, Phone Number.", "warn", 6000);
      return;
    }

    // Validate phones; warn but still import valid ones.
    const invalidPhones = rows.filter((r) => r.phone && !isValidPhone(r.phone));
    showSpinner(`Importing ${rows.length} students…`);
    const { created, skipped } = await bulkCreateStudents(
      state.batchId,
      state.labId,
      rows
    );
    await logActivity(profile.uid, "student_import", paths.studentsCol(state.batchId, state.labId), { created, skipped: skipped.length });

    let msg = `Imported ${created} student(s).`;
    if (skipped.length) msg += ` Skipped ${skipped.length} duplicate/blank roll(s).`;
    if (invalidPhones.length)
      msg += ` ${invalidPhones.length} had unusual phone formats.`;
    toast(msg, created ? "success" : "warn", 7000);
    await loadStudents();
  } catch (err) {
    handleError(err, "import");
  } finally {
    hideSpinner();
  }
}

function downloadTemplate() {
  if (typeof XLSX === "undefined") {
    toast("Excel library failed to load.", "error");
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet([
    ["Roll Number", "Student Name", "Phone Number"],
    ["7A-001", "Example Name", "01712345678"],
  ]);
  ws["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  XLSX.writeFile(wb, "student_import_template.xlsx");
}

function skelRows(n) {
  return Array.from({ length: n })
    .map(() => `<div class="skeleton skeleton-row"></div>`)
    .join("");
}
