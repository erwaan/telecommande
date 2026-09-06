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
  serverTimestamp
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
    activeQuizId: null,
    activeRunId: null,
    phase: "waiting",
    round1PitchIndex: 0,
    round1Results: null,
    selectedPitchIds: [],
    round2PitchIndex: 0,
    round2Results: null
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

export function listenSession(code, callback) {
  return onSnapshot(doc(db, "sessions", code), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
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

export function listenParticipant(code, participantId, callback) {
  return onSnapshot(
    doc(db, "sessions", code, "participants", participantId),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null)
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
