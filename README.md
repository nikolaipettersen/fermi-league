# Fermi League

A private daily estimation leaderboard for you and your coworkers, hosted for
free on GitHub Pages. No Claude account, no sign-up of any kind needed for
anyone who plays — just a link and a join code.

## How it's built, in plain terms

- The **website** (this folder) is static HTML/CSS/JS. GitHub Pages hosts it
  for free, same as your wedding page.
- The **shared data** (everyone's scores) lives in **Firebase Firestore**, a
  free real-time database from Google. The website talks to it directly from
  the browser — there's no server you have to run or maintain.
- **Identity** is handled by **Firebase Anonymous Auth**: the first time
  someone opens the page, their browser gets a private, permanent ID with no
  login screen at all. They just type a display name once. That ID is what
  ties "this person submitted this score" together across days, on that one
  browser/device.
- The **join code** is a soft lock, not real security. It stops randoms who
  find the link from wandering in, but it does not stop someone determined to
  poke around — don't use it for anything sensitive.

## What you'll need to do (this is the part that needs your input)

This is written assuming zero prior experience with any of these tools.

### 1. Create a free Firebase project

1. Go to https://console.firebase.google.com and sign in with any Google account.
2. Click **Add project**, give it a name (e.g. `fermi-league`), and click
   through the setup (you can turn off Google Analytics, you don't need it).
3. Once created, click the **</>** (web) icon to add a web app. Give it any
   nickname. You do **not** need Firebase Hosting — you're using GitHub Pages
   instead.
4. Firebase will show you a code block called `firebaseConfig` with values
   like `apiKey`, `authDomain`, etc. Copy those values into `firebase-config.js`
   in this folder, replacing the `"REPLACE_ME"` placeholders.

### 2. Turn on the two Firebase features this uses

In the Firebase console, in the left sidebar:

- **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**
- **Build → Firestore Database → Create database** (choose any region close
  to Oslo — `europe-west1` or similar — and start in **production mode**)

### 3. Set the security rules

Still in the Firebase console: **Firestore Database → Rules** tab. Delete
whatever's there and paste in the entire contents of `firestore.rules` from
this folder, then click **Publish**.

This step matters — without it, Firestore defaults to blocking everything,
and the site won't be able to save any scores.

### 4. Pick your join code

Open `firebase-config.js` and change `INITIAL_JOIN_CODE` to whatever code
you want to share with your coworkers (e.g. a word, like `PIANOTUNERS`).
This only matters the very first time anyone opens the deployed site — that
visit locks in the code. Change it before your first visit, not after.

### 5. Push this to GitHub and turn on Pages

This is the part I'd suggest doing with **Claude Code** rather than by hand —
tell it "push this folder to a new GitHub repo and enable GitHub Pages" and
it'll handle the git commands and authentication properly. If you'd rather do
it yourself:

```bash
cd fermi-league-github
git init
git add .
git commit -m "Fermi League"
gh repo create fermi-league --public --source=. --push
```

Then in the repo's settings on GitHub: **Settings → Pages → Source: Deploy
from a branch → Branch: main → / (root)**. GitHub gives you a URL like
`https://yourusername.github.io/fermi-league/` within a minute or two.

### 6. Open the link yourself first

Visit your new site once before sending it to anyone. Type your join code,
then your name. This first visit is what makes **you** the admin (able to
delete mistaken entries) — whoever opens the site first becomes the founding
admin, so don't skip this or share the link before doing it.

### 7. Share the link + join code with your coworkers

That's it — send them the GitHub Pages URL and the join code (separately, if
you want to be a bit careful — a Slack DM for the code rather than posting
both in the same public channel, say).

## Changing the join code later

If you ever want to rotate the code (say it leaked more widely than you'd
like): in the Firebase console, go to **Firestore Database → Data**, open the
`meta` collection → `league` document, and edit the `joinCode` field directly.
Anyone with the old code cached in their browser will keep working until they
clear their browser data, so this isn't instant, but it stops new joins with
the old code.

## Admin — deleting a mistaken entry

If you're the founding admin, you'll see a small ✕ next to each entry on the
daily leaderboard. Tap it once (it turns red and asks "Confirm?"), tap again
within 3 seconds to actually delete it.

To make someone else an admin too: in Firestore, edit `meta/league` and add
their uid to the `adminUids` array. Their uid isn't shown anywhere in the UI
right now — the simplest way to find it is to check the `players` collection
in Firestore, matching their display name to the document ID next to it.

## Known limitations, honestly

- **Not real authentication.** Anonymous auth ties a person to a *browser*,
  not an identity. If someone uses a different browser or device, or clears
  their browsing data, they'll show up as a "new" player and lose their
  history. Fine for an office game; not fine for anything that needs to be
  tamper-proof.
- **The join code is visible in page source.** Anyone who opens developer
  tools can find it. It keeps out casual link-sharing accidents, not a
  determined snoop.
- **Free tier limits.** Firebase's free (Spark) tier is generous — tens of
  thousands of reads/writes a day — and a small office league will not come
  close to it. If this ever grew to hundreds of active daily players, revisit
  the plan.
