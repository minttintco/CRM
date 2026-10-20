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

if (!CRM_BASE || !ACCESS_TOKEN || !LOCATION_ID) {
  console.error(
    "Missing CRM_API_BASE / CRM_ACCESS_TOKEN / CRM_LOCATION_ID env vars.",
  );
  process.exit(1);
}

async function fetchAllContacts() {
  const out = [];
  const limit = 100;
  let nextPageUrl = null;
  let pageCount = 0;
  const maxPages = 50;

  while (pageCount < maxPages) {
    pageCount++;
    const url =
      nextPageUrl ||
      `${CRM_BASE}/contacts/?locationId=${LOCATION_ID}&limit=${limit}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Version: API_VERSION,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CRM contacts API ${res.status}: ${text}`);
    }

    const body = await res.json();
    const batch = Array.isArray(body.contacts)
      ? body.contacts
      : Array.isArray(body.data)
        ? body.data
        : [];

    out.push(...batch);

    const nextUrl =
      body?.meta?.nextPageUrl ||
      body?.nextPageUrl ||
      (body?.meta?.nextPageToken
        ? `${CRM_BASE}/contacts/?locationId=${LOCATION_ID}&limit=${limit}&startAfterId=${body.meta.nextPageToken}`
        : null) ||
      (body?.meta?.startAfterId
        ? `${CRM_BASE}/contacts/?locationId=${LOCATION_ID}&limit=${limit}&startAfterId=${body.meta.startAfterId}`
        : null);

    if (!nextUrl || batch.length === 0 || batch.length < limit) {
      break;
    }
    nextPageUrl = nextUrl;
  }
  return out;
}

function mapContact(c) {
  const fields = Array.isArray(c.customFields) ? c.customFields : [];
  const cf = (id) => fields.find((f) => f.id === id)?.value ?? "";

  const email = Array.isArray(c.email) ? c.email[0] : c.email || "";
  const phone = Array.isArray(c.phone) ? c.phone[0] : c.phone || "";
  const addr = [c.address1, c.city, c.state, c.postalCode || c.zip]
    .filter(Boolean)
    .join(", ");

  const name =
    c.contactName ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.companyName ||
    c.name ||
    "";

  return {
    contactId: c.id,
    name,
    email,
    phone,
    address: addr,
    vehicle: VEHICLE_FIELD ? cf(VEHICLE_FIELD) : "",
    vin: VIN_FIELD ? cf(VIN_FIELD) : "",
    tags: Array.isArray(c.tags) ? c.tags : [],
    status: "Active",
    notes: "",
  };
}

app.post("/sync", async (req, res) => {
  if (req.query.type !== "customers") {
    return res.status(400).json({ error: "Unsupported type" });
  }
  try {
    const contacts = await fetchAllContacts();
    res.json({ customers: contacts.map(mapContact) });
  } catch (err) {
    console.error("sync failed:", err);
    res.status(500).json({ error: err.message || "Sync failed" });
  }
});

app.get("/", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`customer-sync bridge on :${port}`));
