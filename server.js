const express=require("express");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const crypto=require("crypto");
const {Pool}=require("pg");

const app=express();
const PORT=process.env.PORT||10000;
const JWT_SECRET=process.env.JWT_SECRET||"change-me";
const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) console.error("DATABASE_URL is not configured");

const pool=new Pool({connectionString:DATABASE_URL,ssl:DATABASE_URL&&DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname)));

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('super_admin','user')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS vehicles(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plate TEXT NOT NULL,
      model TEXT NOT NULL,
      fuel TEXT NOT NULL,
      year INTEGER,
      start_odo INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,plate)
    );
    CREATE TABLE IF NOT EXISTS fuel_logs(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      date DATE NOT NULL,
      odometer INTEGER NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      price NUMERIC(12,3) NOT NULL,
      litres NUMERIC(12,3) NOT NULL,
      station TEXT,
      payment TEXT,
      full_tank BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON fuel_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_vehicle ON fuel_logs(vehicle_id);
  `);
  const adminEmail=(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
  const adminPassword=process.env.ADMIN_PASSWORD||"";
  const adminName=process.env.ADMIN_NAME||"Super Admin";
  if(adminEmail&&adminPassword){
    const existing=await pool.query("SELECT id FROM users WHERE email=$1",[adminEmail]);
    if(!existing.rowCount){
      const hash=await bcrypt.hash(adminPassword,12);
      await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'super_admin')",[adminName,adminEmail,hash]);
      console.log("Initial super admin created");
    }
  }
}

function sign(user){return jwt.sign({id:user.id,role:user.role,email:user.email,name:user.name},JWT_SECRET,{expiresIn:"7d"})}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  try{req.user=jwt.verify(token,JWT_SECRET);next()}catch(e){res.status(401).json({error:"unauthorized"})}
}
function admin(req,res,next){if(req.user.role!=="super_admin")return res.status(403).json({error:"forbidden"});next()}
const cleanEmail=s=>String(s||"").trim().toLowerCase();
const mapUser=r=>({id:String(r.id),name:r.name,email:r.email,role:r.role,status:r.status||((r.active===false)?"disabled":"active"),active:(r.status||((r.active===false)?"disabled":"active"))==="active",createdAt:r.created_at,lastLogin:r.last_login||null,passwordUpdatedAt:r.password_updated_at||null});
const mapVehicle=r=>({id:String(r.id),userId:String(r.user_id),plate:r.plate,model:r.model,fuel:r.fuel,year:r.year,startOdo:Number(r.start_odo)||0,createdAt:r.created_at,ownerName:r.owner_name||null,ownerEmail:r.owner_email||null});
const mapLog=r=>({id:String(r.id),userId:String(r.user_id),vehicleId:String(r.vehicle_id),createdBy:String(r.created_by),date:String(r.date).slice(0,10),odometer:Number(r.odometer),amount:Number(r.amount),price:Number(r.price),litres:Number(r.litres),station:r.station||"",payment:r.payment||"",fullTank:Boolean(r.full_tank),notes:r.notes||"",createdAt:r.created_at,vehiclePlate:r.plate||"",vehicleModel:r.model||"",ownerName:r.owner_name||"",creatorName:r.creator_name||""});

app.get("/api/health",(req,res)=>res.json({ok:true}));

app.post("/api/login",async(req,res)=>{
  try{
    const email=cleanEmail(req.body.email),password=String(req.body.password||"");
    const q=await pool.query("SELECT * FROM users WHERE email=$1",[email]);
    if(!q.rowCount||!q.rows[0].active)return res.status(401).json({error:"invalid_credentials"});
    const u=q.rows[0];
    if(!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"invalid_credentials"});
    res.json({token:sign(u),user:mapUser(u)});
  }catch(e){console.error(e);res.status(500).json({error:"server_error"})}
});

app.get("/api/me",auth,async(req,res)=>{
  const q=await pool.query("SELECT * FROM users WHERE id=$1",[req.user.id]);
  if(!q.rowCount||!q.rows[0].active)return res.status(401).json({error:"unauthorized"});
  res.json({user:mapUser(q.rows[0])});
});

app.get("/api/users",auth,admin,async(req,res)=>{
  const q=await pool.query("SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at");
  res.json({users:q.rows.map(mapUser)});
});
app.post("/api/users",auth,admin,async(req,res)=>{
  try{
    const name=String(req.body.name||"").trim(),email=cleanEmail(req.body.email),password=String(req.body.password||""),role=req.body.role==="super_admin"?"super_admin":"user";
    if(!name||!email||password.length<6)return res.status(400).json({error:"invalid_input"});
    const hash=await bcrypt.hash(password,12);
    const q=await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active,created_at",[name,email,hash,role]);
    res.status(201).json({user:mapUser(q.rows[0])});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"email_exists"});console.error(e);res.status(500).json({error:"server_error"})}
});
app.delete("/api/users/:id",auth,admin,async(req,res)=>{
  if(String(req.user.id)===String(req.params.id))return res.status(400).json({error:"cannot_delete_self"});
  await pool.query("DELETE FROM users WHERE id=$1",[req.params.id]);res.json({ok:true});
});

app.get("/api/vehicles",auth,async(req,res)=>{
  const isAdmin=req.user.role==="super_admin";
  const q=await pool.query(`
    SELECT v.*,u.name owner_name,u.email owner_email
    FROM vehicles v JOIN users u ON u.id=v.user_id
    ${isAdmin?"":"WHERE v.user_id=$1"} ORDER BY v.created_at DESC
  `,isAdmin?[]:[req.user.id]);
  res.json({vehicles:q.rows.map(mapVehicle)});
});
app.post("/api/vehicles",auth,async(req,res)=>{
  try{
    const ownerId=req.user.role==="super_admin"&&req.body.userId?req.body.userId:req.user.id;
    const plate=String(req.body.plate||"").trim().toUpperCase(),model=String(req.body.model||"").trim(),fuel=String(req.body.fuel||"").trim(),year=req.body.year?Number(req.body.year):null,startOdo=Number(req.body.startOdo)||0;
    if(!plate||!model||!fuel)return res.status(400).json({error:"invalid_input"});
    if(req.user.role==="super_admin"){const uq=await pool.query("SELECT id FROM users WHERE id=$1 AND active=TRUE",[ownerId]);if(!uq.rowCount)return res.status(400).json({error:"invalid_user"})}
    const q=await pool.query("INSERT INTO vehicles(user_id,plate,model,fuel,year,start_odo) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[ownerId,plate,model,fuel,year,startOdo]);
    res.status(201).json({vehicle:mapVehicle(q.rows[0])});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"plate_exists"});console.error(e);res.status(500).json({error:"server_error"})}
});
app.delete("/api/vehicles/:id",auth,async(req,res)=>{
  const q=await pool.query("SELECT * FROM vehicles WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});
  const v=q.rows[0];if(req.user.role!=="super_admin"&&String(v.user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});
  await pool.query("DELETE FROM vehicles WHERE id=$1",[req.params.id]);res.json({ok:true});
});

app.get("/api/logs",auth,async(req,res)=>{
  const isAdmin=req.user.role==="super_admin";
  const q=await pool.query(`
    SELECT l.*,v.plate,v.model,u.name owner_name,c.name creator_name
    FROM fuel_logs l
    JOIN vehicles v ON v.id=l.vehicle_id
    JOIN users u ON u.id=l.user_id
    JOIN users c ON c.id=l.created_by
    ${isAdmin?"":"WHERE l.user_id=$1"}
    ORDER BY l.date DESC,l.odometer DESC,l.id DESC
  `,isAdmin?[]:[req.user.id]);
  res.json({logs:q.rows.map(mapLog)});
});
app.post("/api/logs",auth,async(req,res)=>{
  try{
    const vehicleId=req.body.vehicleId;
    const vq=await pool.query("SELECT * FROM vehicles WHERE id=$1",[vehicleId]);if(!vq.rowCount)return res.status(404).json({error:"vehicle_not_found"});
    const v=vq.rows[0];if(req.user.role!=="super_admin"&&String(v.user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});
    const date=req.body.date,odometer=Number(req.body.odometer),amount=Number(req.body.amount),price=Number(req.body.price),litres=amount/price;
    if(!date||!Number.isFinite(odometer)||odometer<0||!(amount>0)||!(price>0))return res.status(400).json({error:"invalid_input"});
    const prev=await pool.query("SELECT odometer FROM fuel_logs WHERE vehicle_id=$1 ORDER BY odometer DESC LIMIT 1",[vehicleId]);
    if(prev.rowCount&&odometer<Number(prev.rows[0].odometer))return res.status(400).json({error:"odometer_too_low"});
    const q=await pool.query(`INSERT INTO fuel_logs(user_id,vehicle_id,created_by,date,odometer,amount,price,litres,station,payment,full_tank,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [v.user_id,vehicleId,req.user.id,date,odometer,amount,price,litres,String(req.body.station||"").trim(),String(req.body.payment||""),req.body.fullTank!==false,String(req.body.notes||"").trim()]);
    res.status(201).json({log:mapLog(q.rows[0])});
  }catch(e){console.error(e);res.status(500).json({error:"server_error"})}
});
app.delete("/api/logs/:id",auth,async(req,res)=>{
  const q=await pool.query("SELECT * FROM fuel_logs WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});
  const l=q.rows[0];if(req.user.role!=="super_admin"&&String(l.user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});
  await pool.query("DELETE FROM fuel_logs WHERE id=$1",[req.params.id]);res.json({ok:true});
});


const VAULT_KEY=process.env.VAULT_KEY||"";
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-4.1-mini";
async function ensureV4(){
 await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;ALTER TABLE users ADD COLUMN IF NOT EXISTS vault_cipher TEXT;ALTER TABLE users ADD COLUMN IF NOT EXISTS vault_iv TEXT;ALTER TABLE users ADD COLUMN IF NOT EXISTS vault_tag TEXT;ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;UPDATE users SET status=CASE WHEN active THEN 'active' ELSE 'disabled' END WHERE status IS NULL OR status='';ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_date DATE;ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2);ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sale_date DATE;ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2);ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes TEXT;CREATE TABLE IF NOT EXISTS expenses(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,category TEXT NOT NULL,date DATE NOT NULL,amount NUMERIC(12,2) NOT NULL DEFAULT 0,odometer INTEGER,title TEXT,vendor TEXT,next_due_date DATE,next_due_odometer INTEGER,notes TEXT,document_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS obligations(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,type TEXT NOT NULL,title TEXT,start_date DATE,due_date DATE,amount NUMERIC(12,2) NOT NULL DEFAULT 0,provider TEXT,reference_no TEXT,paid BOOLEAN NOT NULL DEFAULT FALSE,notes TEXT,document_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS documents(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,uploaded_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,filename TEXT NOT NULL,mime_type TEXT NOT NULL,file_bytes BYTEA NOT NULL,sha256 TEXT NOT NULL,doc_type TEXT,ai_status TEXT NOT NULL DEFAULT 'uploaded',ai_json JSONB,confirmed BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);CREATE TABLE IF NOT EXISTS audit_log(id BIGSERIAL PRIMARY KEY,actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,details JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
}
async function auditV4(actor,action,entityType,entityId,details){try{await pool.query("INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",[actor||null,action,entityType||null,entityId==null?null:String(entityId),JSON.stringify(details||{})])}catch(e){console.error("audit",e.message)}}
function vaultKeyV4(){return VAULT_KEY?crypto.createHash("sha256").update(VAULT_KEY).digest():null}
function encryptV4(text){const k=vaultKeyV4();if(!k)return null;const iv=crypto.randomBytes(12),x=crypto.createCipheriv("aes-256-gcm",k,iv),buf=Buffer.concat([x.update(String(text),"utf8"),x.final()]);return{cipher:buf.toString("base64"),iv:iv.toString("base64"),tag:x.getAuthTag().toString("base64")}}
function decryptV4(r){const k=vaultKeyV4();if(!k||!r.vault_cipher)return null;const x=crypto.createDecipheriv("aes-256-gcm",k,Buffer.from(r.vault_iv,"base64"));x.setAuthTag(Buffer.from(r.vault_tag,"base64"));return Buffer.concat([x.update(Buffer.from(r.vault_cipher,"base64")),x.final()]).toString("utf8")}
async function vehicleAccessV4(id,user){const q=await pool.query("SELECT * FROM vehicles WHERE id=$1",[id]);if(!q.rowCount)return null;return user.role==="super_admin"||String(q.rows[0].user_id)===String(user.id)?q.rows[0]:false}
function parseDataV4(s){const m=String(s||"").match(/^data:([^;]+);base64,(.+)$/s);return m?{mime:m[1],buffer:Buffer.from(m[2],"base64")}:null}
function outputTextV4(d){if(typeof d.output_text==="string")return d.output_text;for(const o of d.output||[])for(const x of o.content||[])if(x.type==="output_text"&&x.text)return x.text;return""}
function jsonV4(t){return JSON.parse(String(t||"").trim())}
app.post("/api/register-request",async(req,res)=>{try{const name=String(req.body.name||"").trim(),email=cleanEmail(req.body.email);if(!name||!email)return res.status(400).json({error:"invalid_input"});if((await pool.query("SELECT id FROM users WHERE email=$1",[email])).rowCount)return res.status(409).json({error:"email_exists"});const hash=await bcrypt.hash(crypto.randomBytes(32).toString("hex"),10),q=await pool.query("INSERT INTO users(name,email,password_hash,role,status,active) VALUES($1,$2,$3,'user','pending',FALSE) RETURNING *",[name,email,hash]);await auditV4(q.rows[0].id,"registration_requested","user",q.rows[0].id,{email});res.status(201).json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"server_error"})}});
app.post("/api/users/:id/approve",auth,admin,async(req,res)=>{const password=String(req.body.password||"");if(password.length<6)return res.status(400).json({error:"invalid_password"});const hash=await bcrypt.hash(password,12),v=encryptV4(password),q=await pool.query("UPDATE users SET status='active',active=TRUE,password_hash=$2,vault_cipher=$3,vault_iv=$4,vault_tag=$5,password_updated_at=NOW(),archived_at=NULL WHERE id=$1 RETURNING *",[req.params.id,hash,v?v.cipher:null,v?v.iv:null,v?v.tag:null]);if(!q.rowCount)return res.status(404).json({error:"not_found"});await auditV4(req.user.id,"user_approved","user",req.params.id,{});res.json({user:mapUser(q.rows[0])})});
app.post("/api/users/:id/reset-password",auth,admin,async(req,res)=>{const password=String(req.body.password||"");if(password.length<6)return res.status(400).json({error:"invalid_password"});const hash=await bcrypt.hash(password,12),v=encryptV4(password),q=await pool.query("UPDATE users SET password_hash=$2,vault_cipher=$3,vault_iv=$4,vault_tag=$5,password_updated_at=NOW() WHERE id=$1 RETURNING id",[req.params.id,hash,v?v.cipher:null,v?v.iv:null,v?v.tag:null]);if(!q.rowCount)return res.status(404).json({error:"not_found"});await auditV4(req.user.id,"password_reset","user",req.params.id,{});res.json({ok:true})});
app.get("/api/users/:id/vault",auth,admin,async(req,res)=>{try{const q=await pool.query("SELECT vault_cipher,vault_iv,vault_tag FROM users WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});const password=decryptV4(q.rows[0]);if(password==null)return res.status(503).json({error:"vault_unavailable"});await auditV4(req.user.id,"vault_viewed","user",req.params.id,{});res.json({password})}catch(e){res.status(500).json({error:"server_error"})}});
app.post("/api/users/:id/status",auth,admin,async(req,res)=>{const status=["active","disabled","archived","pending"].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:"invalid_status"});if(String(req.user.id)===String(req.params.id)&&status!=="active")return res.status(400).json({error:"cannot_disable_self"});const q=await pool.query("UPDATE users SET status=$2,active=($2='active'),archived_at=CASE WHEN $2='archived' THEN NOW() ELSE archived_at END WHERE id=$1 RETURNING *",[req.params.id,status]);if(!q.rowCount)return res.status(404).json({error:"not_found"});await auditV4(req.user.id,"user_status_changed","user",req.params.id,{status});res.json({user:mapUser(q.rows[0])})});
app.post("/api/self/archive",auth,async(req,res)=>{if(req.user.role==="super_admin")return res.status(400).json({error:"admin_cannot_self_archive"});await pool.query("UPDATE users SET status='archived',active=FALSE,archived_at=NOW() WHERE id=$1",[req.user.id]);await auditV4(req.user.id,"self_archived","user",req.user.id,{});res.json({ok:true})});
app.get("/api/expenses",auth,async(req,res)=>{const a=req.user.role==="super_admin",sql="SELECT e.*,v.plate,u.name owner_name FROM expenses e JOIN vehicles v ON v.id=e.vehicle_id JOIN users u ON u.id=e.user_id "+(a?"":"WHERE e.user_id=$1 ")+"ORDER BY e.date DESC,e.id DESC",q=await pool.query(sql,a?[]:[req.user.id]);res.json({expenses:q.rows.map(r=>({id:String(r.id),userId:String(r.user_id),vehicleId:String(r.vehicle_id),category:r.category,date:String(r.date).slice(0,10),amount:Number(r.amount),odometer:r.odometer==null?null:Number(r.odometer),title:r.title||"",vendor:r.vendor||"",nextDueDate:r.next_due_date?String(r.next_due_date).slice(0,10):"",nextDueOdometer:r.next_due_odometer==null?null:Number(r.next_due_odometer),notes:r.notes||"",documentId:r.document_id?String(r.document_id):null,vehiclePlate:r.plate||"",ownerName:r.owner_name||""}))})});
app.post("/api/expenses",auth,async(req,res)=>{const v=await vehicleAccessV4(req.body.vehicleId,req.user);if(v===null)return res.status(404).json({error:"vehicle_not_found"});if(v===false)return res.status(403).json({error:"forbidden"});const q=await pool.query("INSERT INTO expenses(user_id,vehicle_id,created_by,category,date,amount,odometer,title,vendor,next_due_date,next_due_odometer,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[v.user_id,v.id,req.user.id,req.body.category||"other",req.body.date,Number(req.body.amount)||0,req.body.odometer||null,req.body.title||"",req.body.vendor||"",req.body.nextDueDate||null,req.body.nextDueOdometer||null,req.body.notes||"",req.body.documentId||null]);await auditV4(req.user.id,"expense_created","expense",q.rows[0].id,{amount:req.body.amount,category:req.body.category});res.status(201).json({ok:true,id:String(q.rows[0].id)})});
app.delete("/api/expenses/:id",auth,async(req,res)=>{const q=await pool.query("SELECT * FROM expenses WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});if(req.user.role!=="super_admin"&&String(q.rows[0].user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});await pool.query("DELETE FROM expenses WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"expense_deleted","expense",req.params.id,{});res.json({ok:true})});
app.get("/api/obligations",auth,async(req,res)=>{const a=req.user.role==="super_admin",sql="SELECT o.*,v.plate,u.name owner_name FROM obligations o JOIN vehicles v ON v.id=o.vehicle_id JOIN users u ON u.id=o.user_id "+(a?"":"WHERE o.user_id=$1 ")+"ORDER BY COALESCE(o.due_date,'9999-12-31'),o.id DESC",q=await pool.query(sql,a?[]:[req.user.id]);res.json({obligations:q.rows.map(r=>({id:String(r.id),userId:String(r.user_id),vehicleId:String(r.vehicle_id),type:r.type,title:r.title||"",startDate:r.start_date?String(r.start_date).slice(0,10):"",dueDate:r.due_date?String(r.due_date).slice(0,10):"",amount:Number(r.amount),provider:r.provider||"",referenceNo:r.reference_no||"",paid:Boolean(r.paid),notes:r.notes||"",documentId:r.document_id?String(r.document_id):null,vehiclePlate:r.plate||"",ownerName:r.owner_name||""}))})});
app.post("/api/obligations",auth,async(req,res)=>{const v=await vehicleAccessV4(req.body.vehicleId,req.user);if(v===null)return res.status(404).json({error:"vehicle_not_found"});if(v===false)return res.status(403).json({error:"forbidden"});const q=await pool.query("INSERT INTO obligations(user_id,vehicle_id,created_by,type,title,start_date,due_date,amount,provider,reference_no,paid,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[v.user_id,v.id,req.user.id,req.body.type||"other",req.body.title||"",req.body.startDate||null,req.body.dueDate||null,Number(req.body.amount)||0,req.body.provider||"",req.body.referenceNo||"",Boolean(req.body.paid),req.body.notes||"",req.body.documentId||null]);await auditV4(req.user.id,"obligation_created","obligation",q.rows[0].id,{type:req.body.type,amount:req.body.amount});res.status(201).json({ok:true,id:String(q.rows[0].id)})});
app.delete("/api/obligations/:id",auth,async(req,res)=>{const q=await pool.query("SELECT * FROM obligations WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});if(req.user.role!=="super_admin"&&String(q.rows[0].user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});await pool.query("DELETE FROM obligations WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"obligation_deleted","obligation",req.params.id,{});res.json({ok:true})});
app.get("/api/audit",auth,admin,async(req,res)=>{const q=await pool.query("SELECT a.*,u.name actor_name,u.email actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 500");res.json({audit:q.rows.map(r=>({id:String(r.id),actorName:r.actor_name||"System",actorEmail:r.actor_email||"",action:r.action,entityType:r.entity_type,entityId:r.entity_id,details:r.details||{},createdAt:r.created_at}))})});
app.get("/api/backup",auth,admin,async(req,res)=>{const qs=await Promise.all(["SELECT id,name,email,role,status,created_at,last_login,password_updated_at FROM users ORDER BY id","SELECT * FROM vehicles ORDER BY id","SELECT * FROM fuel_logs ORDER BY id","SELECT * FROM expenses ORDER BY id","SELECT * FROM obligations ORDER BY id","SELECT id,user_id,vehicle_id,uploaded_by,filename,mime_type,sha256,doc_type,ai_status,ai_json,confirmed,created_at FROM documents ORDER BY id","SELECT * FROM audit_log ORDER BY id"].map(x=>pool.query(x)));await auditV4(req.user.id,"backup_downloaded","system",null,{});res.json({version:1,generatedAt:new Date().toISOString(),users:qs[0].rows,vehicles:qs[1].rows,fuelLogs:qs[2].rows,expenses:qs[3].rows,obligations:qs[4].rows,documents:qs[5].rows,audit:qs[6].rows})});
app.post("/api/documents/analyze",auth,async(req,res)=>{try{if(!OPENAI_API_KEY)return res.status(503).json({error:"ai_not_configured"});const p=parseDataV4(req.body.dataUrl);if(!p)return res.status(400).json({error:"invalid_file"});if(p.buffer.length>12*1024*1024)return res.status(413).json({error:"file_too_large"});const filename=String(req.body.filename||"document"),sha=crypto.createHash("sha256").update(p.buffer).digest("hex"),dupSql="SELECT d.id,d.filename,d.confirmed,v.plate FROM documents d LEFT JOIN vehicles v ON v.id=d.vehicle_id WHERE d.sha256=$1 "+(req.user.role==="super_admin"?"":"AND d.user_id=$2 ")+"ORDER BY d.id DESC LIMIT 1",dup=await pool.query(dupSql,req.user.role==="super_admin"?[sha]:[sha,req.user.id]),vq=await pool.query("SELECT id,plate,model,user_id FROM vehicles "+(req.user.role==="super_admin"?"":"WHERE user_id=$1 ")+"ORDER BY plate",req.user.role==="super_admin"?[]:[req.user.id]),list=vq.rows.map(v=>String(v.id)+": "+v.plate+" | "+v.model).join("\n"),prompt="Ανάλυσε το ελληνικό έγγραφο οχήματος και επέστρεψε ΜΟΝΟ έγκυρο JSON χωρίς markdown. Διαθέσιμα οχήματα:\n"+list+"\nSchema: {\"docType\":\"fuel|insurance|kteo|emissions|road_tax|service|repair|tires|battery|parking|tolls|other\",\"vehicleId\":\"id ή null\",\"plate\":\"\",\"date\":\"YYYY-MM-DD ή null\",\"dueDate\":\"YYYY-MM-DD ή null\",\"amount\":number|null,\"litres\":number|null,\"pricePerLitre\":number|null,\"odometer\":number|null,\"provider\":\"\",\"referenceNo\":\"\",\"title\":\"\",\"paid\":boolean|null,\"confidence\":0,\"notes\":\"\"}. Μην εφευρίσκεις τιμές.",content=p.mime.startsWith("image/")?[{type:"input_image",image_url:req.body.dataUrl,detail:"high"},{type:"input_text",text:prompt}]:[{type:"input_file",filename,file_data:req.body.dataUrl},{type:"input_text",text:prompt}],ar=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+OPENAI_API_KEY},body:JSON.stringify({model:OPENAI_MODEL,input:[{role:"user",content}]})}),aj=await ar.json();if(!ar.ok)return res.status(502).json({error:"ai_error",message:aj&&aj.error&&aj.error.message?aj.error.message:"AI request failed"});let x;try{x=jsonV4(outputTextV4(aj))}catch(e){return res.status(502).json({error:"ai_invalid_json"})}let sv=x.vehicleId?vq.rows.find(v=>String(v.id)===String(x.vehicleId)):null;if(!sv&&x.plate){const n=String(x.plate).replace(/[^A-ZΑ-Ω0-9]/gi,"").toUpperCase();sv=vq.rows.find(v=>String(v.plate).replace(/[^A-ZΑ-Ω0-9]/gi,"").toUpperCase()===n)}if(sv){x.vehicleId=String(sv.id);x.plate=sv.plate}else{x.vehicleId=null}const owner=sv?sv.user_id:req.user.id,ins=await pool.query("INSERT INTO documents(user_id,vehicle_id,uploaded_by,filename,mime_type,file_bytes,sha256,doc_type,ai_status,ai_json,confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ai_read',$9,FALSE) RETURNING id",[owner,sv?sv.id:null,req.user.id,filename,p.mime,p.buffer,sha,x.docType||"other",JSON.stringify(x)]);await auditV4(req.user.id,"document_ai_read","document",ins.rows[0].id,{filename,duplicate:Boolean(dup.rowCount)});res.json({documentId:String(ins.rows[0].id),extraction:x,duplicate:dup.rowCount?{id:String(dup.rows[0].id),filename:dup.rows[0].filename,plate:dup.rows[0].plate,confirmed:dup.rows[0].confirmed}:null})}catch(e){console.error(e);res.status(500).json({error:"server_error"})}});
app.post("/api/documents/:id/confirm",auth,async(req,res)=>{const cl=await pool.connect();try{await cl.query("BEGIN");const dq=await cl.query("SELECT * FROM documents WHERE id=$1 FOR UPDATE",[req.params.id]);if(!dq.rowCount)throw Object.assign(new Error("not_found"),{status:404});const d=dq.rows[0];if(req.user.role!=="super_admin"&&String(d.uploaded_by)!==String(req.user.id))throw Object.assign(new Error("forbidden"),{status:403});const x=req.body.extraction||d.ai_json||{},vq=await cl.query("SELECT * FROM vehicles WHERE id=$1",[x.vehicleId]);if(!vq.rowCount)throw Object.assign(new Error("vehicle_required"),{status:400});const v=vq.rows[0];if(req.user.role!=="super_admin"&&String(v.user_id)!==String(req.user.id))throw Object.assign(new Error("forbidden"),{status:403});const t=x.docType||"other";let et="",ei=null;if(t==="fuel"){const a=Number(x.amount),pr=Number(x.pricePerLitre),li=Number(x.litres)||(a&&pr?a/pr:0),odo=Number(x.odometer)||0;if(!(a>0)||!(pr>0)||!x.date)throw Object.assign(new Error("invalid_extraction"),{status:400});const q=await cl.query("INSERT INTO fuel_logs(user_id,vehicle_id,created_by,date,odometer,amount,price,litres,station,payment,full_tank,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11) RETURNING id",[v.user_id,v.id,req.user.id,x.date,odo,a,pr,li,x.provider||"",x.payment||"",x.notes||"Από AI έγγραφο"]);et="fuel_log";ei=q.rows[0].id}else if(["insurance","kteo","emissions","road_tax","warranty"].includes(t)){const q=await cl.query("INSERT INTO obligations(user_id,vehicle_id,created_by,type,title,start_date,due_date,amount,provider,reference_no,paid,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[v.user_id,v.id,req.user.id,t,x.title||"",x.date||null,x.dueDate||null,Number(x.amount)||0,x.provider||"",x.referenceNo||"",Boolean(x.paid),x.notes||"",d.id]);et="obligation";ei=q.rows[0].id}else{const q=await cl.query("INSERT INTO expenses(user_id,vehicle_id,created_by,category,date,amount,odometer,title,vendor,next_due_date,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",[v.user_id,v.id,req.user.id,t,x.date||new Date().toISOString().slice(0,10),Number(x.amount)||0,x.odometer||null,x.title||"",x.provider||"",x.dueDate||null,x.notes||"",d.id]);et="expense";ei=q.rows[0].id}await cl.query("UPDATE documents SET user_id=$2,vehicle_id=$3,doc_type=$4,ai_status='confirmed',ai_json=$5,confirmed=TRUE WHERE id=$1",[d.id,v.user_id,v.id,t,JSON.stringify(x)]);await cl.query("COMMIT");await auditV4(req.user.id,"document_confirmed",et,ei,{documentId:d.id,docType:t});res.json({ok:true,entityType:et,entityId:String(ei)})}catch(e){try{await cl.query("ROLLBACK")}catch(_){}res.status(e.status||500).json({error:e.message||"server_error"})}finally{cl.release()}});
app.get("/api/documents",auth,async(req,res)=>{const a=req.user.role==="super_admin",sql="SELECT d.id,d.user_id,d.vehicle_id,d.uploaded_by,d.filename,d.mime_type,d.sha256,d.doc_type,d.ai_status,d.ai_json,d.confirmed,d.created_at,v.plate,u.name owner_name FROM documents d LEFT JOIN vehicles v ON v.id=d.vehicle_id JOIN users u ON u.id=d.user_id "+(a?"":"WHERE d.user_id=$1 ")+"ORDER BY d.created_at DESC LIMIT 200",q=await pool.query(sql,a?[]:[req.user.id]);res.json({documents:q.rows.map(r=>Object.assign({},r,{id:String(r.id),user_id:String(r.user_id),vehicle_id:r.vehicle_id?String(r.vehicle_id):null,uploaded_by:String(r.uploaded_by)}))})});
app.get("/api/documents/:id/file",auth,async(req,res)=>{const q=await pool.query("SELECT * FROM documents WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).end();const d=q.rows[0];if(req.user.role!=="super_admin"&&String(d.user_id)!==String(req.user.id))return res.status(403).end();res.setHeader("Content-Type",d.mime_type);res.send(d.file_bytes)});


app.post("/api/backup/restore",auth,admin,async(req,res)=>{
  const b=req.body||{};
  if(!Array.isArray(b.users)||!Array.isArray(b.vehicles)||!Array.isArray(b.fuelLogs)||!Array.isArray(b.expenses)||!Array.isArray(b.obligations)) return res.status(400).json({error:"invalid_backup"});
  const cl=await pool.connect();
  try{
    await cl.query("BEGIN");
    await cl.query("CREATE TEMP TABLE restore_guard(x INT)");
    for(const v of b.vehicles){
      if(!v.id||!v.user_id||!v.plate||!v.model||!v.fuel) continue;
      await cl.query("INSERT INTO vehicles(id,user_id,plate,model,fuel,year,start_odo,status,purchase_date,purchase_price,sale_date,sale_price,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,NOW())) ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,plate=EXCLUDED.plate,model=EXCLUDED.model,fuel=EXCLUDED.fuel,year=EXCLUDED.year,start_odo=EXCLUDED.start_odo,status=EXCLUDED.status,purchase_date=EXCLUDED.purchase_date,purchase_price=EXCLUDED.purchase_price,sale_date=EXCLUDED.sale_date,sale_price=EXCLUDED.sale_price,notes=EXCLUDED.notes",[v.id,v.user_id,v.plate,v.model,v.fuel,v.year||null,v.start_odo||0,v.status||"active",v.purchase_date||null,v.purchase_price||null,v.sale_date||null,v.sale_price||null,v.notes||"",v.created_at||null]);
    }
    for(const x of b.fuelLogs){
      if(!x.id||!x.user_id||!x.vehicle_id||!x.created_by||!x.date) continue;
      await cl.query("INSERT INTO fuel_logs(id,user_id,vehicle_id,created_by,date,odometer,amount,price,litres,station,payment,full_tank,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,NOW())) ON CONFLICT(id) DO NOTHING",[x.id,x.user_id,x.vehicle_id,x.created_by,x.date,x.odometer||0,x.amount||0,x.price||0,x.litres||0,x.station||"",x.payment||"",x.full_tank!==false,x.notes||"",x.created_at||null]);
    }
    for(const x of b.expenses){
      if(!x.id||!x.user_id||!x.vehicle_id||!x.created_by||!x.date) continue;
      await cl.query("INSERT INTO expenses(id,user_id,vehicle_id,created_by,category,date,amount,odometer,title,vendor,next_due_date,next_due_odometer,notes,document_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,NOW()),COALESCE($16,NOW())) ON CONFLICT(id) DO NOTHING",[x.id,x.user_id,x.vehicle_id,x.created_by,x.category||"other",x.date,x.amount||0,x.odometer||null,x.title||"",x.vendor||"",x.next_due_date||null,x.next_due_odometer||null,x.notes||"",x.document_id||null,x.created_at||null,x.updated_at||null]);
    }
    for(const x of b.obligations){
      if(!x.id||!x.user_id||!x.vehicle_id||!x.created_by) continue;
      await cl.query("INSERT INTO obligations(id,user_id,vehicle_id,created_by,type,title,start_date,due_date,amount,provider,reference_no,paid,notes,document_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,NOW()),COALESCE($16,NOW())) ON CONFLICT(id) DO NOTHING",[x.id,x.user_id,x.vehicle_id,x.created_by,x.type||"other",x.title||"",x.start_date||null,x.due_date||null,x.amount||0,x.provider||"",x.reference_no||"",!!x.paid,x.notes||"",x.document_id||null,x.created_at||null,x.updated_at||null]);
    }
    await cl.query("COMMIT");
    await auditV4(req.user.id,"backup_restored","system",null,{vehicles:b.vehicles.length,fuelLogs:b.fuelLogs.length,expenses:b.expenses.length,obligations:b.obligations.length});
    res.json({ok:true});
  }catch(e){try{await cl.query("ROLLBACK")}catch(_){ } console.error(e);res.status(500).json({error:"restore_failed"})}
  finally{cl.release()}
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

initDb().then(ensureV4).then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("OilBank listening on "+PORT))).catch(e=>{console.error("DB init failed",e);process.exit(1)});
