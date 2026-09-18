// Fill these in from your Firebase project settings
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


// The join code people need to type to get into the league.
// This is a SOFT lock only — it keeps out randoms who stumble on the link,
// it does not stop someone who reads this file's source. Don't use it to
// protect anything truly sensitive. Change this before sharing the link.
const INITIAL_JOIN_CODE = "ARTBIO";
