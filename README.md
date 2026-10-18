# Marriage Khata

Our scorebook for Marriage nights: a home page, the rules of Marriage, and the shared ledger.

| Page | File | What's on it |
|---|---|---|
| `/` | `index.html` | Dealing animation, live tally from the ledger, how it works |
| `/rules` | `rules.html` | Rules with card illustrations, maal explorer, scoring calculator |
| `/watch` | `watch.html` | A simulated 4-player game, card by card, with each player's story |
| `/ledger` | `ledger.html` | Upload games or score one live (round by round, `js/scorer.js`), players, games table, settlement, stats |

Shared design: `css/site.css` (colors, fonts, nav, playing cards via `js/cards.js`).

`js/sim.js` simulates Marriage for the home page deal and the watch page: a real shoe (3 decks, 1 Superman, 3 Putalis), legal hands, sets, dublee, maal and scoring. Every game is random and checked turn by turn (`node --test test/sim.test.js`).

## Ledger

A static website that reads **Marriage Point Calculator** scoreboard screenshots, adds each game to a running ledger, and works out the fewest payments needed to settle up.

Players: Uttu, Utsu, Sanil, Harsh, Sargat, Subash, Rajesh, Suyog, Abhishek (shown as "Bhuj." in the app), Sajol. More can be added on the site (**Players → Add player**, or **+ New player…** in a screenshot's player dropdown); this asks for the edit password. Players who have played a game can't be removed.

## How to use

Everyone opens the same link and sees the same games and settlement. Only the person adding a game needs to upload anything.

1. **Upload screenshots** (several at once is fine). Each one is read in the browser: the *Total Points* row, the column names, and the start time.
2. Each column name is matched to a player automatically: any abbreviation, in any upper/lower case ("Raje.", "SARG", "subas" …), common misreads ("5arg." → Sargat), and nicknames ("Bhuj." → Abhishek). If a name isn't recognised on the first pass, just that header cell is read again. When you pick a player for an unrecognised name, that nickname is remembered for everyone and the game is saved to the shared ledger straight away. A screenshot only stays open for review when something is off: an unmatched name, totals not adding to 0, or the same game already in the ledger. Fix it and click **Add game**.
3. The games table and settlement update for everyone (others see it on reload, **Refresh**, or when they come back to the tab).
4. After everyone has paid up, **Download Excel** to keep a copy, then **Clear all** to start a new round.

### Where the data lives

The ledger is one Excel file, `ledger.xlsx`, on the **`ledger` branch** of this repo. Every change is a commit there, so the branch history is a full audit log, and any old version can be downloaded from GitHub. It's on its own branch so saves don't redeploy the site (`vercel.json` turns off deployments for that branch).

| Sheet | Contents |
|---|---|
| Games | One row per game: date + each player's Total Points (blank = didn't play) + an ID |
| Totals | Points and rupee amount per player |
| Settlement | Who pays whom, how much |
| Settings | Rupees per point (default 10) |
| Players | Player list and learned nicknames |

Only **Games**, **Settings** and **Players** are read back; the others are regenerated on every save. **Replace from Excel** overwrites the shared ledger with an uploaded file.

### Server setup (Vercel)

Saving goes through `api/ledger.js`, a Vercel function that reads and commits `ledger.xlsx` with a GitHub token. In Vercel → Project → Settings → Environment Variables add:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | Fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens): repository access *Only select repositories* → `settlement-calculator`; permission **Contents: Read and write** |
| `EDIT_PASSWORD` | Optional but recommended. Anyone can view; adding/deleting games asks for this password once per device |

Then redeploy (Deployments → ⋯ → Redeploy). Without `GITHUB_TOKEN` the site still works but says "saved on this device only".

## How it works

- `js/core.js`: image cleanup before OCR, scoreboard parsing, name matching, settlement. Totals are cross-checked against the "Rs. 10/pt Total Amt" row and must add up to 0.
- `api/ledger.js`: reads/writes the shared Excel in the repo.
- `js/app.js`: UI, OCR via [Tesseract.js](https://tesseract.projectnaptha.com/), Excel via [SheetJS](https://sheetjs.com/).
- Settlement: each person's balance = total points × rate; the biggest debtor pays the biggest creditor until everyone is at zero (at most *players − 1* payments).

Nicknames that don't look like a real name can be hard-coded in `DEFAULT_ALIASES` in `js/core.js`.

## Hosting

Hosted on Vercel (framework preset "Other", no build step). GitHub Pages can't run the save function, so it would only work in device-only mode.

## Tests

```
node --test test/core.test.js
```
`test/fixtures/` holds sample screenshots.
