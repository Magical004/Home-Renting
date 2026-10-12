const SHARING_LABELS = { 1: "Single", 2: "Double", 3: "Triple", 4: "4+ sharing" };
const COMMON_AMENITIES = ["WiFi", "Meals", "AC", "Laundry", "Parking", "Security", "Power backup", "Housekeeping"];
const API = "/api/listings";
const LS_SHORTLIST = "pg-shortlist";
const LS_LOCAL = "pg-local-listings";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("filter-form"), q: $("q"), city: $("city"), rent: $("rent"), rentOut: $("rent-out"),
  gender: $("gender"), sharing: $("sharing"), amenities: $("amenities"), shortlisted: $("shortlisted"),
  shortCount: $("short-count"), sort: $("sort"), count: $("count"), notice: $("notice"),
  listings: $("listings"), map: $("map"), viewList: $("view-list"), viewMap: $("view-map"),
  detail: $("detail"), addDialog: $("add-dialog"), addForm: $("add-form"), addError: $("add-error"),
  addAmenities: $("add-amenities"), cityList: $("city-list"),
};

const state = { listings: [], shortlist: new Set(), backend: true, view: "list", map: null, markers: null };

/* ---------- helpers ---------- */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function lsGet(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

function showNotice(msg) {
  els.notice.textContent = msg;
  els.notice.hidden = !msg;
}

/* ---------- data ---------- */

async function loadListings() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(res.status);
    state.listings = await res.json();
    state.backend = true;
  } catch {
    // No API (e.g. static hosting): seed file plus listings saved in this browser.
    state.backend = false;
    try {
      const res = await fetch("data/listings.json");
      state.listings = await res.json();
    } catch {
      state.listings = [];
      showNotice("Couldn't load listings. Start the server with `npm start` and open http://localhost:3000.");
      return;
    }
    state.listings.push(...lsGet(LS_LOCAL, []));
    showNotice("Running without the server: new listings are saved only in this browser.");
  }
}

async function saveListing(data) {
  if (state.backend) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not save listing");
    return body;
  }
  const local = lsGet(LS_LOCAL, []);
  const id = state.listings.reduce((m, l) => Math.max(m, l.id), 0) + 1;
  const item = { ...data, id, rating: null };
  local.push(item);
  lsSet(LS_LOCAL, local);
  return item;
}

// Approximate position: the city's average from existing listings plus a small jitter.
function guessCoords(city) {
  const same = state.listings.filter((l) => l.city.toLowerCase() === city.toLowerCase() && l.lat != null);
  if (!same.length) return { lat: null, lng: null };
  const avg = (k) => same.reduce((s, l) => s + l[k], 0) / same.length;
  const jitter = () => (Math.random() - 0.5) * 0.04;
  return { lat: avg("lat") + jitter(), lng: avg("lng") + jitter() };
}

/* ---------- controls ---------- */

function allAmenities() {
  return [...new Set([...COMMON_AMENITIES, ...state.listings.flatMap((l) => l.amenities)])].sort();
}

function setupControls() {
  const checked = new Set([...els.amenities.querySelectorAll("input:checked")].map((b) => b.value));
  const cityVal = els.city.value;

  els.city.replaceChildren(new Option("All cities", ""));
  const cities = [...new Set(state.listings.map((l) => l.city))].sort();
  cities.forEach((c) => els.city.add(new Option(c, c)));
  els.city.value = cities.includes(cityVal) ? cityVal : "";
  els.cityList.replaceChildren(...cities.map((c) => h("option", { value: c })));

  const maxRent = Math.max(0, ...state.listings.map((l) => l.rent));
  const atMax = !els.rent.max || Number(els.rent.value) >= Number(els.rent.max);
  els.rent.min = 0;
  els.rent.max = maxRent;
  els.rent.setAttribute("value", maxRent); // default restored by form reset
  if (atMax) els.rent.value = maxRent;

  els.amenities.replaceChildren(
    ...allAmenities()
      .filter((a) => state.listings.some((l) => l.amenities.includes(a)))
      .map((a) => {
        const box = h("input", { type: "checkbox", value: a });
        box.checked = checked.has(a);
        return h("label", {}, box, a);
      })
  );
}

