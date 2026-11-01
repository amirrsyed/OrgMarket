# Self-hosting OrgMarket

OrgMarket runs as one Node.js container plus Postgres. Nothing else is
required: no Redis, no queue, no second datastore (D20 explains why).

## 1. Try the demo (2 minutes)

```sh
git clone https://github.com/amirrsyed/OrgMarket && cd OrgMarket
docker compose up --build
```

Open http://localhost:3000 and pick a demo user. The demo seeds a fictional
game studio ("Meridian Games") with open markets, trader rationales, a resolved
market, and one market partway through its challenge window with a dispute.

## 2. Configure for real use

Create a `.env` next to `docker-compose.yml`:

```sh
POSTGRES_PASSWORD=<long random>
AUTH_SECRET=<openssl rand -base64 32>
CRON_SECRET=<long random>
APP_URL=https://orgmarket.yourcompany.com
SEED_DEMO=0
DEV_LOGIN=0

# At least one identity provider, for example Microsoft Entra ID:
AUTH_MICROSOFT_ENTRA_ID_ID=...
AUTH_MICROSOFT_ENTRA_ID_SECRET=...
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
```

Then uncomment those variables in the `app` service of `docker-compose.yml` (or
pass them with `env_file:`). The full list is in
[`apps/web/.env.example`](../apps/web/.env.example).

**SAML.** Run [BoxyHQ SAML Jackson](https://github.com/boxyhq/jackson) next to
OrgMarket and point the generic `AUTH_OIDC_*` variables at it. Jackson
translates your IdP's SAML into OIDC, so OrgMarket never parses SAML itself.

**Your organization.** On first boot without the demo seed, create the org row
and the first admin, and list the email domains that may join:

```sql
INSERT INTO orgs (id, name, settings) VALUES
  ('org-acme', 'Acme', '{"anonymity":"pseudonymous","allowedDomains":["acme.com"],"challengeWindowHours":48,"joinGrantCredits":1000,"weeklyStipendCredits":250}');
```

Anyone at `acme.com` who signs in is provisioned as a member with a random
pseudonym and a join grant. To promote the first admin, sign in once, then:

```sql
UPDATE memberships SET role = 'admin'
WHERE user_id = (SELECT id FROM users WHERE email = 'you@acme.com');
```

(An admin UI for org settings is on the roadmap.)

## 3. The scheduler

`POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` closes expired
markets, settles resolutions whose challenge window passed without disputes, and
pays weekly stipends. It is idempotent: calling it twice changes nothing. The
compose file's `scheduler` sidecar calls it every 5 minutes. On Kubernetes, use a
CronJob; on Vercel, a cron entry.

## 4. Operations

- **Backups:** back up the Postgres volume. Everything lives there.
- **Ledger integrity:** `GET /api/ledger/verify` (any signed-in member)
  recomputes the org's hash chain and returns the head hash. Record the head
  hash somewhere outside the database (the weekly digest, a wiki page) so a later
  rewrite of history is detectable.
- **Upgrades:** pre-1.0, schema changes are applied at boot with
  `CREATE TABLE IF NOT EXISTS`. Read the release notes before upgrading; a
  breaking schema change will say so.
- **Privacy:** trade history is visible to members only under pseudonyms. Admins
  see real names only in the optional settlement export (emails and amounts).
