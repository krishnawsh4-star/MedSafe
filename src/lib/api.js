/* -------------------------------------------------------------------------
   CONFIG
   Point VITE_API_URL at your backend (default: FastAPI on localhost:8000).
   ALLOW_DEMO_FALLBACK keeps the app usable while the backend isn't ready.
   Set it to false for a real deployment so failures show an error instead
   of sample results.
------------------------------------------------------------------------- */
export const API_URL = "https://medsafe-api-sj17.onrender.com";
export const ALLOW_DEMO_FALLBACK = false;

/* -------------------------------------------------------------------------
   SHARED HELPERS
------------------------------------------------------------------------- */
export const lc = (s) => String(s).trim().toLowerCase();

// "type" values must match the "type" strings your backend sends in each warning.
export const TYPE_META = {
  "Drug-Drug Interaction": { icon: "⚠️", short: "Drug interactions" },
  "Allergy Interaction": { icon: "🤧", short: "Allergy alerts" },
  "Drug-Disease Interaction": { icon: "🩺", short: "Condition conflicts" },
  "Dosage Review": { icon: "⚖️", short: "Dosage review" },
  "Duplicate Medication": { icon: "🔁", short: "Duplicates" },
};

export function sevKey(severity) {
  const s = lc(severity || "");
  if (/(high|severe|major|critical|contraindicated)/.test(s)) return "high";
  if (/(moderate|medium)/.test(s)) return "moderate";
  if (/(low|minor)/.test(s)) return "low";
  return "review";
}

const SEV_RANK = { high: 0, moderate: 1, review: 2, low: 3 };
export const sortWarnings = (list) =>
  [...list].sort((a, b) => SEV_RANK[sevKey(a.severity)] - SEV_RANK[sevKey(b.severity)]);

export function warningTitle(w) {
  if (w.allergy) return `${w.allergy} allergy`;
  return w.medicine || w.drug || "Needs review";
}

/* -------------------------------------------------------------------------
   PRESCRIPTION CHECK  (POST /check  ->  { warnings: [...] })
   Each warning: { type, medicine?, allergy?, severity, reason }
------------------------------------------------------------------------- */
export async function callApi(form) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${API_URL}/check-prescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        patient_name: form.patient_name.trim(),
        age: Number(form.age),
        weight: Number(form.weight),
        diseases: form.diseases,
        allergies: form.allergies,
        existing_medicines: form.existing_medicines,
        new_medicines: form.new_medicines.map((m) => ({
          name: m.name,
          dosage: m.dosage === "" ? null : Number(m.dosage),
        })),
      }),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.warnings)) throw new Error("Unexpected response");
    return data.warnings;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------
   DEMO RULES (used only when the backend is unreachable)
   A tiny sample so the UI can be shown end to end. Not a clinical source.
------------------------------------------------------------------------- */
const DEMO_INTERACTIONS = [
  { a: "warfarin", b: "aspirin", severity: "High", reason: "Taking both raises the risk of serious bleeding." },
  { a: "simvastatin", b: "clarithromycin", severity: "High", reason: "Clarithromycin raises simvastatin levels and the risk of muscle damage." },
  { a: "aspirin", b: "ibuprofen", severity: "Moderate", reason: "Ibuprofen can blunt aspirin's heart protection and add to stomach bleeding risk." },
  { a: "lisinopril", b: "spironolactone", severity: "Moderate", reason: "Both can raise blood potassium levels." },
];
const DEMO_ALLERGY_GROUPS = [
  { name: "penicillin", members: ["penicillin", "amoxicillin", "ampicillin"] },
  { name: "NSAID", members: ["ibuprofen", "aspirin", "diclofenac", "nsaid"] },
];
const DEMO_DISEASE_RULES = [
  { disease: "kidney", drug: "ibuprofen", severity: "High", reason: "Ibuprofen can worsen kidney function." },
  { disease: "ulcer", drug: "aspirin", severity: "High", reason: "Aspirin can irritate the stomach lining and cause bleeding." },
  { disease: "asthma", drug: "aspirin", severity: "Moderate", reason: "Aspirin can trigger asthma symptoms in some people." },
];
const DEMO_MAX_SINGLE_DOSE_MG = { paracetamol: 1000, ibuprofen: 800, aspirin: 1000, amoxicillin: 1000 };

