# Remembos — your private memory

Drop screenshots, PDFs, videos, voice notes and copied text. Remembos reads them **on your device** and makes
everything findable in plain words: "Priya's phone number", "what did I decide about Atlas last month",
"which document mentioned this amount?".

- **Upload-first and instant.** The home page is the upload area. Upload, paste (⌘V / Ctrl+V saves instantly with
  Undo), record a voice note, take a photo on phones, or drop files anywhere. Notes are there too, as a side feature.
- **Private by design.** No account, no server, no uploads. Memories live in this browser's IndexedDB.
- **Reads everything locally.** Text in images, scanned PDFs and video frames (Tesseract OCR), PDF text layers
  (pdf.js), speech in voice notes and videos (Whisper), all inside the browser.
- **Finds things by meaning.** Keyword search plus an on-device embedding model, smart answers (the actual phone
  number, amount, date or link) and a knowledge graph of people, numbers and topics.
- **Works offline, installs as an app.** A PWA with an offline app shell, app shortcuts, "Open with Remembos" for
  files on desktop and the Android share sheet. *Your data → Get ready for offline* downloads every AI model in one go.
- **Shows you where everything is.** Each memory has "Where is this stored?" and a built-in IndexedDB explorer;
  `/storage/` explains IndexedDB, Cache Storage, localStorage, sessionStorage and cookies, including the real folders
  on your disk.
- **Free to host.** A static site (`next build` with `output: "export"`), so hosting costs nothing.

The only network requests the app makes are downloads of public model files and their code (from jsDelivr and
Hugging Face), once, the first time a feature needs them. Your content is never sent anywhere.

## Tech

Next.js 16 (static export), React 19, Tailwind CSS v4, Dexie (IndexedDB), MiniSearch, tesseract.js, pdfjs-dist,
transformers.js (loaded inside Web Workers), sonner, lucide-react.

## Develop

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run build` | Static site in `out/` (plus the offline precache list and a versioned service worker) |
| `npm start` | Serves `out/` on http://localhost:4310 |
| `npm run test:unit` | Unit tests (Node) |
| `npm run test:e2e` | Browser tests against `out/` in desktop and phone viewports (build first) |
| `npm test` | Everything above, in order |

Browser tests use the locally installed Google Chrome (`PW_CHANNEL=""` switches to Playwright's Chromium).
Meaning search is off in tests so they need no downloads; `REMEMBOS_E2E_NETWORK=1 npm run test:e2e` also runs
the OCR, video and offline checks, which download the text reader.

## Deploy

Any static host works; the build output is the `out/` folder.

- **Vercel:** import the GitHub repository; the Next.js preset needs no settings.
- **Netlify / Cloudflare Pages:** build command `npm run build`, output directory `out`.
- **GitHub Pages or any sub-folder:** set `NEXT_PUBLIC_BASE_PATH=/your-folder` at build time.

`next/font` downloads the fonts at build time, so the build machine needs internet access.

## Where data lives

Everything is stored in the visitor's own browser, separately for each site address:

- **IndexedDB** `remembos`: memories, original files, previews, search data. In Chrome this is
  `…/Default/IndexedDB/<site>.indexeddb.leveldb` (text, inside `.log`/`.ldb` files) and
  `…/<site>.indexeddb.blob` (files, as numbered pieces).
- **Cache Storage**: AI model files and the offline copy of the app.
- **localStorage**: one small key for preferences. No cookies.

Deleting a memory erases its original file from disk right away; text can leave traces in the browser's database
files until the browser compacts them. For a complete wipe, also delete the site's data in browser settings.
The in-app pages **Your data** (`/data/`) and **Where your data lives** (`/storage/`) show live sizes and explain
backup, restore and clearing.
