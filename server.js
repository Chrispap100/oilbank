const express=require("express");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const crypto=require("crypto");
const fs=require("fs");
const local=require("./local-store");
const pool=local.pool;

const app=express();
const PORT=process.env.PORT||10000;
let JWT_SECRET=local.secret("jwt");
app.use("/api/backup/restore",express.json({limit:"200mb"}));
app.use(express.json({limit:"18mb"}));
const publicFiles=new Set(["index.html","style.css","script.js","v4.js","local-ui.js","manifest.webmanifest","icon.svg","sw.js"]);
app.get("/:file",(req,res,next)=>publicFiles.has(req.params.file)?res.sendFile(path.join(__dirname,req.params.file)):next());
// Serialize API requests so multi-statement transactions cannot interleave.
let requestTail=Promise.resolve();
app.use("/api",(req,res,next)=>{let release;const done=new Promise(r=>release=r),previous=requestTail;requestTail=previous.then(()=>done);previous.then(()=>{if(res.destroyed){release();return}res.once("finish",release);res.once("close",release);next()})});
app.use((err,req,res,next)=>{if(err&&err.type==="entity.too.large"){console.error("UPLOAD_TOO_LARGE",err.length||0);return res.status(413).json({error:"file_too_large",message:"Το αρχείο είναι πολύ μεγάλο. Δοκίμασε μικρότερη φωτογραφία."})}next(err)});

async function initDb(){
  local.migrate();
  const adminEmail=(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
  const adminPassword=process.env.ADMIN_PASSWORD||"";
  const adminName=process.env.ADMIN_NAME||"Super Admin";
  if(adminEmail&&adminPassword&&!(await pool.query("SELECT id FROM users LIMIT 1")).rowCount){
    const existing=await pool.query("SELECT id FROM users WHERE email=$1",[adminEmail]);
    const hash=await bcrypt.hash(adminPassword,12);
    if(!existing.rowCount){
      await pool.query("INSERT INTO users(name,email,password_hash,role,active) VALUES($1,$2,$3,'super_admin',TRUE)",[adminName,adminEmail,hash]);
      console.log("Initial super admin created");
    }
  }
}

function sign(user){return jwt.sign({id:user.id,role:user.role,email:user.email,name:user.name,pw:crypto.createHash("sha256").update(user.password_hash).digest("hex")},JWT_SECRET,{expiresIn:"7d"})}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  try{const claims=jwt.verify(token,JWT_SECRET);const u=local.db().prepare("SELECT * FROM users WHERE id=?").get(claims.id);if(!u||!u.active||u.status!=="active"||claims.pw!==crypto.createHash("sha256").update(u.password_hash).digest("hex"))throw new Error();req.user=u;next()}catch(e){res.status(401).json({error:"unauthorized"})}
}
function admin(req,res,next){if(req.user.role!=="super_admin")return res.status(403).json({error:"forbidden"});next()}
const cleanEmail=s=>String(s||"").trim().toLowerCase();
const mapUser=r=>({id:String(r.id),name:r.name,email:r.email,role:r.role,status:r.status||((r.active===false)?"disabled":"active"),active:(r.status||((r.active===false)?"disabled":"active"))==="active",createdAt:r.created_at,lastLogin:r.last_login||null,passwordUpdatedAt:r.password_updated_at||null});
const mapVehicle=r=>({id:String(r.id),userId:String(r.user_id),plate:r.plate,model:r.model,fuel:r.fuel,year:r.year,startOdo:Number(r.start_odo)||0,createdAt:r.created_at,ownerName:r.owner_name||null,ownerEmail:r.owner_email||null,status:r.status,purchaseDate:r.purchase_date,purchasePrice:r.purchase_price,saleDate:r.sale_date,salePrice:r.sale_price,notes:r.notes||""});
const mapLog=r=>({id:String(r.id),userId:String(r.user_id),vehicleId:String(r.vehicle_id),createdBy:String(r.created_by),date:String(r.date).slice(0,10),odometer:Number(r.odometer),amount:Number(r.amount),price:Number(r.price),litres:Number(r.litres),station:r.station||"",payment:r.payment||"",fullTank:Boolean(r.full_tank),notes:r.notes||"",product:r.product||"",referenceNo:r.reference_no||"",netAmount:r.net_amount==null?null:Number(r.net_amount),vatRate:r.vat_rate==null?null:Number(r.vat_rate),vatAmount:r.vat_amount==null?null:Number(r.vat_amount),documentId:r.document_id?String(r.document_id):null,createdAt:r.created_at,vehiclePlate:r.plate||"",vehicleModel:r.model||"",ownerName:r.owner_name||"",creatorName:r.creator_name||""});

