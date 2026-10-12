// Zero-dependency server: serves the static site and a small JSON API.
// Run with: node server.js   (PORT env var overrides 3000)
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "listings.json");
const PORT = process.env.PORT || 3000;
const MAX_BODY = 100 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const GENDERS = ["male", "female", "unisex"];

const readListings = () => JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

function writeListings(list) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function send(res, status, body, type = MIME[".json"]) {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Returns { value } or { error }. Never trusts client-supplied id/rating.
function validate(input) {
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(input.name, 80);
  const city = str(input.city, 60);
  const locality = str(input.locality, 80);
  const phone = str(input.phone, 15).replace(/[\s-]/g, "");
  const rent = Number(input.rent);
  const sharing = Number(input.sharing);

  if (!name || !city || !locality) return { error: "name, city and locality are required" };
  if (!/^\d{10}$/.test(phone)) return { error: "phone must be 10 digits" };
  if (!Number.isInteger(rent) || rent < 500 || rent > 200000) return { error: "rent must be between 500 and 200000" };
  if (![1, 2, 3, 4].includes(sharing)) return { error: "sharing must be 1-4" };
  if (!GENDERS.includes(input.gender)) return { error: "invalid gender" };

  const list = (v, maxItems, maxLen) =>
    Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

  const coord = (v, lo, hi) => (typeof v === "number" && v >= lo && v <= hi ? v : null);

  return {
    value: {
      name, city, locality, phone, rent, sharing,
      gender: input.gender,
      rating: null,
      amenities: list(input.amenities, 12, 30),
      description: str(input.description, 500),
      rules: list(input.rules, 10, 120),
      lat: coord(input.lat, -90, 90),
      lng: coord(input.lng, -180, 180),
    },
  };
}

async function handleApi(req, res, url) {
  const match = url.pathname.match(/^\/api\/listings(?:\/(\d+))?$/);
  if (!match) return send(res, 404, { error: "Not found" });
  const id = match[1] ? Number(match[1]) : null;

  if (req.method === "GET") {
    const list = readListings();
    if (id === null) return send(res, 200, list);
    const item = list.find((l) => l.id === id);
    return item ? send(res, 200, item) : send(res, 404, { error: "Not found" });
  }

  if (req.method === "POST" && id === null) {
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      return send(res, 400, { error: "Invalid JSON" });
    }
    const { value, error } = validate(input || {});
    if (error) return send(res, 400, { error });
    const list = readListings();
    value.id = list.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    list.push(value);
    writeListings(list);
    return send(res, 201, value);
  }

  send(res, 405, { error: "Method not allowed" });
}

function serveStatic(res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad request", "text/plain");
  }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  const allowed = ["index.html", "css", "js", "data"].some(
    (p) => file === path.join(ROOT, p) || file.startsWith(path.join(ROOT, p) + path.sep)
  );
  if (!file.startsWith(ROOT + path.sep) || !allowed) return send(res, 404, "Not found", "text/plain");

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const run = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : serveStatic(res, url);
    Promise.resolve(run).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: "Server error" });
    });
  })
  .listen(PORT, () => console.log(`PG Finder running at http://localhost:${PORT}`));
