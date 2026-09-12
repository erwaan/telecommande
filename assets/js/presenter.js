import { ensureAuth } from "./firebase-init.js";
import { PRESENTER_PIN } from "./firebase-config.js";
import {
  createSession,
  endSession,
  getActiveSessionCode,
  listenSession,
  updateSession,
  listenParticipants,
  excludeParticipant,
  listenVotesForPitch,
  getVotesForQuizRound,
  generateSessionCode
} from "./session-service.js";
import { loadQuizConfigs } from "./quiz-config.js";

let QUIZ_IDS = [];

let currentCode = null;
let currentSession = null;
let participants = [];
const configs = {};
const voteData = {}; // quizId -> { key, round, pitchId, votes }
const voteUnsub = {}; // quizId -> unsubscribe fn
let unsubSession = null;
let unsubParticipants = null;
let activeDrawRunId = null; // runId dont l'animation de tirage est déjà lancée localement

// ---------- Confirm modal ----------
function confirmModal(message) {
  const overlay = document.getElementById("confirm-modal");
  const okBtn = document.getElementById("confirm-modal-ok");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  document.getElementById("confirm-modal-message").textContent = message;
  overlay.classList.remove("hidden");

  return new Promise((resolve) => {
    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlayClick(e) { if (e.target === overlay) cleanup(false); }
    function onKeydown(e) { if (e.key === "Escape") cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

// ---------- PIN gate ----------
function initPinGate() {
  const gate = document.getElementById("pin-gate");
  const app = document.getElementById("app");
  if (sessionStorage.getItem("presenterPinOk") === "1") {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    boot();
    return;
  }
  document.getElementById("pin-submit").addEventListener("click", submit);
  document.getElementById("pin-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  function submit() {
    const val = document.getElementById("pin-input").value;
    if (val === PRESENTER_PIN) {
      sessionStorage.setItem("presenterPinOk", "1");
      gate.classList.add("hidden");
      app.classList.remove("hidden");
      boot();
    } else {
      document.getElementById("pin-error").classList.remove("hidden");
    }
  }
}

// ---------- Boot ----------
async function boot() {
  try {
    await ensureAuth();
  } catch (err) {
    showFatalError(
      "Impossible de se connecter à Firebase. Vérifie que assets/js/firebase-config.js contient bien la configuration de ton projet Firebase et que l'authentification anonyme est activée.",
      err
    );
    return;
  }

  const { ids, configs: loadedConfigs } = await loadQuizConfigs("../config/");
  QUIZ_IDS = ids;
  Object.assign(configs, loadedConfigs);

  buildQuizDom();
  initViews();
  document.getElementById("create-session-btn").addEventListener("click", onCreateSession);
  document.getElementById("end-session-btn").addEventListener("click", onEndSession);
  document.getElementById("regen-session-btn").addEventListener("click", onRegenSession);

  const activeCode = await getActiveSessionCode();
  if (activeCode) attach(activeCode);
  else renderAll();
}

function showFatalError(message, err) {
  const app = document.getElementById("app");
  app.classList.remove("hidden");
  app.innerHTML = `<div class="landing"><div class="card stack" style="max-width:480px"><h2>⚠️ Erreur de configuration</h2><p>${message}</p>${err ? `<p class="muted">${escapeHtml(err.message || String(err))}</p>` : ""}</div></div>`;
}

// ---------- Views (accueil / session / quiz dynamiques) ----------
function buildQuizDom() {
  const grid = document.getElementById("home-quiz-grid");
  const container = document.getElementById("quiz-views-container");
  grid.innerHTML = QUIZ_IDS.map(
    (quizId) => `
      <button class="quiz-home-btn" data-quiz="${quizId}">
        <span class="quiz-home-title">${escapeHtml(configs[quizId].name)}</span>
        <span class="quiz-home-status muted" data-status="${quizId}">Non commencé</span>
      </button>`
  ).join("");
  container.innerHTML = QUIZ_IDS.map(
    (quizId) => `
      <section id="view-${quizId}" class="view stage-view" data-quiz-id="${quizId}">
        <div id="tab-${quizId}"></div>
      </section>`
  ).join("");
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.getElementById("app").classList.toggle("stage-mode", QUIZ_IDS.includes(name) || name === "draw");
  document.getElementById("home-nav-btn").classList.toggle("hidden", name === "home");
}

function initViews() {
  document.getElementById("home-nav-btn").addEventListener("click", () => showView("home"));
  document.getElementById("session-mgmt-btn").addEventListener("click", () => showView("session"));
  document.getElementById("gift-btn").addEventListener("click", () => launchDraw());
  document.querySelectorAll(".quiz-home-btn").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.quiz));
  });
}

