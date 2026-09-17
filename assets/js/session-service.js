import { db } from "./firebase-init.js";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
  disableNetwork,
  enableNetwork
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I pour éviter les confusions

export function generateSessionCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

const META_DOC = doc(db, "meta", "activeSession");

export async function getActiveSessionCode() {
  const snap = await getDoc(META_DOC);
  return snap.exists() ? snap.data().code || null : null;
}

export async function createSession() {
  const code = generateSessionCode();
  const sessionRef = doc(db, "sessions", code);
  await setDoc(sessionRef, {
    status: "active",
    createdAt: serverTimestamp(),
    activeScreen: null,
    activeQuizId: null,
    quizzes: {}
  });
  await setDoc(META_DOC, { code });
  return code;
}

export async function endSession(code) {
  await updateDoc(doc(db, "sessions", code), { status: "ended" });
  const active = await getActiveSessionCode();
  if (active === code) {
    await setDoc(META_DOC, { code: null });
  }
}

export function listenSession(code, callback, onError) {
  return onSnapshot(
    doc(db, "sessions", code),
    (snap) => {
      callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    },
    onError
  );
}

// Force la réouverture du canal temps réel avec Firestore. Sur mobile, quand
// l'onglet passe en arrière-plan (écran verrouillé, changement d'appli), le
// navigateur peut couper la connexion sans que le SDK s'en aperçoive : les
// écouteurs restent alors muets jusqu'à un rechargement de la page. Couper puis
// rétablir le réseau oblige le SDK à rouvrir le canal et à resynchroniser tous
// les écouteurs actifs.
export async function reconnectRealtime() {
  await disableNetwork(db);
  await enableNetwork(db);
}

export async function updateSession(code, updates) {
  await updateDoc(doc(db, "sessions", code), updates);
}

export function listenParticipants(code, callback) {
  const q = query(
    collection(db, "sessions", code, "participants"),
    orderBy("joinedAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function joinSession(code, name, participantId) {
  const sessionRef = doc(db, "sessions", code);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists() || sessionSnap.data().status !== "active") {
    throw new Error("SESSION_NOT_FOUND");
  }
  const participantRef = doc(db, "sessions", code, "participants", participantId);
  const existing = await getDoc(participantRef);
  if (existing.exists() && existing.data().excluded) {
    throw new Error("PARTICIPANT_EXCLUDED");
  }
  if (!existing.exists()) {
    await setDoc(participantRef, {
      name,
      joinedAt: serverTimestamp(),
      excluded: false
    });
  }
  return participantId;
}

export function listenParticipant(code, participantId, callback, onError) {
  return onSnapshot(
    doc(db, "sessions", code, "participants", participantId),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError
  );
}

export async function excludeParticipant(code, participantId) {
  await updateDoc(doc(db, "sessions", code, "participants", participantId), {
    excluded: true
  });
}

function voteDocId(quizId, runId, round, pitchId, participantId) {
  return `${quizId}_${runId}_${round}_${pitchId}_${participantId}`;
}

// `runId` identifie un lancement de quiz : si le présentateur réinitialise puis
// relance le même quiz, les anciens votes (autre runId) ne sont plus jamais
// interrogés et ne polluent pas le nouveau décompte.
export async function castVote(code, { quizId, runId, round, pitchId, participantId, optionIndex, points }) {
  const voteRef = doc(
    db,
    "sessions",
    code,
    "votes",
    voteDocId(quizId, runId, round, pitchId, participantId)
  );
  await setDoc(voteRef, {
    quizId,
    runId,
    round,
    pitchId,
    participantId,
    optionIndex,
    points: points ?? null,
    createdAt: serverTimestamp()
  });
}

// Relit le vote déjà déposé par un participant pour un pitch donné (utile
// quand le présentateur revient en arrière : le téléphone réaffiche le choix
// précédent même si la page a été rechargée entre-temps).
export async function getMyVote(code, { quizId, runId, round, pitchId, participantId }) {
  const snap = await getDoc(
    doc(db, "sessions", code, "votes", voteDocId(quizId, runId, round, pitchId, participantId))
  );
  return snap.exists() ? snap.data() : null;
}

export function listenVotesForPitch(code, quizId, runId, round, pitchId, callback) {
  const q = query(
    collection(db, "sessions", code, "votes"),
    where("quizId", "==", quizId),
    where("runId", "==", runId),
    where("round", "==", round),
    where("pitchId", "==", pitchId)
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => d.data())));
}

// Lecture ponctuelle (pas d'abonnement) utilisée pour calculer un classement final
export async function getVotesForQuizRound(code, quizId, runId, round) {
  const q = query(
    collection(db, "sessions", code, "votes"),
    where("quizId", "==", quizId),
    where("runId", "==", runId),
    where("round", "==", round)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// ---------- Tirage au sort : inscription d'un participant ----------
// Attribue un numéro de ticket aléatoire entre 1 et 9999 de façon atomique via
// une transaction, pour éviter que deux téléphones se retrouvent avec le même
// numéro quand plusieurs s'inscrivent en même temps.
const TICKET_MAX = 9999;

export async function registerForDraw(code, participantId, avis, name) {
  const sessionRef = doc(db, "sessions", code);
  const participantRef = doc(db, "sessions", code, "participants", participantId);
  const ticketNumber = await runTransaction(db, async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    const draw = sessionSnap.exists() ? sessionSnap.data().draw : null;
    if (!draw || draw.status !== "registration") {
      throw new Error("REGISTRATION_CLOSED");
    }
    const usedNumbers = draw.usedNumbers || [];
    let number;
    do {
      number = 1 + Math.floor(Math.random() * TICKET_MAX);
    } while (usedNumbers.includes(number));
    tx.update(sessionRef, {
      "draw.count": (draw.count || 0) + 1,
      "draw.usedNumbers": [...usedNumbers, number]
    });
    tx.update(participantRef, {
      avis,
      drawRunId: draw.runId,
      ticketNumber: number
    });
    return number;
  });

  // Copie durable de l'avis, indépendante des sessions : écrite à part (pas
  // dans la transaction ci-dessus) pour qu'un souci sur cette copie (ex. règles
  // Firestore pas encore republiées) ne fasse jamais échouer l'inscription au
  // tirage elle-même, qui est ce qui compte pour le participant.
  try {
    await setDoc(doc(db, "feedback", `${code}_${participantId}`), {
      code,
      participantId,
      name: name || "?",
      avis,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("Copie durable de l'avis impossible (l'inscription au tirage est quand même validée) :", e);
  }

  return ticketNumber;
}

// ---------- Avis : consultation durable, indépendante des sessions ----------
export function listenAllFeedback(callback) {
  const q = query(collection(db, "feedback"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
