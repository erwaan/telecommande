import { ensureAuth } from "./firebase-init.js";
import { joinSession, listenSession, listenParticipant, castVote } from "./session-service.js";

const QUIZ_IDS = ["quiz-1", "quiz-2", "quiz-3"];
const STORAGE_KEY = "quizJoin";

const configs = {};
let uid = null;
let currentCode = null;
let unsubSession = null;
let unsubParticipant = null;
const myVotes = {}; // voteKey -> optionIndex (état local, optimiste)

async function boot() {
  let user;
  try {
    user = await ensureAuth();
  } catch (err) {
    document.body.innerHTML = `<div class="landing"><div class="card stack" style="max-width:480px"><h2>⚠️ Erreur de connexion</h2><p>Impossible de se connecter au serveur. Réessaie dans un instant ou préviens l'organisateur.</p></div></div>`;
    console.error(err);
    return;
  }
  uid = user.uid;

  await Promise.all(
    QUIZ_IDS.map(async (id) => {
      const res = await fetch(`config/${id}.json`);
      configs[id] = await res.json();
    })
  );

  const params = new URLSearchParams(window.location.search);
  const qCode = params.get("code");
  if (qCode) document.getElementById("code-input").value = qCode.toUpperCase();

  document.getElementById("join-btn").addEventListener("click", onJoin);
  document.getElementById("code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onJoin();
  });
  document.getElementById("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onJoin();
  });

  const stored = readStoredJoin();
  if (stored) {
    subscribe(stored.code, stored.name);
  }
}

function readStoredJoin() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredJoin(code, name) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, name }));
}

function clearStoredJoin() {
  localStorage.removeItem(STORAGE_KEY);
}

async function onJoin() {
  const code = document.getElementById("code-input").value.trim().toUpperCase();
  const name = document.getElementById("name-input").value.trim();
  const errorEl = document.getElementById("join-error");
  errorEl.classList.add("hidden");

  if (!code || !name) {
    errorEl.textContent = "Merci de remplir les deux champs.";
    errorEl.classList.remove("hidden");
    return;
  }

  const btn = document.getElementById("join-btn");
  btn.disabled = true;
  try {
    await joinSession(code, name, uid);
    saveStoredJoin(code, name);
    subscribe(code, name);
  } catch (e) {
    if (e.message === "SESSION_NOT_FOUND") {
      errorEl.textContent = "Code invalide ou session terminée.";
    } else if (e.message === "PARTICIPANT_EXCLUDED") {
      errorEl.textContent = "Tu as été exclu de cette session.";
    } else {
      errorEl.textContent = "Une erreur est survenue, réessaie.";
    }
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

function subscribe(code, name) {
  currentCode = code;
  document.getElementById("join-view").classList.add("hidden");
  document.getElementById("session-view").classList.remove("hidden");
  document.getElementById("name-badge").textContent = name;
  document.getElementById("code-badge").textContent = code;

  unsubSession = listenSession(code, (session) => {
    if (!session || session.status !== "active") {
      returnToJoin("La session est terminée.");
      return;
    }
    renderContent(session);
  });

  unsubParticipant = listenParticipant(code, uid, (participant) => {
    if (participant && participant.excluded) {
      returnToJoin("Tu as été exclu de cette session.");
    }
  });
}

function returnToJoin(message) {
  if (unsubSession) unsubSession();
  if (unsubParticipant) unsubParticipant();
  unsubSession = null;
  unsubParticipant = null;
  currentCode = null;
  clearStoredJoin();
  document.getElementById("session-view").classList.add("hidden");
  document.getElementById("join-view").classList.remove("hidden");
  const errorEl = document.getElementById("join-error");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function waitingScreen(emoji, text) {
  return `<div class="waiting-screen"><div class="emoji">${emoji}</div><p>${text}</p></div>`;
}

function renderContent(session) {
  const content = document.getElementById("content");

  if (!session.activeQuizId || session.phase === "waiting") {
    content.innerHTML = waitingScreen("⏳", "En attente du début du quiz...");
    return;
  }

  const config = configs[session.activeQuizId];

  if (session.phase === "round1-voting") {
    const pitch = config.round1.pitches[session.round1PitchIndex];
    const key = `${session.activeQuizId}-${session.activeRunId}-r1-${session.round1PitchIndex}`;
    renderVoteButtons(content, {
      title: pitch.title,
      text: pitch.pitch,
      options: config.round1.voteOptions.map((o) => o.label),
      voteKey: key,
      onVote: (i) => {
        castVote(currentCode, {
          quizId: session.activeQuizId,
          runId: session.activeRunId,
          round: 1,
          pitchId: pitch.id,
          participantId: uid,
          optionIndex: i,
          points: config.round1.voteOptions[i].points
        });
        myVotes[key] = i;
        renderContent(session);
      }
    });
    return;
  }

  if (session.phase === "round2-voting") {
    const pitchId = session.selectedPitchIds[session.round2PitchIndex];
    const pitch = config.round1.pitches.find((p) => p.id === pitchId);
    const options = pitch.presentationOptions;
    const key = `${session.activeQuizId}-${session.activeRunId}-r2-${session.round2PitchIndex}`;
    renderVoteButtons(content, {
      title: pitch.title,
      text: pitch.pitch,
      options,
      voteKey: key,
      onVote: (i) => {
        castVote(currentCode, {
          quizId: session.activeQuizId,
          runId: session.activeRunId,
          round: 2,
          pitchId,
          participantId: uid,
          optionIndex: i,
          points: null
        });
        myVotes[key] = i;
        renderContent(session);
      }
    });
    return;
  }

  if (session.phase === "quiz-done") {
    content.innerHTML = waitingScreen("🎉", "Quiz terminé ! Regarde l'écran pour le récapitulatif.");
    return;
  }

  // round1-final, round2-pitch-result : résultats révélés sur l'écran présentateur
  content.innerHTML = waitingScreen("🎭", "Résultats à l'écran !");
}

function renderVoteButtons(content, { title, text, options, voteKey, onVote }) {
  const selected = myVotes[voteKey];
  content.innerHTML = `
    <div class="stack">
      <h2 class="pitch-title">${escapeHtml(title)}</h2>
      <p class="pitch-text">${escapeHtml(text)}</p>
      <div class="vote-options">
        ${options
          .map(
            (label, i) =>
              `<button data-i="${i}" class="secondary${selected === i ? " selected" : ""}">${escapeHtml(label)}</button>`
          )
          .join("")}
      </div>
      ${selected !== undefined ? '<p class="muted center">Vote enregistré — tu peux le changer avant la fin du vote.</p>' : ""}
    </div>`;
  content.querySelectorAll("button[data-i]").forEach((btn) => {
    btn.addEventListener("click", () => onVote(Number(btn.dataset.i)));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

boot();