// ---------- Session lifecycle ----------
async function onCreateSession() {
  const code = await createSession();
  attach(code);
}

async function onEndSession() {
  if (!currentCode) return;
  if (!(await confirmModal("Terminer la session en cours ?"))) return;
  await endSession(currentCode);
  detach();
  renderAll();
}

async function onRegenSession() {
  if (!currentCode) return;
  if (!(await confirmModal("Terminer la session actuelle et en générer une nouvelle ?"))) return;
  const old = currentCode;
  await endSession(old);
  const code = await createSession();
  attach(code);
}

function attach(code) {
  detach();
  currentCode = code;
  renderQrCode(code);
  unsubSession = listenSession(code, (session) => {
    currentSession = session;
    renderAll();
  });
  unsubParticipants = listenParticipants(code, (list) => {
    participants = list;
    renderParticipants();
    if (currentSession && currentSession.activeQuizId) {
      renderQuizPanel(currentSession.activeQuizId);
    }
  });
}

function detach() {
  if (unsubSession) unsubSession();
  if (unsubParticipants) unsubParticipants();
  Object.values(voteUnsub).forEach((fn) => fn && fn());
  Object.keys(voteUnsub).forEach((k) => delete voteUnsub[k]);
  Object.keys(voteData).forEach((k) => delete voteData[k]);
  currentCode = null;
  currentSession = null;
  participants = [];
}

function renderQrCode(code) {
  const container = document.getElementById("qrcode-container");
  container.innerHTML = "";
  const publicUrl = new URL(`../index.html?code=${code}`, window.location.href).href;
  // eslint-disable-next-line no-undef
  new QRCode(container, { text: publicUrl, width: 180, height: 180 });
  document.getElementById("session-code-text").textContent = code;
}

// ---------- Render: SESSION tab ----------
function renderAll() {
  const badge = document.getElementById("session-status-badge");
  const noSessionView = document.getElementById("no-session-view");
  const sessionView = document.getElementById("session-view");

  if (!currentSession || currentSession.status !== "active") {
    badge.textContent = "Aucune session";
    noSessionView.classList.remove("hidden");
    sessionView.classList.add("hidden");
  } else {
    badge.textContent = `Code de session : ${currentSession.id}`;
    noSessionView.classList.add("hidden");
    sessionView.classList.remove("hidden");
  }

  renderParticipants();
  renderHome();
  renderDraw();
  QUIZ_IDS.forEach((quizId) => {
    manageVoteListener(quizId);
    renderQuizPanel(quizId);
  });
}

function renderHome() {
  QUIZ_IDS.forEach((quizId) => {
    const statusEl = document.querySelector(`[data-status="${quizId}"]`);
    if (!statusEl) return;
    statusEl.textContent = quizStatusLabel(quizId);
  });
}

function quizStatusLabel(quizId) {
  const quizState = currentSession && currentSession.quizzes && currentSession.quizzes[quizId];
  if (!quizState || !quizState.phase || quizState.phase === "waiting") return "Non commencé";
  const pausedTag = currentSession.activeQuizId === quizId ? "" : " (en pause)";
  switch (quizState.phase) {
    case "round1-voting":
      return `En cours — manche 1 (${quizState.round1PitchIndex + 1}/${configs[quizId].round1.pitches.length})${pausedTag}`;
    case "round1-final":
      return `En cours — classement manche 1${pausedTag}`;
    case "round2-voting":
    case "round2-pitch-result":
      return `En cours — manche 2 (${quizState.round2PitchIndex + 1}/${quizState.selectedPitchIds.length})${pausedTag}`;
    case "quiz-done":
      return "Terminé";
    default:
      return `En cours${pausedTag}`;
  }
}

