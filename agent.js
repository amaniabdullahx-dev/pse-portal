// PSE Talent Agent — reads CVs, scores candidates against the PSE rubric,
// matches them to client roles, and produces ranked reports.
// The agent only RECOMMENDS. It never changes a candidate's status or rejects anyone;
// every decision stays with a PSE admin.
//
// Needs env var ANTHROPIC_API_KEY (set in Railway). Optional: AI_MODEL.
// No extra npm dependencies: PDFs go to the model natively, .docx text is read with node:zlib.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";

// ---------------- rubric (total = 100) ----------------
const RUBRIC = [
  { key: "specialization", label: "Specialization fit", max: 25,
    guide: "Engineering or economics background with direct relevance to energy / sustainable energy / sustainability." },
  { key: "experience", label: "Seniority & career progression", max: 20,
    guide: "Years of relevant experience, job titles, scope of responsibility, upward progression." },
  { key: "vision2030", label: "Vision 2030 / Giga-Project exposure", max: 20,
    guide: "Work with Vision 2030 entities, Giga-Projects, PIF subsidiaries, or national-KPI programmes." },
  { key: "education", label: "Education & certifications", max: 15,
    guide: "Degree level and field, institution, professional certifications (e.g. PE, PMP, CFA, CEM, LEED)." },
  { key: "technical", label: "Evidence of technical depth", max: 15,
    guide: "Specific projects, tools, quantified achievements, publications; not just buzzwords." },
  { key: "cv_quality", label: "CV clarity & completeness", max: 5,
    guide: "Clear, consistent, complete, no unexplained gaps." },
];

// ---------------- DB ----------------
function setup(db) {
  const cols = db.prepare("PRAGMA table_info(candidates)").all().map((c) => c.name);
  const add = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE candidates ADD COLUMN ${name} ${def}`); };
  add("ai_status", "TEXT");        // null | running | done | error
  add("ai_score", "INTEGER");
  add("ai_report", "TEXT");        // JSON
  add("ai_error", "TEXT");
  add("ai_scored_at", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS job_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      score INTEGER,
      rationale TEXT,
      gaps TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(job_id, candidate_id)
    );
  `);
}

// ---------------- CV reading ----------------
function readDocxText(file) {
  // Minimal zip reader: find word/document.xml in the archive and inflate it.
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .docx file");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    if (name === "word/document.xml") {
      const ln = buf.readUInt16LE(lho + 26);
      const le = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + ln + le;
      const data = buf.subarray(start, start + csize);
      const xml = (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8");
      return xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error("Could not find text in .docx");
}

function cvContent(file, originalName) {
  const ext = path.extname(originalName || file).toLowerCase();
  if (ext === ".pdf") {
    return [{
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(file).toString("base64") },
    }];
  }
  if (ext === ".docx") {
    const text = readDocxText(file);
    if (!text) throw new Error("The Word file has no readable text");
    return [{ type: "text", text: "CV TEXT:\n\n" + text.slice(0, 60000) }];
  }
  throw new Error("Old .doc format cannot be read automatically. Ask the candidate for PDF or .docx.");
}

// ---------------- model call ----------------
async function askModel(content, system, maxTokens = 3000) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("AI request failed: " + ((body.error && body.error.message) || res.status));
  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI returned no JSON");
  return JSON.parse(m[0]);
}

