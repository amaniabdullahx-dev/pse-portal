# PSE Web Portal

A working portal for PSE (Pillars for Sustainable Empowerment):

- **Public site** — home page with About, Service Models, and CTA to apply.
- **Candidates** — apply with CV upload, create an account, log in, and check application status.
- **Admin** — secure login, searchable/filterable candidate pipeline, candidate detail view, status updates, CV download.

Built with Node.js, Express, EJS, and SQLite (Node's built-in `node:sqlite` — no native modules to compile, so `npm install` stays simple on any host).

## 1. Run it locally (5 minutes)

You need [Node.js](https://nodejs.org) **22.5 or newer** installed on your computer (for the built-in SQLite support). Check with `node -v`; if you're on an older version, install the current LTS from nodejs.org.

```bash
cd pse-portal
npm install
npm start
```

Open **http://localhost:3000**. A database file is created automatically at `data/pse.db` on first run, along with a default admin account:

> **First run only:** this folder ships with an empty placeholder `data/pse.db`. If you see a database error the very first time you run `npm start`, delete the `data/pse.db` and `data/pse.db-journal` files and run `npm start` again — a clean one will be created automatically.

```
email:    admin@pseconsulting.com
password: PSE-Admin-2026!
```

**Change this password immediately** — open `data/pse.db` isn't the way; instead, temporarily add a route or use a script to update it (ask me and I'll add a "change password" screen, or run the snippet in section 4 below).

## 2. Put it on the internet (your domain)

This code is ready to deploy — it just needs to live on a server instead of your laptop. Three beginner-friendly options, easiest first:

### Option A — Render.com (recommended, free tier available)
1. Create a free account at render.com and connect your GitHub account.
2. Push this `pse-portal` folder to a new GitHub repository.
3. In Render: **New → Web Service** → select the repo.
4. Build command: `npm install` — Start command: `npm start`.
5. Add a **persistent disk** (Render dashboard → Disks) mounted at `/opt/render/project/src/data` so uploaded CVs and the database survive restarts.
6. Once deployed, Render gives you a URL like `pse-portal.onrender.com`.

### Option B — Railway.app
Same idea as Render: connect the GitHub repo, it detects Node.js automatically, add a volume for the `data/` folder.

### Option C — A VPS (DigitalOcean, AWS Lightsail, etc.)
More control, more setup: install Node.js on the server, copy this folder over (`scp` or `git clone`), run `npm install --production`, then keep it running with `pm2 start server.js`. Point your domain's DNS at the server's IP.

## 3. Connect your domain (pseconsulting.com or whichever you register)

1. Buy the domain from any registrar (Namecheap, GoDaddy, or Saudi Arabia's SaudiNIC for a `.sa` domain).
2. In the registrar's DNS settings, add the record your host gives you:
   - Render/Railway: usually a **CNAME** record pointing `www` at the URL they gave you, plus an **A record** or "ALIAS" for the bare domain — each host's dashboard shows the exact values under "Custom Domain."
3. Add the domain in your hosting dashboard (Render: Settings → Custom Domain) and wait for it to verify (can take up to 24 hours).
4. Your site is now live at your own domain, with free HTTPS handled automatically by Render/Railway.

**Ask me when you get here — I'll walk you through whichever option you pick, step by step.**

## 4. Change the admin password

Run this once, locally or on the server (replace the password):

```bash
node -e "
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const hash = bcrypt.hashSync('YOUR-NEW-PASSWORD', 10);
db.prepare('UPDATE admins SET password_hash = ? WHERE email = ?').run(hash, 'admin@pseconsulting.com');
console.log('Password updated.');
"
```

## 5. Project structure

```
pse-portal/
  server.js         all routes (public site, candidate auth, admin auth)
  db.js             SQLite schema + connection
  views/            EJS templates (site pages, candidate pages, admin/)
  public/           CSS + logo images
  data/             created on first run — pse.db + uploaded CVs (not in git)
```

## 6. Before going live — checklist

- [ ] Change the default admin password (section 4).
- [ ] Replace placeholder content on the "Our Team" slide of the pitch deck with your real bio.
- [ ] Set a real `SESSION_SECRET` environment variable on your host (any long random string).
- [ ] Confirm the contact email/phone in `views/partials/site-footer.ejs` match your final domain and number.
- [ ] Decide on a real privacy policy / data retention note before collecting candidate CVs at scale — you're handling personal data (MHRSD/PDPL considerations).
