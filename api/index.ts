const express = require("express");
const cors = require("cors");
const { createClient } = require('@libsql/client');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Turso client
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

const DEFAULT_USERS = ["28259717", "8013817688", "1658013861", "2297463874"];

// Database initialization
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

// User initialization
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

// App initialization
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

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Rate limiting
const rmap = new Map();
const tw = 60000; // 1 minute window
const mr = 100; // max 100 requests per window

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
        error: "Too many requests",
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

// Helper function to get current users
async function getCurrentUsers() {
  try {
    const result = await turso.execute("SELECT id FROM users WHERE removed = FALSE");
    return result.rows.map(row => row.id);
  } catch (error) {
    console.error("Error getting current users:", error);
    return [];
  }
}

// Endpoints

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "NEXIUM" });
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({ message: "NEXIUM ON TOP!" });
});

// Get user IDs as space-separated string
app.get("/api/id", async (req, res) => {
  try {
    const users = await getCurrentUsers();
    res.json({ message: users.join(" ") });
  } catch (error) {
    console.error("Error in /api/id:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all active users with details
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
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Add a new user
app.post("/api/users/add", async (req, res) => {
  const { userid } = req.body;
  console.log(`[ADD] Request to add user: ${userid}`);

  if (!userid) {
    return res.status(400).json({ error: "User ID required" });
  }

  if (!/^\d+$/.test(userid)) {
    return res.status(400).json({ error: "Invalid user ID format" });
  }

  try {
    // Check if user already exists
    const existing = await turso.execute({
      sql: "SELECT 1 FROM users WHERE id = ? AND removed = FALSE",
      args: [userid]
    });

    if (existing.rows.length > 0) {
      console.log(`[ADD] User ${userid} already exists`);
      return res.status(409).json({ error: "User already exists" });
    }

    // Fetch user data from Roblox
    const resp = await fetch(`https://users.roblox.com/v1/users/${userid}`);
    if (!resp.ok) {
      console.log(`[ADD] Failed to fetch user data for ${userid}`);
      return res.status(400).json({ error: "Invalid user ID or API error" });
    }

    const userData = await resp.json();
    
    // Add user to database
    await turso.execute({
      sql: "INSERT OR REPLACE INTO users (id, username, removed) VALUES (?, ?, FALSE)",
      args: [userid, userData.name]
    });

    console.log(`[ADD] Successfully added user ${userid} (${userData.name})`);
    const users = await getCurrentUsers();

    res.json({ 
      message: "Success", 
      users,
      addedUser: {
        id: userid,
        username: userData.name
      }
    });
  } catch (error) {
    console.error("Error adding user:", error);
    res.status(500).json({ 
      error: "Failed to add user",
      details: error.message 
    });
  }
});

// Remove a user
app.delete("/api/users/remove", async (req, res) => {
  const { userid } = req.body;
  console.log(`[REMOVE] Request to remove user: ${userid}`);

  if (!userid) {
    return res.status(400).json({ error: "User ID required" });
  }

  try {
    const result = await turso.execute({
      sql: "UPDATE users SET removed = TRUE, removed_at = CURRENT_TIMESTAMP WHERE id = ? AND removed = FALSE RETURNING 1",
      args: [userid]
    });

    if (result.rows.length === 0) {
      console.log(`[REMOVE] User ${userid} not found in list`);
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`[REMOVE] Successfully removed user ${userid}`);
    const users = await getCurrentUsers();

    res.json({ 
      message: "Removed", 
      users,
      removedUserId: userid
    });
  } catch (error) {
    console.error("Error removing user:", error);
    res.status(500).json({ 
      error: "Failed to remove user",
      details: error.message 
    });
  }
});

// Get list of active user IDs
app.get("/api/users/list", async (req, res) => {
  try {
    const users = await getCurrentUsers();
    res.json({ users });
  } catch (error) {
    console.error("Error in /api/users/list:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${port}/`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

module.exports = app;
