# MailOS Bridge

Use MailOS mailboxes in **Gmail, Outlook, Apple Mail and Thunderbird**. MailOS runs on Cloudflare Workers, which cannot accept mail-app connections, so this small server translates the standard protocols to the MailOS JMAP API:

| Protocol | Port | What it does |
|---|---|---|
| POP3 over TLS | 995 | Downloads Inbox mail into the app |
| POP3 + STLS | 110 | Same, upgraded to TLS |
| SMTP over TLS | 465 | Sends mail through MailOS (saved in Sent) |
| SMTP submission + STARTTLS | 587 | Same |

Sign-in for every app: **username** = the full mailbox address, **password** = a MailOS **app password** (MailOS → Settings → App passwords). The account's normal password is never used by mail apps.

IMAP (two-way folder sync) is planned; until then apps download the Inbox over POP3. Deleting a message in the app moves it to MailOS Trash.

## Deploy on a VPS

**Free option:** step-by-step for Oracle Cloud's Always Free tier in [ORACLE-FREE-TIER.md](ORACLE-FREE-TIER.md).

Any small Linux VPS works (1 vCPU / 1 GB). Ports 110, 465, 587 and 995 must be open; port 80 is needed briefly for the certificate.

1. **DNS:** add an `A` record, e.g. `connect.example.com` → the VPS IP, **DNS only** (grey cloud in Cloudflare — the proxy cannot carry mail protocols).
2. **Install Docker** on the VPS, copy this `bridge/` folder there, then:
   ```bash
   cp .env.example .env          # set MAILOS_URL and BRIDGE_HOSTNAME
   docker compose run --rm -p 80:80 certbot certonly --standalone -d connect.example.com --agree-tos -m you@example.com
   sudo chown -R 1000:1000 letsencrypt   # the bridge runs as uid 1000 and must read the key
   docker compose up -d bridge
   ```
3. **Renew the certificate** weekly (cron): `docker compose run --rm -p 80:80 certbot renew && sudo chown -R 1000:1000 letsencrypt && docker compose restart bridge`

Check it: `openssl s_client -connect connect.example.com:995 -quiet` should print `+OK MailOS POP3 ready`.

## App settings

| Setting | Value |
|---|---|
| Incoming (POP3) | `connect.example.com`, port **995**, SSL/TLS |
| Outgoing (SMTP) | `connect.example.com`, port **465** SSL/TLS (or 587 STARTTLS) |
| Username | full email address |
| Password | MailOS app password |

**Gmail app on Android:** Settings → Add account → Other → Personal (POP3) → settings above.
**Thunderbird, Outlook for Windows, Apple Mail:** add account → manual/advanced setup → POP3 → settings above.
**Gmail on the web:** *Send mail as* works with the SMTP settings. Google ended *Check mail from other accounts* (POP fetching) in 2026, so it can no longer download mail.
**Gmail on iPhone and the Outlook mobile app** need IMAP, which the bridge does not offer yet.

## Development

```bash
npm install
npm test                                    # fake MailOS server, no network
MAILOS_URL=https://mail.example.com ALLOW_PLAINTEXT=true POP3_PORT=1110 SUBMISSION_PORT=2587 npm start
```

Security notes: only authenticated users can send, and only as addresses their MailOS account owns (no open relay). Without `TLS_CERT`/`TLS_KEY` the bridge refuses to start unless `ALLOW_PLAINTEXT=true` (local testing only); with TLS configured, plaintext ports require STLS/STARTTLS before login.

MailOS Bridge is part of MailOS by 14 Technologies, licensed AGPL-3.0.
