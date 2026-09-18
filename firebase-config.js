// Firebase project settings.
// (Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration)
//
// These values are NOT secret — they identify which Firebase project to talk to,
// not a password. It is normal and expected for them to be visible in this public
// JS file. Access control is enforced separately by firestore.rules.

const firebaseConfig = {
  apiKey: "AIzaSyA0OoiwrXy5Ly7SM7Roxp8nB3R_ObV5tbA",
  authDomain: "fermi-league.firebaseapp.com",
  projectId: "fermi-league",
  storageBucket: "fermi-league.firebasestorage.app",
  messagingSenderId: "236228239764",
  appId: "1:236228239764:web:e3d45651deda2de716af81"
};

// There's no single "initial" join code anymore — since multi-league support,
// a league is created on the fly whenever someone types a code that isn't
// already taken (see gate.js). Nothing to set here.
