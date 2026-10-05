# Security

## Security model of the live demo

The demo is a **static website**. There is no server-side code, database, API, login or file storage.

| Concern | How it is handled |
|---|---|
| Uploaded files | Parsed and processed **inside the visitor's browser tab** (a Web Worker). There is no upload endpoint; data is never sent anywhere and is discarded when the tab closes. |
| Data leaving the device | Blocked **by the browser** through the Content-Security-Policy `connect-src 'self'` (see `frontend/vercel.json`); tested in `frontend/e2e/security.spec.ts`. |
| Cross-site scripting | All uploaded text is rendered through React (escaped); no `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in the app. The CSP restricts scripts to the site's own origin. |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| Other headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy`/`Resource-Policy: same-origin`, HSTS. |
| Third parties | None at runtime: no analytics, telemetry, fonts or CDNs (fonts are bundled). |
| Oversized or malformed input | Strict CSV validation (required columns, 3,000-row and 8 MB limits, friendly errors, no stack traces). |
| Browser storage | Only per-tab `sessionStorage` for non-sensitive demo state (whether the sample was loaded, demo review clicks). |
| Dependencies | `npm audit` clean at publication; Dependabot enabled; CI fails on high-severity production advisories. |
| Secrets | The project uses none. `.gitignore` blocks `.env`, keys and credential files; the history was scanned before publication. |

**Known limits (by design):** the demo audit trail and reviewer personas live in the visitor's own browser and can be
changed by that visitor. They demonstrate the governance workflow and are not an authoritative record. A pilot deployment
would keep the ledger server-side with role-based access, TLS and encryption at rest (see the PRD, NFR-08).

## Reporting a vulnerability

Please report security issues privately to the maintainers through GitHub's **"Report a vulnerability"** button
(Security tab of this repository) rather than opening a public issue. We will acknowledge within a few days.
