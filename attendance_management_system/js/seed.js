// =============================================================================
// seed.js — One-time demo data seeder (run from seed.html while signed in as
// the bootstrap admin). Populates settings, Batch 7 (Lab A/B/C), 75 students,
// realistic attendance history, and a demo trainer account.
//
// SAFE TO RUN ONCE. Re-running will attempt to recreate data; students are
// skipped if their roll number already exists. Attendance days are overwritten
// (idempotent per date).
// =============================================================================

import { auth, db, createSecondaryAuth } from "./firebase.js";
import {
  getUserProfile,
  saveSettings,
  saveBatch,
  saveLab,
  bulkCreateStudents,
  listStudents,
  createUserProfile,
} from "./data.js";
import { paths, computeDayTotals, formatDateLocal, toast } from "./utils.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- Demo credentials (documented in README) ---
const DEMO_ADMIN_EMAIL = "admin@institute.edu";     // create manually (bootstrap)
const DEMO_TRAINER = {
  email: "trainer@institute.edu",
  password: "trainer123",
  displayName: "Demo Trainer",
};

const BATCH_ID = "batch7";
const LABS = [
  { id: "labA", name: "Lab A", key: "A" },
  { id: "labB", name: "Lab B", key: "B" },
  { id: "labC", name: "Lab C", key: "C" },
];

