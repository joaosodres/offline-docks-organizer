# Offline Docs Toolkit

App desktop para trabalho em lote com documentos, com foco em processamento local.

[English](./README.md)

## O que faz

- Renomeia arquivos em lote
- Mescla PDFs
- Divide PDFs
- Converte imagens em PDF
- Converte CSV em XLSX
- Organiza arquivos localmente com preview

Tudo roda na máquina do usuário.

## Download

Baixe a versão mais recente em:

`https://github.com/joaosodres/offline-docks-organizer/releases`

Para a maioria das pessoas:

- macOS: baixe o `.dmg`
- Windows: baixe o `.exe`

## Stack

- Electron
- Vite
- React
- TypeScript
- Zustand
- Tailwind CSS

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

Gerar arquivos locais:

```bash
npm run build
```

Publicar uma release por tag no GitHub Actions:

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

## Observações

- O build de macOS ainda não é assinado, então o sistema pode mostrar aviso de segurança.
- Os arquivos de auto update também aparecem na release. Para o usuário final, normalmente só importam o `.dmg` ou o `.exe`.
