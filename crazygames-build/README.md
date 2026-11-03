# SKYENGINE — CrazyGames release candidate

This folder is a separate, guest-first build. It does not replace the main SKYENGINE creator portal.

## Preview locally

Serve this folder over HTTP (not by opening the HTML as a `file://` URL), then open it in desktop Chrome. The game uses Three.js from jsDelivr and the CrazyGames HTML5 SDK v3.

## Package for a review upload

Create a ZIP whose **root contains `index.html`** and whose other files (if any) are alongside it. In other words, ZIP the *contents* of this folder, not the parent `crazygames-build` folder. Keep the SDK script and Three.js import intact.

## Implemented in this candidate

- Separate guest-first launch path; no mandatory SKYENGINE username/password screen.
- Main creator portal, custom video lounge, and admin UI are not shown in this release build.
- CrazyGames HTML5 SDK v3 script and initialization.
- CrazyGames gameplayStart/gameplayStop lifecycle calls on start, resume, and pause.
- CrazyGames Data Module cloud progress saving for the world; localStorage fallback is retained for ordinary previews and SDK failures.
- One-click start screen and an in-game shelter objective with control guidance.
- Existing touch controls remain available on narrow screens.
- Existing game code uses procedural voxel terrain and locally generated materials.

## Not yet verified — do not claim acceptance

- Desktop Chrome load-to-play time under 20 seconds, including on a lower-powered Chromebook.
- No console errors or failed network requests on the packaged ZIP.
- Mobile controls, camera look, layout, and performance on real phones/tablets.
- Gameplay physics at high-refresh-rate displays.
- Complete start-to-finish playthrough by someone other than the creator.
- Ownership/license audit for every code, art, font, and sound asset included in the final ZIP.
- CrazyGames Preview tool QA and final approval.
- In the CrazyGames submission flow, enable the Progress Save/Data Module option so the SDK data store is available.

## Manual QA checklist

- [ ] Test a clean desktop Chrome profile; clear site storage first.
- [ ] Measure from navigation until the world is interactive; target less than 20 seconds.
- [ ] Check DevTools Console and Network; resolve all errors and missing assets.
- [ ] Start a new world; walk, look, jump, mine, place blocks, pause, and resume.
- [ ] Verify save/load after refresh.
- [ ] Test on a real phone and tablet, in portrait and landscape; if mobile quality is not good enough, submit as desktop-only instead.
- [ ] Ask another person to play the game without coaching and complete the intended gameplay loop.
- [ ] Confirm all included assets are original or have licenses that allow game distribution.
- [ ] Upload to CrazyGames Preview and follow the current QA feedback before submission.

## Important

This is a release candidate, not a guarantee of CrazyGames acceptance. The multiplayer and creator-submission systems remain in the main portal and are intentionally not part of this single-player release candidate.