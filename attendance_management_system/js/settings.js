// =============================================================================
// settings.js — Institute settings, batch/lab management, trainer accounts
// =============================================================================

import {
  requireAuth,
  renderShell,
  setPageTitle,
  isAdmin,
} from "./auth.js";
import { createSecondaryAuth } from "./firebase.js";
import {
  getSettings,
  saveSettings,
  listBatches,
  saveBatch,
  archiveBatch,
  listLabs,
  saveLab,
  deleteLab,
  listUsers,
  createUserProfile,
  updateUserProfile,
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
  applyTheme,
  isNonEmpty,
  logActivity,
} from "./utils.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let profile;
let settings;
let batches = [];
let users = [];

init();

async function init() {
  // Settings is admin-only.
  profile = await requireAuth(["admin"]);
  await renderShell(profile, "settings.html");
  setPageTitle("Settings");

  try {
    settings = await getSettings();
    batches = await listBatches();
    fillGeneralForm();
    wireGeneral();
    await renderBatches();
    await renderTrainers();
    wireButtons();
  } catch (err) {
    handleError(err, "settings init");
  }
}

// -----------------------------------------------------------------------------
// GENERAL SETTINGS
// -----------------------------------------------------------------------------

function fillGeneralForm() {
  $("#s-name").value = settings.instituteName || "";
  $("#s-duration").value = settings.courseDurationMonths || 3;
  $("#s-theme").value = settings.theme || "light";
  const preview = $("#logo-preview");
  if (settings.logoBase64) preview.src = settings.logoBase64;
  else preview.style.display = "none";

  const sel = $("#s-current-batch");
  sel.innerHTML = "";
  sel.appendChild(el("option", { value: "" }, "— none —"));
  for (const b of batches)
    sel.appendChild(el("option", { value: b.id }, b.name || b.id));
  sel.value = settings.currentBatchId || "";
}

function wireGeneral() {
  $("#s-theme").addEventListener("change", (e) => applyTheme(e.target.value));

  $("#s-logo").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await compressImageToBase64(file, 256, 0.8);
      settings.logoBase64 = base64;
      const preview = $("#logo-preview");
      preview.src = base64;
      preview.style.display = "";
      toast("Logo loaded. Click Save to persist.", "info");
    } catch (err) {
      handleError(err, "logo load");
    }
  });

  $("#logo-clear").addEventListener("click", () => {
    settings.logoBase64 = "";
    const preview = $("#logo-preview");
    preview.removeAttribute("src");
    preview.style.display = "none";
    toast("Logo cleared. Click Save to persist.", "info");
  });

  $("#general-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      instituteName: $("#s-name").value.trim() || "Training Institute",
      currentBatchId: $("#s-current-batch").value || "",
      courseDurationMonths: Number($("#s-duration").value) || 3,
      theme: $("#s-theme").value,
      logoBase64: settings.logoBase64 || "",
    };
    showSpinner("Saving…");
    try {
      await saveSettings(data);
      settings = { ...settings, ...data };
      applyTheme(data.theme);
      await logActivity(profile.uid, "settings_update", "settings/general", {});
      toast("Settings saved.", "success");
    } catch (err) {
      handleError(err, "save settings");
    } finally {
      hideSpinner();
    }
  });
}