app.get("/api/health",(req,res)=>res.json({ok:true}));
app.post("/api/logout",(req,res)=>res.json({ok:true}));

app.post("/api/login",async(req,res)=>{
  try{
    const email=cleanEmail(req.body.email),password=String(req.body.password||"");
    const emailTag=crypto.createHash("sha256").update(email).digest("hex").slice(0,10);
    const q=await pool.query("SELECT * FROM users WHERE email=$1",[email]);
    if(!q.rowCount){console.log("LOGIN_FAIL user_not_found",emailTag);return res.status(401).json({error:"invalid_credentials"})}
    const u=q.rows[0];
    if(!u.active){console.log("LOGIN_FAIL inactive",emailTag);return res.status(401).json({error:"invalid_credentials"})}
    const ok=await bcrypt.compare(password,u.password_hash);
    if(!ok){console.log("LOGIN_FAIL password_mismatch",emailTag);return res.status(401).json({error:"invalid_credentials"})}
    console.log("LOGIN_OK",emailTag,String(u.id),u.role);
    await pool.query("UPDATE users SET last_login=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=$1",[u.id]);
    await auditV4(u.id,"login","user",u.id,{});
    res.json({token:sign(u),user:mapUser(u)});
  }catch(e){console.error("LOGIN_ERROR",e);res.status(500).json({error:"server_error"})}
});

app.get("/api/me",auth,async(req,res)=>{
  const q=await pool.query("SELECT * FROM users WHERE id=$1",[req.user.id]);
  if(!q.rowCount||!q.rows[0].active)return res.status(401).json({error:"unauthorized"});
  res.json({user:mapUser(q.rows[0])});
});

