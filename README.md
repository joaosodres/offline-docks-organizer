# Offline Docs Toolkit

Desktop app for local-first batch document work.

[Português (Brasil)](./README.pt-BR.md)

## What it does

- Batch rename files
- Merge PDFs
- Split PDFs
- Convert images to PDF
- Convert CSV to XLSX
- Organize files locally with previews

Everything runs on the user's machine.

## Download

Download the latest release here:

`https://github.com/joaosodres/offline-docks-organizer/releases`

For most users:

- macOS: download the `.dmg`
- Windows: download the `.exe`

## Stack

- Electron
- Vite
- React
- TypeScript
- Zustand
- Tailwind CSS

## Development

```bash
npm install
npm run dev
```

## Build

Create local build files:

```bash
npm run build
```

Publish a tagged release through GitHub Actions:

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

## Notes

- macOS builds are not signed yet, so Gatekeeper may show a warning.
- Auto-update metadata files are generated in releases. End users usually only need the `.dmg` or `.exe`.