function renderParticipants() {
  const list = document.getElementById("participant-list");
  const countBadge = document.getElementById("participant-count");
  const active = participants.filter((p) => !p.excluded);
  countBadge.textContent = String(active.length);
  list.innerHTML = "";
  participants.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    if (p.excluded) li.classList.add("excluded");
    li.title = "Double-clic pour exclure";
    li.addEventListener("dblclick", async () => {
      if (p.excluded) return;
      if (!(await confirmModal(`Exclure ${p.name} de la session ?`))) return;
      await excludeParticipant(currentCode, p.id);
    });
    list.appendChild(li);
  });
}

// ---------- Vote listener management ----------
function computeListenerSpec(quizId, session) {
  if (!session || session.activeQuizId !== quizId) return null;
  const quizState = session.quizzes && session.quizzes[quizId];
  if (!quizState) return null;
  if (quizState.phase === "round1-voting") {
    const pitch = configs[quizId].round1.pitches[quizState.round1PitchIndex];
    if (!pitch) return null;
    return { key: `${quizState.activeRunId}-r1-${quizState.round1PitchIndex}`, round: 1, pitchId: pitch.id, runId: quizState.activeRunId };
  }
  if (quizState.phase === "round2-voting" || quizState.phase === "round2-pitch-result") {
    const pitchId = quizState.selectedPitchIds[quizState.round2PitchIndex];
    if (!pitchId) return null;
    return { key: `${quizState.activeRunId}-r2-${quizState.round2PitchIndex}`, round: 2, pitchId, runId: quizState.activeRunId };
  }
  return null;
}

function manageVoteListener(quizId) {
  const spec = computeListenerSpec(quizId, currentSession);
  const existingKey = voteData[quizId] ? voteData[quizId].key : null;
  const desiredKey = spec ? spec.key : null;
  if (existingKey === desiredKey) return;

  if (voteUnsub[quizId]) {
    voteUnsub[quizId]();
    delete voteUnsub[quizId];
  }
  if (!spec) {
    delete voteData[quizId];
    return;
  }
  voteData[quizId] = { key: spec.key, round: spec.round, pitchId: spec.pitchId, votes: [] };
  voteUnsub[quizId] = listenVotesForPitch(currentCode, quizId, spec.runId, spec.round, spec.pitchId, (votes) => {
    voteData[quizId] = { key: spec.key, round: spec.round, pitchId: spec.pitchId, votes };
    renderQuizPanel(quizId);
  });
}

