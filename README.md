# Automated Project Consultant

> **Status: Work in progress.** The single-consultant flow is implemented and
> its first recorded evaluation baseline has been captured. Calibration,
> baseline acceptance, and later delegation experiments are still in progress.

A localhost-only AI project-framing consultant that turns rough ideas into
traceable, minimum-sufficient project seeds while teaching relevant engineering
and AI techniques.

## Getting Started

Install dependencies and start the local development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser
npm run eval
```

The application stores project state locally, but model inference is not local:
configured model requests leave the machine. Never supply secrets, credentials,
private source code, or sensitive personal documents.
