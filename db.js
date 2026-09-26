const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const NODE_ID = process.env.NODE_ID || "node-1";


const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, `${NODE_ID}.sqlite`);

const db = new sqlite3.Database(DB_FILE);


const schema = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");
db.exec(schema, (err) => {
  if (err) {
    console.error("[DB] Chyba pri inicializacii schemy:", err.message);
  } else {
    console.log(`[DB] Uzol ${NODE_ID}: databaza pripravena (${DB_FILE})`);
  }
});


function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = { db, run, get, all, NODE_ID };