const SYSTEM_SCORE = `You are the screening analyst for PSE (Pillars for Sustainable Empowerment), a Saudi consulting boutique that places specialized Saudi female professionals (engineering and economics) in energy and sustainability roles at Vision 2030 entities, Giga-Projects and PIF subsidiaries.
Analyse the CV objectively and ONLY from what the CV says. Never invent facts. If something is not stated, say "not stated".
Do not penalise or reward anything based on name, age, religion, or appearance. Nationality and gender are recorded only as eligibility information for a human to verify; they are NOT part of the score.
Score using this rubric (max points in brackets):
${RUBRIC.map((r) => `- ${r.key} [${r.max}]: ${r.guide}`).join("\n")}
Return ONLY a JSON object, no other text, in exactly this shape:
{
 "profile": {"name":"","current_title":"","years_experience":0,"education":[{"degree":"","field":"","institution":"","year":""}],"certifications":[""],"employers":[{"name":"","title":"","period":""}],"skills":[""],"giga_vision2030_projects":[""],"languages":[""],"nationality_stated":"","gender_stated":""},
 "scores": {"specialization":{"points":0,"why":""},"experience":{"points":0,"why":""},"vision2030":{"points":0,"why":""},"education":{"points":0,"why":""},"technical":{"points":0,"why":""},"cv_quality":{"points":0,"why":""}},
 "summary": "3 sentences for a PSE recruiter",
 "strengths": [""],
 "gaps": [""],
 "red_flags": [""],
 "interview_questions": [""],
 "eligibility_notes": "what the CV says about nationality/gender and what a human should verify"
}
Points must be integers within each criterion's maximum.`;

function finalize(result) {
  let total = 0;
  RUBRIC.forEach((r) => {
    const s = (result.scores && result.scores[r.key]) || { points: 0, why: "" };
    s.points = Math.max(0, Math.min(r.max, Math.round(Number(s.points) || 0)));
    result.scores[r.key] = s;
    total += s.points;
  });
  result.total = total;
  result.tier = total >= 75 ? "Strong" : total >= 55 ? "Review" : "Weak";
  return result;
}

async function analyzeCandidate(db, UPLOADS_DIR, id) {
  const c = db.prepare("SELECT * FROM candidates WHERE id = ?").get(id);
  if (!c) return;
  db.prepare("UPDATE candidates SET ai_status='running', ai_error=NULL WHERE id=?").run(id);
  try {
    const file = path.join(UPLOADS_DIR, c.cv_filename);
    const content = cvContent(file, c.cv_original_name);
    content.push({
      type: "text",
      text:
        "Application form data (self-reported):\n" +
        `Specialization: ${c.specialization || "-"}\nYears of experience: ${c.years_experience || "-"}\n` +
        `Giga-project experience: ${c.giga_project_experience || "-"}\n\nAnalyse the CV above.`,
    });
    const result = finalize(await askModel(content, SYSTEM_SCORE, 3500));
    db.prepare(
      "UPDATE candidates SET ai_status='done', ai_score=?, ai_report=?, ai_scored_at=datetime('now') WHERE id=?"
    ).run(result.total, JSON.stringify(result), id);
  } catch (e) {
    db.prepare("UPDATE candidates SET ai_status='error', ai_error=? WHERE id=?").run(String(e.message || e).slice(0, 400), id);
  }
}

async function matchCandidate(db, job, c) {
  const report = JSON.parse(c.ai_report);
  const system = `You match candidate profiles to a client role for PSE, a Saudi talent boutique. Use ONLY the candidate profile given. Be strict and evidence-based. Return ONLY JSON: {"score":0-100,"rationale":"2-3 sentences","gaps":["..."]}`;
  const text =
    `ROLE\nClient: ${job.client}\nTitle: ${job.title}\nDescription / requirements:\n${job.description}\n\n` +
    `CANDIDATE PROFILE\n${JSON.stringify(report.profile)}\nStrengths: ${JSON.stringify(report.strengths)}\nGaps: ${JSON.stringify(report.gaps)}`;
  const r = await askModel([{ type: "text", text }], system, 600);
  const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
  db.prepare(
    `INSERT INTO job_matches (job_id, candidate_id, score, rationale, gaps) VALUES (?,?,?,?,?)
     ON CONFLICT(job_id, candidate_id) DO UPDATE SET score=excluded.score, rationale=excluded.rationale, gaps=excluded.gaps, created_at=datetime('now')`
  ).run(job.id, c.id, score, r.rationale || "", JSON.stringify(r.gaps || []));
}

