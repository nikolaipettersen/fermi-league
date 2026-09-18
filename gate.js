// Logic for index.html only. On success, sends the browser to board.html —
// a real page navigation, not just swapping visibility of a div.

let myId = null;

$('gate-submit').addEventListener('click', handleGateSubmit);
$('gate-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleGateSubmit(); });

async function handleGateSubmit() {
  const code = $('gate-code').value;
  $('gate-error').textContent = '';
  $('gate-submit').disabled = true;
  try {
    if (!myId) {
      const user = await ensureSignedIn();
      myId = user.uid;
    }
    const ok = await tryJoinCode(code, myId);
    if (ok) {
      localStorage.setItem(LS_JOIN_CODE, code.trim().toUpperCase());
      window.location.href = 'board.html';
    } else {
      $('gate-error').textContent = 'That code doesn\u2019t match. Check with whoever shared the link.';
      $('gate-submit').disabled = false;
    }
  } catch (e) {
    console.error(e);
    $('gate-error').textContent = 'Could not connect. Check your internet connection and try again.';
    $('gate-submit').disabled = false;
  }
}

// On load: if this browser already has a working code saved, skip the form
// entirely and go straight to the board.
(async () => {
  const savedCode = localStorage.getItem(LS_JOIN_CODE);
  if (!savedCode) return; // show the form as normal

  $('gate-form').hidden = true;
  $('gate-status').hidden = false;

  try {
    const user = await ensureSignedIn();
    myId = user.uid;
    const ok = await tryJoinCode(savedCode, myId);
    if (ok) {
      window.location.href = 'board.html';
      return;
    }
  } catch (e) {
    console.error(e);
    // fall through to showing the form
  }

  // Saved code no longer works (or something failed) — clear it and let
  // them enter a fresh one.
  localStorage.removeItem(LS_JOIN_CODE);
  $('gate-status').hidden = true;
  $('gate-form').hidden = false;
})();
