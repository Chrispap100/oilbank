const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(process.env.OILBANK_HOME || __dirname);
for (const name of ['data', 'documents', 'backups', 'exports']) fs.mkdirSync(path.join(root, name), { recursive: true });
const dbPath = path.join(root, 'data', 'oilbank.db');
let connection;
function db() {
  if (!connection) {
    connection = new DatabaseSync(dbPath);
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  }
  return connection;
}
function migrate() {
  const d = db(), version = d.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('Database was created by a newer OilBank version');
  if (version === 0) {
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(fs.readFileSync(path.join(__dirname, 'migrations', '001-local.sql'), 'utf8'));
      d.exec('PRAGMA user_version=1; COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
  }
}
function secret(key) {
  migrate();
  const row = db().prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (row) return row.value;
  const value = crypto.randomBytes(48).toString('hex');
  db().prepare('INSERT INTO settings VALUES(?,?)').run(key, value);
  return value;
}
function query(sql, values = []) {
  const args = [];
  const text = sql.replace(/\$(\d+)/g, (_, n) => { const v = values[Number(n) - 1]; args.push(typeof v === 'boolean' ? Number(v) : v ?? null); return '?'; });
  try {
    const stmt = db().prepare(text);
    if (stmt.columns().length) {
      const rows = stmt.all(...args).map(r => {
        for (const key of ['active', 'full_tank', 'paid', 'confirmed']) if (key in r) r[key] = Boolean(r[key]);
        for (const key of ['ai_json', 'details']) if (r[key]) r[key] = JSON.parse(r[key]);
        return r;
      });
      return { rows, rowCount: rows.length };
    }
    const result = stmt.run(...args);
    return { rows: [], rowCount: Number(result.changes) };
  } catch (e) { if (/UNIQUE constraint failed/.test(e.message)) e.code = '23505'; throw e; }
}
const pool = { query: async (...args) => query(...args), connect: async () => ({ query: async (...args) => query(...args), release() {} }) };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function documentPath(name) {
  if (!/^[a-f0-9]{64}\.bin$/.test(name)) throw new Error('Invalid document path');
  return path.join(root, 'documents', name);
}
function saveDocument(buffer) {
  const name = hash(buffer) + '.bin', target = documentPath(name);
  if (fs.existsSync(target)) { if (hash(fs.readFileSync(target)) !== hash(buffer)) throw new Error('Document checksum mismatch'); }
  else fs.writeFileSync(target, buffer, { flag: 'wx' });
  return name;
}
const tables = ['users', 'vehicles', 'documents', 'fuel_logs', 'expenses', 'obligations', 'audit_log', 'settings'];
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex'); }
function backup(label = 'manual', { allowDamaged = false } = {}) {
  const id = stamp(), snapshot = path.join(root, 'backups', id + '.db');
  try {
    db().prepare('VACUUM INTO ?').run(snapshot);
    const docs = {}, missingDocuments = [];
    for (const row of db().prepare('SELECT file_path,sha256,size_bytes FROM documents').all()) {
      try {
      const bytes = fs.readFileSync(documentPath(row.file_path));
      if (hash(bytes) !== row.sha256 || bytes.length !== row.size_bytes) throw new Error('Document checksum mismatch: ' + row.file_path);
      docs[row.file_path] = bytes.toString('base64');
      } catch(e) { if(!allowDamaged)throw e;missingDocuments.push(row.file_path); }
    }
    const bytes = fs.readFileSync(snapshot);
    const result = { format: 'oilbank-local', version: 1, generatedAt: new Date().toISOString(), database: bytes.toString('base64'), sha256: hash(bytes), documents: docs, missingDocuments };
    const file = path.join(root, 'backups', label + '-' + id + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(result));
    fs.renameSync(file + '.tmp', file);
    return { file, result };
  } finally { if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot); }
}
function decode(s) {
  if (typeof s !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error('Invalid backup encoding');
  return Buffer.from(s, 'base64');
}
function restore(b) {
  if (!b || b.format !== 'oilbank-local' || b.version !== 1 || !b.documents || typeof b.documents !== 'object' || Array.isArray(b.documents)) throw new Error('Unsupported backup: use a full local SQLite backup');
  const bytes = decode(b.database);
  if (hash(bytes) !== b.sha256) throw new Error('Backup checksum mismatch');
  const temp = path.join(root, 'data', 'restore-' + stamp() + '.db');
  let source;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx' });
    source = new DatabaseSync(temp, { readOnly: true });
    source.exec('PRAGMA trusted_schema=OFF');
    if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length || source.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('Invalid backup database');
    const schema = d => d.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    if (JSON.stringify(schema(source)) !== JSON.stringify(schema(db()))) throw new Error('Incompatible backup schema');
    if (!source.prepare("SELECT id FROM users WHERE role='super_admin' AND active=1 AND status='active'").get()) throw new Error('Backup has no active administrator');
    const rows = Object.fromEntries(tables.map(t => [t, source.prepare('SELECT * FROM ' + t).all()]));
    for (const row of rows.documents) {
      documentPath(row.file_path);
      const data = decode(b.documents[row.file_path]);
      if (hash(data) !== row.sha256 || data.length !== row.size_bytes || row.file_path !== hash(data) + '.bin') throw new Error('Missing or damaged document');
    }
    const safety = backup('before-restore', { allowDamaged: true }).file;
    // Files are immutable and content-addressed. Stage all before committing database;
    // a failed restore can only leave harmless unreferenced files, never break live data.
    for (const row of rows.documents) {
      const target = documentPath(row.file_path), data = decode(b.documents[row.file_path]);
      if (fs.existsSync(target) && hash(fs.readFileSync(target)) !== row.sha256) {
        const staged = target + '.restore';fs.writeFileSync(staged,data);fs.renameSync(staged,target);
      } else saveDocument(data);
    }
    db().exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    try {
      for (const t of ['fuel_logs', 'expenses', 'obligations', 'documents', 'vehicles', 'audit_log', 'users', 'settings']) db().exec('DELETE FROM ' + t);
      for (const t of tables) {
        if (!rows[t].length) continue;
        const keys = Object.keys(rows[t][0]);
        const insert = db().prepare('INSERT INTO ' + t + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')');
        for (const row of rows[t]) insert.run(...keys.map(k => row[k]));
      }
      db().prepare("INSERT OR REPLACE INTO settings VALUES('jwt',?)").run(crypto.randomBytes(48).toString('hex'));
      if (db().prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid restored relationships');
      db().exec('COMMIT');
    } catch (e) { db().exec('ROLLBACK'); throw e; }
    return safety;
  } finally { source?.close(); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function csvCell(v) {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[\s]*[=+@-]/.test(s) && typeof v !== 'number') s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCsv() {
  const dir = path.join(root, 'exports', stamp()); fs.mkdirSync(dir);
  const files = {};
  for (const t of tables.filter(t => t !== 'settings')) {
    const columns = db().prepare('PRAGMA table_info(' + t + ')').all().map(x => x.name).filter(k => !['password_hash', 'vault_cipher', 'vault_iv', 'vault_tag'].includes(k));
    const rows = db().prepare('SELECT ' + columns.join(',') + ' FROM ' + t + ' ORDER BY id').all();
    const csv = '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map(r => columns.map(k => csvCell(r[k])).join(','))].join('\r\n') + '\r\n';
    files[t + '.csv'] = csv;fs.writeFileSync(path.join(dir, t + '.csv'), csv);
  }
  return { directory: dir, files };
}
function acquireLock() {
  const file = path.join(root, 'data', 'oilbank.lock');
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    try { process.kill(pid, 0); throw new Error('OilBank is already running. Stop it before using maintenance scripts.'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; fs.unlinkSync(file); }
  }
  fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
  process.on('exit', () => { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); });
}
module.exports = { root, db, migrate, secret, pool, saveDocument, documentPath, backup, restore, exportCsv, acquireLock, close: () => { connection?.close(); connection = null; } };