export function demoCheck(form) {
  const out = [];
  const existing = form.existing_medicines.map((n) => ({ key: lc(n), label: n, fresh: false }));
  const fresh = form.new_medicines.map((m) => ({ key: lc(m.name), label: m.name, fresh: true, dosage: m.dosage }));

  fresh.forEach((m, i) => {
    const duplicate = existing.some((e) => e.key === m.key) || fresh.findIndex((x) => x.key === m.key) !== i;
    if (duplicate) {
      out.push({
        type: "Duplicate Medication",
        medicine: m.label,
        severity: "Moderate",
        reason: `${m.label} appears more than once across current and new medicines.`,
      });
    }
  });

  const all = [...existing, ...fresh];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (!all[i].fresh && !all[j].fresh) continue;
      const rule = DEMO_INTERACTIONS.find(
        (r) => (r.a === all[i].key && r.b === all[j].key) || (r.a === all[j].key && r.b === all[i].key)
      );
      if (rule) {
        out.push({
          type: "Drug-Drug Interaction",
          medicine: `${all[i].label} + ${all[j].label}`,
          severity: rule.severity,
          reason: rule.reason,
        });
      }
    }
  }

  form.allergies.forEach((allergy) => {
    const a = lc(allergy);
    DEMO_ALLERGY_GROUPS.forEach((group) => {
      if (!a.includes(lc(group.name)) && !group.members.some((mem) => a.includes(mem))) return;
      fresh.forEach((m) => {
        if (group.members.some((mem) => m.key.includes(mem))) {
          out.push({
            type: "Allergy Interaction",
            allergy,
            severity: "High",
            reason: `${m.label} belongs to the ${group.name} group, which matches the recorded allergy.`,
          });
        }
      });
    });
  });

  form.diseases.forEach((disease) => {
    DEMO_DISEASE_RULES.forEach((rule) => {
      if (!lc(disease).includes(rule.disease)) return;
      fresh.forEach((m) => {
        if (m.key.includes(rule.drug)) {
          out.push({ type: "Drug-Disease Interaction", medicine: m.label, severity: rule.severity, reason: rule.reason });
        }
      });
    });
  });

  fresh.forEach((m) => {
    const max = DEMO_MAX_SINGLE_DOSE_MG[m.key];
    if (max && m.dosage !== "" && Number(m.dosage) > max) {
      out.push({
        type: "Dosage Review",
        medicine: m.label,
        severity: "Review Required",
        reason: `${m.dosage} mg is above the usual adult single-dose limit of ${max} mg.`,
      });
    }
  });

  const seen = new Set();
  return out.filter((w) => {
    const key = `${w.type}|${lc(w.medicine || "")}|${lc(w.allergy || "")}|${w.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------------------
   AI ASSISTANT  (POST /chat  ->  { reply: "..." })
   The real answers come from a language model running on your backend
   (see api.py). If /chat is unreachable, localAnswer() gives basic replies
   so the chat still works in a demo.
------------------------------------------------------------------------- */
function summariseReport(report) {
  if (!report) return null;
  return {
    patient: report.patient,
    warnings: report.warnings.map((w) => ({
      type: w.type,
      item: w.medicine || w.allergy || w.drug || "",
      severity: w.severity,
      reason: w.reason,
    })),
  };
}

export async function askBot({ messages, role, report }) {
  // The API needs the conversation to start with a user message.
  const firstUser = messages.findIndex((m) => m.role === "user");
  const trimmed = messages.slice(Math.max(firstUser, 0)).slice(-12);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: trimmed.map(({ role: r, content }) => ({ role: r, content })),
        user_role: role,
        report: summariseReport(report),
      }),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("Empty reply");
    return data.reply;
  } finally {
    clearTimeout(timer);
  }
}

function reportSummaryText(report) {
  if (!report) {
    return "You don't have a report yet. Open the Check tab, enter the details and tap Check safety.";
  }
  const list = sortWarnings(report.warnings);
  if (list.length === 0) {
    return `The latest check for ${report.patient.name} found no warnings in the knowledge base. That is not a guarantee of safety, so please confirm with a pharmacist or doctor.`;
  }
  const top = list
    .slice(0, 3)
    .map((w) => `• ${w.severity}: ${warningTitle(w)}. ${w.reason}`)
    .join("\n");
  const more = list.length > 3 ? `\n…and ${list.length - 3} more on the Results tab.` : "";
  return `The latest check for ${report.patient.name} found ${list.length} ${list.length === 1 ? "warning" : "warnings"}. The most serious:\n${top}${more}\nPlease review these with a doctor or pharmacist before changing any medicine.`;
}

export function localAnswer(text, { report }) {
  const t = lc(text);

  if (/(chest pain|can'?t breathe|cannot breathe|difficulty breathing|trouble breathing|overdose|unconscious|seizure|severe bleeding|throat (is )?swelling|swelling of (the )?(face|throat|tongue))/.test(t)) {
    return "This could be an emergency. Call your local emergency number now (112 in India) or go to the nearest hospital. Please don't wait for the app.";
  }
  if (/(suicid|kill myself|end my life|self.?harm|hurt myself)/.test(t)) {
    return "I'm really sorry you're feeling this way, and I'm glad you said it. Please reach out to someone right now: a person you trust, or a crisis line. In India you can call Tele-MANAS on 14416, or call 112 if you are in immediate danger.";
  }
  if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(t)) {
    return "Hello! I can explain your medicine reports, drug interactions, allergies and doses, and show you how to use the app. What would you like to know?";
  }
  if (/(severity|severe|high|moderate|review required|levels?)/.test(t)) {
    return "Severity levels:\n• High: a serious risk. Talk to the doctor or pharmacist before the medicine is given or taken.\n• Moderate: needs attention or monitoring.\n• Low: minor, usually good to know.\n• Review Required: a rule matched but a clinician needs to judge it, for example a dose that may be too high.";
  }
  if (/(report|result|latest|warning)/.test(t)) {
    return reportSummaryText(report);
  }
  if (/interaction/.test(t)) {
    return "A drug interaction happens when two medicines affect each other, making one work too strongly, too weakly, or causing side effects. MedSafe checks every new medicine against the ones already being taken. Add both on the Check tab to see if any pair is flagged.";
  }
  if (/allerg/.test(t)) {
    return "Enter known allergies on the Check tab. MedSafe compares them with the new medicines and flags matches, including medicines from the same family (for example penicillin and amoxicillin). If someone has a reaction, get medical help immediately.";
  }
  if (/(miss|forgot|skipped).*(dose|tablet|pill|medicine)|(dose|tablet|pill).*(miss|forgot)/.test(t)) {
    return "What to do about a missed dose depends on the medicine. Check the leaflet or ask your pharmacist, and don't take a double dose unless they tell you to.";
  }
  if (/(dose|dosage|mg\b|how much)/.test(t)) {
    return "Enter the dose (in mg) next to each new medicine on the Check tab. MedSafe flags doses that need review. The right dose depends on age, weight, kidney function and other medicines, so always follow the prescriber's instructions.";
  }
  if (/(alcohol|pregnan|breastfeed|breast-feed|driving)/.test(t)) {
    return "Alcohol, pregnancy, breastfeeding and driving can change how a medicine affects you. MedSafe doesn't check these yet, so please ask a doctor or pharmacist.";
  }
  if (/(how|start|use|begin|work)/.test(t) && /(check|app|work|use|start|medsafe)/.test(t)) {
    return "1. Open the Check tab.\n2. Enter the patient details, conditions and allergies.\n3. Add current medicines and the new prescription with doses.\n4. Tap Check safety and review the warnings, most serious first.";
  }
  if (/(mic|microphone|voice|speak|talk)/.test(t)) {
    return "Tap the microphone next to the message box and speak. Your words appear in the box so you can check them before sending. Voice input works best in Chrome or Edge.";
  }
  if (/(thank|thanks|thx)/.test(t)) {
    return "You're welcome! Ask me anything else whenever you like.";
  }
  return "I can help with drug interactions, allergies, doses, your latest report and how to use the app. For other questions the full AI service needs to be connected. Until then, please ask a doctor or pharmacist.";
}

/* -------------------------------------------------------------------------
   PATIENT APP-HELP ASSISTANT
   Patients no longer run their own checks, so their assistant is scoped to
   three things only: what MedSafe is, how to view a prescription a doctor
   has shared with them, and how to get around the app. It never answers
   medical questions (interactions, doses, severity meanings, etc.) — those
   stay with askBot()/localAnswer() above, which the doctor assistant still
   uses unchanged. The emergency and crisis checks are kept as a safety net
   even though they're outside that scope.
------------------------------------------------------------------------- */
export function localPatientAnswer(text) {
  const t = lc(text);

  if (/(chest pain|can'?t breathe|cannot breathe|difficulty breathing|trouble breathing|overdose|unconscious|seizure|severe bleeding|throat (is )?swelling|swelling of (the )?(face|throat|tongue))/.test(t)) {
    return "This could be an emergency. Call your local emergency number now (112 in India) or go to the nearest hospital. Please don't wait for the app.";
  }
  if (/(suicid|kill myself|end my life|self.?harm|hurt myself)/.test(t)) {
    return "I'm really sorry you're feeling this way, and I'm glad you said it. Please reach out to someone right now: a person you trust, or a crisis line. In India you can call Tele-MANAS on 14416, or call 112 if you are in immediate danger.";
  }
  if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(t)) {
    return "Hello! I can help you find your way around MedSafe, like seeing a prescription your doctor has checked for you. What would you like to know?";
  }
  if (/(what is medsafe|about medsafe|what does medsafe do|what('?s| is) this app)/.test(t)) {
    return "MedSafe is a safety check your doctor runs before prescribing you a new medicine. It looks for drug interactions, allergy conflicts, condition conflicts, dosage issues and duplicate medicines, then gives you the prescription as a QR code that you can keep in this app.";
  }
  if (/(qr|scan|camera)/.test(t)) {
    return 'After your doctor writes your prescription they will show you a QR code. Point your phone camera at it and open the link that appears. Your prescription opens straight away, with no login needed. To keep it, log in as a patient and tap "Save to My Prescriptions". It then appears in the My Prescriptions tab.';
  }
  if (/(prescription|report|see my|find my|where.*(report|prescription)|latest)/.test(t)) {
    return 'Open the "My Prescriptions" tab from the menu on the left. Every prescription you have saved appears there, most recent first. Tap one to see your medicines, how often to take them and for how many days. If you have not saved one yet, scan the QR code your doctor gave you and tap "Save to My Prescriptions".';
  }
  if (/(how.*(use|navigate|work)|get around|tabs?|menu|home screen)/.test(t)) {
    return 'MedSafe has three areas for you: Home (a quick summary), My Prescriptions (every prescription you have saved) and Help (this guide). Use the menu on the left to move between them.';
  }
  if (/(log ?out|sign ?out)/.test(t)) {
    return "Tap your initial in the top right corner and choose \"Log out\".";
  }
  if (/(account|log ?in|sign ?up|password|email)/.test(t)) {
    return 'Log in as a patient to save prescriptions to your account. If you scanned a QR code before logging in, log in or sign up as a patient and it will be saved for you automatically. For anything else about your account, use the menu in the top right.';
  }
  if (/(don'?t see|missing|not (showing|appearing)|can'?t find)/.test(t)) {
    return 'Prescriptions only appear in "My Prescriptions" after you save them. Scan the QR code from your doctor again and tap "Save to My Prescriptions" while you are logged in as a patient.';
  }
  if (/(thank|thanks|thx)/.test(t)) {
    return "You're welcome! Let me know if you need help finding anything else in the app.";
  }

  return "I can only help with using the MedSafe app, like finding a prescription your doctor has shared with you, or getting around the app. For questions about your medicines or health, please talk to your doctor or pharmacist.";
}
