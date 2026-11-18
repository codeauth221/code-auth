# CodeAuthentic — Premium Landing & Instructor Access UI

## Scope

This is a **frontend-only**, **not deployed** patch for the CodeAuthentic source ZIP reviewed on 18 November 2026.

Files included:

- `src/components/HomeIntro.tsx` — redesigned landing hero, explanatory workflow, modern feature grid, academic-integrity guidance.
- `src/components/InstructorLogin.tsx` — redesigned faculty sign-in/register screen, labeled inputs, password visibility toggle, accessible mode switch, loading/error states.
- `src/global.css` — scoped premium responsive styles for the above two components; preserves the previously prepared frontend performance fixes in the CSS baseline.

**No** `backend/`, `ml/`, `dataset/`, `.joblib`, model weights, package manifests, deployment configuration, or training scripts are included or changed. No deployment or backend process was performed by the assistant.

## How to apply to your LOCAL project (not the running training host)

1. Back up the existing local project folder (or commit your existing local changes to a safe non-deploying branch).
2. Extract this ZIP somewhere **outside** your project folder.
3. Compare the three included files with your own changes, especially if you have edited `src/global.css` since the previous performance patch. Merge instead of blindly overwriting custom changes.
4. Copy those three files into the matching relative `src/` paths in your local CodeAuthentic project.
5. Run your normal local frontend checks (`npm run lint`, `npm run build`), then test Home → Instructor Sign In → Create Account → Sign In, theme toggle, and mobile layout. Do not assume compilation passed based only on the static syntax checks below.
6. Leave production deployment and backend training tasks alone until the classifiers are ready.

### Training safety

Copying these frontend files on your **local development copy** does not modify the training job. If your frontend and backend share a deployment pipeline, avoid a push to an auto-deploying branch or any command that restarts the backend. Do not overwrite or delete the training working directory, and do not run `START_SYSTEM.bat` or a deployment action merely to test the new entry screens.

## Visual changes

- Landing: readable, focused headline; upgraded CTAs; explanatory workflow panel; four responsive cards; academic-integrity note.
- Instructor access: two-column branded layout on desktop; one-column on tablet/phone; refined dark glass form; visible focus states; show/hide password; sign-in/register switch.
- Performance: no video, complex animations, or extra image assets. Uses the existing campus photo and icon library. Disables blur on mobile for the new glass cards and removes the hero's expensive full-screen blurred pseudo-element.

## Functionality preserved

- Original `loginInstructor`, `registerInstructor`, and automatic sign-in call sequence.
- Original `onLogin` instructor object and token handling.
- Original registration name/password/email validations.
- Original home navigation callbacks and dashboard routing.
- Existing light/dark theme token system; the photo-backed entry areas use deliberate dark branding in both themes while lower home content follows theme tokens.

## Verification performed

- HomeIntro.tsx and InstructorLogin.tsx TypeScript/TSX parsing and transpilation: no syntax diagnostics.
- Global CSS parsed using `tinycss2`: no stylesheet-level parse errors.
- ZIP integrity and exact path checks.
- Full Vite build and browser smoke tests: **not verified in this environment** (project's dependency folders were incomplete). Please run them locally before deploying.

**Note:** The workflow card is labeled as an explanation/preview, not actual live analysis or real risk results. The C classifier may still be training; no claim is made that every classifier is fully available.
