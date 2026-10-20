import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const CRM_BASE = process.env.CRM_API_BASE;
const ACCESS_TOKEN = process.env.CRM_ACCESS_TOKEN;
const LOCATION_ID = process.env.CRM_LOCATION_ID;
const API_VERSION = process.env.CRM_API_VERSION || "2021-07-28";

const VEHICLE_FIELD = process.env.CRM_VEHICLE_FIELD || "";
const VIN_FIELD = process.env.CRM_VIN_FIELD || "";
const VEHICLE_FIELD_KEY = process.env.CRM_VEHICLE_FIELD_KEY || "car_model_and_year";
const VIN_FIELD_KEY = process.env.CRM_VIN_FIELD_KEY || "";

if (!CRM_BASE || !ACCESS_TOKEN || !LOCATION_ID) {
  console.error("Missing CRM_API_BASE / CRM_ACCESS_TOKEN / CRM_LOCATION_ID env vars.");
  process.exit(1);
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function fetchFieldDefs() {
  try {
    const res = await fetch(
      `${CRM_BASE}/locations/${LOCATION_ID}/customFields?limit=100`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Version: API_VERSION, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const body = await res.json();
    return body.customFields || body.fields || body.data || (Array.isArray(body) ? body : []);
  } catch {
    return [];
  }
}

function findFieldId(defs, key, explicitId) {
  if (explicitId) return explicitId;
  if (!key) return "";
  const lk = norm(key);
  const hit = defs.find((d) => norm(d.fieldKey || "") === lk || norm(d.name || "") === lk || norm(d.key || "") === lk);
  return hit?.id || hit?.fieldId || "";
}

function getFieldValue(contact, defs, fieldId, fieldKey) {
  const cf = contact?.customField ?? contact?.customFields;
  if (Array.isArray(cf)) {
    const lk = fieldKey ? norm(fieldKey) : "";
    const hit = cf.find((f) => (fieldId && f.id === fieldId) || (lk && norm(f.name || f.key || f.fieldKey || "") === lk));
    return hit && hit.value != null ? String(hit.value) : "";
  }
  if (cf && typeof cf === "object") {
    const id = fieldId || findFieldId(defs, fieldKey);
    if (id && cf[id] != null) return String(cf[id]);
  }
  return "";
}

async function fetchAllContacts() {
  const out = [];
  const limit = 100;
  let nextPageUrl = null;
  let pageCount = 0;
  const maxPages = 50;

  while (pageCount < maxPages) {
    pageCount++;
    const url = nextPageUrl || `${CRM_BASE}/contacts/?locationId=${LOCATION_ID}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Version: API_VERSION, Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CRM contacts API ${res.status}: ${text}`);
    }
    const body = await res.json();
    const batch = body.contacts || body.data || [];
    out.push(...batch);

    const nextUrl =
      body?.meta?.nextPageUrl || body?.nextPageUrl ||
      (body?.meta?.nextPageToken ? `${CRM_BASE}/contacts/?locationId=${LOCATION_ID}&limit=${limit}&startAfterId=${body.meta.nextPageToken}` : null) ||
      (body?.meta?.startAfterId ? `${CRM_BASE}/contacts/?locationId=${LOCATION_ID}&limit=${limit}&startAfterId=${body.meta.startAfterId}` : null);

    if (!nextUrl || batch.length === 0 || batch.length < limit) break;
    nextPageUrl = nextUrl;
  }
  return out;
}

function mapContact(c, defs) {
  const email = Array.isArray(c.email) ? c.email[0] : c.email || "";
  const phone = Array.isArray(c.phone) ? c.phone[0] : c.phone || "";
  const addr = [c.address1, c.city, c.state, c.postalCode || c.zip].filter(Boolean).join(", ");
  const name = c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.companyName || c.name || "";
  return {
    contactId: c.id,
    name,
    email,
    phone,
    address: addr,
    vehicle: getFieldValue(c, defs, VEHICLE_FIELD, VEHICLE_FIELD_KEY),
    vin: getFieldValue(c, defs, VIN_FIELD, VIN_FIELD_KEY),
    tags: Array.isArray(c.tags) ? c.tags : [],
    status: "Active",
    notes: "",
  };
}

app.post("/sync", async (req, res) => {
  if (req.query.type !== "customers") return res.status(400).json({ error: "Unsupported type" });
  try {
    const [contacts, defs] = await Promise.all([fetchAllContacts(), fetchFieldDefs()]);
    if (contacts[0]) {
      console.log("[sync] resolved vehicle field id:", findFieldId(defs, VEHICLE_FIELD_KEY, VEHICLE_FIELD) || "(not found)");
      console.log("[sync] first contact customField keys:", Object.keys(contacts[0].customField || contacts[0].customFields || {}));
    }
    res.json({ customers: contacts.map((c) => mapContact(c, defs)) });
  } catch (err) {
    console.error("sync failed:", err);
    res.status(500).json({ error: err.message || "Sync failed" });
  }
});

app.post("/push-vehicle", async (req, res) => {
  const { contactId, vehicle, vin } = req.body || {};
  if (!contactId) return res.status(400).json({ error: "contactId is required" });
  try {
    const defs = await fetchFieldDefs();
    const vehId = findFieldId(defs, VEHICLE_FIELD_KEY, VEHICLE_FIELD);
    const vinId = findFieldId(defs, VIN_FIELD_KEY, VIN_FIELD);
    const customFields = {};
    if (vehId && vehicle) customFields[vehId] = String(vehicle);
    if (vinId && vin) customFields[vinId] = String(vin);
    if (!Object.keys(customFields).length) return res.status(400).json({ error: "No vehicle custom field found to update" });

    const r = await fetch(`${CRM_BASE}/contacts/${contactId}?locationId=${LOCATION_ID}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Version: API_VERSION, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ customFields }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `CRM update failed: ${text || r.status}` });
    }
    res.json({ ok: true, updated: customFields });
  } catch (err) {
    console.error("push-vehicle failed:", err);
    res.status(500).json({ error: err.message || "Push failed" });
  }
});

app.get("/", (_req, res) => res.json({ ok: true }));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`customer-sync bridge on :${port}`));
