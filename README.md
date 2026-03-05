# Offline Docs Toolkit

Desktop app for batch document operations with an offline-first workflow.

## Frontend Stack

- Electron + Vite + React + TypeScript
- TailwindCSS
- Zustand
- TanStack Table + Virtual
- Radix UI primitives + CVA utility pattern

## App Sections

- `Dashboard`: import files/folders and configure operations
- `Queue`: track jobs and progress
- `History`: review completed runs
- `Settings`: local defaults and preferences

## Folder Structure

```txt
src/
  app/
  pages/
  components/
  stores/
  types/
  lib/
```

## Run

```bash
npm install
npm run dev
```

## Test

```bash
npm run test
```
