# Run the MailOS bridge on Oracle Cloud (free)

The MailOS bridge lets mail apps (the Gmail app on Android, Thunderbird, Outlook for Windows,
Apple Mail) sign in to MailOS mailboxes over **POP3** (receive) and **SMTP** (send). MailOS itself
runs on Cloudflare, which cannot accept mail-app connections, so the bridge needs a small always-on
server. Oracle Cloud's **Always Free** tier runs it at no cost.

Everything here is free: Oracle Always Free VM, Ubuntu, Docker, Let's Encrypt certificates and
Cloudflare DNS. Nothing needs a paid plugin.

## What works with the bridge today

| App | Works | How |
|---|---|---|
| Gmail app on **Android** | ✅ | Add account → Other → Personal (**POP3**) |
| Thunderbird (Windows/Mac/Linux) | ✅ | Manual setup → POP3 |
| Outlook for Windows (classic and new) | ✅ | Add account → Advanced → POP |
| Apple Mail (iPhone, iPad, Mac) | ✅ | Add account → Other → **POP** |
| Gmail on the **web** | Send only | Google ended "Check mail from other accounts" (POP fetching) in 2026; "Send mail as" still works with the SMTP settings |
| Gmail app on **iPhone**, Outlook **mobile** app | ❌ for now | These need IMAP, which the bridge does not offer yet |

POP3 downloads the Inbox. Folders and read status do not sync back; deleting a message in the app
moves it to MailOS Trash. The MailOS phone app (install from the browser, or the Android APK) is
still the full experience.

## Part 1: you, in the Oracle Cloud console (about 15 minutes)

Do these yourself in your browser; never share your Oracle password or paste it into an AI chat.

1. **Create the server:** Compute → Instances → **Create instance**.
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **VM.Standard.A1.Flex** (Ampere, 1 OCPU, 6 GB) – or **VM.Standard.E2.1.Micro** if A1 says
     "out of capacity". Both are Always Free.
   - Networking: keep "Assign a public IPv4 address" **on**.
   - SSH keys: choose **Paste public keys** and paste the public key from Part 2, step 1.
2. **Note the public IP** shown on the instance page.
3. **Open the ports:** Networking → Virtual cloud networks → your VCN → Security → **Security Lists** →
   Default Security List → **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP protocol TCP, destination
   ports **80, 110, 465, 587, 995** (one rule with `80,110,465,587,995` is fine). Port 22 (SSH) is open
   already.
4. **Optional but recommended:** Oracle may reclaim Always Free VMs that stay almost idle for a week.
   Upgrading the account to **Pay As You Go** stops that; you still pay nothing while you stay within
   the Always Free limits.
5. **DNS (Cloudflare dashboard):** add an `A` record `connect` → the public IP, with the proxy
   **off (grey cloud, DNS only)**. Cloudflare's proxy cannot carry mail protocols.

## Part 2: the server setup (you, or an AI agent such as Codex)

1. On your computer, create an SSH key just for this server:
   `ssh-keygen -t ed25519 -f ~/.ssh/mailos_oracle -C mailos-bridge` (no passphrase is fine for a
   dedicated key). Paste `~/.ssh/mailos_oracle.pub` in Part 1, step 1.
2. Connect: `ssh -i ~/.ssh/mailos_oracle ubuntu@SERVER_IP`
3. On the server:

```bash
# Updates, automatic security updates, and a 2 GB swap file (helps the 1 GB micro shape)
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install unattended-upgrades git netfilter-persistent
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Oracle's Ubuntu images block everything except SSH in iptables: open the bridge ports
for p in 80 110 465 587 995; do sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT; done
sudo netfilter-persistent save

# Docker (official install script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu   # then log out and back in

# The bridge
git clone --depth 1 https://github.com/14technologies/mailos.git
cd mailos/bridge
cp .env.example .env
nano .env   # MAILOS_URL=https://mail.yourcompany.com   BRIDGE_HOSTNAME=connect.yourcompany.com

# Free TLS certificate (port 80 must be open), then start the bridge
docker compose run --rm -p 80:80 certbot certonly --standalone -d connect.yourcompany.com --agree-tos -m you@yourcompany.com --non-interactive
sudo chown -R 1000:1000 letsencrypt
docker compose up -d --build bridge
```

4. **Certificate renewal** (Let's Encrypt certificates last 90 days). Add a weekly cron job with
   `crontab -e`:

```
0 4 * * 1 cd /home/ubuntu/mailos/bridge && docker compose run --rm -p 80:80 certbot renew --quiet && sudo chown -R 1000:1000 letsencrypt && docker compose restart bridge
```

5. **Check it:**
   - On the server: `docker compose ps` shows the bridge running; `docker compose logs --tail 50 bridge` has no errors.
   - From anywhere: `openssl s_client -connect connect.yourcompany.com:995 -quiet` prints `+OK MailOS POP3 ready`,
     and `openssl s_client -connect connect.yourcompany.com:465 -quiet` prints a `220` greeting.
   - Restart the VM once (`sudo reboot`) and check the bridge comes back by itself.

**Updating later:** `cd ~/mailos && git pull && cd bridge && docker compose up -d --build bridge`

## Part 3: each person, in their mail app

1. In MailOS: **Settings → App passwords → Create app password**. Copy it; it is shown once.
   Mail apps use this, never the MailOS sign-in password, and it can be revoked any time.
2. In the app, add the account manually:

| Setting | Value |
|---|---|
| Account type | **POP3** |
| Incoming server | `connect.yourcompany.com`, port **995**, **SSL/TLS** |
| Outgoing server | `connect.yourcompany.com`, port **465**, **SSL/TLS** (or 587 with STARTTLS) |
| Username | the full email address, e.g. `you@yourcompany.com` |
| Password | the app password from step 1 |

**Gmail app on Android:** Settings → Add account → **Other** → enter the address → **Personal (POP3)** →
app password → the incoming and outgoing settings above.

## Security notes

- Only people with a valid MailOS app password can sign in, and they can only send as addresses their
  MailOS account owns: the bridge is not an open relay.
- With TLS configured, plain ports (110, 587) require STARTTLS before any password is sent.
- Keep SSH key-only (Oracle's default) and let unattended-upgrades install security updates.
