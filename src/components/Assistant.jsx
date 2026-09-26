import { useEffect, useRef, useState } from "react";
import { askBot, localAnswer } from "../lib/api.js";

const SUGGESTIONS = [
  "Explain my latest report",
  "What do the severity levels mean?",
  "How does a check work?",
];

// Web Speech API: works in Chrome, Edge and Safari. Not in Firefox.
const SpeechRecognition =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${counter++}`;

export function makeGreeting(displayName, role) {
  const text =
    role === "doctor"
      ? `Hello ${displayName}. Ask me about drug interactions, allergies, doses or how to read a report.`
      : `Hi ${displayName}! I can help you understand your medicine checks. Ask me anything about interactions, allergies or doses.`;
  return { id: nextId(), role: "assistant", content: text };
}

export default function Assistant({ user, report, messages, setMessages }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState("");
  const [speakOn, setSpeakOn] = useState(false);

  const recRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  useEffect(
    () => () => {
      recRef.current?.abort?.();
      if (canSpeak) window.speechSynthesis.cancel();
    },
    []
  );

  function speak(text) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-IN";
    window.speechSynthesis.speak(utter);
  }

  function toggleSpeak() {
    if (speakOn && canSpeak) window.speechSynthesis.cancel();
    setSpeakOn((v) => !v);
  }

  function toggleMic() {
    if (!SpeechRecognition) {
      setMicNote("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;

    const base = input.trim() ? `${input.trim()} ` : "";
    rec.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      setInput(base + heard);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setMicNote("Microphone access is blocked. Allow it in your browser's site settings, then try again.");
      } else if (e.error === "no-speech") {
        setMicNote("I didn't hear anything. Tap the microphone and try again.");
      } else {
        setMicNote("Voice input stopped. Please try again.");
      }
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    setMicNote("");
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  async function send(textArg) {
    const text = (textArg ?? input).trim();
    if (!text || loading) return;

    recRef.current?.stop?.();
    const userMsg = { id: nextId(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setMicNote("");
    setLoading(true);

    let reply;
    let basic = false;
    try {
      reply = await askBot({ messages: history, role: user.role, report });
    } catch {
      reply = localAnswer(text, { report });
      basic = true;
    }

    setMessages((m) => [...m, { id: nextId(), role: "assistant", content: reply, basic }]);
    setLoading(false);
    if (speakOn) speak(reply);
  }

  const onlyGreeting = messages.length <= 1;

  return (
    <div className="assistant-screen">
      <div className="assistant-bar">
        <div>
          <strong>MedSafe assistant</strong>
          <span>General information, not medical advice</span>
        </div>
        {canSpeak && (
          <button type="button" className={`speak-btn ${speakOn ? "on" : ""}`} aria-pressed={speakOn} onClick={toggleSpeak}>
            <span aria-hidden="true">{speakOn ? "🔊" : "🔈"}</span> Read aloud
          </button>
        )}
      </div>

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((m) => (
          <div key={m.id} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}`}>
              {m.content}
              {m.basic && <span className="basic-tag">Basic answer: AI service not connected</span>}
            </div>
          </div>
        ))}

        {onlyGreeting && !loading && (
          <div className="suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        {loading && (
          <div className="bubble-row assistant">
            <div className="bubble assistant typing" aria-label="Assistant is typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        <p className="mic-note" role="status" aria-live="polite">
          {listening ? "Listening… speak now" : micNote}
        </p>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button
            type="button"
            className={`mic-btn ${listening ? "on" : ""}`}
            onClick={toggleMic}
            aria-pressed={listening}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
          >
            🎤
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type or tap the mic and speak"
            aria-label="Message"
            autoComplete="off"
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || loading} aria-label="Send message">
            ➤
          </button>
        </form>
        <p className="emergency">In an emergency, call 112 or go to the nearest hospital.</p>
      </div>
    </div>
  );
}
