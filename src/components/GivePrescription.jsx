import { useEffect, useId, useState } from "react";
import QRCode from "qrcode";
import "../rx.css";
import { lc } from "../lib/api.js";
import {
  MAX_LINK_LENGTH,
  buildLink,
  defaultBase,
  getBase,
  isLocalAddress,
  makePayload,
  newDraft,
  newRow,
  saveBase,
} from "../lib/rxLink.js";

const TIMES_OPTIONS = [
  { value: "1", label: "Once a day" },
  { value: "2", label: "Twice a day" },
  { value: "3", label: "3 times a day" },
  { value: "4", label: "4 times a day" },
  { value: "5", label: "5 times a day" },
  { value: "6", label: "6 times a day" },
];

const sig = (name, dose) => `${lc(name)}|${Number(dose) || ""}`;

function validate(draft) {
  if (!draft.patient.trim()) return "Enter the patient's name.";
  const used = draft.items.filter((i) => i.name.trim() || i.dosage !== "" || i.days !== "");
  if (used.length === 0) return "Add at least one medicine.";
  for (const i of used) {
    const label = i.name.trim() || "a medicine";
    if (!i.name.trim()) return "Every medicine row needs a name. Fill it in or remove the row.";
    if (!(Number(i.dosage) > 0)) return `Enter the dose in mg for ${label}.`;
    const days = Number(i.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return `Enter how many days (1 to 365) for ${label}.`;
  }
  return "";
}

export default function GivePrescription({ doctorName, latest, draft, setDraft, onGoCheck }) {
  const baseId = useId();
  const [base, setBase] = useState(getBase);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pre-fill from the most recent safety check, once per check.
  const latestId = latest?.id ?? null;
  useEffect(() => {
    if (draft.seededFrom === latestId) return;
    setDraft((d) => ({
      ...d,
      seededFrom: latestId,
      patient: latest ? latest.patient.name : d.patient,
      items: latest?.medicines?.length
        ? latest.medicines.map((m) => newRow({ name: m.name, dosage: m.dosage ?? "" }))
        : d.items,
      result: null,
      error: "",
    }));
  }, [latest, latestId, draft.seededFrom, setDraft]);

  // Does what's on screen match the last safety check?
  const checked = latest?.medicines ?? [];
  const onScreen = draft.items.filter((i) => i.name.trim()).map((i) => sig(i.name, i.dosage));
  const checkedSigs = new Set(checked.map((m) => sig(m.name, m.dosage)));
  const status =
    checked.length === 0
      ? "none"
      : onScreen.length === checkedSigs.size && onScreen.every((s) => checkedSigs.has(s))
        ? "match"
        : "mismatch";

  const edit = (updater) => setDraft((d) => ({ ...d, result: null, error: "", ...updater(d) }));
  const patchRow = (id, changes) =>
    edit((d) => ({ items: d.items.map((i) => (i.id === id ? { ...i, ...changes } : i)) }));
  const removeRow = (id) => edit((d) => ({ items: d.items.filter((i) => i.id !== id) }));
  const addRow = () => edit((d) => ({ items: [...d.items, newRow()] }));

  function changeBase(value) {
    setBase(value);
    saveBase(value);
    setDraft((d) => ({ ...d, result: null }));
  }

  async function generate() {
    const problem = validate(draft);
    if (problem) {
      setDraft((d) => ({ ...d, error: problem, result: null }));
      return;
    }

    const items = draft.items.filter((i) => i.name.trim());
    const payload = makePayload({
      doctorName,
      patientName: draft.patient.trim(),
      items,
      warnings: status === "match" ? latest.warnings : null,
    });
    const link = buildLink(base || defaultBase(), payload);
    if (link.length > MAX_LINK_LENGTH) {
      setDraft((d) => ({
        ...d,
        result: null,
        error: "That's too many medicines to fit in one scannable QR code. Remove some, or give them as two prescriptions.",
      }));
      return;
    }

    setBusy(true);
    try {
      let qr;
      try {
        qr = await QRCode.toDataURL(link, { width: 360, margin: 2, errorCorrectionLevel: "M" });
      } catch {
        qr = await QRCode.toDataURL(link, { width: 360, margin: 2, errorCorrectionLevel: "L" });
      }
      setDraft((d) => ({
        ...d,
        error: "",
        result: { link, qr, count: items.length, at: payload.t, patient: payload.p, attached: status === "match" },
      }));
    } catch {
      setDraft((d) => ({ ...d, result: null, error: "Couldn't create the QR code. Try shortening the medicine names." }));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(draft.result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", draft.result.link);
    }
  }

  const startOver = () => setDraft({ ...newDraft(), seededFrom: latestId });
  const local = isLocalAddress(base || defaultBase());

  return (
    <div className="screen">
      <h2 className="screen-title">Give prescription</h2>

      {status === "match" ? (
        <div className="rx-note ok" role="status">
          ✅ These medicines match your last safety check
          {latest.warnings.length ? ` (${latest.warnings.length} ${latest.warnings.length === 1 ? "warning" : "warnings"})` : ""}.
          A short summary of it will be attached to the QR code.
        </div>
      ) : (
        <div className="rx-note warn" role="status">
          <span>
            ⚠️{" "}
            {status === "none"
              ? "No safety check has been run for these medicines yet. We recommend checking them before you give the prescription."
              : "These medicines don't match your last safety check. We recommend checking them again before you give the prescription."}
          </span>
          <button type="button" className="link-btn" onClick={onGoCheck}>Go to Check</button>
        </div>
      )}

      <section className="card">
        <div className="field">
          <label className="field-label" htmlFor="rx-patient">Patient name</label>
          <input
            id="rx-patient"
            value={draft.patient}
            placeholder="Full name"
            autoComplete="off"
            onChange={(e) => edit(() => ({ patient: e.target.value }))}
          />
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Medicines</h3>
        {draft.items.length === 0 && <p className="rx-empty">No medicines yet. Add the first one below.</p>}
        <ul className="rx-rows">
          {draft.items.map((it) => (
            <li key={it.id} className="rx-row">
              <div className="field rx-name">
                <label className="field-label" htmlFor={`${it.id}-n`}>Medicine</label>
                <input id={`${it.id}-n`} value={it.name} placeholder="Medicine name" autoComplete="off" onChange={(e) => patchRow(it.id, { name: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${it.id}-d`}>Dose (mg)</label>
                <input id={`${it.id}-d`} type="number" inputMode="decimal" min="0" value={it.dosage} placeholder="mg" onChange={(e) => patchRow(it.id, { dosage: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${it.id}-f`}>How often</label>
                <select id={`${it.id}-f`} value={it.times} onChange={(e) => patchRow(it.id, { times: e.target.value })}>
                  {TIMES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${it.id}-k`}>For how many days</label>
                <input id={`${it.id}-k`} type="number" inputMode="numeric" min="1" max="365" value={it.days} placeholder="Days" onChange={(e) => patchRow(it.id, { days: e.target.value })} />
              </div>
              <button type="button" className="rx-remove" aria-label={`Remove ${it.name.trim() || "this medicine"}`} onClick={() => removeRow(it.id)}>×</button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-add rx-add" onClick={addRow}>+ Add medicine</button>
      </section>

      <details className="card rx-base">
        <summary>Address the QR code opens</summary>
        <div className="field">
          <label className="field-label" htmlFor={baseId}>App address</label>
          <input id={baseId} value={base} onChange={(e) => changeBase(e.target.value)} placeholder={defaultBase()} autoComplete="off" />
          <span className="field-hint">Defaults to the address you're using now. Use your deployed link when giving a prescription to a phone.</span>
        </div>
        <button type="button" className="link-btn" onClick={() => changeBase("")}>Reset to this address</button>
      </details>

      {local && (
        <div className="rx-note warn" role="status">
          ⚠️ This QR code will point to <strong>localhost</strong>, which a phone can't open. To scan it with a phone, either use your deployed link above, or run{" "}
          <code>npm run dev -- --host</code>, open the "Network" address it prints on this computer, and keep both devices on the same Wi-Fi.
        </div>
      )}

      <div className="submit-row">
        <p className="form-error" role="alert" aria-live="assertive">{draft.error}</p>
        <button type="button" className="btn-primary" onClick={generate} disabled={busy}>
          {busy ? "Creating…" : "Generate QR code"}
        </button>
      </div>

      {draft.result && (
        <section className="card rx-result" aria-live="polite">
          <img className="rx-qr" src={draft.result.qr} width="260" height="260" alt="QR code for this prescription" />
          <div className="rx-result-body">
            <h3 className="card-title">Ready to scan</h3>
            <p>
              Ask <strong>{draft.result.patient}</strong> to point their phone camera at this code and open the link. Their prescription (
              {draft.result.count} {draft.result.count === 1 ? "medicine" : "medicines"}) opens straight away, with no app or login needed.
              {draft.result.attached ? " The safety-check summary is included." : " No safety-check summary is included."}
            </p>
            <div className="rx-actions">
              <button type="button" className="btn-secondary" onClick={copyLink}>{copied ? "Copied ✓" : "Copy link"}</button>
              <a className="btn-secondary rx-download" href={draft.result.qr} download="medsafe-prescription-qr.png">Download QR</a>
              <a className="btn-secondary rx-download" href={draft.result.link} target="_blank" rel="noreferrer">Preview as patient</a>
              <button type="button" className="link-btn" onClick={startOver}>Start a new prescription</button>
            </div>
            <p className="rx-privacy">The code contains the patient's name and medicines, so only show it to the patient.</p>
          </div>
        </section>
      )}
    </div>
  );
}
