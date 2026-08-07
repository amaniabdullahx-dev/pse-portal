const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { db, UPLOADS_DIR } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "pse-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 },
  })
);

// make `candidate` available to every view (for header nav state)
app.use((req, res, next) => {
  res.locals.candidate = req.session.candidateId
    ? db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.session.candidateId)
    : null;
  next();
});

// ---------- file upload config ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [".pdf", ".doc", ".docx"].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Only PDF or Word files are accepted."), ok);
  },
});

// ============================================================
// PUBLIC SITE
// ============================================================
app.get("/", (req, res) => res.render("index"));

// ============================================================
// CANDIDATE: APPLY
// ============================================================
app.get("/apply", (req, res) => res.render("apply", { error: null, old: {} }));

app.post("/apply", (req, res) => {
  upload.single("cv")(req, res, (err) => {
    if (err) return res.render("apply", { error: err.message, old: req.body });

    const {
      full_name, email, phone, password, password2,
      specialization, years_experience, giga_project_experience,
    } = req.body;

    if (!req.file) {
      return res.render("apply", { error: "Please attach your CV (PDF or Word).", old: req.body });
    }
    if (password !== password2) {
      fs.unlinkSync(req.file.path);
      return res.render("apply", { error: "Passwords do not match.", old: req.body });
    }
    if (password.length < 8) {
      fs.unlinkSync(req.file.path);
      return res.render("apply", { error: "Password must be at least 8 characters.", old: req.body });
    }

    const existing = db.prepare("SELECT id FROM candidates WHERE email = ?").get(email.toLowerCase().trim());
    if (existing) {
      fs.unlinkSync(req.file.path);
      return res.render("apply", { error: "An application with this email already exists. Please log in instead.", old: req.body });
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(`INSERT INTO candidates
        (full_name, email, phone, password_hash, specialization, years_experience, giga_project_experience, cv_filename, cv_original_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        full_name.trim(),
        email.toLowerCase().trim(),
        phone.trim(),
        hash,
        specialization.trim(),
        years_experience,
        giga_project_experience ? giga_project_experience.trim() : "",
        req.file.filename,
        req.file.originalname
      );

    req.session.candidateId = info.lastInsertRowid;
    res.redirect("/dashboard");
  });
});

// ============================================================
// CANDIDATE: LOGIN / DASHBOARD
// ============================================================
app.get("/login", (req, res) => res.render("login", { error: null }));

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const c = db.prepare("SELECT * FROM candidates WHERE email = ?").get((email || "").toLowerCase().trim());
  if (!c || !bcrypt.compareSync(password || "", c.password_hash)) {
    return res.render("login", { error: "Invalid email or password." });
  }
  req.session.candidateId = c.id;
  res.redirect("/dashboard");
});

function requireCandidate(req, res, next) {
  if (!req.session.candidateId) return res.redirect("/login");
  next();
}

app.get("/dashboard", requireCandidate, (req, res) => {
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.session.candidateId);
  res.render("dashboard", { candidate });
});

app.get("/logout", (req, res) => {
  req.session.candidateId = null;
  res.redirect("/");
});

// ============================================================
// ADMIN
// ============================================================
app.get("/admin/login", (req, res) => res.render("admin/login", { error: null }));

app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;
  const a = db.prepare("SELECT * FROM admins WHERE email = ?").get((email || "").toLowerCase().trim());
  if (!a || !bcrypt.compareSync(password || "", a.password_hash)) {
    return res.render("admin/login", { error: "Invalid email or password." });
  }
  req.session.adminId = a.id;
  res.redirect("/admin/dashboard");
});

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect("/admin/login");
  next();
}

app.get("/admin/dashboard", requireAdmin, (req, res) => {
  const q = (req.query.q || "").trim();
  const status = req.query.status || "";
  let sql = "SELECT * FROM candidates WHERE 1=1";
  const params = [];
  if (q) {
    sql += " AND (full_name LIKE ? OR email LIKE ? OR specialization LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC";
  const candidates = db.prepare(sql).all(...params);
  res.render("admin/dashboard", { candidates, query: { q, status } });
});

app.get("/admin/candidate/:id", requireAdmin, (req, res) => {
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.id);
  if (!candidate) return res.status(404).send("Candidate not found.");
  res.render("admin/candidate", { candidate, saved: req.query.saved === "1" });
});

app.post("/admin/candidate/:id", requireAdmin, (req, res) => {
  const { status, admin_notes } = req.body;
  db.prepare("UPDATE candidates SET status = ?, admin_notes = ? WHERE id = ?").run(status, admin_notes || "", req.params.id);
  res.redirect(`/admin/candidate/${req.params.id}?saved=1`);
});

app.get("/admin/candidate/:id/cv", requireAdmin, (req, res) => {
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.id);
  if (!candidate || !candidate.cv_filename) return res.status(404).send("File not found.");
  res.download(path.join(UPLOADS_DIR, candidate.cv_filename), candidate.cv_original_name);
});

app.get("/admin/logout", (req, res) => {
  req.session.adminId = null;
  res.redirect("/admin/login");
});

// ============================================================
app.listen(PORT, () => {
  console.log(`PSE portal running at http://localhost:${PORT}`);
});
