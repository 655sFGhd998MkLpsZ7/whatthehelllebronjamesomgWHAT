const express = require("express");
const cors = require("cors");
const { createClient } = require('@libsql/client');
const fetch = require('node-fetch'); // Added missing fetch import
const app = express();
const port = process.env.PORT || 3000;

// Initialize Turso client with error handling
let turso;
try {
  turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
} catch (error) {
  console.error("Failed to initialize Turso client:", error);
  process.exit(1);
}

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

const DEFAULT_USERS = ["28259717, "8013817688", "1658013861", "2297463874"];

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

// Initialize database and users with error handling
async function initializeApp() {
  try {
    await initializeDatabase();
    await initializeUsers();
    console.log("App initialization complete");
  } catch (error) {
    console.error("Failed to initialize app:", error);
    process.exit(1);
  }
}

initializeApp();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const rmap = new Map();
const tw = 60000;
const mr = 100;

const rlim = (req, res, next) => {
  try {
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
  } catch (error) {
    console.error("Rate limiter error:", error);
    next();
  }
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.get("/", (req, res) => {
  res.send({ message: "NEXIUM" });
});

app.get("/api/test", (req, res) => {
  res.json({ message: "NEXIUM ON TOP!" });
});

app.get("/api/id", async (req, res) => {
  try {
    const users = await getCurrentUsers();
    res.json({ message: users.join(" ") });
  } catch (error) {
    console.error("Error in /api/id:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ... [rest of your route handlers remain the same] ...

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`running at http://0.0.0.0:${port}/`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

module.exports = app;
