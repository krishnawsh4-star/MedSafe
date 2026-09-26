/* -------------------------------------------------------------------------
   DEMO AUTHENTICATION (browser only)

   Accounts are stored in this browser's localStorage, so they exist only on
   this device and anyone with access to the browser could read or delete them.
   That is fine for a hackathon demo. For a real product, move sign-up, log-in
   and sessions to your backend (hashed passwords in a database + tokens).
------------------------------------------------------------------------- */
const USERS_KEY = "medsafe-users";
const SESSION_KEY = "medsafe-session";

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => Uint8Array.from(hex.match(/.{2}/g) || [], (h) => parseInt(h, 16));

function readUsers() {
  try {
    const list = JSON.parse(localStorage.getItem(USERS_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeUsers(list) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  } catch {
    throw new Error("Couldn't save your account in this browser. Check that storage isn't blocked.");
  }
}

async function hashPassword(password, saltHex) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Accounts need a secure page. Open the app at http://localhost:5173 or over https.");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

const publicUser = ({ passHash, salt, ...rest }) => rest; // never hand the hash to the UI

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signUp({ name, email, password, role, age, weight }) {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName) throw new Error("Enter your full name.");
  if (!EMAIL_RE.test(cleanEmail)) throw new Error("Enter a valid email address.");
  if (password.length < 6) throw new Error("Use a password with at least 6 characters.");

  let ageNum;
  let weightNum;
  if (role === "patient") {
    ageNum = Number(age);
    weightNum = Number(weight);
    if (!age || !Number.isFinite(ageNum) || ageNum <= 0 || ageNum > 120) throw new Error("Enter an age between 1 and 120.");
    if (!weight || !Number.isFinite(weightNum) || weightNum <= 0 || weightNum > 400) throw new Error("Enter your weight in kg (for example 62).");
  }

  const users = readUsers();
  if (users.some((u) => u.email === cleanEmail)) {
    throw new Error("An account with this email already exists. Try logging in.");
  }

  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const user = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    email: cleanEmail,
    role,
    ...(role === "patient" ? { age: ageNum, weight: weightNum } : {}),
    salt,
    passHash: await hashPassword(password, salt),
  };

  writeUsers([...users, user]);
  try {
    localStorage.setItem(SESSION_KEY, user.id);
  } catch {
    /* session just won't survive a refresh */
  }
  return publicUser(user);
}

export async function logIn({ email, password, role }) {
  const cleanEmail = email.trim().toLowerCase();
  const user = readUsers().find((u) => u.email === cleanEmail);
  const wrong = new Error("Email or password is incorrect.");

  if (!user) throw wrong;
  if ((await hashPassword(password, user.salt)) !== user.passHash) throw wrong;
  if (user.role !== role) {
    throw new Error(`This account is registered as a ${user.role}. Go back and choose ${user.role === "doctor" ? "Doctor" : "Patient"}.`);
  }

  try {
    localStorage.setItem(SESSION_KEY, user.id);
  } catch {
    /* session just won't survive a refresh */
  }
  return publicUser(user);
}

export function getSessionUser() {
  try {
    const id = localStorage.getItem(SESSION_KEY);
    const user = id ? readUsers().find((u) => u.id === id) : null;
    return user ? publicUser(user) : null;
  } catch {
    return null;
  }
}

export function logOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}