app.get("/api/users",auth,admin,async(req,res)=>{
  const q=await pool.query("SELECT * FROM users ORDER BY created_at");
  res.json({users:q.rows.map(mapUser)});
});
app.post("/api/users",auth,admin,async(req,res)=>{
  try{
    const name=String(req.body.name||"").trim(),email=cleanEmail(req.body.email),password=String(req.body.password||""),role=req.body.role==="super_admin"?"super_admin":"user";
    if(!name||!email||password.length<6)return res.status(400).json({error:"invalid_input"});
    const hash=await bcrypt.hash(password,12);
    const q=await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active,created_at",[name,email,hash,role]);
    await auditV4(req.user.id,"user_created","user",q.rows[0].id,{});res.status(201).json({user:mapUser(q.rows[0])});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"email_exists"});console.error(e);res.status(500).json({error:"server_error"})}
});
app.delete("/api/users/:id",auth,admin,async(req,res)=>{
  if(String(req.user.id)===String(req.params.id))return res.status(400).json({error:"cannot_delete_self"});
  await pool.query("DELETE FROM users WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"user_deleted","user",req.params.id,{});res.json({ok:true});
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
    const q=await pool.query("INSERT INTO vehicles(user_id,plate,model,fuel,year,start_odo,status,purchase_date,purchase_price,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[ownerId,plate,model,fuel,year,startOdo,["active","sold","archived"].includes(req.body.status)?req.body.status:"active",req.body.purchaseDate||null,req.body.purchasePrice??null,String(req.body.notes||"")]);
    await auditV4(req.user.id,"vehicle_created","vehicle",q.rows[0].id,{});res.status(201).json({vehicle:mapVehicle(q.rows[0])});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"plate_exists"});console.error(e);res.status(500).json({error:"server_error"})}
});
app.delete("/api/vehicles/:id",auth,async(req,res)=>{
  const q=await pool.query("SELECT * FROM vehicles WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});
  const v=q.rows[0];if(req.user.role!=="super_admin"&&String(v.user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});
  await pool.query("DELETE FROM vehicles WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"vehicle_deleted","vehicle",req.params.id,{});res.json({ok:true});
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
    await auditV4(req.user.id,"fuel_created","fuel_log",q.rows[0].id,{});res.status(201).json({log:mapLog(q.rows[0])});
  }catch(e){console.error(e);res.status(500).json({error:"server_error"})}
});
app.delete("/api/logs/:id",auth,async(req,res)=>{
  const q=await pool.query("SELECT * FROM fuel_logs WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});
  const l=q.rows[0];if(req.user.role!=="super_admin"&&String(l.user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});
  await pool.query("DELETE FROM fuel_logs WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"fuel_log_deleted","fuel_log",req.params.id,{});res.json({ok:true});
});



const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-4.1-mini";

async function auditV4(actor,action,entityType,entityId,details){try{await pool.query("INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",[actor||null,action,entityType||null,entityId==null?null:String(entityId),JSON.stringify(details||{})])}catch(e){console.error("audit",e.message)}}
function vaultKeyV4(){return crypto.createHash("sha256").update(local.secret("vault")).digest()}
function encryptV4(text){const k=vaultKeyV4();if(!k)return null;const iv=crypto.randomBytes(12),x=crypto.createCipheriv("aes-256-gcm",k,iv),buf=Buffer.concat([x.update(String(text),"utf8"),x.final()]);return{cipher:buf.toString("base64"),iv:iv.toString("base64"),tag:x.getAuthTag().toString("base64")}}
function decryptV4(r){const k=vaultKeyV4();if(!k||!r.vault_cipher)return null;const x=crypto.createDecipheriv("aes-256-gcm",k,Buffer.from(r.vault_iv,"base64"));x.setAuthTag(Buffer.from(r.vault_tag,"base64"));return Buffer.concat([x.update(Buffer.from(r.vault_cipher,"base64")),x.final()]).toString("utf8")}
async function vehicleAccessV4(id,user){const q=await pool.query("SELECT * FROM vehicles WHERE id=$1",[id]);if(!q.rowCount)return null;return user.role==="super_admin"||String(q.rows[0].user_id)===String(user.id)?q.rows[0]:false}
function parseDataV4(s){const m=String(s||"").match(/^data:([^;]+);base64,(.+)$/s);return m?{mime:m[1],buffer:Buffer.from(m[2],"base64")}:null}
function outputTextV4(d){if(typeof d.output_text==="string")return d.output_text;for(const o of d.output||[])for(const x of o.content||[])if(x.type==="output_text"&&x.text)return x.text;return""}
function jsonV4(t){return JSON.parse(String(t||"").trim())}
app.post("/api/register-request",async(req,res)=>{try{const name=String(req.body.name||"").trim(),email=cleanEmail(req.body.email);if(!name||!email)return res.status(400).json({error:"invalid_input"});if((await pool.query("SELECT id FROM users WHERE email=$1",[email])).rowCount)return res.status(409).json({error:"email_exists"});const hash=await bcrypt.hash(crypto.randomBytes(32).toString("hex"),10),q=await pool.query("INSERT INTO users(name,email,password_hash,role,status,active) VALUES($1,$2,$3,'user','pending',FALSE) RETURNING *",[name,email,hash]);await auditV4(q.rows[0].id,"registration_requested","user",q.rows[0].id,{email});res.status(201).json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"server_error"})}});
app.post("/api/users/:id/approve",auth,admin,async(req,res)=>{const password=String(req.body.password||"");if(password.length<6)return res.status(400).json({error:"invalid_password"});const hash=await bcrypt.hash(password,12),v=encryptV4(password),q=await pool.query("UPDATE users SET status='active',active=TRUE,password_hash=$2,vault_cipher=$3,vault_iv=$4,vault_tag=$5,password_updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')),archived_at=NULL WHERE id=$1 RETURNING *",[req.params.id,hash,v?v.cipher:null,v?v.iv:null,v?v.tag:null]);if(!q.rowCount)return res.status(404).json({error:"not_found"});await auditV4(req.user.id,"user_approved","user",req.params.id,{});res.json({user:mapUser(q.rows[0])})});
app.post("/api/users/:id/reset-password",auth,admin,async(req,res)=>{const password=String(req.body.password||"");if(password.length<6)return res.status(400).json({error:"invalid_password"});const hash=await bcrypt.hash(password,12),v=encryptV4(password),q=await pool.query("UPDATE users SET password_hash=$2,vault_cipher=$3,vault_iv=$4,vault_tag=$5,password_updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=$1 RETURNING id",[req.params.id,hash,v?v.cipher:null,v?v.iv:null,v?v.tag:null]);if(!q.rowCount)return res.status(404).json({error:"not_found"});await auditV4(req.user.id,"password_reset","user",req.params.id,{});res.json({ok:true})});
app.get("/api/users/:id/vault",auth,admin,async(req,res)=>{try{const q=await pool.query("SELECT vault_cipher,vault_iv,vault_tag FROM users WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});const password=decryptV4(q.rows[0]);if(password==null)return res.status(503).json({error:"vault_unavailable"});await auditV4(req.user.id,"vault_viewed","user",req.params.id,{});res.json({password})}catch(e){res.status(500).json({error:"server_error"})}});
app.post("/api/users/:id/status",auth,admin,async(req,res)=>{const status=["active","disabled","archived","pending"].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:"invalid_status"});if(String(req.user.id)===String(req.params.id)&&status!=="active")return res.status(400).json({error:"cannot_disable_self"});const q=await pool.query("UPDATE users SET status=$2,active=($2='active'),archived_at=CASE WHEN $2='archived' THEN (strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE archived_at END WHERE id=$1 RETURNING *",[req.params.id,status]);if(!q.rowCount)return res.status(404).json({error:"not_found"});await auditV4(req.user.id,"user_status_changed","user",req.params.id,{status});res.json({user:mapUser(q.rows[0])})});
app.post("/api/self/archive",auth,async(req,res)=>{if(req.user.role==="super_admin")return res.status(400).json({error:"admin_cannot_self_archive"});await pool.query("UPDATE users SET status='archived',active=FALSE,archived_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=$1",[req.user.id]);await auditV4(req.user.id,"self_archived","user",req.user.id,{});res.json({ok:true})});
app.get("/api/expenses",auth,async(req,res)=>{const a=req.user.role==="super_admin",sql="SELECT e.*,v.plate,u.name owner_name FROM expenses e JOIN vehicles v ON v.id=e.vehicle_id JOIN users u ON u.id=e.user_id "+(a?"":"WHERE e.user_id=$1 ")+"ORDER BY e.date DESC,e.id DESC",q=await pool.query(sql,a?[]:[req.user.id]);res.json({expenses:q.rows.map(r=>({id:String(r.id),userId:String(r.user_id),vehicleId:String(r.vehicle_id),category:r.category,date:String(r.date).slice(0,10),amount:Number(r.amount),odometer:r.odometer==null?null:Number(r.odometer),title:r.title||"",vendor:r.vendor||"",nextDueDate:r.next_due_date?String(r.next_due_date).slice(0,10):"",nextDueOdometer:r.next_due_odometer==null?null:Number(r.next_due_odometer),notes:r.notes||"",documentId:r.document_id?String(r.document_id):null,vehiclePlate:r.plate||"",ownerName:r.owner_name||""}))})});
app.post("/api/expenses",auth,async(req,res)=>{const v=await vehicleAccessV4(req.body.vehicleId,req.user);if(v===null)return res.status(404).json({error:"vehicle_not_found"});if(v===false)return res.status(403).json({error:"forbidden"});const q=await pool.query("INSERT INTO expenses(user_id,vehicle_id,created_by,category,date,amount,odometer,title,vendor,next_due_date,next_due_odometer,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[v.user_id,v.id,req.user.id,req.body.category||"other",req.body.date,Number(req.body.amount)||0,req.body.odometer||null,req.body.title||"",req.body.vendor||"",req.body.nextDueDate||null,req.body.nextDueOdometer||null,req.body.notes||"",req.body.documentId||null]);await auditV4(req.user.id,"expense_created","expense",q.rows[0].id,{amount:req.body.amount,category:req.body.category});res.status(201).json({ok:true,id:String(q.rows[0].id)})});
app.delete("/api/expenses/:id",auth,async(req,res)=>{const q=await pool.query("SELECT * FROM expenses WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});if(req.user.role!=="super_admin"&&String(q.rows[0].user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});await pool.query("DELETE FROM expenses WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"expense_deleted","expense",req.params.id,{});res.json({ok:true})});
app.get("/api/obligations",auth,async(req,res)=>{const a=req.user.role==="super_admin",sql="SELECT o.*,v.plate,u.name owner_name FROM obligations o JOIN vehicles v ON v.id=o.vehicle_id JOIN users u ON u.id=o.user_id "+(a?"":"WHERE o.user_id=$1 ")+"ORDER BY COALESCE(o.due_date,'9999-12-31'),o.id DESC",q=await pool.query(sql,a?[]:[req.user.id]);res.json({obligations:q.rows.map(r=>({id:String(r.id),userId:String(r.user_id),vehicleId:String(r.vehicle_id),type:r.type,title:r.title||"",startDate:r.start_date?String(r.start_date).slice(0,10):"",dueDate:r.due_date?String(r.due_date).slice(0,10):"",amount:Number(r.amount),provider:r.provider||"",referenceNo:r.reference_no||"",paid:Boolean(r.paid),notes:r.notes||"",documentId:r.document_id?String(r.document_id):null,vehiclePlate:r.plate||"",ownerName:r.owner_name||""}))})});
app.post("/api/obligations",auth,async(req,res)=>{const v=await vehicleAccessV4(req.body.vehicleId,req.user);if(v===null)return res.status(404).json({error:"vehicle_not_found"});if(v===false)return res.status(403).json({error:"forbidden"});const q=await pool.query("INSERT INTO obligations(user_id,vehicle_id,created_by,type,title,start_date,due_date,amount,provider,reference_no,paid,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[v.user_id,v.id,req.user.id,req.body.type||"other",req.body.title||"",req.body.startDate||null,req.body.dueDate||null,Number(req.body.amount)||0,req.body.provider||"",req.body.referenceNo||"",Boolean(req.body.paid),req.body.notes||"",req.body.documentId||null]);await auditV4(req.user.id,"obligation_created","obligation",q.rows[0].id,{type:req.body.type,amount:req.body.amount});res.status(201).json({ok:true,id:String(q.rows[0].id)})});
app.delete("/api/obligations/:id",auth,async(req,res)=>{const q=await pool.query("SELECT * FROM obligations WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).json({error:"not_found"});if(req.user.role!=="super_admin"&&String(q.rows[0].user_id)!==String(req.user.id))return res.status(403).json({error:"forbidden"});await pool.query("DELETE FROM obligations WHERE id=$1",[req.params.id]);await auditV4(req.user.id,"obligation_deleted","obligation",req.params.id,{});res.json({ok:true})});
app.get("/api/audit",auth,admin,async(req,res)=>{const q=await pool.query("SELECT a.*,u.name actor_name,u.email actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 500");res.json({audit:q.rows.map(r=>({id:String(r.id),actorName:r.actor_name||"System",actorEmail:r.actor_email||"",action:r.action,entityType:r.entity_type,entityId:r.entity_id,details:r.details||{},createdAt:r.created_at}))})});
app.post("/api/documents/analyze",auth,async(req,res)=>{try{if(!OPENAI_API_KEY)return res.status(503).json({error:"ai_not_configured"});const p=parseDataV4(req.body.dataUrl);if(!p)return res.status(400).json({error:"invalid_file"});if(p.buffer.length>12*1024*1024)return res.status(413).json({error:"file_too_large"});const filename=String(req.body.filename||"document"),sha=crypto.createHash("sha256").update(p.buffer).digest("hex"),dupSql="SELECT d.id,d.filename,d.confirmed,v.plate FROM documents d LEFT JOIN vehicles v ON v.id=d.vehicle_id WHERE d.sha256=$1 "+(req.user.role==="super_admin"?"":"AND d.user_id=$2 ")+"ORDER BY d.id DESC LIMIT 1",dup=await pool.query(dupSql,req.user.role==="super_admin"?[sha]:[sha,req.user.id]),vq=await pool.query("SELECT id,plate,model,user_id FROM vehicles "+(req.user.role==="super_admin"?"":"WHERE user_id=$1 ")+"ORDER BY plate",req.user.role==="super_admin"?[]:[req.user.id]),list=vq.rows.map(v=>String(v.id)+": "+v.plate+" | "+v.model).join("\n"),prompt="Ανάλυσε το ελληνικό έγγραφο οχήματος και επέστρεψε ΜΟΝΟ έγκυρο JSON χωρίς markdown. Διαθέσιμα οχήματα:\n"+list+"\nSchema: {\"docType\":\"fuel|insurance|kteo|emissions|road_tax|service|repair|tires|battery|parking|tolls|other\",\"vehicleId\":\"id ή null\",\"plate\":\"\",\"date\":\"YYYY-MM-DD ή null\",\"dueDate\":\"YYYY-MM-DD ή null\",\"amount\":number|null,\"netAmount\":number|null,\"vatRate\":number|null,\"vatAmount\":number|null,\"litres\":number|null,\"pricePerLitre\":number|null,\"odometer\":number|null,\"product\":\"\",\"provider\":\"\",\"referenceNo\":\"\",\"title\":\"\",\"paid\":boolean|null,\"confidence\":0,\"notes\":\"\"}. Μην εφευρίσκεις τιμές.",content=p.mime.startsWith("image/")?[{type:"input_image",image_url:req.body.dataUrl,detail:"high"},{type:"input_text",text:prompt}]:[{type:"input_file",filename,file_data:req.body.dataUrl},{type:"input_text",text:prompt}],ar=await fetch("https://api.openai.com/v1/responses",{signal:AbortSignal.timeout(60000),method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+OPENAI_API_KEY},body:JSON.stringify({model:OPENAI_MODEL,input:[{role:"user",content}]})}),aj=await ar.json();if(!ar.ok){const ae=aj&&aj.error?aj.error:{};console.error("AI_ERROR",ar.status,ae.code||"",ae.type||"",ae.message||"");return res.status(502).json({error:"ai_error",message:ae.message||"AI request failed",code:ae.code||null,type:ae.type||null})}let x;try{x=jsonV4(outputTextV4(aj))}catch(e){return res.status(502).json({error:"ai_invalid_json"})}let sv=x.vehicleId?vq.rows.find(v=>String(v.id)===String(x.vehicleId)):null;if(!sv&&x.plate){const n=String(x.plate).replace(/[^A-ZΑ-Ω0-9]/gi,"").toUpperCase();sv=vq.rows.find(v=>String(v.plate).replace(/[^A-ZΑ-Ω0-9]/gi,"").toUpperCase()===n)}if(sv){x.vehicleId=String(sv.id);x.plate=sv.plate}else{x.vehicleId=null}const owner=sv?sv.user_id:req.user.id,ins=await pool.query("INSERT INTO documents(user_id,vehicle_id,uploaded_by,filename,mime_type,file_path,size_bytes,sha256,doc_type,ai_status,ai_json,confirmed) VALUES($1,$2,$3,$4,$5,$6,$10,$7,$8,'ai_read',$9,FALSE) RETURNING id",[owner,sv?sv.id:null,req.user.id,filename,p.mime,local.saveDocument(p.buffer),sha,x.docType||"other",JSON.stringify(x),p.buffer.length]);await auditV4(req.user.id,"document_ai_read","document",ins.rows[0].id,{filename,duplicate:Boolean(dup.rowCount)});res.json({documentId:String(ins.rows[0].id),extraction:x,duplicate:dup.rowCount?{id:String(dup.rows[0].id),filename:dup.rows[0].filename,plate:dup.rows[0].plate,confirmed:dup.rows[0].confirmed}:null})}catch(e){console.error(e);res.status(500).json({error:"server_error"})}});
app.post("/api/documents/:id/confirm",auth,async(req,res)=>{const cl=await pool.connect();try{await cl.query("BEGIN");const dq=await cl.query("SELECT * FROM documents WHERE id=$1",[req.params.id]);if(!dq.rowCount)throw Object.assign(new Error("not_found"),{status:404});const d=dq.rows[0];if(d.confirmed)throw Object.assign(new Error("already_confirmed"),{status:409});if(req.user.role!=="super_admin"&&String(d.uploaded_by)!==String(req.user.id))throw Object.assign(new Error("forbidden"),{status:403});const x=req.body.extraction||d.ai_json||{},vq=await cl.query("SELECT * FROM vehicles WHERE id=$1",[x.vehicleId]);if(!vq.rowCount)throw Object.assign(new Error("vehicle_required"),{status:400});const v=vq.rows[0];if(req.user.role!=="super_admin"&&String(v.user_id)!==String(req.user.id))throw Object.assign(new Error("forbidden"),{status:403});const t=x.docType||"other";let et="",ei=null;if(t==="fuel"){const a=Number(x.amount),pr=Number(x.pricePerLitre),li=Number(x.litres)||(a&&pr?a/pr:0),odo=Number(x.odometer)||0;if(!(a>0)||!(pr>0)||!x.date)throw Object.assign(new Error("invalid_extraction"),{status:400});const q=await cl.query("INSERT INTO fuel_logs(user_id,vehicle_id,created_by,date,odometer,amount,price,litres,station,payment,full_tank,notes,product,reference_no,net_amount,vat_rate,vat_amount,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$13,$14,$15,$16,$17) RETURNING id",[v.user_id,v.id,req.user.id,x.date,odo,a,pr,li,x.provider||"",x.payment||"",x.notes||"Από έγγραφο",x.product||"",x.referenceNo||"",x.netAmount==null?null:Number(x.netAmount),x.vatRate==null?null:Number(x.vatRate),x.vatAmount==null?null:Number(x.vatAmount),d.id]);et="fuel_log";ei=q.rows[0].id}else if(["insurance","kteo","emissions","road_tax","warranty"].includes(t)){const q=await cl.query("INSERT INTO obligations(user_id,vehicle_id,created_by,type,title,start_date,due_date,amount,provider,reference_no,paid,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[v.user_id,v.id,req.user.id,t,x.title||"",x.date||null,x.dueDate||null,Number(x.amount)||0,x.provider||"",x.referenceNo||"",Boolean(x.paid),x.notes||"",d.id]);et="obligation";ei=q.rows[0].id}else{const q=await cl.query("INSERT INTO expenses(user_id,vehicle_id,created_by,category,date,amount,odometer,title,vendor,next_due_date,notes,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",[v.user_id,v.id,req.user.id,t,x.date||new Date().toISOString().slice(0,10),Number(x.amount)||0,x.odometer||null,x.title||"",x.provider||"",x.dueDate||null,x.notes||"",d.id]);et="expense";ei=q.rows[0].id}await cl.query("UPDATE documents SET user_id=$2,vehicle_id=$3,doc_type=$4,ai_status='confirmed',ai_json=$5,confirmed=TRUE WHERE id=$1",[d.id,v.user_id,v.id,t,JSON.stringify(x)]);await cl.query("COMMIT");await auditV4(req.user.id,"document_confirmed",et,ei,{documentId:d.id,docType:t});res.json({ok:true,entityType:et,entityId:String(ei)})}catch(e){try{await cl.query("ROLLBACK")}catch(_){}res.status(e.status||500).json({error:e.message||"server_error"})}finally{cl.release()}});
app.get("/api/documents",auth,async(req,res)=>{const a=req.user.role==="super_admin",sql="SELECT d.id,d.user_id,d.vehicle_id,d.uploaded_by,d.filename,d.mime_type,d.file_path,d.size_bytes,d.sha256,d.doc_type,d.ai_status,d.ai_json,d.confirmed,d.created_at,v.plate,u.name owner_name FROM documents d LEFT JOIN vehicles v ON v.id=d.vehicle_id JOIN users u ON u.id=d.user_id "+(a?"":"WHERE d.user_id=$1 ")+"ORDER BY d.created_at DESC LIMIT 200",q=await pool.query(sql,a?[]:[req.user.id]);res.json({documents:q.rows.map(r=>Object.assign({},r,{id:String(r.id),user_id:String(r.user_id),vehicle_id:r.vehicle_id?String(r.vehicle_id):null,uploaded_by:String(r.uploaded_by)}))})});
app.get("/api/documents/:id/file",auth,async(req,res)=>{const q=await pool.query("SELECT * FROM documents WHERE id=$1",[req.params.id]);if(!q.rowCount)return res.status(404).end();const d=q.rows[0];if(req.user.role!=="super_admin"&&String(d.user_id)!==String(req.user.id))return res.status(403).end();res.setHeader("Content-Type",d.mime_type);res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Disposition",["application/pdf","image/png","image/jpeg","image/webp"].includes(d.mime_type)?"inline":"attachment");res.sendFile(local.documentPath(d.file_path))});




require("./local-routes")(app,{auth,admin,pool,local,audit:auditV4,parseData:parseDataV4,vehicleAccess:vehicleAccessV4,rotateSession:()=>{JWT_SECRET=local.secret("jwt")}});
app.use("/api",(req,res)=>res.status(404).json({error:"not_found"}));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||400).json({error:err.status===413?"file_too_large":"request_failed"})});


async function runOneTimeFuelImport(){
  const raw=process.env.ONE_TIME_FUEL_IMPORT;
  if(!raw)return;
  let x;try{x=JSON.parse(raw)}catch(e){console.error("ONE_TIME_FUEL_IMPORT invalid JSON");return}
  const norm=s=>String(s||"").replace(/[^A-ZΑ-Ω0-9]/gi,"").toUpperCase();
  const vq=await pool.query("SELECT * FROM vehicles ORDER BY id");
  const v=vq.rows.find(r=>norm(r.plate)===norm(x.plate));
  if(!v){console.error("ONE_TIME_FUEL_IMPORT vehicle not found",norm(x.plate));return}
  const dup=await pool.query("SELECT id FROM fuel_logs WHERE vehicle_id=$1 AND date=$2 AND amount=$3 AND COALESCE(reference_no,'')=$4 LIMIT 1",[v.id,x.date,Number(x.amount),String(x.referenceNo||"")]);
  if(dup.rowCount){console.log("ONE_TIME_FUEL_IMPORT already exists",dup.rows[0].id);return}
  const creator=await pool.query("SELECT id FROM users WHERE role='super_admin' AND active=TRUE ORDER BY id LIMIT 1");
  const createdBy=creator.rowCount?creator.rows[0].id:v.user_id;
  const q=await pool.query(`INSERT INTO fuel_logs(user_id,vehicle_id,created_by,date,odometer,amount,price,litres,station,payment,full_tank,notes,product,reference_no,net_amount,vat_rate,vat_amount)
    VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,'',FALSE,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [v.user_id,v.id,createdBy,x.date,Number(x.amount),Number(x.pricePerLitre),Number(x.litres),String(x.provider||""),String(x.notes||"Καταχώριση από παραστατικό"),String(x.product||""),String(x.referenceNo||""),x.netAmount==null?null:Number(x.netAmount),x.vatRate==null?null:Number(x.vatRate),x.vatAmount==null?null:Number(x.vatAmount)]);
  await auditV4(createdBy,"one_time_fuel_import","fuel_log",q.rows[0].id,{plate:v.plate,referenceNo:String(x.referenceNo||"")});
  console.log("ONE_TIME_FUEL_IMPORT inserted",q.rows[0].id);
}

async function start(){
 await initDb();await runOneTimeFuelImport();
 if(process.env.OILBANK_AUTO_BACKUP!=="0")local.backup("startup");
 return new Promise((resolve,reject)=>{const server=app.listen(PORT,"127.0.0.1",()=>{console.log("OilBank http://127.0.0.1:"+server.address().port);resolve(server)});server.once("error",reject)});
}
if(require.main===module){local.acquireLock();start().catch(e=>{console.error("Startup failed",e);process.exit(1)})}
module.exports={app,start};