function setupAddForm() {
  els.addAmenities.replaceChildren(
    ...allAmenities().map((a) => h("label", {}, h("input", { type: "checkbox", name: "amenity", value: a }), a))
  );
}

/* ---------- filtering ---------- */

function getFiltered() {
  const q = els.q.value.trim().toLowerCase();
  const maxR = Number(els.rent.value);
  const wanted = [...els.amenities.querySelectorAll("input:checked")].map((b) => b.value);

  const sorters = {
    "rent-asc": (a, b) => a.rent - b.rent,
    "rent-desc": (a, b) => b.rent - a.rent,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  };

  return state.listings
    .filter(
      (l) =>
        (!q || `${l.name} ${l.locality}`.toLowerCase().includes(q)) &&
        (!els.city.value || l.city === els.city.value) &&
        l.rent <= maxR &&
        (!els.gender.value || l.gender === els.gender.value) &&
        (!els.sharing.value || l.sharing === Number(els.sharing.value)) &&
        wanted.every((a) => l.amenities.includes(a)) &&
        (!els.shortlisted.checked || state.shortlist.has(l.id))
    )
    .sort(sorters[els.sort.value]);
}

/* ---------- shortlist ---------- */

function toggleShortlist(id) {
  state.shortlist.has(id) ? state.shortlist.delete(id) : state.shortlist.add(id);
  lsSet(LS_SHORTLIST, [...state.shortlist]);
  render();
}

function heartButton(l) {
  const on = state.shortlist.has(l.id);
  return h("button", {
    type: "button",
    class: `heart${on ? " on" : ""}`,
    "aria-pressed": String(on),
    "aria-label": on ? `Remove ${l.name} from shortlist` : `Add ${l.name} to shortlist`,
    text: on ? "♥" : "♡",
    onclick: (e) => {
      e.stopPropagation();
      toggleShortlist(l.id);
      if (els.detail.open) openDetail(l);
    },
  });
}

/* ---------- rendering ---------- */

function ratingText(l) {
  return l.rating == null ? "New" : `★ ${l.rating}`;
}

function card(l) {
  return h(
    "article",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: l.name }), heartButton(l)),
    h("div", { class: "loc", text: `${l.locality}, ${l.city} · ${ratingText(l)}` }),
    h("div", { class: "rent", text: `${inr(l.rent)} ` }, h("small", { text: "/ month" })),
    h(
      "div",
      { class: "tags" },
      ...[SHARING_LABELS[l.sharing], cap(l.gender), ...l.amenities].map((t) => h("span", { class: "tag", text: t }))
    ),
    h("button", { type: "button", class: "details", text: "View details", onclick: () => openDetail(l) })
  );
}

function render() {
  els.rentOut.textContent = inr(els.rent.value);
  els.shortCount.textContent = state.shortlist.size;
  const items = getFiltered();
  els.count.textContent = `${items.length} PG${items.length === 1 ? "" : "s"} found`;

  els.listings.replaceChildren();
  if (!items.length) {
    els.listings.append(h("p", { class: "empty", text: "No PGs match your filters. Try widening your search." }));
  } else {
    els.listings.append(...items.map(card));
  }
  if (state.view === "map") renderMap(items);
}

/* ---------- map ---------- */

function renderMap(items) {
  if (typeof L === "undefined") {
    showNotice("Map couldn't load (check your internet connection).");
    return;
  }
  if (!state.map) {
    state.map = L.map(els.map).setView([20.59, 78.96], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);
    state.markers = L.layerGroup().addTo(state.map);
  }
  state.map.invalidateSize();
  state.markers.clearLayers();

  const points = [];
  items
    .filter((l) => l.lat != null && l.lng != null)
    .forEach((l) => {
      const popup = h(
        "div",
        { class: "popup" },
        h("strong", { text: l.name }),
        h("div", { text: `${l.locality}, ${l.city}` }),
        h("div", { text: `${inr(l.rent)} / month` }),
        h("button", { type: "button", text: "View details", onclick: () => openDetail(l) })
      );
      L.marker([l.lat, l.lng]).bindPopup(popup).addTo(state.markers);
      points.push([l.lat, l.lng]);
    });
  if (points.length) state.map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
}

