import { useId, useState } from "react";
import { logIn, signUp } from "../lib/auth.js";

const ROLES = [
  { id: "doctor", icon: "🩺", title: "Doctor", text: "Check prescriptions for your patients" },
  { id: "patient", icon: "🙋", title: "Patient", text: "Check your own medicines" },
];

function Brand({ compact }) {
  return (
    <div className={`onb-top ${compact ? "compact" : ""}`}>
      <div className="logo-card" aria-hidden="true">💊</div>
      <h1>MedSafe</h1>
      <p>Check every prescription before it is given</p>
    </div>
  );
}

/* Step 1: who are you? */
export function RoleScreen({ role, setRole, onContinue }) {
  const headingId = useId();
  return (
    <div className="onb">
      <Brand />
      <div className="onb-sheet">
        <h2 id={headingId} className="onb-title">Who is using MedSafe?</h2>
        <p className="onb-sub">Choose the option that fits you. You'll see the tools made for that role.</p>

        <div className="role-grid" role="radiogroup" aria-labelledby={headingId}>
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={role === r.id}
              className={`role-tile ${role === r.id ? "on" : ""}`}
              onClick={() => setRole(r.id)}
            >
              <span className="role-icon" aria-hidden="true">{r.icon}</span>
              <span className="role-text">
                <strong>{r.title}</strong>
                <span>{r.text}</span>
              </span>
              <span className="role-check" aria-hidden="true">{role === r.id ? "✓" : ""}</span>
            </button>
          ))}
        </div>

        <button type="button" className="btn-primary" onClick={onContinue} disabled={!role}>
          {role ? "Continue" : "Choose an option to continue"}
        </button>
      </div>
    </div>
  );
}

/* Step 2: log in or sign up */
export function AuthScreen({ role, onBack, onDone }) {
  const uid = useId();
  const [mode, setMode] = useState("login");
  const [fields, setFields] = useState({ name: "", email: "", password: "", age: "", weight: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const roleLabel = role === "doctor" ? "Doctor" : "Patient";

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user =
        mode === "signup"
          ? await signUp({ ...fields, role })
          : await logIn({ email: fields.email, password: fields.password, role });
      onDone(user);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <Brand compact />
      <div className="onb-sheet">
        <div className="role-line">
          <span>Continuing as <strong>{roleLabel}</strong></span>
          <button type="button" className="link-btn" onClick={onBack}>Change</button>
        </div>

        <div className="seg" role="tablist" aria-label="Log in or sign up">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setError(""); }}>
            Log in
          </button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setError(""); }}>
            Sign up
          </button>
        </div>

        <form onSubmit={submit} noValidate className="auth-form">
          {mode === "signup" && (
            <div className="field">
              <label className="field-label" htmlFor={`${uid}-name`}>Full name</label>
              <input id={`${uid}-name`} value={fields.name} onChange={set("name")} autoComplete="name" placeholder="Your name" />
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor={`${uid}-email`}>Email</label>
            <input id={`${uid}-email`} type="email" value={fields.email} onChange={set("email")} autoComplete="email" placeholder="you@example.com" />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${uid}-pw`}>Password</label>
            <div className="pw-row">
              <input
                id={`${uid}-pw`}
                type={showPassword ? "text" : "password"}
                value={fields.password}
                onChange={set("password")}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              />
              <button type="button" className="btn-add" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {mode === "signup" && role === "patient" && (
            <div className="two-col">
              <div className="field">
                <label className="field-label" htmlFor={`${uid}-age`}>Age</label>
                <input id={`${uid}-age`} type="number" inputMode="numeric" min="0" value={fields.age} onChange={set("age")} placeholder="Years" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${uid}-weight`}>Weight</label>
                <input id={`${uid}-weight`} type="number" inputMode="decimal" min="0" value={fields.weight} onChange={set("weight")} placeholder="kg" />
              </div>
            </div>
          )}

          <p className="form-error" role="alert" aria-live="assertive">{error}</p>

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="switch-line">
          {mode === "login" ? "New to MedSafe?" : "Already have an account?"}{" "}
          <button type="button" className="link-btn" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