/** Downscale + compress an image file to a Base64 data URL (JPEG/PNG). */
function compressImageToBase64(file, maxSize = 256, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        // PNG preserves transparency for logos; fall back is fine either way.
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(type, quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// -----------------------------------------------------------------------------
// BATCHES & LABS
// -----------------------------------------------------------------------------

async function renderBatches() {
  const wrap = $("#batches-list");
  wrap.innerHTML = "";
  if (batches.length === 0) {
    wrap.appendChild(
      el("div", { class: "empty-state" }, el("p", {}, "No batches yet. Create your first one."))
    );
    return;
  }
  for (const b of batches) {
    const labs = await listLabs(b.id);
    const card = el("div", { class: "batch-item" });
    card.innerHTML = `
      <div class="batch-head">
        <div>
          <span class="batch-name">${escapeHtml(b.name || b.id)}</span>
          ${b.isActive === false ? '<span class="badge badge-inactive">Archived</span>' : '<span class="badge badge-active">Active</span>'}
        </div>
        <div class="batch-actions">
          <button class="btn btn-ghost small" data-act="add-lab" data-batch="${b.id}">＋ Lab</button>
          <button class="btn btn-ghost small" data-act="edit-batch" data-batch="${b.id}">Edit</button>
          ${b.isActive === false ? "" : `<button class="btn btn-ghost small" data-act="archive-batch" data-batch="${b.id}">Archive</button>`}
        </div>
      </div>
      <div class="batch-meta">Start: ${escapeHtml(b.startDate || "—")} · Duration: ${escapeHtml(String(b.durationMonths || settings.courseDurationMonths || 3))} months</div>
      <div class="labs-row">
        ${
          labs.length
            ? labs
                .map(
                  (l) =>
                    `<span class="lab-chip">${escapeHtml(l.name || l.id)}
                      <button class="chip-x" title="Rename lab" data-act="rename-lab" data-batch="${b.id}" data-lab="${l.id}">✎</button>
                      <button class="chip-x" title="Delete lab" data-act="delete-lab" data-batch="${b.id}" data-lab="${l.id}">×</button>
                    </span>`
                )
                .join("")
            : '<span class="cell-muted">No labs yet.</span>'
        }
      </div>
    `;
    wrap.appendChild(card);
  }

  // Delegate clicks.
  wrap.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => onBatchAction(btn.dataset));
  });
}

async function onBatchAction(ds) {
  const { act, batch, lab } = ds;
  try {
    if (act === "add-lab") return openLabForm(batch);
    if (act === "rename-lab") return openLabForm(batch, lab);
    if (act === "edit-batch")
      return openBatchForm(batches.find((b) => b.id === batch));
    if (act === "archive-batch") {
      const ok = await confirmDialog({
        title: "Archive batch?",
        message: "Archived batches are hidden from attendance-taking but kept for reports.",
        confirmText: "Archive",
      });
      if (!ok) return;
      showSpinner("Archiving…");
      await archiveBatch(batch);
      await logActivity(profile.uid, "batch_archive", `batches/${batch}`, {});
      batches = await listBatches();
      fillGeneralForm();
      await renderBatches();
      toast("Batch archived.", "success");
    }
    if (act === "delete-lab") {
      const ok = await confirmDialog({
        title: "Delete lab?",
        message: "This only works if the lab has no active students.",
        confirmText: "Delete",
      });
      if (!ok) return;
      showSpinner("Deleting lab…");
      await deleteLab(batch, lab);
      await logActivity(profile.uid, "lab_delete", `batches/${batch}/labs/${lab}`, {});
      await renderBatches();
      toast("Lab deleted.", "success");
    }
  } catch (err) {
    handleError(err, "batch action");
  } finally {
    hideSpinner();
  }
}