function setView(view) {
  state.view = view;
  const isMap = view === "map";
  els.listings.hidden = isMap;
  els.map.hidden = !isMap;
  els.viewList.classList.toggle("active", !isMap);
  els.viewMap.classList.toggle("active", isMap);
  els.viewList.setAttribute("aria-pressed", String(!isMap));
  els.viewMap.setAttribute("aria-pressed", String(isMap));
  render();
}

/* ---------- detail dialog ---------- */

function openDetail(l) {
  const links = h(
    "div",
    { class: "actions" },
    h("a", { class: "primary", href: `tel:${l.phone}`, text: "Call owner" }),
    h("a", { href: `https://wa.me/91${l.phone}`, target: "_blank", rel: "noopener", text: "WhatsApp" })
  );
  if (l.lat != null) {
    links.append(
      h("a", {
        href: `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=16/${l.lat}/${l.lng}`,
        target: "_blank",
        rel: "noopener",
        text: "Open map",
      })
    );
  }

  els.detail.replaceChildren(
    h(
      "div",
      { class: "detail-head" },
      h("div", {}, h("h2", { id: "detail-title", text: l.name }), h("div", { class: "loc", text: `${l.locality}, ${l.city} · ${ratingText(l)}` })),
      heartButton(l),
      h("button", { type: "button", class: "close", "aria-label": "Close", text: "×", onclick: () => els.detail.close() })
    ),
    h("div", { class: "rent", text: `${inr(l.rent)} ` }, h("small", { text: "/ month" })),
    h(
      "div",
      { class: "tags" },
      ...[SHARING_LABELS[l.sharing], cap(l.gender), ...l.amenities].map((t) => h("span", { class: "tag", text: t }))
    ),
    l.description ? h("p", { text: l.description }) : null,
    l.rules && l.rules.length ? h("div", {}, h("h3", { text: "House rules" }), h("ul", {}, ...l.rules.map((r) => h("li", { text: r })))) : null,
    links
  );
  if (!els.detail.open) els.detail.showModal();
}

/* ---------- add listing ---------- */

function openAddDialog() {
  setupAddForm();
  els.addError.hidden = true;
  els.addDialog.showModal();
}

async function onAddSubmit(e) {
  e.preventDefault();
  const f = els.addForm;
  const fd = new FormData(f);
  const city = fd.get("city").trim();
  const data = {
    name: fd.get("name").trim(),
    city,
    locality: fd.get("locality").trim(),
    rent: Number(fd.get("rent")),
    phone: fd.get("phone").replace(/[\s-]/g, ""),
    gender: fd.get("gender"),
    sharing: Number(fd.get("sharing")),
    amenities: fd.getAll("amenity"),
    description: fd.get("description").trim(),
    rules: fd.get("rules").split("\n").map((r) => r.trim()).filter(Boolean),
    ...guessCoords(city),
  };

  const submit = f.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const saved = await saveListing(data);
    state.listings.push(saved);
    f.reset();
    els.addDialog.close();
    setupControls();
    render();
    openDetail(saved);
  } catch (err) {
    els.addError.textContent = err.message;
    els.addError.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

/* ---------- init ---------- */

async function init() {
  state.shortlist = new Set(lsGet(LS_SHORTLIST, []));
  await loadListings();
  setupControls();

  els.form.addEventListener("input", render);
  els.sort.addEventListener("change", render);
  // Reset restores defaults after the event fires, so render on the next tick.
  els.form.addEventListener("reset", () => setTimeout(render));
  els.viewList.addEventListener("click", () => setView("list"));
  els.viewMap.addEventListener("click", () => setView("map"));
  $("add-btn").addEventListener("click", openAddDialog);
  $("add-cancel").addEventListener("click", () => els.addDialog.close());
  els.addForm.addEventListener("submit", onAddSubmit);
  // Click on the backdrop closes a dialog.
  [els.detail, els.addDialog].forEach((d) =>
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    })
  );

  render();
}

init();
