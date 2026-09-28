import { useEffect, useId, useRef, useState } from "react";
import "./App.css";
import {
  ALLOW_DEMO_FALLBACK,
  TYPE_META,
  callApi,
  demoCheck,
  lc,
  sevKey,
  sortWarnings,
  warningTitle,
} from "./lib/api.js";
import { getSessionUser, logOut } from "./lib/auth.js";
import { AuthScreen, RoleScreen } from "./components/Onboarding.jsx";
import Assistant, { makeGreeting } from "./components/Assistant.jsx";
import GivePrescription from "./components/GivePrescription.jsx";
import {
  daysText,
  loadPrescriptionsFor,
  newDraft,
  perDay,
  savePrescriptionForPatient,
  takePendingRx,
} from "./lib/rxLink.js";

/* -------------------------------------------------------------------------
   STATIC DATA
   NAV and TILES are keyed by role so a patient only ever sees the tabs and
   shortcuts meant for them — doctors keep the original five tabs unchanged.
------------------------------------------------------------------------- */
const NAV = {
  doctor: [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "check", label: "Check", icon: "💊" },
    { id: "results", label: "Results", icon: "📋" },
    { id: "give", label: "Give Prescription", icon: "📝" },
    { id: "history", label: "History", icon: "🕘" },
    { id: "help", label: "Help", icon: "❓" },
  ],
  patient: [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "prescriptions", label: "My Prescriptions", icon: "📋" },
    { id: "help", label: "Help", icon: "❓" },
  ],
};

const TILES = {
  doctor: [
    { icon: "💊", label: "Check prescription", tone: "sky", tab: "check", filter: "all" },
    { icon: "⚠️", label: "Drug interactions", tone: "amber", tab: "check", filter: "Drug-Drug Interaction" },
    { icon: "🤧", label: "Allergy alerts", tone: "azure", tab: "check", filter: "Allergy Interaction" },
    { icon: "🩺", label: "Condition conflicts", tone: "indigo", tab: "check", filter: "Drug-Disease Interaction" },
    { icon: "⚖️", label: "Dosage review", tone: "violet", tab: "check", filter: "Dosage Review" },
    { icon: "📋", label: "Latest report", tone: "teal", tab: "results", filter: "all" },
    { icon: "🕘", label: "Patient history", tone: "sky", tab: "history", filter: "all" },
    { icon: "📞", label: "Need help?", tone: "rose", tab: "help", filter: "all" },
  ],
  patient: [
    { icon: "📋", label: "My prescriptions", tone: "indigo", tab: "prescriptions", filter: "all" },
    { icon: "📞", label: "Need help?", tone: "rose", tab: "help", filter: "all" },
  ],
};

const EMPTY_FORM = {
  patient_name: "",
  age: "",
  weight: "",
  diseases: [],
  allergies: [],
  existing_medicines: [],
  new_medicines: [], // [{ name, dosage }]
};

/* -------------------------------------------------------------------------
   HELPERS
------------------------------------------------------------------------- */
const historyKey = (userId) => `medsafe-history-${userId}`;

function loadHistory(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey(userId)));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

// Patients get their own details pre-filled; doctors start with an empty form.
const formFor = (user) =>
  user && user.role === "patient"
    ? { ...EMPTY_FORM, patient_name: user.name, age: String(user.age ?? ""), weight: String(user.weight ?? "") }
    : EMPTY_FORM;

const displayName = (user) =>
  user.role === "doctor" && !/^dr\.?\s/i.test(user.name) ? `Dr. ${user.name}` : user.name;

function validate(form) {
  if (!form.patient_name.trim()) return "Enter the patient's name.";
  const age = Number(form.age);
  if (!form.age || !Number.isFinite(age) || age <= 0 || age > 120) return "Enter an age between 1 and 120.";
  const weight = Number(form.weight);
  if (!form.weight || !Number.isFinite(weight) || weight <= 0 || weight > 400) return "Enter a weight in kg (for example 62).";
  if (form.new_medicines.length === 0) return "Add at least one new medicine to check.";
  return "";
}

