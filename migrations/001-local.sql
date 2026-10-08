
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('super_admin','user')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS vehicles(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plate TEXT NOT NULL,
      model TEXT NOT NULL,
      fuel TEXT NOT NULL,
      year INTEGER,
      start_odo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(user_id,plate)
    );
    CREATE TABLE IF NOT EXISTS fuel_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      date DATE NOT NULL,
      odometer INTEGER NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      price NUMERIC(12,3) NOT NULL,
      litres NUMERIC(12,3) NOT NULL,
      station TEXT,
      payment TEXT,
      full_tank BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON fuel_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_vehicle ON fuel_logs(vehicle_id);

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';ALTER TABLE users ADD COLUMN archived_at TEXT;ALTER TABLE users ADD COLUMN last_login TEXT;ALTER TABLE users ADD COLUMN vault_cipher TEXT;ALTER TABLE users ADD COLUMN vault_iv TEXT;ALTER TABLE users ADD COLUMN vault_tag TEXT;ALTER TABLE users ADD COLUMN password_updated_at TEXT;UPDATE users SET status=CASE WHEN active THEN 'active' ELSE 'disabled' END WHERE status IS NULL OR status='';ALTER TABLE vehicles ADD COLUMN status TEXT NOT NULL DEFAULT 'active';ALTER TABLE vehicles ADD COLUMN purchase_date DATE;ALTER TABLE vehicles ADD COLUMN purchase_price NUMERIC(12,2);ALTER TABLE vehicles ADD COLUMN sale_date DATE;ALTER TABLE vehicles ADD COLUMN sale_price NUMERIC(12,2);ALTER TABLE vehicles ADD COLUMN notes TEXT;CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,category TEXT NOT NULL,date DATE NOT NULL,amount NUMERIC(12,2) NOT NULL DEFAULT 0,odometer INTEGER,title TEXT,vendor TEXT,next_due_date DATE,next_due_odometer INTEGER,notes TEXT,document_id INTEGER,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));CREATE TABLE IF NOT EXISTS obligations(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,type TEXT NOT NULL,title TEXT,start_date DATE,due_date DATE,amount NUMERIC(12,2) NOT NULL DEFAULT 0,provider TEXT,reference_no TEXT,paid BOOLEAN NOT NULL DEFAULT FALSE,notes TEXT,document_id INTEGER,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,filename TEXT NOT NULL,mime_type TEXT NOT NULL,file_path TEXT NOT NULL, size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,doc_type TEXT,ai_status TEXT NOT NULL DEFAULT 'uploaded',ai_json TEXT,confirmed BOOLEAN NOT NULL DEFAULT FALSE,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,details TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));ALTER TABLE fuel_logs ADD COLUMN product TEXT;ALTER TABLE fuel_logs ADD COLUMN reference_no TEXT;ALTER TABLE fuel_logs ADD COLUMN net_amount NUMERIC(12,2);ALTER TABLE fuel_logs ADD COLUMN vat_rate NUMERIC(6,3);ALTER TABLE fuel_logs ADD COLUMN vat_amount NUMERIC(12,2);ALTER TABLE fuel_logs ADD COLUMN document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
