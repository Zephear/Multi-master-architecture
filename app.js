const path = require("path");
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { run, get, all, NODE_ID } = require("./db");

const PORT = process.env.PORT || 8000;
const PEERS = process.env.PEERS ? process.env.PEERS.split(",").filter(Boolean) : [];
const SYNC_INTERVAL_MS = 5000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


app.get("/api/node-info", (req, res) => {
  res.json({ node_id: NODE_ID, peers: PEERS });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, node_id: NODE_ID });
});

app.get("/api/status", async (req, res) => {
  const results = await Promise.all(
    PEERS.map(async (peer) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const r = await fetch(`${peer}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);
        return { peer, online: r.ok };
      } catch (e) {
        return { peer, online: false };
      }
    }),
  );
  const pendingLog = await all(`SELECT COUNT(*) as count FROM operations_log`);
  res.json({
    node_id: NODE_ID,
    peers: results,
    pending_operations: pendingLog[0].count,
  });
});

// TICKETS - CRUD

app.get("/api/tickets", async (req, res) => {
  try {
    const tickets = await all(`SELECT * FROM tickets ORDER BY created_at DESC`);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tickets", async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const ticket = {
      id: uuidv4(),
      title,
      description: description || "",
      status: "Open",
      owner_node_id: NODE_ID,
    };

    await run(
      `INSERT INTO tickets (id, title, description, status, owner_node_id) VALUES (?, ?, ?, ?, ?)`,
      [ticket.id, ticket.title, ticket.description, ticket.status, ticket.owner_node_id],
    );

    await run(
      `INSERT INTO operations_log (ticket_id, action, payload, origin_node_id) VALUES (?, ?, ?, ?)`,
      [ticket.id, "CREATE", JSON.stringify(ticket), NODE_ID],
    );

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tickets/:id", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const existing = await get(`SELECT * FROM tickets WHERE id = ?`, [ticketId]);

    if (!existing) return res.status(404).json({ error: "Ticket not found" });

    if (existing.owner_node_id !== NODE_ID) {
      return res.status(403).json({
        error: `This ticket is owned by node ${existing.owner_node_id}. This node (${NODE_ID}) is not allowed to edit it.`,
      });
    }

    const title = req.body.title ?? existing.title;
    const description = req.body.description ?? existing.description;
    const status = req.body.status ?? existing.status;

    await run(
      `UPDATE tickets SET title = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [title, description, status, ticketId],
    );

    const updated = await get(`SELECT * FROM tickets WHERE id = ?`, [ticketId]);

    await run(
      `INSERT INTO operations_log (ticket_id, action, payload, origin_node_id) VALUES (?, ?, ?, ?)`,
      [ticketId, "UPDATE", JSON.stringify(updated), NODE_ID],
    );

    res.json({ success: true, ticket: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tickets/:id", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const existing = await get(`SELECT * FROM tickets WHERE id = ?`, [ticketId]);

    if (!existing) return res.status(404).json({ error: "Ticket not found" });

    if (existing.owner_node_id !== NODE_ID) {
      return res.status(403).json({
        error: `This ticket is owned by node ${existing.owner_node_id}. This node (${NODE_ID}) is not allowed to delete it.`,
      });
    }

    await run(`DELETE FROM tickets WHERE id = ?`, [ticketId]);

    await run(
      `INSERT INTO operations_log (ticket_id, action, payload, origin_node_id) VALUES (?, ?, ?, ?)`,
      [ticketId, "DELETE", JSON.stringify({ id: ticketId }), NODE_ID],
    );

    res.json({ success: true, id: ticketId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/sync", async (req, res) => {
  try {
    const operations = Array.isArray(req.body) ? req.body : [];

    for (const op of operations) {
      const payload = JSON.parse(op.payload);

      if (op.action === "CREATE") {
        await run(
          `INSERT OR IGNORE INTO tickets (id, title, description, status, owner_node_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))`,
          [
            payload.id,
            payload.title,
            payload.description,
            payload.status,
            payload.owner_node_id,
            payload.created_at,
            payload.updated_at,
          ],
        );
      } else if (op.action === "UPDATE") {
        const result = await run(
          `UPDATE tickets SET title = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`,
          [payload.title, payload.description, payload.status, payload.updated_at, payload.id],
        );

        if (result.changes === 0) {
          await run(
            `INSERT OR IGNORE INTO tickets (id, title, description, status, owner_node_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [payload.id, payload.title, payload.description, payload.status, payload.owner_node_id, payload.updated_at],
          );
        }
      } else if (op.action === "DELETE") {
        await run(`DELETE FROM tickets WHERE id = ?`, [payload.id]);
      }
    }

    res.json({ success: true, applied: operations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function syncWithPeers() {
  if (PEERS.length === 0) return;

  const logs = await all(`SELECT * FROM operations_log ORDER BY id ASC`);
  if (logs.length === 0) return;

  const deliveredTo = [];

  for (const peer of PEERS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${peer}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logs),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        deliveredTo.push(peer);
      }
    } catch (err) {
      console.log(`[SYNC] Uzol ${peer} nedostupny, operacie ostavaju v rade.`);
    }
  }

  if (deliveredTo.length === PEERS.length) {
    const ids = logs.map((l) => l.id);
    const placeholders = ids.map(() => "?").join(",");
    await run(`DELETE FROM operations_log WHERE id IN (${placeholders})`, ids);
    console.log(`[SYNC] ${logs.length} operacii uspesne synchronizovanych a odstranenych z fronty.`);
  } else {
    console.log(`[SYNC] Doruceno ${deliveredTo.length}/${PEERS.length} uzlom, ${logs.length} operacii ostava v rade.`);
  }
}

setInterval(() => {
  syncWithPeers().catch((err) => console.error("[SYNC] chyba:", err.message));
}, SYNC_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`[APP] Uzol ${NODE_ID} bezi na porte ${PORT}. Susedia: ${PEERS.join(", ") || "ziadni"}`);
});
