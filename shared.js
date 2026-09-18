// Shared between index.html (the gate) and board.html (the league itself).
// Loaded after firebase-config.js and the Firebase SDK scripts, before
// gate.js or app.js.

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const $ = id => document.getElementById(id);

const LS_JOIN_CODE = 'fermiLeague.joinCode';

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

// Checks a join code against the league's config doc. If the league doesn't
// exist yet at all, whoever is checking becomes its founding admin — this
// only ever fires once, for whoever opens the site first after deploy.
async function tryJoinCode(code, uid) {
  const trimmed = (code || '').trim().toUpperCase();
  if (!trimmed) return false;

  const metaRef = db.collection('meta').doc('league');
  const metaSnap = await metaRef.get();

  if (!metaSnap.exists) {
    await metaRef.set({
      joinCode: trimmed,
      adminUids: [uid],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  }

  const meta = metaSnap.data();
  return !!(meta.joinCode && meta.joinCode.toUpperCase() === trimmed);
}