function openBatchForm(batch = null) {
  const isEdit = !!batch;
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: "modal modal-form" });
  box.innerHTML = `
    <h3 class="modal-title">${isEdit ? "Edit Batch" : "New Batch"}</h3>
    <form id="batch-form" class="modal-body" novalidate>
      ${
        isEdit
          ? ""
          : `<label class="field">
              <span class="field-label">Batch ID *</span>
              <input type="text" id="b-id" placeholder="batch8" required />
              <span class="field-hint">Lowercase, no spaces (e.g. batch8). Cannot be changed later.</span>
            </label>`
      }
      <label class="field">
        <span class="field-label">Display Name *</span>
        <input type="text" id="b-name" value="${escapeHtml(batch?.name || "")}" placeholder="Batch 8" required />
      </label>
      <label class="field">
        <span class="field-label">Start Date</span>
        <input type="date" id="b-start" value="${escapeHtml(batch?.startDate || "")}" />
      </label>
      <label class="field">
        <span class="field-label">Duration (months)</span>
        <input type="number" id="b-dur" min="1" max="24" value="${escapeHtml(String(batch?.durationMonths || settings.courseDurationMonths || 3))}" />
      </label>
      ${
        isEdit
          ? ""
          : `<label class="field">
              <span class="field-label">Initial Labs (comma-separated)</span>
              <input type="text" id="b-labs" value="Lab A, Lab B, Lab C" />
              <span class="field-hint">You can add or remove labs later.</span>
            </label>`
      }
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="b-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Create"}</button>
      </div>
    </form>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  box.querySelector("#b-cancel").addEventListener("click", () => overlay.remove());

  box.querySelector("#batch-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = box.querySelector("#b-name").value.trim();
    const startDate = box.querySelector("#b-start").value || "";
    const durationMonths = Number(box.querySelector("#b-dur").value) || 3;
    if (!isNonEmpty(name)) {
      toast("Display name is required.", "warn");
      return;
    }
    showSpinner(isEdit ? "Saving…" : "Creating…");
    try {
      if (isEdit) {
        await saveBatch(batch.id, { name, startDate, durationMonths });
        await logActivity(profile.uid, "batch_edit", `batches/${batch.id}`, {});
      } else {
        const id = box.querySelector("#b-id").value.trim().toLowerCase().replace(/\s+/g, "");
        if (!isNonEmpty(id)) {
          hideSpinner();
          toast("Batch ID is required.", "warn");
          return;
        }
        if (batches.some((b) => b.id === id)) {
          hideSpinner();
          toast("A batch with that ID already exists.", "warn");
          return;
        }
        await saveBatch(id, {
          name,
          startDate,
          durationMonths,
          isActive: true,
        });
        // Create initial labs.
        const labNames = box
          .querySelector("#b-labs")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const ln of labNames) {
          const labId = "lab" + ln.replace(/[^a-zA-Z0-9]/g, "");
          await saveLab(id, labId, { name: ln });
        }
        await logActivity(profile.uid, "batch_create", `batches/${id}`, { labs: labNames.length });
      }
      overlay.remove();
      batches = await listBatches();
      fillGeneralForm();
      await renderBatches();
      toast(isEdit ? "Batch saved." : "Batch created.", "success");
    } catch (err) {
      handleError(err, "save batch");
    } finally {
      hideSpinner();
    }
  });
}

function openLabForm(batchId, labId = null) {
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: "modal modal-form" });
  box.innerHTML = `
    <h3 class="modal-title">${labId ? "Rename Lab" : "New Lab"}</h3>
    <form id="lab-form" class="modal-body" novalidate>
      <label class="field">
        <span class="field-label">Lab Name *</span>
        <input type="text" id="l-name" placeholder="Lab D" required />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="l-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  box.querySelector("#l-cancel").addEventListener("click", () => overlay.remove());

  box.querySelector("#lab-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = box.querySelector("#l-name").value.trim();
    if (!isNonEmpty(name)) {
      toast("Lab name is required.", "warn");
      return;
    }
    showSpinner("Saving…");
    try {
      const id = labId || "lab" + name.replace(/[^a-zA-Z0-9]/g, "") + "_" + Date.now().toString(36);
      await saveLab(batchId, id, { name });
      await logActivity(profile.uid, labId ? "lab_rename" : "lab_create", `batches/${batchId}/labs/${id}`, {});
      overlay.remove();
      await renderBatches();
      toast("Lab saved.", "success");
    } catch (err) {
      handleError(err, "save lab");
    } finally {
      hideSpinner();
    }
  });
}

// -----------------------------------------------------------------------------
// TRAINERS / ADMINS
// -----------------------------------------------------------------------------

async function renderTrainers() {
  const body = $("#trainers-body");
  body.innerHTML = "";
  try {
    users = await listUsers();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="cell-muted">Could not load users.</td></tr>`;
    return;
  }
  if (users.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="cell-muted">No users yet.</td></tr>`;
    return;
  }
  for (const u of users) {
    const tr = el(
      "tr",
      { class: u.isActive === false ? "row-inactive" : "" },
      el("td", {}, escapeHtml(u.displayName || "—")),
      el("td", {}, escapeHtml(u.email || "—")),
      el("td", {}, el("span", { class: "badge badge-" + (u.role || "trainer") }, u.role || "trainer")),
      el("td", {}, escapeHtml((u.assignedBatches || []).join(", ") || (u.role === "admin" ? "all" : "—"))),
      el(
        "td",
        {},
        u.isActive === false
          ? el("span", { class: "badge badge-inactive" }, "Inactive")
          : el("span", { class: "badge badge-active" }, "Active")
      ),
      el(
        "td",
        { class: "actions-col" },
        el(
          "button",
          {
            type: "button",
            class: "icon-btn small",
            title: "Edit",
            "aria-label": "Edit user",
            onClick: () => openTrainerForm(u),
          },
          "✏️"
        )
      )
    );
    body.appendChild(tr);
  }
}

