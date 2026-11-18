# CodeAuthentic – Compact Mobile Dashboard and Bottom Navigation

**Only frontend files changed.** This patch does not change CodeBERT, C/Java/Python classifiers, Python backend, training datasets, HTTP calls, or login logic. Do not deploy/restart the backend while C training is running.

## Preferred install (safe with your latest UI tweaks)

1. Back up the `src/` folder or commit it locally (do not push while training).
2. Replace just `src/components/InstructorDashboard.tsx` from this ZIP.
3. Open your current `src/global.css` and **append** `MOBILE_NAV_CSS_ONLY.txt` at the bottom.
4. Save, launch the existing Vite frontend locally, and confirm the bottom bar, instructor dashboard, lobbies, submissions, and modals.

**Alternative:** `src/global.css` is provided already merged with the Premium Landing/Auth patch + premium autofill fix as of Nov 18. Only replace the whole CSS if your local version is exactly that same prior version and has no other changes. Otherwise, append the snippet so you do not lose other recent UI improvements.

## Changes
- Dashboard / Lobbies / Submissions tabs become a fixed floating bottom dock on viewports <= 1023px; desktop retains its original sidebar.
- Dock respects iPhone safe-area, is visible while scrolling, and keeps touch targets >=55px tall.
- Mobile hero, action toolbar, stat cards, quick lobbies, submission cards, spacing and panels compacted.
- Switching sections scrolls back to the beginning on phone/tablet.
- Adaptive light/dark design; avoids heavy continuous animation.
- Dock z-index 41 is lower than existing modal overlays (z-50), preserving modal accessibility.

## Important
The top **brand/account** header remains at the top. Only the instructor **section navigation** (Dashboard/Lobbies/Submissions) moves to bottom on mobile. No new API requests or background processes are introduced.

## Smoke test
- Phone: bottom dock visible on Dashboard, Lobbies, Submissions, while scrolling; selected tab accurate.
- Switch from long submissions list to Dashboard; page returns to top.
- Open create lobby, datasets, inspect code; dialogs appear above dock.
- Check light and dark modes and landscape/safe-area on iPhone.
- Desktop >=1024px: sidebar remains on left.
- Backend training process and deployment not touched.
