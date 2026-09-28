import { lc, sevKey } from "./api.js";

/* -------------------------------------------------------------------------
   PRESCRIPTION LINK / QR HELPERS

   A "given" prescription travels inside the QR code itself:

       https://<your-app>/#rx=<base64url of a small JSON object>

   Everything after "#" stays in the browser and is never sent to a server,
   so no backend is involved. Keys are kept short so several medicines still
   fit in one scannable QR code:
       v version · i id · t time (ms) · d doctor · p patient
       m [{ n name, g dose mg, f times per day, k days }]
       s [high, moderate, low, review] warning counts (only if checked)
------------------------------------------------------------------------- */

export const PRESCRIPTIONS_KEY = "medsafe-shared-prescriptions";
const PENDING_KEY = "medsafe-pending-rx";
const BASE_KEY = "medsafe-rx-base";
const PENDING_MAX_AGE = 24 * 60 * 60 * 1000;

// Above this the QR becomes too dense for a phone camera to read reliably.
export const MAX_LINK_LENGTH = 1800;

/* ---------- small formatting helpers (used by doctor + patient screens) ---------- */
export const perDay = (n) => (n === 1 ? "Once a day" : n === 2 ? "Twice a day" : `${n} times a day`);
export const daysText = (n) => `${n} ${n === 1 ? "day" : "days"}`;

/* ---------- draft state for the Give Prescription screen ---------- */
let rowCounter = 0;
export const newRow = (over = {}) => ({
  id: `r${Date.now().toString(36)}${rowCounter++}`,
  name: "",
  dosage: "",
  times: "1",
  days: "",
  ...over,
});

export const newDraft = () => ({
  items: [newRow()],
  patient: "",
  seededFrom: undefined, // set once the screen has pre-filled from the latest check
  result: null, // { link, qr, count, at }
  error: "",
});

/* ---------- base64url (UTF-8 safe, so Hindi/Telugu/Tamil names survive) ---------- */
function toB64Url(text) {
  let bin = "";
  new TextEncoder().encode(text).forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(encoded) {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ---------- building the payload ---------- */
export function severityCounts(warnings) {
  const c = { high: 0, moderate: 0, low: 0, review: 0 };
  warnings.forEach((w) => {
    c[sevKey(w.severity)] += 1;
  });
  return [c.high, c.moderate, c.low, c.review];
}

/** `warnings` is the matching safety check's warnings, or null if none applies. */
export function makePayload({ doctorName, patientName, items, warnings }) {
  return {
    v: 1,
    i: Math.random().toString(36).slice(2, 10),
    t: Date.now(),
    d: doctorName,
    p: patientName,
    m: items.map((it) => ({
      n: it.name.trim(),
      g: Number(it.dosage),
      f: Number(it.times),
      k: Number(it.days),
    })),
    ...(warnings ? { s: severityCounts(warnings) } : {}),
  };
}

/* ---------- link address ---------- */
export const defaultBase = () => `${window.location.origin}${window.location.pathname}`;

export function getBase() {
  try {
    return localStorage.getItem(BASE_KEY) || defaultBase();
  } catch {
    return defaultBase();
  }
}

export function saveBase(value) {
  try {
    if (value.trim()) localStorage.setItem(BASE_KEY, value.trim());
    else localStorage.removeItem(BASE_KEY);
  } catch {
    /* storage unavailable: the address just won't be remembered */
  }
}

export function isLocalAddress(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function buildLink(base, payload) {
  return `${base.trim().replace(/#.*$/, "")}#rx=${toB64Url(JSON.stringify(payload))}`;
}

/* ---------- reading a link back ---------- */
const text = (v, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Returns a cleaned prescription, or null if the data is missing or damaged. */
export function decodeRx(encoded) {
  try {
    const data = JSON.parse(fromB64Url(encoded));
    if (!data || data.v !== 1 || !Array.isArray(data.m) || data.m.length === 0 || data.m.length > 20) return null;

    const medicines = data.m.map((m) => ({
      name: text(m?.n),
      dosage: Number(m?.g),
      times: Number(m?.f),
      days: Number(m?.k),
    }));
    const valid = medicines.every(
      (m) => m.name && m.dosage > 0 && Number.isInteger(m.times) && m.times > 0 && Number.isInteger(m.days) && m.days > 0
    );
    if (!valid) return null;

    const s = data.s;
    const summary =
      Array.isArray(s) && s.length === 4 && s.every((n) => Number.isInteger(n) && n >= 0)
        ? { high: s[0], moderate: s[1], low: s[2], review: s[3] }
        : null;

    const t = Number(data.t);
    const createdAt = Number.isFinite(t) ? t : Date.now();
    return {
      id: text(data.i, 40) || String(createdAt),
      createdAt,
      doctorName: text(data.d) || "Your doctor",
      patientName: text(data.p),
      medicines,
      summary,
    };
  } catch {
    return null;
  }
}

/* ---------- the patient's saved prescriptions (browser storage) ---------- */
function readAll() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESCRIPTIONS_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function loadPrescriptionsFor(name) {
  const key = lc(name || "");
  if (!key) return [];
  return readAll()
    .filter((p) => p.patientKey === key)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Saves a decoded prescription under this patient's account. Returns "saved" | "exists" | "error". */
export function savePrescriptionForPatient(user, rx) {
  const patientKey = lc(user.name);
  const id = `rx-${rx.id}`;
  const all = readAll();
  if (all.some((p) => p.id === id && p.patientKey === patientKey)) return "exists";

  const entry = {
    id,
    patientKey,
    createdAt: new Date(rx.createdAt).toISOString(),
    patient: { name: rx.patientName || user.name },
    doctorName: rx.doctorName,
    medicines: rx.medicines,
    summary: rx.summary,
    warnings: [],
  };
  try {
    localStorage.setItem(PRESCRIPTIONS_KEY, JSON.stringify([entry, ...all].slice(0, 300)));
    return "saved";
  } catch {
    return "error";
  }
}

/* ---------- "log in first, then save" hand-off ---------- */
export function setPendingRx(encoded) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ e: encoded, at: Date.now() }));
  } catch {
    /* storage unavailable: they'll just have to scan again after logging in */
  }
}

export function takePendingRx() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY));
    localStorage.removeItem(PENDING_KEY);
    if (!raw || typeof raw.e !== "string" || Date.now() - raw.at > PENDING_MAX_AGE) return null;
    return decodeRx(raw.e);
  } catch {
    return null;
  }
}
