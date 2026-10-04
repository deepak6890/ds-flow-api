require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required.");
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4"
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()) : false
}));
app.use(express.json({ limit: "100kb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });
}

function requireJwt(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.auth = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

function isoOrNull(d) {
  return d ? new Date(d).toISOString() : null;
}

async function logAction(actor, action, targetUserId = null, details = null) {
  await pool.execute(
    "INSERT INTO audit_logs (actor, action, target_user_id, details) VALUES (?, ?, ?, ?)",
    [actor, action, targetUserId, details ? JSON.stringify(details) : null]
  );
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "DS FLOW API", domain: "flowwultra.online" });
  } catch {
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    return res.json({ token: signToken({ role: "admin", email }), admin: { email } });
  }
  return res.status(401).json({ error: "Invalid admin credentials" });
});

app.post("/api/extension/login", loginLimiter, async (req, res) => {
  try {
    const { email, password, deviceId, deviceName } = req.body || {};
    if (!email || !password || !deviceId) {
      return res.status(400).json({ error: "Email, password and deviceId are required" });
    }

    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE email = ? LIMIT 1", [String(email).trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid login" });
    if (user.status !== "active") return res.status(403).json({ error: "Account blocked" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid login" });

    if (user.subscription_expires_at && new Date(user.subscription_expires_at) <= new Date()) {
      return res.status(403).json({ error: "Subscription expired", expiresAt: user.subscription_expires_at });
    }

    const [devices] = await pool.execute(
      "SELECT device_id FROM devices WHERE user_id = ?", [user.id]
    );
    const already = devices.some(d => d.device_id === String(deviceId));
    if (!already && devices.length >= user.max_devices) {
      return res.status(403).json({ error: "Maximum devices reached" });
    }

    await pool.execute(
      `INSERT INTO devices (user_id, device_id, device_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE device_name = VALUES(device_name), last_seen_at = CURRENT_TIMESTAMP`,
      [user.id, String(deviceId), deviceName ? String(deviceName).slice(0, 190) : null]
    );

    const [servers] = await pool.execute(
      "SELECT server_no FROM user_servers WHERE user_id = ? ORDER BY server_no", [user.id]
    );

    const token = signToken({ role: "user", userId: user.id, deviceId: String(deviceId) });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        expiresAt: isoOrNull(user.subscription_expires_at),
        maxDevices: user.max_devices,
        servers: servers.map(x => x.server_no)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/extension/me", requireJwt, async (req, res) => {
  if (req.auth.role !== "user") return res.status(403).json({ error: "User token required" });
  const [rows] = await pool.execute(
    "SELECT id,email,subscription_expires_at,max_devices,status FROM users WHERE id=? LIMIT 1",
    [req.auth.userId]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });

  const [servers] = await pool.execute(
    "SELECT server_no FROM user_servers WHERE user_id=? ORDER BY server_no", [user.id]
  );
  res.json({
    user: {
      ...user,
      expiresAt: isoOrNull(user.subscription_expires_at),
      servers: servers.map(x => x.server_no)
    }
  });
});

app.use("/api/admin", requireJwt, requireAdmin);

app.get("/api/admin/users", async (req, res) => {
  const [users] = await pool.query(
    "SELECT id,email,subscription_expires_at,max_devices,status,created_at FROM users ORDER BY id DESC"
  );
  const [servers] = await pool.query("SELECT user_id,server_no FROM user_servers ORDER BY server_no");
  const [devices] = await pool.query("SELECT user_id,COUNT(*) count FROM devices GROUP BY user_id");

  const byUser = {};
  for (const s of servers) (byUser[s.user_id] ||= []).push(s.server_no);
  const deviceCount = Object.fromEntries(devices.map(d => [d.user_id, Number(d.count)]));

  res.json(users.map(u => ({
    ...u,
    expiresAt: isoOrNull(u.subscription_expires_at),
    servers: byUser[u.id] || [],
    devices: deviceCount[u.id] || 0
  })));
});

app.post("/api/admin/users", async (req, res) => {
  try {
    const { email, password, subscriptionDays = 30, maxDevices = 1, servers = [] } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const cleanEmail = String(email).trim().toLowerCase();
    const hash = await bcrypt.hash(String(password), 12);
    const days = Math.max(1, Number(subscriptionDays));
    const max = Math.max(1, Number(maxDevices));
    const expires = new Date(Date.now() + days * 86400000);

    const [result] = await pool.execute(
      "INSERT INTO users (email,password_hash,subscription_expires_at,max_devices) VALUES (?,?,?,?)",
      [cleanEmail, hash, expires, max]
    );

    const userId = result.insertId;
    const requested = Array.isArray(servers) ? [...new Set(servers.map(Number).filter(n => n >= 1 && n <= 7))] : [];
    if (requested.length) {
      const values = requested.map(n => [userId, n]);
      await pool.query("INSERT INTO user_servers (user_id,server_no) VALUES ?", [values]);
    }

    await logAction(req.auth.email, "create_user", userId, { email: cleanEmail });
    res.status(201).json({ id: userId, email: cleanEmail, expiresAt: expires.toISOString(), servers: requested });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Email already exists" });
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/admin/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status, maxDevices, subscriptionDays, servers, password } = req.body || {};

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (status !== undefined) {
      await conn.execute("UPDATE users SET status=? WHERE id=?", [status === "blocked" ? "blocked" : "active", id]);
    }
    if (maxDevices !== undefined) {
      await conn.execute("UPDATE users SET max_devices=? WHERE id=?", [Math.max(1, Number(maxDevices)), id]);
    }
    if (subscriptionDays !== undefined) {
      const days = Math.max(1, Number(subscriptionDays));
      await conn.execute(
        "UPDATE users SET subscription_expires_at=DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id=?",
        [days, id]
      );
    }
    if (password) {
      const hash = await bcrypt.hash(String(password), 12);
      await conn.execute("UPDATE users SET password_hash=? WHERE id=?", [hash, id]);
    }
    if (Array.isArray(servers)) {
      await conn.execute("DELETE FROM user_servers WHERE user_id=?", [id]);
      const requested = [...new Set(servers.map(Number).filter(n => n >= 1 && n <= 7))];
      if (requested.length) {
        await conn.query(
          "INSERT INTO user_servers (user_id,server_no) VALUES ?",
          [requested.map(n => [id, n])]
        );
      }
    }

    await conn.commit();
    await logAction(req.auth.email, "update_user", id, { fields: Object.keys(req.body || {}) });
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: "Server error" });
  } finally {
    conn.release();
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  await pool.execute("DELETE FROM users WHERE id=?", [id]);
  await logAction(req.auth.email, "delete_user", id);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/clear-devices", async (req, res) => {
  const id = Number(req.params.id);
  await pool.execute("DELETE FROM devices WHERE user_id=?", [id]);
  await logAction(req.auth.email, "clear_devices", id);
  res.json({ ok: true });
});

app.get("/api/admin/logs", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id,actor,action,target_user_id,details,created_at FROM audit_logs ORDER BY id DESC LIMIT 200"
  );
  res.json(rows);
});

// Serve the live Owner Control Panel from the same domain.
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`DS FLOW API listening on port ${PORT}`);
});
