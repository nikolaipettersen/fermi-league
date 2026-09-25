// Shared between index.html (the gate) and board.html (any league's board).
// Loaded after firebase-config.js and the Firebase SDK scripts, before
// gate.js or app.js.

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const $ = id => document.getElementById(id);

// The very first league this project shipped with lives at the database
// root (collections players/, scores/, and meta/league for its code and
// admins) rather than under leagues/{id} like every league created after
// multi-league support was added. Kept exactly as-is so existing history
// isn't disturbed. LEGACY_LEAGUE_ID is just a local sentinel string, never
// written to the database.
const LEGACY_LEAGUE_ID = '__legacy__';

const LS_ACTIVE_LEAGUE = 'fermiLeague.activeLeague';
const LS_JOINED_LEAGUES = 'fermiLeague.joinedLeagues'; // [{id, label}, ...]

/* ---------------- Auth ---------------- */

// Resolves once we have a signed-in (anonymous) user. Firebase persists this
// per-browser, so returning visitors get the same id without seeing anything.
function waitForAuth() {
  return new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) { unsub(); resolve(user); }
    }, reject);
  });
}
async function ensureSignedIn() {
  await auth.signInAnonymously();
  return waitForAuth();
}

/* ---------------- Locally-remembered leagues (per browser) ---------------- */
// Which leagues has this browser joined, and what does this person privately
// call each one? Purely a local convenience — nothing here is shared or
// synced, so two people can label the same league differently.

function getJoinedLeagues() {
  try { return JSON.parse(localStorage.getItem(LS_JOINED_LEAGUES)) || []; }
  catch (e) { return []; }
}
function saveJoinedLeagues(list) { localStorage.setItem(LS_JOINED_LEAGUES, JSON.stringify(list)); }
function rememberLeague(id, label) {
  const list = getJoinedLeagues();
  const existing = list.find(l => l.id === id);
  if (existing) { if (label) existing.label = label; }
  else { list.push({ id, label: label || id }); }
  saveJoinedLeagues(list);
}
function forgetLeague(id) {
  saveJoinedLeagues(getJoinedLeagues().filter(l => l.id !== id));
}
function getActiveLeague() { return localStorage.getItem(LS_ACTIVE_LEAGUE); }
function setActiveLeague(id) { localStorage.setItem(LS_ACTIVE_LEAGUE, id); }

// Which player identity does THIS browser play as, within a given league?
// Normally this is just the browser's own auth uid. After a merge (see
// app.js), it's the uid of the player they merged into, so the device
// keeps landing on that identity without going through name entry again.
const LS_PLAYER_ID_PREFIX = 'fermiLeague.playerId.';
function getStoredPlayerId(leagueId) { return localStorage.getItem(LS_PLAYER_ID_PREFIX + leagueId); }
function setStoredPlayerId(leagueId, pid) { localStorage.setItem(LS_PLAYER_ID_PREFIX + leagueId, pid); }

/* ---------------- Join codes ---------------- */

// Firestore doc ids can't contain most punctuation, so a league's id is its
// join code, stripped down to letters and numbers. That also means "does a
// league with this code exist" and "does this document exist" are the same
// question — no separate stored code field needed for leagues created this
// way (unlike the legacy league, which predates this and keeps its own
// stored joinCode field).
function sanitizeCode(raw) {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function checkLegacyCode(rawCode) {
  const trimmed = (rawCode || '').trim().toUpperCase();
  if (!trimmed) return false;
  const snap = await db.collection('meta').doc('league').get();
  if (!snap.exists) return false;
  const meta = snap.data();
  return !!(meta.joinCode && meta.joinCode.toUpperCase() === trimmed);
}
async function legacyStillValid() {
  const snap = await db.collection('meta').doc('league').get();
  return snap.exists;
}
async function legacyAdmins() {
  const snap = await db.collection('meta').doc('league').get();
  return snap.exists ? (snap.data().adminUids || []) : [];
}

async function leagueExists(id) {
  if (!id) return false;
  const snap = await db.collection('leagues').doc(id).get();
  return snap.exists;
}
async function createLeague(id, uid) {
  await db.collection('leagues').doc(id).set({
    adminUids: [uid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function leagueAdmins(id) {
  const snap = await db.collection('leagues').doc(id).get();
  return snap.exists ? (snap.data().adminUids || []) : [];
}

/* ---------------- League display name (shared, admin-editable) ---------------- */
// Separate from the local per-browser label in LS_JOINED_LEAGUES: this is
// the name everyone in the league sees, stored server-side.

async function leagueDisplayName(leagueId) {
  const ref = leagueId === LEGACY_LEAGUE_ID ? db.collection('meta').doc('league') : db.collection('leagues').doc(leagueId);
  const snap = await ref.get();
  return snap.exists ? (snap.data().name || null) : null;
}
async function renameLeague(leagueId, name) {
  const trimmed = (name || '').trim().slice(0, 40);
  if (!trimmed) return;
  const ref = leagueId === LEGACY_LEAGUE_ID ? db.collection('meta').doc('league') : db.collection('leagues').doc(leagueId);
  await ref.set({ name: trimmed }, { merge: true });
}

/* ---------------- Dispatch: legacy league vs. a leagues/{id} league ---------------- */

function collectionsFor(leagueId) {
  if (leagueId === LEGACY_LEAGUE_ID) {
    return { players: db.collection('players'), scores: db.collection('scores') };
  }
  const ref = db.collection('leagues').doc(leagueId);
  return { players: ref.collection('players'), scores: ref.collection('scores') };
}
async function adminsFor(leagueId) {
  return leagueId === LEGACY_LEAGUE_ID ? legacyAdmins() : leagueAdmins(leagueId);
}
async function leagueStillValid(leagueId) {
  return leagueId === LEGACY_LEAGUE_ID ? legacyStillValid() : leagueExists(leagueId);
}
