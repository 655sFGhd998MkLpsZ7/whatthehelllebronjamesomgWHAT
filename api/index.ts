const express = require("express");
const cors = require("cors");
const { createClient } = require('@libsql/client');
const app = express();
const port = process.env.PORT || 3000;

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function initializeDatabase() {
  try {
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        removed BOOLEAN DEFAULT FALSE,
        removed_at TEXT
      )
    `);
    console.log("Database initialized");
  } catch (error) {
    console.error("Error initializing database:", error);
    process.exit(1);
  }
}

initializeDatabase();

const DEFAULT_USERS = ["37218933", "7905349991", "28259717", "1044958583", "2297463874", "2296980322", "23647969", "351069", "7281612909", "1578598009", "4721316027", "8609495309"];

async function initializeUsers() {
  try {
    const result = await turso.execute("SELECT id FROM users WHERE removed = FALSE");
    if (result.rows.length === 0) {
      console.log("No existing users found, adding default users");
      for (const userId of DEFAULT_USERS) {
        try {
          const resp = await fetch(`https://users.roblox.com/v1/users/${userId}`);
          if (resp.ok) {
            const userData = await resp.json();
            await turso.execute({
              sql: "INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)",
              args: [userId, userData.name]
            });
          }
        } catch (error) {
          console.error(`Error adding default user ${userId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Error initializing users:", error);
  }
}

initializeUsers();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const rmap = new Map();
const tw = 60000;
const mr = 100;

const rlim = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rmap.has(ip)) {
    rmap.set(ip, { count: 1, resetTime: now + tw });
    return next();
  }

  const data = rmap.get(ip);

  if (now > data.resetTime) {
    data.count = 1;
    data.resetTime = now + tw;
    return next();
  }

  if (data.count >= mr) {
    return res.status(429).json({
      error: "too many requests",
      retry: Math.ceil((data.resetTime - now) / 1000),
    });
  }

  data.count++;
  next();
};

app.use(rlim);

async function getCurrentUsers() {
  try {
    const result = await turso.execute("SELECT id FROM users WHERE removed = FALSE");
    return result.rows.map(row => row.id);
  } catch (error) {
    console.error("Error getting current users:", error);
    return [];
  }
}

app.get("/", (req, res) => {
  res.send({ message: "NEXIUM" });
});

app.get("/api/test", (req, res) => {
  res.json({ message: "NEXIUM ON TOP!" });
});

app.get("/api/id", async (req, res) => {
  const users = await getCurrentUsers();
  res.json({ message: users.join(" ") });
});

app.get("/api/users", async (req, res) => {
  try {
    const result = await turso.execute("SELECT id, username FROM users WHERE removed = FALSE");
    const users = result.rows.map(row => ({
      id: row.id,
      username: row.username
    }));
    res.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      error: "failed to fetch",
      fallback: { message: "idk why u got this error" },
    });
  }
});

app.post("/api/users/add", async (req, res) => {
  const { userid } = req.body;
  console.log(`[ADD] request to add user: ${userid}`);

  if (!userid) {
    return res.status(400).json({ error: "id required" });
  }

  if (!/^\d+$/.test(userid)) {
    return res.status(400).json({ error: "invalid user id format" });
  }

  try {
    const existing = await turso.execute({
      sql: "SELECT 1 FROM users WHERE id = ? AND removed = FALSE",
      args: [userid]
    });

    if (existing.rows.length > 0) {
      console.log(`[ADD] user ${userid} already exists`);
      return res.status(409).json({ error: "already exists" });
    }

    const resp = await fetch(`https://users.roblox.com/v1/users/${userid}`);
    if (!resp.ok) {
      console.log(`[ADD] failed to fetch user data for ${userid}`);
      return res.status(400).json({ error: "invalid user id or API error" });
    }

    const userData = await resp.json();
    await turso.execute({
      sql: "INSERT OR REPLACE INTO users (id, username, removed) VALUES (?, ?, FALSE)",
      args: [userid, userData.name]
    });

    console.log(`[ADD] successfully added user ${userid} (${userData.name})`);
    const users = await getCurrentUsers();

    res.json({ 
      message: "success", 
      users,
      addedUser: {
        id: userid,
        username: userData.name
      }
    });
  } catch (error) {
    console.error("error adding user:", error);
    res.status(500).json({ 
      error: "failed to add user",
      details: error.message 
    });
  }
});

app.delete("/api/users/remove", async (req, res) => {
  const { userid } = req.body;
  console.log(`[REMOVE] request to remove user: ${userid}`);

  if (!userid) {
    return res.status(400).json({ error: "id required" });
  }

  try {
    const result = await turso.execute({
      sql: "UPDATE users SET removed = TRUE, removed_at = CURRENT_TIMESTAMP WHERE id = ? AND removed = FALSE RETURNING 1",
      args: [userid]
    });

    if (result.rows.length === 0) {
      console.log(`[REMOVE] user ${userid} not found in list`);
      return res.status(404).json({ error: "not found" });
    }

    console.log(`[REMOVE] successfully removed user ${userid}`);
    const users = await getCurrentUsers();

    res.json({ 
      message: "removed", 
      users,
      removedUserId: userid
    });
  } catch (error) {
    console.error("error removing user:", error);
    res.status(500).json({ 
      error: "failed to remove user",
      details: error.message 
    });
  }
});

app.get("/api/users/list", async (req, res) => {
  const users = await getCurrentUsers();
  res.json({ users });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`running at http://0.0.0.0:${port}/`);
});

module.exports = app;