// ---------- Render: QUIZ tabs ----------
function renderQuizPanel(quizId) {
  const el = document.getElementById(`tab-${quizId}`);
  const config = configs[quizId];
  if (!el || !config) return;

  if (!currentSession || currentSession.status !== "active") {
    el.innerHTML = `<div class="card center"><p class="muted">Crée une session dans l'onglet SESSION pour démarrer ${config.name}.</p></div>`;
    return;
  }

  const quizState = currentSession.quizzes && currentSession.quizzes[quizId];

  if (!quizState || !quizState.phase || quizState.phase === "waiting") {
    el.innerHTML = `
      <div class="card center stack" style="max-width:480px;margin:0 auto">
        <h2>${config.name}</h2>
        <p class="muted">${config.round1.pitches.length} pitchs — les ${config.round1.selectCount} meilleurs passent en manche 2</p>
        <button id="start-${quizId}">Démarrer cette partie</button>
      </div>`;
    document.getElementById(`start-${quizId}`).addEventListener("click", () => startQuiz(quizId));
    return;
  }

  if (currentSession.activeQuizId !== quizId) {
    el.innerHTML = `
      <div class="card center stack" style="max-width:480px;margin:0 auto">
        <h2>${config.name}</h2>
        <p class="muted">${quizStatusLabel(quizId)}</p>
        <p class="muted">Cette partie est en pause — une autre partie est affichée en ce moment.</p>
        <button id="resume-${quizId}">Reprendre cette partie</button>
      </div>`;
    document.getElementById(`resume-${quizId}`).addEventListener("click", () => resumeQuiz(quizId));
    return;
  }

  const votes = voteData[quizId] ? voteData[quizId].votes : [];

  if (quizState.phase === "round1-voting") {
    const pitch = config.round1.pitches[quizState.round1PitchIndex];
    const isLast = quizState.round1PitchIndex === config.round1.pitches.length - 1;
    const total = votes.length;

    el.innerHTML = `
      <div class="card stack" style="max-width:1100px">
        <span class="badge">Manche 1 — Pitch ${quizState.round1PitchIndex + 1}/${config.round1.pitches.length}</span>
        <h2 class="pitch-title">${escapeHtml(pitch.title)}</h2>
        <p class="pitch-text">${escapeHtml(pitch.pitch)}</p>
        <p class="muted">${total} vote${total > 1 ? "s" : ""} reçu${total > 1 ? "s" : ""} — ${participants.filter((p) => !p.excluded).length} inscrits</p>
        <div class="row" style="justify-content:center">
          <button id="next-r1">${isLast ? "Voir le classement" : "Pitch suivant"}</button>
        </div>
      </div>`;

    document.getElementById("next-r1").addEventListener("click", () => nextRound1Pitch(quizId));
    return;
  }

  if (quizState.phase === "round1-final") {
    const ranking = (quizState.round1Results || []).filter((r) => quizState.selectedPitchIds.includes(r.pitchId));
    el.innerHTML = `
      <div class="card stack" style="max-width:640px">
        <span class="badge">Manche 1 — Classement final</span>
        <h2>Top ${config.round1.selectCount} pièces retenues</h2>
        <ul class="ranking-list">
          ${ranking
            .map(
              (r, i) => `<li class="selected"><span>#${i + 1} ${escapeHtml(r.title)}</span><span>${r.points} pts</span></li>`
            )
            .join("")}
        </ul>
        <div class="row" style="justify-content:center">
          <button id="start-r2">Démarrer la manche 2</button>
        </div>
      </div>`;
    document.getElementById("start-r2").addEventListener("click", () => startRound2(quizId));
    return;
  }

  if (quizState.phase === "round2-voting" || quizState.phase === "round2-pitch-result") {
    const pitchId = quizState.selectedPitchIds[quizState.round2PitchIndex];
    const pitch = config.round1.pitches.find((p) => p.id === pitchId);
    const options = pitch.presentationOptions;
    const isLast = quizState.round2PitchIndex === quizState.selectedPitchIds.length - 1;
    const counts = options.map((_, i) => votes.filter((v) => v.optionIndex === i).length);
    const total = votes.length;

    el.innerHTML = `
      <div class="card stack" style="max-width:1100px">
        <span class="badge">Manche 2 — Pièce ${quizState.round2PitchIndex + 1}/${quizState.selectedPitchIds.length}</span>
        <h2 class="pitch-title">${escapeHtml(pitch.title)}</h2>
        <p class="pitch-text">${escapeHtml(pitch.pitch)}</p>
        <p class="muted">${total} vote${total > 1 ? "s" : ""} reçu${total > 1 ? "s" : ""}</p>
        <div class="results-bars">
          ${options
            .map(
              (opt, i) => `
            <div class="result-row">
              <div class="result-label"><span>${escapeHtml(opt)}</span><span>${counts[i]}</span></div>
              <div class="progress-bar"><span style="width:${total ? (counts[i] / total) * 100 : 0}%"></span></div>
            </div>`
            )
            .join("")}
        </div>
        <div class="row" style="justify-content:center">
          ${
            quizState.phase === "round2-voting"
              ? `<button id="lock-r2">Verrouiller et voir le résultat</button>`
              : `<button id="next-r2">${isLast ? "Terminer la partie" : "Pièce suivante"}</button>`
          }
        </div>
      </div>`;

    if (quizState.phase === "round2-voting") {
      document.getElementById("lock-r2").addEventListener("click", () => lockRound2Pitch(quizId));
    } else {
      document.getElementById("next-r2").addEventListener("click", () => nextRound2Pitch(quizId));
    }
    return;
  }

  if (quizState.phase === "quiz-done") {
    const results = quizState.round2Results || [];
    el.innerHTML = `
      <div class="card stack" style="max-width:640px;margin:0 auto">
        <span class="badge">Partie terminée</span>
        <h2>Récapitulatif</h2>
        <ul class="ranking-list">
          ${results
            .map(
              (r) => `<li><span>${escapeHtml(r.title)}</span><span>${escapeHtml(r.options[r.winningOptionIndex])}</span></li>`
            )
            .join("")}
        </ul>
        <div class="row" style="justify-content:center">
          <button class="secondary" id="reset-quiz">Réinitialiser cette partie</button>
        </div>
      </div>`;
    document.getElementById("reset-quiz").addEventListener("click", () => resetQuiz(quizId));
    return;
  }

  el.innerHTML = `<div class="card"><p class="muted">État inconnu.</p></div>`;
}

// ---------- State transitions ----------
async function startQuiz(quizId) {
  await updateSession(currentCode, {
    activeQuizId: quizId,
    [`quizzes.${quizId}`]: {
      activeRunId: generateSessionCode(8),
      phase: "round1-voting",
      round1PitchIndex: 0,
      round1Results: null,
      selectedPitchIds: [],
      round2PitchIndex: 0,
      round2Results: null
    }
  });
}

async function resumeQuiz(quizId) {
  await updateSession(currentCode, { activeQuizId: quizId });
}

async function nextRound1Pitch(quizId) {
  const config = configs[quizId];
  const quizState = currentSession.quizzes[quizId];
  const nextIndex = quizState.round1PitchIndex + 1;
  if (nextIndex < config.round1.pitches.length) {
    await updateSession(currentCode, {
      [`quizzes.${quizId}.phase`]: "round1-voting",
      [`quizzes.${quizId}.round1PitchIndex`]: nextIndex
    });
    return;
  }
  const votes = await getVotesForQuizRound(currentCode, quizId, quizState.activeRunId, 1);
  const totals = {};
  config.round1.pitches.forEach((p) => (totals[p.id] = 0));
  votes.forEach((v) => {
    totals[v.pitchId] = (totals[v.pitchId] || 0) + (v.points || 0);
  });
  const ranking = config.round1.pitches
    .map((p) => ({ pitchId: p.id, title: p.title, points: totals[p.id] || 0 }))
    .sort((a, b) => b.points - a.points);
  const selectedPitchIds = ranking.slice(0, config.round1.selectCount).map((r) => r.pitchId);
  await updateSession(currentCode, {
    [`quizzes.${quizId}.phase`]: "round1-final",
    [`quizzes.${quizId}.round1Results`]: ranking,
    [`quizzes.${quizId}.selectedPitchIds`]: selectedPitchIds
  });
}

async function startRound2(quizId) {
  await updateSession(currentCode, {
    [`quizzes.${quizId}.phase`]: "round2-voting",
    [`quizzes.${quizId}.round2PitchIndex`]: 0
  });
}

async function lockRound2Pitch(quizId) {
  await updateSession(currentCode, { [`quizzes.${quizId}.phase`]: "round2-pitch-result" });
}

async function nextRound2Pitch(quizId) {
  const config = configs[quizId];
  const quizState = currentSession.quizzes[quizId];
  const nextIndex = quizState.round2PitchIndex + 1;
  if (nextIndex < quizState.selectedPitchIds.length) {
    await updateSession(currentCode, {
      [`quizzes.${quizId}.phase`]: "round2-voting",
      [`quizzes.${quizId}.round2PitchIndex`]: nextIndex
    });
    return;
  }
  const votes = await getVotesForQuizRound(currentCode, quizId, quizState.activeRunId, 2);
  const results = quizState.selectedPitchIds.map((pitchId) => {
    const pitch = config.round1.pitches.find((p) => p.id === pitchId);
    const options = pitch.presentationOptions;
    const counts = options.map(
      (_, i) => votes.filter((v) => v.pitchId === pitchId && v.optionIndex === i).length
    );
    let winningOptionIndex = 0;
    counts.forEach((c, i) => {
      if (c > counts[winningOptionIndex]) winningOptionIndex = i;
    });
    return { pitchId, title: pitch.title, options, counts, winningOptionIndex };
  });
  await updateSession(currentCode, {
    [`quizzes.${quizId}.phase`]: "quiz-done",
    [`quizzes.${quizId}.round2Results`]: results
  });
}

async function resetQuiz(quizId) {
  const updates = {
    [`quizzes.${quizId}`]: {
      activeRunId: null,
      phase: "waiting",
      round1PitchIndex: 0,
      round1Results: null,
      selectedPitchIds: [],
      round2PitchIndex: 0,
      round2Results: null
    }
  };
  if (currentSession.activeQuizId === quizId) {
    updates.activeQuizId = null;
  }
  await updateSession(currentCode, updates);
}

// ---------- Tirage au sort ----------
async function launchDraw() {
  const eligible = participants.filter((p) => !p.excluded);
  showView("draw");
  const el = document.getElementById("draw-content");

  if (eligible.length === 0) {
    activeDrawRunId = null;
    el.innerHTML = `<div class="card center"><p class="muted">Aucun participant inscrit pour l'instant.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="draw-stage">
      <span class="badge">Tirage au sort</span>
      <div class="draw-number">•••</div>
      <p class="muted">Préparation du tirage...</p>
    </div>`;

  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const tickets = {};
  shuffled.forEach((p, i) => {
    tickets[p.id] = i + 1;
  });

  await updateSession(currentCode, {
    draw: { runId: generateSessionCode(8), status: "drawing", tickets, winnerId: null }
  });
}

function renderDraw() {
  const el = document.getElementById("draw-content");
  if (!el) return;
  const draw = currentSession && currentSession.draw;

  if (!draw) {
    activeDrawRunId = null;
    el.innerHTML = `<div class="card center"><p class="muted">Aucun tirage pour l'instant — clique sur 🎁 depuis l'accueil.</p></div>`;
    return;
  }

  if (draw.status === "revealed") {
    activeDrawRunId = draw.runId;
    const winner = participants.find((p) => p.id === draw.winnerId);
    el.innerHTML = `
      <div class="draw-stage">
        <span class="badge">Tirage au sort</span>
        <div class="draw-number draw-number-landed">${formatTicket(draw.tickets[draw.winnerId])}</div>
        <div class="draw-winner-name">🎉 ${escapeHtml(winner ? winner.name : "?")} 🎉</div>
      </div>`;
    return;
  }

  if (activeDrawRunId === draw.runId) return;
  activeDrawRunId = draw.runId;
  startDrawAnimation(draw);
}

function formatTicket(n) {
  return `N° ${String(n).padStart(3, "0")}`;
}

function startDrawAnimation(draw) {
  const el = document.getElementById("draw-content");
  const ids = Object.keys(draw.tickets);
  const numbers = Object.values(draw.tickets);
  const winnerId = ids[Math.floor(Math.random() * ids.length)];
  const winningNumber = draw.tickets[winnerId];

  el.innerHTML = `
    <div class="draw-stage">
      <span class="badge">Tirage au sort</span>
      <div class="draw-number" id="draw-number">${formatTicket(numbers[0])}</div>
      <p class="muted" id="draw-status">Mélange des tickets...</p>
    </div>`;

  const numberEl = document.getElementById("draw-number");
  const statusEl = document.getElementById("draw-status");
  const start = Date.now();
  const totalDuration = 2800;

  function tick() {
    if (activeDrawRunId !== draw.runId) return;
    const elapsed = Date.now() - start;
    if (elapsed >= totalDuration) {
      numberEl.textContent = formatTicket(winningNumber);
      numberEl.classList.add("draw-number-landed");
      statusEl.textContent = "Et le/la gagnant·e est...";
      setTimeout(() => {
        if (activeDrawRunId !== draw.runId) return;
        updateSession(currentCode, {
          "draw.status": "revealed",
          "draw.winnerId": winnerId
        });
      }, 2200);
      return;
    }
    numberEl.textContent = formatTicket(numbers[Math.floor(Math.random() * numbers.length)]);
    const delay = 60 + (elapsed / totalDuration) * 220;
    setTimeout(tick, delay);
  }
  tick();
}

// ---------- Utils ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

initPinGate();