// simple in-memory queue so the server never runs more than one CV at a time
const queue = [];
let busy = false;
function enqueue(fn) {
  queue.push(fn);
  if (!busy) drain();
}
async function drain() {
  busy = true;
  while (queue.length) {
    try { await queue.shift()(); } catch (e) { console.error("agent job failed:", e.message); }
  }
  busy = false;
}

// ---------------- routes ----------------
function mount(app, { db, UPLOADS_DIR, requireAdmin }) {
  setup(db);
  const configured = () => !!process.env.ANTHROPIC_API_KEY;
  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

  // run the agent on one candidate
  app.post("/admin/candidate/:id/analyze", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE candidates SET ai_status='running' WHERE id=?").run(id);
    enqueue(() => analyzeCandidate(db, UPLOADS_DIR, id));
    res.redirect(`/admin/candidate/${id}?saved=0`);
  });

  // run the agent on every candidate that has no report yet (or errored)
  app.post("/admin/agent/analyze-all", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT id FROM candidates WHERE ai_status IS NULL OR ai_status='error'").all();
    rows.forEach((r) => {
      db.prepare("UPDATE candidates SET ai_status='running' WHERE id=?").run(r.id);
      enqueue(() => analyzeCandidate(db, UPLOADS_DIR, r.id));
    });
    res.redirect("/admin/report");
  });

  // ranked report of all analysed candidates (print-friendly)
  app.get("/admin/report", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM candidates WHERE ai_report IS NOT NULL ORDER BY ai_score DESC").all();
    const pending = db.prepare("SELECT COUNT(*) AS c FROM candidates WHERE ai_status='running'").get().c;
    const unscored = db.prepare("SELECT COUNT(*) AS c FROM candidates WHERE ai_status IS NULL OR ai_status='error'").get().c;
    const items = rows.map((c) => ({ c, r: parse(c.ai_report) })).filter((x) => x.r);
    res.render("admin/report", { items, pending, unscored, configured: configured(), RUBRIC });
  });

  // jobs
  app.get("/admin/jobs", requireAdmin, (req, res) => {
    const jobs = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
    res.render("admin/jobs", { jobs, configured: configured() });
  });
  app.post("/admin/jobs", requireAdmin, (req, res) => {
    const { client, title, description } = req.body;
    if (client && title && description) {
      const info = db.prepare("INSERT INTO jobs (client,title,description) VALUES (?,?,?)").run(client.trim(), title.trim(), description.trim());
      return res.redirect("/admin/jobs/" + info.lastInsertRowid);
    }
    res.redirect("/admin/jobs");
  });
  app.get("/admin/jobs/:id", requireAdmin, (req, res) => {
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
    if (!job) return res.status(404).send("Role not found.");
    const matches = db.prepare(
      `SELECT m.*, c.full_name, c.email, c.specialization, c.ai_score, c.status FROM job_matches m
       JOIN candidates c ON c.id=m.candidate_id WHERE m.job_id=? ORDER BY m.score DESC`
    ).all(job.id).map((m) => ({ ...m, gaps: parse(m.gaps) || [] }));
    res.render("admin/job", { job, matches, configured: configured() });
  });
  app.post("/admin/jobs/:id/match", requireAdmin, (req, res) => {
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
    if (!job) return res.status(404).send("Role not found.");
    db.prepare("SELECT * FROM candidates WHERE ai_report IS NOT NULL").all().forEach((c) => {
      enqueue(() => matchCandidate(db, job, c));
    });
    res.redirect("/admin/jobs/" + job.id);
  });
  app.post("/admin/jobs/:id/close", requireAdmin, (req, res) => {
    db.prepare("UPDATE jobs SET status = CASE status WHEN 'Open' THEN 'Closed' ELSE 'Open' END WHERE id=?").run(req.params.id);
    res.redirect("/admin/jobs/" + req.params.id);
  });
}

// make a parsed report + rubric available to the candidate page
function loadReport(c) {
  try { return c.ai_report ? JSON.parse(c.ai_report) : null; } catch (e) { return null; }
}

module.exports = { mount, setup, enqueue, analyzeCandidate, loadReport, RUBRIC };
