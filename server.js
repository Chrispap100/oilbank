const express=require("express");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
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
const mapUser=r=>({id:String(r.id),name:r.name,email:r.email,role:r.role,active:r.active,createdAt:r.created_at});
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

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

initDb().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("OilBank listening on "+PORT))).catch(e=>{console.error("DB init failed",e);process.exit(1)});