const formatWhen = (iso) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/* -------------------------------------------------------------------------
   SMALL FORM COMPONENTS
------------------------------------------------------------------------- */
function TagField({ label, placeholder, items, onAdd, onRemove }) {
  const id = useId();
  const [value, setValue] = useState("");

  const add = () => {
    const v = value.trim();
    if (!v) return;
    if (!items.some((i) => lc(i) === lc(v))) onAdd(v);
    setValue("");
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="add-row">
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn-add" onClick={add}>Add</button>
      </div>
      {items.length > 0 && (
        <ul className="chips">
          {items.map((item) => (
            <li key={item} className="chip">
              {item}
              <button type="button" aria-label={`Remove ${item}`} onClick={() => onRemove(item)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewMedicineField({ label, items, onAdd, onRemove }) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");

  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (!items.some((i) => lc(i.name) === lc(n))) onAdd({ name: n, dosage });
    setName("");
    setDosage("");
  };
  const onEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={nameId}>{label}</label>
      <div className="add-row">
        <input id={nameId} className="grow" value={name} placeholder="Medicine name" onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
        <input
          className="dose"
          type="number"
          inputMode="decimal"
          min="0"
          value={dosage}
          placeholder="mg"
          aria-label="Dosage in milligrams"
          onChange={(e) => setDosage(e.target.value)}
          onKeyDown={onEnter}
        />
        <button type="button" className="btn-add" onClick={add}>Add</button>
      </div>
      {items.length > 0 && (
        <ul className="chips">
          {items.map((m) => (
            <li key={m.name} className="chip chip-strong">
              {m.name}{m.dosage !== "" ? ` · ${m.dosage} mg` : ""}
              <button type="button" aria-label={`Remove ${m.name}`} onClick={() => onRemove(m.name)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WarningCard({ w }) {
  const meta = TYPE_META[w.type] || { icon: "⚠️" };
  return (
    <article className={`warn sev-${sevKey(w.severity)}`}>
      <div className="warn-top">
        <span className="warn-type">{meta.icon} {w.type}</span>
        <span className="sev-pill">{w.severity}</span>
      </div>
      <h3>{warningTitle(w)}</h3>
      <p>{w.reason}</p>
    </article>
  );
}

/* -------------------------------------------------------------------------
   DOCTOR SCREENS (unchanged)
------------------------------------------------------------------------- */
function HomeScreen({ user, latest, backend, onOpen }) {
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const badge = backend === "live" ? "Live data" : backend === "demo" ? "Demo data" : "Ready";
  const heading = user.role === "doctor" ? "Is this prescription safe?" : "Are your medicines safe together?";

  return (
    <div className="home-screen">
      <section className="hero">
        <div className="hero-text">
          <p className="hero-date">{today}</p>
          <h2>{heading}</h2>
          <div className="hero-row">
            <div className="hero-pill">
              <span aria-hidden="true">📋</span>
              <span>
                {latest
                  ? `${latest.warnings.length} ${latest.warnings.length === 1 ? "warning" : "warnings"}`
                  : "No checks yet"}
              </span>
              {latest && user.role === "doctor" && <span className="hero-sub">{latest.patient.name}</span>}
            </div>
            <span className={`badge badge-${backend}`}>{badge}</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">💊</div>
      </section>

      <section className="tiles" aria-label="What would you like to do?">
        {TILES[user.role].map((t) => (
          <button key={t.label} type="button" className={`tile tone-${t.tone}`} onClick={() => onOpen(t)}>
            <span className="tile-icon" aria-hidden="true">{t.icon}</span>
            <span className="tile-label">{t.label}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

function CheckScreen({ role, form, setForm, onSubmit, loading, error, filter }) {
  const doctor = role === "doctor";
  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const addTo = (key) => (value) => setForm((f) => ({ ...f, [key]: [...f[key], value] }));
  const removeFrom = (key) => (value) => setForm((f) => ({ ...f, [key]: f[key].filter((v) => v !== value) }));

  return (
    <form className="screen" onSubmit={onSubmit} noValidate>
      <h2 className="screen-title">{doctor ? "Check a prescription" : "Check my medicine"}</h2>
      {filter !== "all" && (
        <p className="focus-note">
          Results will open on <strong>{TYPE_META[filter]?.short}</strong>. You can switch back to all warnings there.
        </p>
      )}

      <div className="card-row">
        <fieldset className="card">
          <legend>{doctor ? "Patient" : "About you"}</legend>
          <div className="field">
            <label className="field-label" htmlFor="pname">Name</label>
            <input id="pname" value={form.patient_name} onChange={setField("patient_name")} placeholder="Full name" autoComplete="off" />
          </div>
          <div className="two-col">
            <div className="field">
              <label className="field-label" htmlFor="page">Age</label>
              <input id="page" type="number" inputMode="numeric" min="0" value={form.age} onChange={setField("age")} placeholder="Years" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pweight">Weight</label>
              <input id="pweight" type="number" inputMode="decimal" min="0" value={form.weight} onChange={setField("weight")} placeholder="kg" />
            </div>
          </div>
          <TagField
            label={doctor ? "Diagnosed conditions" : "My health conditions"}
            placeholder="e.g. kidney disease"
            items={form.diseases}
            onAdd={addTo("diseases")}
            onRemove={removeFrom("diseases")}
          />
          <TagField
            label={doctor ? "Known allergies" : "My allergies"}
            placeholder="e.g. penicillin"
            items={form.allergies}
            onAdd={addTo("allergies")}
            onRemove={removeFrom("allergies")}
          />
        </fieldset>

        <fieldset className="card">
          <legend>Medicines</legend>
          <TagField
            label={doctor ? "Medicines the patient already takes" : "Medicines I already take"}
            placeholder="e.g. warfarin"
            items={form.existing_medicines}
            onAdd={addTo("existing_medicines")}
            onRemove={removeFrom("existing_medicines")}
          />
          <NewMedicineField
            label={doctor ? "New medicines being prescribed" : "New medicines I was given"}
            items={form.new_medicines}
            onAdd={(m) => setForm((f) => ({ ...f, new_medicines: [...f.new_medicines, m] }))}
            onRemove={(name) => setForm((f) => ({ ...f, new_medicines: f.new_medicines.filter((m) => m.name !== name) }))}
          />
        </fieldset>
      </div>

      <div className="submit-row">
        <p className="form-error" role="alert" aria-live="assertive">{error}</p>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Checking…" : "Check safety"}
        </button>
      </div>
    </form>
  );
}

function ResultsScreen({ role, report, filter, setFilter, onNew }) {
  if (!report) {
    return (
      <div className="screen empty">
        <span className="empty-icon" aria-hidden="true">📋</span>
        <h2 className="screen-title">No report yet</h2>
        <p>Run a check and the warnings will appear here.</p>
        <button type="button" className="btn-primary" onClick={onNew}>Start a check</button>
      </div>
    );
  }

  const warnings = sortWarnings(report.warnings);
  const shown = filter === "all" ? warnings : warnings.filter((w) => w.type === filter);
  const highCount = warnings.filter((w) => sevKey(w.severity) === "high").length;
  const countOf = (type) => warnings.filter((w) => w.type === type).length;

  return (
    <div className="screen">
      <section className="hero hero-compact">
        <div className="hero-text">
          <p className="hero-date">Safety report</p>
          <h2>{report.patient.name}</h2>
          <p className="hero-meta">
            {report.patient.age} yrs · {report.patient.weight} kg · {formatWhen(report.createdAt)}
          </p>
          <div className="hero-row">
            <div className="hero-pill">
              <span aria-hidden="true">{warnings.length === 0 ? "✅" : "⚠️"}</span>
              <span>
                {warnings.length === 0
                  ? "No warnings found"
                  : `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}${highCount ? `, ${highCount} high` : ""}`}
              </span>
            </div>
            <span className={`badge ${report.demo ? "badge-demo" : "badge-live"}`}>{report.demo ? "Demo data" : "Live data"}</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">{warnings.length === 0 ? "✅" : "⚠️"}</div>
      </section>

      <div className="filters" role="group" aria-label="Filter warnings by type">
        <button type="button" className={`filter ${filter === "all" ? "on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All ({warnings.length})
        </button>
        {Object.entries(TYPE_META).map(([type, meta]) => (
          <button key={type} type="button" className={`filter ${filter === type ? "on" : ""}`} aria-pressed={filter === type} onClick={() => setFilter(type)}>
            {meta.short} ({countOf(type)})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="all-clear">
          <strong>{warnings.length === 0 ? "No known issues found" : "Nothing in this category"}</strong>
          <p>
            {warnings.length === 0
              ? "The checks did not match anything in the knowledge base. This is not a guarantee of safety, so confirm with a pharmacist."
              : "Pick another filter to see the other warnings in this report."}
          </p>
        </div>
      ) : (
        <div className="warn-grid">{shown.map((w, i) => <WarningCard key={`${w.type}-${i}`} w={w} />)}</div>
      )}

      <p className="disclaimer">
        {role === "patient"
          ? "Show this report to your doctor or pharmacist before you start, stop or change any medicine. MedSafe does not replace medical advice."
          : "MedSafe supports clinical decisions and does not replace your judgement or a pharmacist's review. Review every warning before prescribing or dispensing."}
      </p>
      <button type="button" className="btn-secondary" onClick={onNew}>Start a new check</button>
    </div>
  );
}

function HistoryScreen({ role, history, onOpen, onClear }) {
  const doctor = role === "doctor";
  if (history.length === 0) {
    return (
      <div className="screen empty">
        <span className="empty-icon" aria-hidden="true">🕘</span>
        <h2 className="screen-title">No checks saved</h2>
        <p>Every check you run is saved here on this device.</p>
      </div>
    );
  }
  return (
    <div className="screen">
      <h2 className="screen-title">{doctor ? "Patient history" : "My history"}</h2>
      <ul className="history">
        {history.map((r) => (
          <li key={r.id}>
            <button type="button" className="history-item" onClick={() => onOpen(r)}>
              <span className="history-main">
                <strong>{r.patient.name}</strong>
                <span>{formatWhen(r.createdAt)}{r.demo ? " · demo data" : ""}</span>
              </span>
              <span className={`count-pill ${r.warnings.length ? "has" : "none"}`}>
                {r.warnings.length} {r.warnings.length === 1 ? "warning" : "warnings"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-secondary" onClick={onClear}>Clear history</button>
    </div>
  );
}

/* -------------------------------------------------------------------------
   PATIENT SCREENS
   Patients no longer run their own checks — they only see what a doctor has
   already checked for them, plus a home screen and help tailored to that.
------------------------------------------------------------------------- */
function PatientHomeScreen({ latest, onOpen }) {
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="home-screen">
      <section className="hero">
        <div className="hero-text">
          <p className="hero-date">{today}</p>
          <h2>Your prescription safety reports</h2>
          <div className="hero-row">
            <div className="hero-pill">
              <span aria-hidden="true">📋</span>
              <span>
                {latest
                  ? latest.medicines?.length
                    ? `${latest.medicines.length} ${latest.medicines.length === 1 ? "medicine" : "medicines"}`
                    : `${latest.warnings.length} ${latest.warnings.length === 1 ? "warning" : "warnings"}`
                  : "No prescriptions yet"}
              </span>
            </div>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">💊</div>
      </section>

      <section className="tiles" aria-label="What would you like to do?">
        {TILES.patient.map((t) => (
          <button key={t.label} type="button" className={`tile tone-${t.tone}`} onClick={() => onOpen(t)}>
            <span className="tile-icon" aria-hidden="true">{t.icon}</span>
            <span className="tile-label">{t.label}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

function PatientPrescriptionsScreen({ list, onOpen }) {
  if (list.length === 0) {
    return (
      <div className="screen empty">
        <span className="empty-icon" aria-hidden="true">📋</span>
        <h2 className="screen-title">No prescriptions yet</h2>
        <p>When your doctor gives you a prescription QR code, scan it with your phone camera and save it. It will appear here.</p>
      </div>
    );
  }
  return (
    <div className="screen">
      <h2 className="screen-title">My prescriptions</h2>
      <ul className="history">
        {list.map((r) => {
          const meds = r.medicines?.length || 0;
          return (
            <li key={r.id}>
              <button type="button" className="history-item" onClick={() => onOpen(r)}>
                <span className="history-main">
                  <strong>{formatWhen(r.createdAt)}</strong>
                  <span>{r.doctorName || "Your doctor"}{r.demo ? " · demo data" : ""}</span>
                </span>
                {meds ? (
                  <span className="count-pill info">{meds} {meds === 1 ? "medicine" : "medicines"}</span>
                ) : (
                  <span className={`count-pill ${r.warnings.length ? "has" : "none"}`}>
                    {r.warnings.length} {r.warnings.length === 1 ? "warning" : "warnings"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PatientPrescriptionDetail({ report, onBack }) {
  const meds = report.medicines || [];
  const warnings = sortWarnings(report.warnings || []);
  const highCount = warnings.filter((w) => sevKey(w.severity) === "high").length;
  const s = report.summary;
  const sTotal = s ? s.high + s.moderate + s.low + s.review : 0;
  const hasMeds = meds.length > 0;

  return (
    <div className="screen">
      <button type="button" className="link-btn" onClick={onBack}>← Back to my prescriptions</button>

      <section className="hero hero-compact">
        <div className="hero-text">
          <p className="hero-date">{hasMeds ? "Prescription" : "Safety report"}{report.doctorName ? ` · ${report.doctorName}` : ""}</p>
          <h2>{formatWhen(report.createdAt)}</h2>
          <div className="hero-row">
            <div className="hero-pill">
              <span aria-hidden="true">{hasMeds ? "📝" : warnings.length === 0 ? "✅" : "⚠️"}</span>
              <span>
                {hasMeds
                  ? `${meds.length} ${meds.length === 1 ? "medicine" : "medicines"}`
                  : warnings.length === 0
                    ? "No warnings found"
                    : `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}${highCount ? `, ${highCount} high` : ""}`}
              </span>
            </div>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">{hasMeds ? "📝" : warnings.length === 0 ? "✅" : "⚠️"}</div>
      </section>

      {hasMeds && (
        <section className="card">
          <h3 className="card-title">Your medicines</h3>
          <ul className="rx-meds">
            {meds.map((m, i) => (
              <li key={`${m.name}-${i}`} className="rx-med">
                <div>
                  <strong>{m.name}</strong>
                  <span className="rx-dose">{m.dosage} mg</span>
                </div>
                <p>{perDay(m.times)} · for {daysText(m.days)}</p>
                <p className="rx-total">{m.times * m.days} doses in total</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasMeds && s && (
        <section className="card">
          <h3 className="card-title">MedSafe safety check</h3>
          {sTotal === 0 ? (
            <p>No warnings were found for these medicines. This is not a guarantee of safety, so please confirm with your doctor or pharmacist.</p>
          ) : (
            <>
              <p>The safety check found {sTotal} {sTotal === 1 ? "warning" : "warnings"}. Please ask your doctor or pharmacist about them.</p>
              <div className="rx-chips">
                {s.high > 0 && <span className="sev-pill sev-high">High · {s.high}</span>}
                {s.moderate > 0 && <span className="sev-pill sev-moderate">Moderate · {s.moderate}</span>}
                {s.review > 0 && <span className="sev-pill sev-review">Review · {s.review}</span>}
                {s.low > 0 && <span className="sev-pill sev-low">Low · {s.low}</span>}
              </div>
            </>
          )}
        </section>
      )}

      {!hasMeds &&
        (warnings.length === 0 ? (
          <div className="all-clear">
            <strong>No known issues found</strong>
            <p>This is not a guarantee of safety — always confirm with your doctor or pharmacist.</p>
          </div>
        ) : (
          <div className="warn-grid">{warnings.map((w, i) => <WarningCard key={`${w.type}-${i}`} w={w} />)}</div>
        ))}

      <p className="disclaimer">
        Take your medicines exactly as your doctor has written them, and show this to your doctor or pharmacist before you start, stop or change anything. MedSafe does not replace medical advice.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
   HELP (shared screen, role-specific content)
   The doctor branch is the original content, unchanged.
------------------------------------------------------------------------- */
function HelpScreen({ role }) {
  if (role === "patient") {
    return (
      <div className="screen">
        <h2 className="screen-title">Need help?</h2>
        <div className="card-row">
          <section className="card">
            <h3 className="card-title">How prescriptions reach you</h3>
            <ol className="steps">
              <li>Your doctor checks your medicines in MedSafe and writes your prescription.</li>
              <li>They show you a QR code. Scan it with your phone's camera and open the link.</li>
              <li>Tap "Save to My Prescriptions" (log in as a patient first) and it appears here.</li>
            </ol>
          </section>

          <section className="card faq">
            <details>
              <summary>What does MedSafe check?</summary>
              <p>Drug-to-drug interactions, allergies, conflicts with existing conditions, dosage limits and duplicate medicines.</p>
            </details>
            <details>
              <summary>What does “Review Required” mean?</summary>
              <p>The rule matched, but it needs a clinician to judge it, for example a dose that may be too high for you.</p>
            </details>
            <details>
              <summary>I don't see a prescription my doctor gave me</summary>
              <p>Prescriptions only appear here after you save them. Scan the QR code again and tap "Save to My Prescriptions" while logged in as a patient.</p>
            </details>
            <details>
              <summary>Where is my data stored?</summary>
              <p>Saved prescriptions are stored in this browser on this device. Nothing is sent anywhere else.</p>
            </details>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Need help?</h2>
      <div className="card-row">
        <section className="card">
          <h3 className="card-title">How a check works</h3>
          <ol className="steps">
            <li>Enter the patient, their conditions and allergies.</li>
            <li>Add the medicines they already take and the new prescription.</li>
            <li>Review each warning, sorted from most to least serious.</li>
          </ol>
        </section>

        <section className="card faq">
          <details>
            <summary>What does MedSafe check?</summary>
            <p>Drug-to-drug interactions, allergies, conflicts with existing conditions, dosage limits and duplicate medicines.</p>
          </details>
          <details>
            <summary>What does “Review Required” mean?</summary>
            <p>The rule matched, but it needs a clinician to judge it, for example a dose that may be too high for this patient.</p>
          </details>
          <details>
            <summary>Where is patient data stored?</summary>
            <p>Saved checks stay in this browser on this device. Use “Clear history” on the History tab to remove them.</p>
          </details>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   APP
------------------------------------------------------------------------- */
export default function App() {
  const [user, setUser] = useState(getSessionUser);
  const [step, setStep] = useState("role"); // role | auth (only used while logged out)
  const [chosenRole, setChosenRole] = useState(null);

  const [tab, setTab] = useState("home");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(() => formFor(user));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState(() => (user ? loadHistory(user.id) : []));
  const [backend, setBackend] = useState("unknown"); // unknown | live | demo
  const [messages, setMessages] = useState(() => (user ? [makeGreeting(displayName(user), user.role)] : []));
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Patient-only: prescriptions shared by a doctor, and which one (if any) is open.
  const [prescriptions, setPrescriptions] = useState(() =>
    user && user.role === "patient" ? loadPrescriptionsFor(user.name) : []
  );
  const [selectedRx, setSelectedRx] = useState(null);

  // Doctor-only: the Give Prescription draft lives here so it survives switching tabs.
  const [rx, setRx] = useState(newDraft);

  const contentRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(historyKey(user.id), JSON.stringify(history));
    } catch {
      /* storage unavailable: history just won't persist */
    }
  }, [history, user]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    setMenuOpen(false);
    setSelectedRx(null);
  }, [tab]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Keep a patient's prescription list current, including when a doctor
  // checks something for them in another tab of the same browser.
  useEffect(() => {
    if (!user || user.role !== "patient") return undefined;
    const refresh = () => setPrescriptions(loadPrescriptionsFor(user.name));
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user, tab]);

  // A prescription scanned before logging in is saved as soon as the patient logs in.
  useEffect(() => {
    if (!user || user.role !== "patient") return;
    const pending = takePendingRx();
    if (!pending) return;
    savePrescriptionForPatient(user, pending);
    setPrescriptions(loadPrescriptionsFor(user.name));
    setTab("prescriptions");
  }, [user]);

  function enterApp(u) {
    setUser(u);
    setHistory(loadHistory(u.id));
    setForm(formFor(u));
    setMessages([makeGreeting(displayName(u), u.role)]);
    setReport(null);
    setBackend("unknown");
    setFilter("all");
    setError("");
    setTab("home");
    setPrescriptions(u.role === "patient" ? loadPrescriptionsFor(u.name) : []);
    setSelectedRx(null);
    setRx(newDraft());
  }

  function handleLogout() {
    logOut();
    setUser(null);
    setMenuOpen(false);
    setChatOpen(false);
    setStep("role");
    setReport(null);
    setHistory([]);
    setMessages([]);
    setForm(EMPTY_FORM);
    setPrescriptions([]);
    setSelectedRx(null);
    setRx(newDraft());
  }

  const openTile = (t) => {
    setFilter(t.filter);
    setTab(t.tab);
  };

  const startNewCheck = () => {
    setForm(formFor(user));
    setError("");
    setFilter("all");
    setTab("check");
  };

  async function submit(e) {
    e.preventDefault();
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setLoading(true);

    let warnings;
    let demo = false;
    try {
      warnings = await callApi(form);
      setBackend("live");
    } catch {
      if (!ALLOW_DEMO_FALLBACK) {
        setLoading(false);
        setError("Can't reach the server. Check that the backend is running, then try again.");
        return;
      }
      warnings = demoCheck(form);
      demo = true;
      setBackend("demo");
    }

    const next = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      patient: { name: form.patient_name.trim(), age: Number(form.age), weight: Number(form.weight) },
      warnings,
      demo,
      medicines: form.new_medicines.map(({ name, dosage }) => ({ name, dosage })),
    };
    setReport(next);
    setHistory((h) => [next, ...h].slice(0, 20));

    setLoading(false);
    setTab("results");
  }

  const openFromHistory = (r) => {
    setReport(r);
    setFilter("all");
    setTab("results");
  };

  const clearHistory = () => {
    if (window.confirm("Remove all saved checks from this device?")) setHistory([]);
  };

  /* ---------------- Logged-out: onboarding ---------------- */
  if (!user) {
    return (
      <div className="onb-stage">
        {step === "role" ? (
          <RoleScreen role={chosenRole} setRole={setChosenRole} onContinue={() => setStep("auth")} />
        ) : (
          <AuthScreen role={chosenRole} onBack={() => setStep("role")} onDone={enterApp} />
        )}
      </div>
    );
  }

  /* ---------------- Logged-in: desktop shell ---------------- */
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo" aria-hidden="true">💊</span>
          <div>
            <h1>MedSafe</h1>
            <p>Check every prescription before it is given</p>
          </div>
        </div>
        <div className="topbar-user">
          <div className="topbar-id">
            <strong>{displayName(user)}</strong>
            <span>{user.role === "doctor" ? "Doctor" : "Patient"}</span>
          </div>
          <div className="user-menu">
            <button
              type="button"
              className="avatar"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {user.name.trim().charAt(0).toUpperCase()}
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <p className="menu-id">
                  <strong>{displayName(user)}</strong>
                  <span>{user.email}</span>
                </p>
                <button type="button" role="menuitem" onClick={handleLogout}>Log out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Main">
          {NAV[user.role].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`nav-item ${tab === t.id ? "active" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-icon" aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <main ref={contentRef} className="content">
          <div className="content-inner">
            {tab === "home" &&
              (user.role === "doctor" ? (
                <HomeScreen user={user} latest={history[0]} backend={backend} onOpen={openTile} />
              ) : (
                <PatientHomeScreen latest={prescriptions[0]} onOpen={openTile} />
              ))}
            {tab === "check" && user.role === "doctor" && (
              <CheckScreen role={user.role} form={form} setForm={setForm} onSubmit={submit} loading={loading} error={error} filter={filter} />
            )}
            {tab === "results" && user.role === "doctor" && (
              <ResultsScreen role={user.role} report={report} filter={filter} setFilter={setFilter} onNew={startNewCheck} />
            )}
            {tab === "give" && user.role === "doctor" && (
              <GivePrescription
                doctorName={displayName(user)}
                latest={history[0] || null}
                draft={rx}
                setDraft={setRx}
                onGoCheck={() => setTab("check")}
              />
            )}
            {tab === "history" && user.role === "doctor" && (
              <HistoryScreen role={user.role} history={history} onOpen={openFromHistory} onClear={clearHistory} />
            )}
            {tab === "prescriptions" && user.role === "patient" && (
              selectedRx ? (
                <PatientPrescriptionDetail report={selectedRx} onBack={() => setSelectedRx(null)} />
              ) : (
                <PatientPrescriptionsScreen list={prescriptions} onOpen={setSelectedRx} />
              )
            )}
            {tab === "help" && <HelpScreen role={user.role} />}
          </div>
        </main>
      </div>

      {/* Floating AI assistant */}
      <button
        type="button"
        className="fab"
        onClick={() => setChatOpen((v) => !v)}
        aria-expanded={chatOpen}
        aria-label={chatOpen ? "Close assistant" : "Open assistant"}
      >
        {chatOpen ? "✕" : "🤖"}
      </button>
      {chatOpen && (
        <div className="chat-panel" role="dialog" aria-label="MedSafe assistant">
          <Assistant user={user} report={report || history[0] || null} messages={messages} setMessages={setMessages} />
        </div>
      )}
    </div>
  );
}