// Embedded roster (75 unique students, unique BD phone numbers).
const STUDENTS = {
  "A": [
    {
      "rollNumber": "7A-001",
      "fullName": "Fatema Khan",
      "phone": "01502685995"
    },
    {
      "rollNumber": "7A-002",
      "fullName": "Farhana Das",
      "phone": "01489078666"
    },
    {
      "rollNumber": "7A-003",
      "fullName": "Sakib Ahmed",
      "phone": "01617603137"
    },
    {
      "rollNumber": "7A-004",
      "fullName": "Dola Hossain",
      "phone": "01415901092"
    },
    {
      "rollNumber": "7A-005",
      "fullName": "Sharmin Kabir",
      "phone": "01715901396"
    },
    {
      "rollNumber": "7A-006",
      "fullName": "Tanvir Howlader",
      "phone": "01445957117"
    },
    {
      "rollNumber": "7A-007",
      "fullName": "Zannat Uddin",
      "phone": "01677412154"
    },
    {
      "rollNumber": "7A-008",
      "fullName": "Hossain Ahmed",
      "phone": "01628038528"
    },
    {
      "rollNumber": "7A-009",
      "fullName": "Nadia Bhuiyan",
      "phone": "01384148525"
    },
    {
      "rollNumber": "7A-010",
      "fullName": "Fahim Akter",
      "phone": "01938885393"
    },
    {
      "rollNumber": "7A-011",
      "fullName": "Rifat Alam",
      "phone": "01936338750"
    },
    {
      "rollNumber": "7A-012",
      "fullName": "Umme Rahman",
      "phone": "01347439575"
    },
    {
      "rollNumber": "7A-013",
      "fullName": "Naeem Akter",
      "phone": "01513137353"
    },
    {
      "rollNumber": "7A-014",
      "fullName": "Tanvir Kabir",
      "phone": "01699075116"
    },
    {
      "rollNumber": "7A-015",
      "fullName": "Farhana Rahman",
      "phone": "01937265167"
    },
    {
      "rollNumber": "7A-016",
      "fullName": "Robiul Rahman",
      "phone": "01612220297"
    },
    {
      "rollNumber": "7A-017",
      "fullName": "Rasel Sultana",
      "phone": "01929975288"
    },
    {
      "rollNumber": "7A-018",
      "fullName": "Tasnim Khan",
      "phone": "01400182633"
    },
    {
      "rollNumber": "7A-019",
      "fullName": "Eshita Hossain",
      "phone": "01343483954"
    },
    {
      "rollNumber": "7A-020",
      "fullName": "Delwar Alam",
      "phone": "01762057986"
    },
    {
      "rollNumber": "7A-021",
      "fullName": "Sohel Hossain",
      "phone": "01982828807"
    },
    {
      "rollNumber": "7A-022",
      "fullName": "Tariqul Sarkar",
      "phone": "01929022279"
    },
    {
      "rollNumber": "7A-023",
      "fullName": "Sabbir Alam",
      "phone": "01818058887"
    },
    {
      "rollNumber": "7A-024",
      "fullName": "Fahim Kabir",
      "phone": "01918033401"
    },
    {
      "rollNumber": "7A-025",
      "fullName": "Tanvir Miah",
      "phone": "01778017598"
    }
  ],
  "B": [
    {
      "rollNumber": "7B-001",
      "fullName": "Anisur Sheikh",
      "phone": "01783478878"
    },
    {
      "rollNumber": "7B-002",
      "fullName": "Dola Bhuiyan",
      "phone": "01484837261"
    },
    {
      "rollNumber": "7B-003",
      "fullName": "Ayesha Molla",
      "phone": "01675136134"
    },
    {
      "rollNumber": "7B-004",
      "fullName": "Maliha Sarkar",
      "phone": "01912524273"
    },
    {
      "rollNumber": "7B-005",
      "fullName": "Alamin Akter",
      "phone": "01816723268"
    },
    {
      "rollNumber": "7B-006",
      "fullName": "Sohel Karim",
      "phone": "01656355150"
    },
    {
      "rollNumber": "7B-007",
      "fullName": "Nayeem Ahmed",
      "phone": "01587706589"
    },
    {
      "rollNumber": "7B-008",
      "fullName": "Alamin Haque",
      "phone": "01581131144"
    },
    {
      "rollNumber": "7B-009",
      "fullName": "Tahmina Patwary",
      "phone": "01324264628"
    },
    {
      "rollNumber": "7B-010",
      "fullName": "Sadia Mahmud",
      "phone": "01797514026"
    },
    {
      "rollNumber": "7B-011",
      "fullName": "Lamia Sultana",
      "phone": "01340141931"
    },
    {
      "rollNumber": "7B-012",
      "fullName": "Nafis Hossain",
      "phone": "01517058649"
    },
    {
      "rollNumber": "7B-013",
      "fullName": "Afsana Bhuiyan",
      "phone": "01408312402"
    },
    {
      "rollNumber": "7B-014",
      "fullName": "Mahfuz Siddique",
      "phone": "01444834782"
    },
    {
      "rollNumber": "7B-015",
      "fullName": "Sadia Khan",
      "phone": "01550400088"
    },
    {
      "rollNumber": "7B-016",
      "fullName": "Shirin Bhuiyan",
      "phone": "01487371678"
    },
    {
      "rollNumber": "7B-017",
      "fullName": "Rakib Roy",
      "phone": "01968433532"
    },
    {
      "rollNumber": "7B-018",
      "fullName": "Nafis Siddique",
      "phone": "01650201462"
    },
    {
      "rollNumber": "7B-019",
      "fullName": "Ayesha Mia",
      "phone": "01316849340"
    },
    {
      "rollNumber": "7B-020",
      "fullName": "Tania Miah",
      "phone": "01622470455"
    },
    {
      "rollNumber": "7B-021",
      "fullName": "Tahmina Kabir",
      "phone": "01753043520"
    },
    {
      "rollNumber": "7B-022",
      "fullName": "Maliha Ahmed",
      "phone": "01561748338"
    },
    {
      "rollNumber": "7B-023",
      "fullName": "Rifat Begum",
      "phone": "01901412690"
    },
    {
      "rollNumber": "7B-024",
      "fullName": "Priya Karim",
      "phone": "01604431982"
    },
    {
      "rollNumber": "7B-025",
      "fullName": "Fahim Rahman",
      "phone": "01896572492"
    }
  ],
  "C": [
    {
      "rollNumber": "7C-001",
      "fullName": "Delwar Das",
      "phone": "01386828890"
    },
    {
      "rollNumber": "7C-002",
      "fullName": "Sumaiya Patwary",
      "phone": "01993100251"
    },
    {
      "rollNumber": "7C-003",
      "fullName": "Tania Islam",
      "phone": "01678008374"
    },
    {
      "rollNumber": "7C-004",
      "fullName": "Nabila Sarkar",
      "phone": "01371881817"
    },
    {
      "rollNumber": "7C-005",
      "fullName": "Mahfuz Miah",
      "phone": "01514333776"
    },
    {
      "rollNumber": "7C-006",
      "fullName": "Mahmud Sheikh",
      "phone": "01374093192"
    },
    {
      "rollNumber": "7C-007",
      "fullName": "Tanvir Uddin",
      "phone": "01544992070"
    },
    {
      "rollNumber": "7C-008",
      "fullName": "Yeasin Khan",
      "phone": "01641374847"
    },
    {
      "rollNumber": "7C-009",
      "fullName": "Nayeem Talukder",
      "phone": "01671834170"
    },
    {
      "rollNumber": "7C-010",
      "fullName": "Farhana Howlader",
      "phone": "01571874633"
    },
    {
      "rollNumber": "7C-011",
      "fullName": "Tahmina Ahmed",
      "phone": "01391284529"
    },
    {
      "rollNumber": "7C-012",
      "fullName": "Mahfuz Molla",
      "phone": "01984153776"
    },
    {
      "rollNumber": "7C-013",
      "fullName": "Rabeya Alam",
      "phone": "01320776426"
    },
    {
      "rollNumber": "7C-014",
      "fullName": "Wasim Patwary",
      "phone": "01565150556"
    },
    {
      "rollNumber": "7C-015",
      "fullName": "Rasel Bhattacharjee",
      "phone": "01330445166"
    },
    {
      "rollNumber": "7C-016",
      "fullName": "Nadia Gazi",
      "phone": "01991564041"
    },
    {
      "rollNumber": "7C-017",
      "fullName": "Wasim Karim",
      "phone": "01342346853"
    },
    {
      "rollNumber": "7C-018",
      "fullName": "Tasnim Sarkar",
      "phone": "01956068831"
    },
    {
      "rollNumber": "7C-019",
      "fullName": "Mim Akter",
      "phone": "01367924708"
    },
    {
      "rollNumber": "7C-020",
      "fullName": "Mizanur Ahmed",
      "phone": "01427654444"
    },
    {
      "rollNumber": "7C-021",
      "fullName": "Riadul Khan",
      "phone": "01634786122"
    },
    {
      "rollNumber": "7C-022",
      "fullName": "Shahriar Roy",
      "phone": "01338783757"
    },
    {
      "rollNumber": "7C-023",
      "fullName": "Shahriar Islam",
      "phone": "01628331258"
    },
    {
      "rollNumber": "7C-024",
      "fullName": "Shirin Bhattacharjee",
      "phone": "01353549306"
    },
    {
      "rollNumber": "7C-025",
      "fullName": "Sohel Begum",
      "phone": "01668364507"
    }
  ]
};

