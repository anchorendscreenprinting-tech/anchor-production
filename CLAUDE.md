# CLAUDE.md — Anchor End Studios software ecosystem

This file gives Claude Code the standing context for this project. Read it before starting work. It exists so the setup, decisions, and hard-won gotchas don't have to be rediscovered each session.

## Who / what this is

Anchor End Studios is a premium screen-printing business (Manchester). This is a custom software ecosystem built to reduce admin burden. The core goal: systems that let a small team input data, so the owner isn't the bottleneck. Prefer fewer apps, not sprawl.

## The apps (three live apps, one shared Firebase project)

All are **vanilla JS, loaded via CDN imports, no build step, no package.json**. They share one Firebase project: **`ink-stock-318c0`** (storageBucket: `ink-stock-318c0.firebasestorage.app` — NOT the `.appspot.com` name, which is dead).

- **anchor-hq** (`anchorendhq.netlify.app`) — the admin hub. Quotes, enquiries inbox, and the Mockup Studio. This is where the owner works.
- **anchor-production** (`anchor-production.netlify.app`) — the production job board (stages: Quote accepted → Invoice sent → Garments ordered → Artwork received → Artwork separated → Screens made → Inks mixed). Holds the send/approve flow and `approval.html`. Separate repo, deployed separately (manual push).
- **ink-library** (`anchorendstudios.netlify.app`) — floor ink stock app.

A retired prototype, **anchor-end** (React + FastAPI/SQLite), is decommissioned and fully severed from Firebase. It is the **source of truth for proven logic** when porting features — read it, port the logic, re-implement the data layer on Firebase. Do not reinvent what already works there.

Other infra: Netlify (hosting), a Cloudflare Worker (`anchor-end-enquiry-handler`) that handles enquiry submissions and the mockup send/approve email via Resend. **The Worker's source is not in any of these repos** — it's deployed separately and can't be edited from here.

## Architecture principles

- **Fewer apps, not sprawl.** New features go into existing apps. All share one Firebase project.
- **Check real data shapes before building.** Report the actual structure of a doc/collection before writing code against it. Do not assume field names or formats — this has caused repeated bugs.
- **Staged builds with stop-and-test gates.** Build in layers, confirm each works before the next. Don't do large features in one pass.
- **Port, don't reinvent.** The retired anchor-end prototype holds proven logic; port it, only rewriting the data layer for Firebase.
- **Report before building** when reconciling two systems or when a decision has real consequences.

## Hard-won gotchas (do not relearn these)

