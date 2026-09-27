# MedSafe frontend

```bash
npm install
npm run dev        # opens http://localhost:5173
```

Backend address (optional): create `.env` with

```
VITE_API_URL=http://localhost:8000
```

Files
- `src/App.jsx`                 app shell, home, check, results, history
- `src/components/Onboarding.jsx`  doctor/patient choice + log in / sign up
- `src/components/Assistant.jsx`   AI chat with microphone
- `src/lib/api.js`             calls to /check and /chat, demo fallback
- `src/lib/auth.js`            demo accounts stored in the browser
- `src/App.css`                white + blue theme, fixed phone frame

Frame size: change `width`/`height` in `.phone` in `App.css`.
Colours: change the variables at the top of `App.css`.

## 🚀 Live Demo

Try the deployed MedSafe application:

**[Open MedSafe →](https://medsafe-6e1o.onrender.com)**

> MedSafe is a prototype medication-safety support tool designed to flag potential medication errors, allergies, drug interactions, drug-disease conflicts, and dosage-related concerns for clinician review.
