import { useMemo, useState } from "react";
import "../rx.css";
import { getSessionUser } from "../lib/auth.js";
import { daysText, decodeRx, perDay, savePrescriptionForPatient, setPendingRx } from "../lib/rxLink.js";

const whenLong = (ms) =>
  new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

// Leaves the viewer and shows the normal app (main.jsx switches on the URL hash).
const openApp = () => {
  window.location.hash = "";
};

export default function PrescriptionViewer({ hash }) {
  const encoded = hash.replace(/^#rx=/, "");
  const rx = useMemo(() => decodeRx(encoded), [encoded]);
  const [user] = useState(getSessionUser);
  const [saveState, setSaveState] = useState(""); // "" | saved | exists | error

  if (!rx) {
    return (
      <div className="rxv">
        <div className="rxv-wrap">
          <div className="rxv-card rxv-bad">
            <h1>This prescription link can't be read</h1>
            <p>The QR code may be damaged or incomplete. Ask your doctor to show it again, or to generate a new one.</p>
            <button type="button" className="btn-secondary rxv-light" onClick={openApp}>Open MedSafe</button>
          </div>
        </div>
      </div>
    );
  }

  const s = rx.summary;
  const sTotal = s ? s.high + s.moderate + s.low + s.review : 0;

  function save() {
    setSaveState(savePrescriptionForPatient(user, rx));
  }

  function loginToSave() {
    setPendingRx(encoded);
    openApp();
  }

  return (
    <div className="rxv">
      <div className="rxv-wrap">
        <div className="rxv-brand">
          <span aria-hidden="true">💊</span> MedSafe
        </div>

        <section className="rxv-card">
          <p className="rxv-eyebrow">Prescription from</p>
          <h1>{rx.doctorName}</h1>
          <p className="rxv-meta">{whenLong(rx.createdAt)}</p>
          {rx.patientName && <p className="rxv-meta">For <strong>{rx.patientName}</strong></p>}
        </section>

        <section aria-label="Medicines">
          <h2 className="rxv-h">Your medicines</h2>
          <ul className="rxv-meds">
            {rx.medicines.map((m, i) => (
              <li key={`${m.name}-${i}`} className="rxv-med">
                <div className="rxv-med-top">
                  <strong>{m.name}</strong>
                  <span className="rxv-dose">{m.dosage} mg</span>
                </div>
                <p>{perDay(m.times)} · for {daysText(m.days)}</p>
                <p className="rxv-total">{m.times * m.days} doses in total</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rxv-block">
          <h2 className="rxv-h">MedSafe safety check</h2>
          {!s && <p>No safety-check summary is attached to this prescription.</p>}
          {s && sTotal === 0 && <p>✅ No warnings were found for these medicines. This is not a guarantee of safety, so please confirm with your doctor or pharmacist.</p>}
          {s && sTotal > 0 && (
            <>
              <p>The safety check found {sTotal} {sTotal === 1 ? "warning" : "warnings"}. Please ask your doctor or pharmacist about them before you start.</p>
              <div className="rx-chips">
                {s.high > 0 && <span className="sev-pill sev-high">High · {s.high}</span>}
                {s.moderate > 0 && <span className="sev-pill sev-moderate">Moderate · {s.moderate}</span>}
                {s.review > 0 && <span className="sev-pill sev-review">Review · {s.review}</span>}
                {s.low > 0 && <span className="sev-pill sev-low">Low · {s.low}</span>}
              </div>
            </>
          )}
        </section>

        <section className="rxv-block rxv-noprint">
          {user?.role === "patient" && saveState === "" && (
            <>
              <p>Keep this in your MedSafe account, under My Prescriptions.</p>
              <button type="button" className="btn-primary" onClick={save}>Save to My Prescriptions</button>
            </>
          )}
          {user?.role === "patient" && (saveState === "saved" || saveState === "exists") && (
            <>
              <p>✅ {saveState === "saved" ? "Saved to My Prescriptions." : "This prescription is already in your account."}</p>
              <button type="button" className="btn-secondary" onClick={openApp}>Open MedSafe</button>
            </>
          )}
          {user?.role === "patient" && saveState === "error" && (
            <p className="form-error">Couldn't save this in your browser. Check that storage isn't blocked, then try again.</p>
          )}
          {user?.role === "doctor" && (
            <p>You're signed in as a doctor on this device, so saving to a patient account isn't available here.</p>
          )}
          {!user && (
            <>
              <p>Want to keep this in the MedSafe app? Log in or sign up as a patient and it will be saved for you automatically.</p>
              <button type="button" className="btn-primary" onClick={loginToSave}>Log in or sign up to save</button>
            </>
          )}
          <button type="button" className="link-btn" onClick={() => window.print()}>Print or save as PDF</button>
        </section>

        <p className="disclaimer">
          Take this prescription exactly as your doctor has written it. MedSafe supports clinical decisions and does not replace advice from your doctor or pharmacist.
        </p>
      </div>
    </div>
  );
}