- **Uploads work on ALL browsers and devices — including iPhone Safari (confirmed on the floor).** ⚠️ The earlier "Safari ITP blocks reCAPTCHA → staff must use desktop Chrome / iPhones can't upload" gotcha was a **red herring** and has been removed. The real causes of the upload failures were (a) the `request.app != null` Storage-rules bug and (b) a classic reCAPTCHA key masquerading as Enterprise (both below) — **both now fixed**. Staff can upload from any browser/device, iPhones included. Customers only *view* the public approval image (a plain `<img>`), which was never affected anyway.
- **Verify a theory live before recording it as fact in CLAUDE.md.** This App Check saga produced **two** wrong "facts" that got written down and then actively misled debugging for days: (1) "Safari ITP blocks reCAPTCHA → desktop Chrome only," and (2) "`request.app` populates in Storage rules when enforced." Both were plausible, both were documented, both were wrong, both are now corrected. A wrong documented assumption can cost days — confirm a theory against live behaviour (reproduce on the real device/browser; test the rule or key directly) before promoting it to a gotcha.
- **App Check is enforced at the console GATEWAY — and `request.app` is NOT a valid variable in Storage rules.** ⚠️ **Root cause of the multi-day App Check saga (June 2026); supersedes any earlier note that `request.app` "populates when enforced."** `request.app` is **Cloud Functions–only**; in Storage Security Rules it does not exist, so `request.app != null` **always evaluates false and denies every write** regardless of a valid token. **Never gate Storage writes/reads on `request.app`.** Instead: set Storage to **Enforced** in the App Check console (token-less / invalid-token requests are blocked *before* rules run) and let the rules validate only size / contentType. Provider is **reCAPTCHA Enterprise** (not classic v3). Firestore App Check is currently **Monitoring** (logs only).
- **Firebase Storage is the image host** — NOT Uploadcare. Uploadcare is broken on this project (uploads 404). Images go to Firebase Storage under `mockups/{jobId}/`, public read, App Check–gated write.
- **Firestore + Storage are both secured** but apps use **PIN login, not Firebase Auth** — so `request.auth` is always null. **Storage rules cannot gate on App Check** (`request.app` isn't valid there — see above); App Check is enforced at the console gateway, and the rules only check size / contentType. (Adopting Firebase Auth is a planned future upgrade.)
- **Mockup calibration uses native Konva stage scale**, NOT CSS `transform: scale()`. CSS transform broke drag-coordinate mapping and calibration input — native stage scale keeps display size and measurement independent.
- **White-on-dark pricing rule:** "white on dark" = single colour white, one screen, double-hit. It does NOT add an extra screen — must NOT use `cols+1` logic.
- **Disk space (`ENOSPC`):** Claude Code's sandbox treats `/private/tmp` as a small, space-constrained overlay, so its command-output capture there hits a spurious *"0 MB free"* in long sessions — even though the real disk has 150 GB+ free (confirmed: `df` of the tasks dir shows the full APFS volume, no separate small mount). **Fixed permanently:** `export CLAUDE_CODE_TMPDIR="$HOME/Documents/claude-tmp"` is set in `~/.bash_profile` (login shell is `/bin/bash`), moving scratch onto the real disk *outside* `/private/tmp`. Takes effect on each new Claude Code launch. Fallback if it ever recurs: **redirect a command's output to a repo-disk file and read that** (`cmd > .out.txt 2>&1`, then read `.out.txt`) and avoid dumping huge output (e.g. grepping minified bundles).

## Mockup Studio (in anchor-hq) — current state

A full mockup maker built fresh in vanilla JS (ported from the anchor-end React prototype). Capabilities: four garment views (front/back/L sleeve/R sleeve); template-photo, flat-colour SVG, and upload-your-own-photo garment modes; photo-mode calibration (amber side-seam handles = horizontal scale; green top-hem + bottom-hem = vertical scale, independent; collar is artwork-placement-only, NOT calibration); diagonal sleeve calibration (top seam / underarm / cuff); artwork sized on a single scale to preserve true proportions; left/right breast snapping (wearer-correct: front view is mirrored, back view is not); Pantone search + eyedropper match (3,233 colours in `js/pantone-data.js`, plus plain White/Black); multi-position proof session with per-position independent state; PDF proof export (jsPDF, styling kept in a clearly-separated theme block for easy future redesign) with an editable measurement-override review step before generating.

**Pipeline:** from a job at "Invoice sent", open the maker → build proof → the proof's pages render to a single stacked PNG (the customer approval image, showing the full proof) → uploaded to Firebase Storage → fed to the existing send/approve flow → customer approves on `approval.html` → job advances to "Garments ordered", approved mockup saved on the card, dual HQ+production notifications, "checked against mockup" staff tick. Full PDF saved separately as `job.mockup.pdfUrl`.

## Parked / on the horizon

- **Garment template library** — upload & save reusable blank garment photos (HQ-only, photo-only, recalibrate each use), built on Firebase Storage. Comes after the mockup pipeline.
- **App Check enforcement on Firestore** — currently monitoring only. Before enforcing: `approval.html` (uses REST API, no SDK token) and the Cloudflare Worker (server-side, can't do reCAPTCHA) must be handled first.
- **Firebase Auth** across all apps — the proper long-term security upgrade (replaces client-side PINs; makes standard auth-based rules possible).
- **Enquiry form changes** — delivery vs collection, date-needed carry-through.
- **Holding page** — to go live once design is finalised.
- **Other HQ modules** — stock ordering, screen management rebuild in Firebase, garment prices in Firebase.

## Build conventions the owner prefers

- Thorough scoping via questions first, then a complete spec to Claude Code.
- One thing at a time; stop-and-test between stages.
- Report real data shapes / current state before building, not after.
- Test before trusting live. A correct earlier refusal or check shouldn't be undone by impatience.

## Visual identity

Orange accent `#f5a623` is the HQ app's identity. (A professional full redesign of everything is planned for the near future — keep styling cleanly separated so it's a swap, not a rewrite.)