const logEl = () => document.getElementById("seed-log");
function log(msg) {
  const p = document.createElement("div");
  p.textContent = msg;
  logEl()?.appendChild(p);
  console.log("[seed]", msg);
}

// -----------------------------------------------------------------------------
// Attendance history generator: class days over the last ~3 months.
// Institute weekend assumed Friday off (BD). ~10% of class days randomly become
// holidays. Present rate 80-95% per day.
// -----------------------------------------------------------------------------
function classDays(monthsBack = 3) {
  const days = [];
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - monthsBack, today.getDate());
  const d = new Date(start);
  while (d <= today) {
    const dow = d.getDay(); // 0 Sun ... 5 Fri, 6 Sat
    if (dow !== 5) days.push(formatDateLocal(new Date(d))); // skip Fridays
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function pickStatus(presentRate) {
  const r = Math.random();
  if (r < presentRate) return "present";
  if (r < presentRate + 0.06) return "late";
  if (r < presentRate + 0.10) return "leave";
  return "absent";
}

async function seedAttendance(labId, studentIds) {
  const days = classDays(3);
  let written = 0;
  for (const date of days) {
    const isHoliday = Math.random() < 0.08; // ~8% holidays
    const records = {};
    if (!isHoliday) {
      const presentRate = 0.80 + Math.random() * 0.15; // 80-95%
      for (const sid of studentIds) records[sid] = { status: pickStatus(presentRate) };
    }
    const totals = computeDayTotals(records);
    await setDoc(doc(db, paths.dayDoc(BATCH_ID, labId, date)), {
      date,
      batchId: BATCH_ID,
      labId,
      isHoliday,
      records,
      totals,
      markedBy: auth.currentUser?.uid || null,
      updatedAt: serverTimestamp(),
    });
    written++;
  }
  return written;
}

// -----------------------------------------------------------------------------
// Main seed routine
// -----------------------------------------------------------------------------
export async function runSeed() {
  const user = auth.currentUser;
  if (!user) {
    toast("Sign in as the bootstrap admin first (login.html).", "error", 6000);
    return;
  }
  const profile = await getUserProfile(user.uid);
  if (!profile || profile.role !== "admin") {
    toast("You must be signed in as an admin to seed data.", "error", 6000);
    return;
  }

  try {
    log("Writing settings…");
    await saveSettings({
      instituteName: "Bright Future Training Institute",
      logoBase64: "",
      currentBatchId: BATCH_ID,
      courseDurationMonths: 3,
      theme: "light",
    });

    log("Creating Batch 7…");
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    await saveBatch(BATCH_ID, {
      name: "Batch 7",
      startDate: formatDateLocal(start),
      durationMonths: 3,
      isActive: true,
    });

    for (const lab of LABS) {
      log(`Creating ${lab.name}…`);
      await saveLab(BATCH_ID, lab.id, { name: lab.name });
      const rows = STUDENTS[lab.key];
      const { created } = await bulkCreateStudents(BATCH_ID, lab.id, rows);
      log(`  Added ${created} students to ${lab.name}.`);
      const roster = await listStudents(BATCH_ID, lab.id, { activeOnly: true });
      const ids = roster.map((s) => s.id);
      log(`  Generating attendance history for ${lab.name}…`);
      const n = await seedAttendance(lab.id, ids);
      log(`  Wrote ${n} attendance day-documents for ${lab.name}.`);
    }

    log("Creating demo trainer account…");
    await createDemoTrainer();

    log("✅ Seed complete!");
    toast("Demo data seeded successfully.", "success", 6000);
  } catch (err) {
    console.error(err);
    log("❌ Error: " + (err?.message || err));
    toast("Seed failed: " + (err?.message || err), "error", 8000);
  }
}

async function createDemoTrainer() {
  let cleanup = null;
  try {
    const sec = await createSecondaryAuth();
    cleanup = sec.cleanup;
    const cred = await createUserWithEmailAndPassword(
      sec.secondaryAuth,
      DEMO_TRAINER.email,
      DEMO_TRAINER.password
    );
    await createUserProfile(cred.user.uid, {
      email: DEMO_TRAINER.email,
      displayName: DEMO_TRAINER.displayName,
      role: "trainer",
      assignedBatches: [BATCH_ID],
      isActive: true,
    });
    await cleanup();
    cleanup = null;
    log(`  Trainer created: ${DEMO_TRAINER.email} / ${DEMO_TRAINER.password}`);
  } catch (err) {
    if (err?.code === "auth/email-already-in-use") {
      log("  Demo trainer already exists — skipping.");
    } else {
      throw err;
    }
  } finally {
    if (cleanup) await cleanup();
  }
}

// Wire the button when loaded via seed.html.
window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("run-seed-btn");
  if (btn) btn.addEventListener("click", () => runSeed());
  onAuthStateChanged(auth, (u) => {
    const status = document.getElementById("seed-auth-status");
    if (status)
      status.textContent = u
        ? `Signed in as ${u.email}`
        : "Not signed in — go to login.html first.";
  });
});
