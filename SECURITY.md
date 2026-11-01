# Security policy

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/amirrsyed/OrgMarket/security/advisories/new),
not public issues. We aim to acknowledge reports within 3 business days.

Areas we care most about:

- **Ledger integrity:** minting or burning credits, bypassing balance checks,
  or editing history without breaking the hash chain.
- **De-anonymization:** any path that links a pseudonym to a real identity for
  someone who shouldn't see it.
- **Authorization:** members acting as admins, or crossing between orgs.
- **Webhook verification:** forging Slack requests or the cron/digest secrets.

Deployment notes:

- Never run with `DEV_LOGIN=1` on a reachable server: it lets anyone pick any
  user.
- Set strong `AUTH_SECRET`, `CRON_SECRET`, and `POSTGRES_PASSWORD` values. The
  compose defaults are for local demos only.
- Slack bot tokens are stored in plaintext in v0.x. Restrict database access
  accordingly. Encryption at rest is on the roadmap.
