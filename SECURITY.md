# Security policy

## Reporting a vulnerability

Do not open a public issue. Report privately by either:

- email security@planarhq.com (planned address, the domain is not registered yet);
- a confidential issue in https://gitlab.com/planarhq/planar (tick "This issue is confidential").

Please include the affected version or commit, reproduction steps and the impact. We will acknowledge the report and agree on a disclosure date with you; no response-time guarantee is made at this stage.

## Supported versions

| Version             | Supported |
| ------------------- | --------- |
| 0.9.x (public beta) | yes       |
| earlier             | no        |

## Scope notes

- Deployment hardening (secrets, `COOKIE_SECURE`, `PLANAR_SECRET_KEY`, trusted proxy subnet) is described in `docs/guides/deploy.md`.
- Issues in third-party dependencies should be reported to their maintainers; tell us as well if Planar is affected.
