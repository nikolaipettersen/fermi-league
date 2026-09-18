// Logic for index.html only. On success, sends the browser to board.html —
// a real page navigation, not just swapping visibility of a div.

let myId = null;

$('gate-submit').addEventListener('click', handleGateSubmit);
$('gate-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleGateSubmit(); });

async function handleGateSubmit() {
  const raw = $('gate-code').value;
  const btn = $('gate-submit');

  // Second tap of the "create a brand-new league?" confirmation.
  if (btn.dataset.confirmingCreate === '1') {
    await finishCreateAndJoin(raw, btn);
    return;
  }

  $('gate-error').textContent = '';
  btn.disabled = true;
  try {
    if (!myId) {
      const user = await ensureSignedIn();
      myId = user.uid;
    }

    const legacyOk = await checkLegacyCode(raw);
    if (legacyOk) {
      rememberLeague(LEGACY_LEAGUE_ID, 'Fermi League');
      setActiveLeague(LEGACY_LEAGUE_ID);
      window.location.href = 'board.html';
      return;
    }

    const id = sanitizeCode(raw);
    if (!id) {
      $('gate-error').textContent = 'Enter a join code.';
      btn.disabled = false;
      return;
    }

    const exists = await leagueExists(id);
    if (exists) {
      rememberLeague(id, raw.trim().toUpperCase());
      setActiveLeague(id);
      window.location.href = 'board.html';
      return;
    }

    // No league uses this code yet. Rather than silently spawning a new,
    // empty league on every typo, ask for one more tap first.
    btn.dataset.confirmingCreate = '1';
    btn.textContent = 'No league found \u2014 create one?';
    btn.disabled = false;
    setTimeout(() => {
      if (btn.dataset.confirmingCreate === '1') {
        btn.dataset.confirmingCreate = '0';
        btn.textContent = 'Enter';
      }
    }, 4000);
  } catch (e) {
    console.error(e);
    const detail = (e && (e.code || e.message)) ? ' (' + (e.code || e.message) + ')' : '';
    $('gate-error').textContent = 'Could not connect' + detail + '. Check your internet connection and try again.';
    btn.disabled = false;
  }
}

async function finishCreateAndJoin(raw, btn) {
  btn.disabled = true;
  btn.dataset.confirmingCreate = '0';
  try {
    if (!myId) {
      const user = await ensureSignedIn();
      myId = user.uid;
    }
    const id = sanitizeCode(raw);
    await createLeague(id, myId);
    rememberLeague(id, raw.trim().toUpperCase());
    setActiveLeague(id);
    window.location.href = 'board.html';
  } catch (e) {
    console.error(e);
    $('gate-error').textContent = 'Could not create the league. Try again.';
    btn.disabled = false;
    btn.textContent = 'Enter';
  }
}

// On load: if this browser already has a working active league, skip the
// form entirely — unless we arrived via "+ Join another league", which
// forces the form so a second league can be added deliberately.
(async () => {
  const forceForm = new URLSearchParams(window.location.search).has('join');
  const active = getActiveLeague();
  if (!active || forceForm) return;

  $('gate-form').hidden = true;
  $('gate-status').hidden = false;

  try {
    const user = await ensureSignedIn();
    myId = user.uid;
    const ok = await leagueStillValid(active);
    if (ok) { window.location.href = 'board.html'; return; }
    forgetLeague(active);
  } catch (e) {
    console.error(e);
    // fall through to showing the form
  }

  $('gate-status').hidden = true;
  $('gate-form').hidden = false;
})();
