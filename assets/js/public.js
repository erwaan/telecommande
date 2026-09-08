import { ensureAuth } from "./firebase-init.js";
import { joinSession, listenSession, listenParticipant, castVote } from "./session-service.js";
import { loadQuizConfigs } from "./quiz-config.js";

const STORAGE_KEY = "quizJoin";

const configs = {};
let uid = null;
let currentCode = null;
let unsubSession = null;
let unsubParticipant = null;
const myVotes = {}; // voteKey -> optionIndex (état local, optimiste)
let celebratedRunId = null; // runId du tirage déjà fêté, pour ne pas relancer les confettis en boucle

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

  const { configs: loadedConfigs } = await loadQuizConfigs("config/");
  Object.assign(configs, loadedConfigs);

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
    renderTicket(session);
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

  const quizId = session.activeQuizId;
  const quizState = quizId && session.quizzes ? session.quizzes[quizId] : null;

  if (!quizId || !quizState || !quizState.phase || quizState.phase === "waiting") {
    content.innerHTML = waitingScreen("⏳", "En attente du début du quiz...");
    return;
  }

  const config = configs[quizId];

  if (quizState.phase === "round1-voting") {
    const pitch = config.round1.pitches[quizState.round1PitchIndex];
    const key = `${quizId}-${quizState.activeRunId}-r1-${quizState.round1PitchIndex}`;
    renderVoteButtons(content, {
      title: pitch.title,
      text: pitch.pitch,
      options: config.round1.voteOptions.map((o) => o.label),
      voteKey: key,
      onVote: (i) => {
        castVote(currentCode, {
          quizId,
          runId: quizState.activeRunId,
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

  if (quizState.phase === "round2-voting") {
    const pitchId = quizState.selectedPitchIds[quizState.round2PitchIndex];
    const pitch = config.round1.pitches.find((p) => p.id === pitchId);
    const options = pitch.presentationOptions;
    const key = `${quizId}-${quizState.activeRunId}-r2-${quizState.round2PitchIndex}`;
    renderVoteButtons(content, {
      title: pitch.title,
      text: pitch.pitch,
      options,
      voteKey: key,
      onVote: (i) => {
        castVote(currentCode, {
          quizId,
          runId: quizState.activeRunId,
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

  if (quizState.phase === "quiz-done") {
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

// ---------- Ticket de tombola / tirage au sort ----------
function renderTicket(session) {
  const badge = document.getElementById("ticket-badge");
  const draw = session.draw;
  const myNumber = draw && draw.tickets ? draw.tickets[uid] : null;

  if (myNumber == null) {
    badge.classList.add("hidden");
    return;
  }
  badge.classList.remove("hidden");
  document.getElementById("ticket-number").textContent = `N° ${String(myNumber).padStart(3, "0")}`;

  if (draw.status === "revealed" && draw.winnerId === uid && celebratedRunId !== draw.runId) {
    celebratedRunId = draw.runId;
    celebrateWin();
  }
}

function celebrateWin() {
  const overlay = document.getElementById("winner-overlay");
  overlay.classList.remove("hidden");
  spawnConfetti();
  setTimeout(() => overlay.classList.add("hidden"), 6000);
}

function spawnConfetti() {
  const container = document.getElementById("confetti-container");
  container.innerHTML = "";
  const colors = [
    "var(--color-magenta)",
    "var(--color-purple)",
    "var(--color-orange)",
    "var(--color-yellow)",
    "var(--color-pink-pale)"
  ];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    container.appendChild(piece);
  }
}

boot();