function openTrainerForm(user = null) {
  const isEdit = !!user;
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const box = el("div", { class: "modal modal-form" });
  const batchChecks = batches
    .map(
      (b) =>
        `<label class="checkbox-row"><input type="checkbox" class="t-batch" value="${b.id}" ${
          user?.assignedBatches?.includes(b.id) ? "checked" : ""
        }/><span>${escapeHtml(b.name || b.id)}</span></label>`
    )
    .join("");
  box.innerHTML = `
    <h3 class="modal-title">${isEdit ? "Edit User" : "New Trainer"}</h3>
    <form id="trainer-form" class="modal-body" novalidate>
      <label class="field">
        <span class="field-label">Full Name *</span>
        <input type="text" id="t-name" value="${escapeHtml(user?.displayName || "")}" required />
      </label>
      <label class="field">
        <span class="field-label">Email *</span>
        <input type="email" id="t-email" value="${escapeHtml(user?.email || "")}" ${isEdit ? "readonly" : ""} required />
      </label>
      ${
        isEdit
          ? ""
          : `<label class="field">
              <span class="field-label">Temporary Password *</span>
              <input type="text" id="t-pass" placeholder="At least 6 characters" required />
              <span class="field-hint">Share this with the trainer; they can reset it via Forgot Password.</span>
            </label>`
      }
      <label class="field">
        <span class="field-label">Role</span>
        <select id="t-role">
          <option value="trainer" ${user?.role === "trainer" ? "selected" : ""}>Trainer</option>
          <option value="admin" ${user?.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </label>
      <div class="field">
        <span class="field-label">Assigned Batches (trainers only)</span>
        <div class="checkbox-list">${batchChecks || '<span class="cell-muted">No batches yet.</span>'}</div>
      </div>
      ${
        isEdit
          ? `<label class="checkbox-row"><input type="checkbox" id="t-active" ${user?.isActive !== false ? "checked" : ""}/><span>Active</span></label>`
          : ""
      }
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="t-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Create"}</button>
      </div>
    </form>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  box.querySelector("#t-cancel").addEventListener("click", () => overlay.remove());

  box.querySelector("#trainer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const displayName = box.querySelector("#t-name").value.trim();
    const email = box.querySelector("#t-email").value.trim();
    const role = box.querySelector("#t-role").value;
    const assignedBatches = Array.from(box.querySelectorAll(".t-batch:checked")).map(
      (c) => c.value
    );
    if (!isNonEmpty(displayName) || !isNonEmpty(email)) {
      toast("Name and email are required.", "warn");
      return;
    }

    if (isEdit) {
      showSpinner("Saving…");
      try {
        const isActive = box.querySelector("#t-active").checked;
        await updateUserProfile(user.uid, {
          displayName,
          role,
          assignedBatches,
          isActive,
        });
        await logActivity(profile.uid, "user_edit", `users/${user.uid}`, { role });
        overlay.remove();
        await renderTrainers();
        toast("User updated.", "success");
      } catch (err) {
        handleError(err, "edit user");
      } finally {
        hideSpinner();
      }
      return;
    }

    // CREATE: use a secondary Firebase app so the admin's session is untouched.
    const password = box.querySelector("#t-pass").value;
    if (!password || password.length < 6) {
      toast("Temporary password must be at least 6 characters.", "warn");
      return;
    }
    showSpinner("Creating account…");
    let cleanup = null;
    try {
      const sec = await createSecondaryAuth();
      cleanup = sec.cleanup;
      const cred = await createUserWithEmailAndPassword(
        sec.secondaryAuth,
        email,
        password
      );
      // Write the profile from the PRIMARY session (admin), which has rights.
      await createUserProfile(cred.user.uid, {
        email,
        displayName,
        role,
        assignedBatches,
        isActive: true,
      });
      await cleanup();
      cleanup = null;
      await logActivity(profile.uid, "user_create", `users/${cred.user.uid}`, { role });
      overlay.remove();
      await renderTrainers();
      toast("Trainer account created.", "success");
    } catch (err) {
      handleError(err, "create trainer");
    } finally {
      if (cleanup) await cleanup();
      hideSpinner();
    }
  });
}

// -----------------------------------------------------------------------------
// Top-level buttons
// -----------------------------------------------------------------------------

function wireButtons() {
  $("#add-batch-btn").addEventListener("click", () => openBatchForm());
  $("#add-trainer-btn").addEventListener("click", () => openTrainerForm());
}
