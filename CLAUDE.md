# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Taal & communicatie

Spreek Nederlands. Gebruiker: Nino. Bevestig altijd voor grote acties.

## Commands

```bash
npm run dev      # Dev server op localhost:5173/todo-app/
npm run build    # Productie build → dist/
npm run lint     # ESLint check
npm run preview  # Preview van productie build
```

Deploy is automatisch: push naar `main` → GitHub Actions → GitHub Pages (`nvantour.github.io/todo-app`).

## Architectuur

**Stack:** React 19 + Vite 7 + Firebase (Auth + Firestore) + PWA

**Routing:** `HashRouter` (vereist voor GitHub Pages). Alle URLs zijn `/#/path` format. Base path: `/todo-app/`.

**Data flow:**
- `AuthContext` → Google Sign-In + OAuth access token (ook voor Calendar API)
- `useTodos()` hook → Firestore real-time sync via `onSnapshot`, offline-first met IndexedDB persistence
- `useCategories()` hook → categorieen met keywords voor auto-detectie, initialiseert defaults bij eerste login
- `categoryDetection.js` → keyword matching op todo-tekst → automatisch categorie toewijzen

**Layout splitpoint in App.jsx:**
- `/quick-add` route → rendert `QuickAddPage` standalone (geen sidebar/header) — gebruikt door Chrome extension
- `/*` routes → rendert `MainLayout` met sidebar, header, modals en task views

**Firestore collections:** `todos` en `categories`. Security rules beperken toegang tot `ninovantour@hotmail.com`.

**Chrome Extension** (`chrome-extension/`): MV3, geen Firebase SDK. Opent de webapp's `/#/quick-add?text=...` URL in een popup-venster. Context menu + Cmd+Shift+T shortcut.

## Belangrijke patronen

- Firebase app init met `getApps().length` check (voorkomt duplicate-app error bij Vite HMR)
- Firestore Timestamps worden geconverteerd naar JS Dates in hooks, niet in components
- Categorieen hebben `keywords[]` array voor auto-detectie; `detectCategory()` matcht case-insensitive
- PWA via `vite-plugin-pwa` met autoUpdate service worker
- CSS custom properties in `index.css` voor theming; system font stack

**Voice input** (`useVoiceInput` hook): Web Speech API wrapper (nl-NL), continue modus. `parseVoiceText()` splitst op "en"/"ook"/komma's voor multi-todo detectie.

**QuickAddPage** (`/#/quick-add`): Standalone pagina voor externe integraties. Ondersteunt `?text=...` en `?autosave=true` URL parameters. Multi-todo support via voice parser.

**MCP Server** (`mcp-server/`): Node.js MCP server met Firebase Admin SDK. Tools: `list_todos`, `add_todo`, `complete_todo`, `reopen_todo`, `update_todo`, `delete_todo`, `list_categories`. Vereist service account key via `FIREBASE_CREDENTIALS_PATH` env var.

## QA

Na elke wijziging in webapp-functionaliteit: voer `/qa` skill uit.
