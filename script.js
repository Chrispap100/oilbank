const DB_KEY="oilbank_v2";
const LEGACY_VEHICLES="vehicles";
const LEGACY_LOGS="fuelLogs";
let pendingConfirm=null;
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const money=n=>new Intl.NumberFormat("el-GR",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const num=(n,d=2)=>new Intl.NumberFormat("el-GR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n)||0);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const today=()=>new Date().toISOString().slice(0,10);
function defaultDB(){return{version:2,vehicles:[],logs:[]}}
function normalizeDB(db){
  const out=defaultDB();
  out.vehicles=Array.isArray(db&&db.vehicles)?db.vehicles.map(v=>Object.assign({},v,{id:v.id||uid(),startOdo:Number(v.startOdo)||0})):[];
  out.logs=Array.isArray(db&&db.logs)?db.logs.map(l=>Object.assign({},l,{id:l.id||uid(),amount:Number(l.amount)||0,price:Number(l.price)||0,odometer:Number(l.odometer)||0,litres:Number(l.litres)||(Number(l.price)?Number(l.amount)/Number(l.price):0),fullTank:Boolean(l.fullTank)})):[];
  return out;
}
function loadDB(){
  try{const raw=localStorage.getItem(DB_KEY);if(raw)return normalizeDB(JSON.parse(raw))}catch(e){}
  const db=defaultDB();
  try{
    const legacyVehicles=JSON.parse(localStorage.getItem(LEGACY_VEHICLES)||"[]");
    const legacyLogs=JSON.parse(localStorage.getItem(LEGACY_LOGS)||"[]");
    db.vehicles=legacyVehicles.map(v=>({id:uid(),plate:v.plate||"",model:v.model||"",fuel:v.fuel||"Άγνωστο",year:"",startOdo:0,createdAt:new Date().toISOString()}));
    db.logs=legacyLogs.map(l=>{
      const vehicle=db.vehicles.find(v=>v.plate===l.vehicle),amount=Number(l.amount)||0,price=Number(l.price)||0;
      return{id:uid(),vehicleId:vehicle?vehicle.id:"",vehiclePlate:l.vehicle||"",fuelType:l.fuelType||(vehicle?vehicle.fuel:"Άγνωστο"),station:l.station||"",amount:amount,price:price,date:l.date||today(),odometer:0,payment:"Άγνωστο",fullTank:false,notes:"Μεταφέρθηκε από παλιά έκδοση",litres:price?amount/price:0,createdAt:new Date().toISOString()};
    });
    if(db.vehicles.length||db.logs.length)localStorage.setItem(DB_KEY,JSON.stringify(db));
  }catch(e){}
  return db;
}
let db=loadDB();
function saveDB(next){if(next)db=normalizeDB(next);else db=normalizeDB(db);localStorage.setItem(DB_KEY,JSON.stringify(db));renderAll()}
function getVehicle(id){return db.vehicles.find(v=>v.id===id)}
function vehicleLabel(v){return v?(v.plate+" · "+v.model):"Άγνωστο όχημα"}
function sortedLogs(){return db.logs.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||Number(b.odometer)-Number(a.odometer))}
function logsForVehicle(id){return db.logs.filter(l=>l.vehicleId===id).sort((a,b)=>Number(a.odometer)-Number(b.odometer)||String(a.date).localeCompare(String(b.date)))}
function vatBreakdown(gross){const g=Number(gross)||0,net=g/1.24;return{net:net,vat:g-net}}
function calcConsumptionForLog(log){
  if(!log.fullTank||!log.vehicleId||!log.odometer)return null;
  const logs=logsForVehicle(log.vehicleId).filter(x=>x.fullTank&&x.odometer>0);
  const idx=logs.findIndex(x=>x.id===log.id);if(idx<=0)return null;
  const prev=logs[idx-1],km=Number(log.odometer)-Number(prev.odometer);if(km<=0)return null;
  return{km:km,consumption:Number(log.litres)/km*100,costPerKm:Number(log.amount)/km};
}
function vehicleStats(id){
  const logs=logsForVehicle(id),spend=logs.reduce((s,l)=>s+Number(l.amount||0),0),litres=logs.reduce((s,l)=>s+Number(l.litres||0),0);
  let km=0,fullLitres=0;
  logs.forEach(l=>{const c=calcConsumptionForLog(l);if(c){km+=c.km;fullLitres+=Number(l.litres)||0}});
  const v=getVehicle(id),odos=logs.map(l=>Number(l.odometer)||0);odos.push(Number(v&&v.startOdo)||0);
  return{spend:spend,litres:litres,avgPrice:litres?spend/litres:0,avgConsumption:km?fullLitres/km*100:null,maxOdo:Math.max.apply(null,odos),entries:logs.length};
}
function globalStats(){
  const spend=db.logs.reduce((s,l)=>s+Number(l.amount||0),0),litres=db.logs.reduce((s,l)=>s+Number(l.litres||0),0);
  let km=0,fullLitres=0;
  db.logs.forEach(l=>{const c=calcConsumptionForLog(l);if(c){km+=c.km;fullLitres+=Number(l.litres)||0}});
  return{spend:spend,litres:litres,avgPrice:litres?spend/litres:0,avgConsumption:km?fullLitres/km*100:null};
}
function navigate(view){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===view));
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const titles={dashboard:"Dashboard",fuel:"Νέος ανεφοδιασμός",vehicles:"Οχήματα",history:"Ιστορικό",data:"Δεδομένα"};
  $("#pageTitle").textContent=titles[view]||"OilBank";window.scrollTo({top:0,behavior:"smooth"});
}
$$(".nav-btn").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
$("#quickAdd").addEventListener("click",()=>navigate("fuel"));
$$("[data-jump]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.jump)));
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2500)}
function confirmAction(text,fn){pendingConfirm=fn;$("#modalText").textContent=text;$("#modal").classList.add("show");$("#modal").setAttribute("aria-hidden","false")}
function closeModal(){pendingConfirm=null;$("#modal").classList.remove("show");$("#modal").setAttribute("aria-hidden","true")}
$("#modalCancel").addEventListener("click",closeModal);
$("#modalConfirm").addEventListener("click",()=>{const fn=pendingConfirm;closeModal();if(fn)fn()});
$("#vehicleForm").addEventListener("submit",e=>{
  e.preventDefault();const plate=$("#plate").value.trim().toUpperCase();
  if(db.vehicles.some(v=>String(v.plate).toUpperCase()===plate)){toast("Υπάρχει ήδη όχημα με αυτή την πινακίδα.");return}
  db.vehicles.push({id:uid(),plate:plate,model:$("#model").value.trim(),fuel:$("#fuelKind").value,year:$("#year").value.trim(),startOdo:Number($("#startOdo").value)||0,createdAt:new Date().toISOString()});
  e.currentTarget.reset();saveDB();toast("Το όχημα προστέθηκε.");
});
function deleteVehicle(id){
  const v=getVehicle(id);if(!v)return;const count=db.logs.filter(l=>l.vehicleId===id).length;
  const msg="Να διαγραφεί το "+v.plate+"; "+(count?("Θα διαγραφούν και "+count+" ανεφοδιασμοί του."):"");
  confirmAction(msg,()=>{db.vehicles=db.vehicles.filter(x=>x.id!==id);db.logs=db.logs.filter(x=>x.vehicleId!==id);saveDB();toast("Το όχημα διαγράφηκε.")});
}
function renderVehicles(){
  const box=$("#vehicleList");
  if(!db.vehicles.length){box.className="vehicle-list empty-state";box.textContent="Δεν έχεις προσθέσει όχημα.";return}
  box.className="vehicle-list";box.innerHTML=db.vehicles.map(v=>{
    const s=vehicleStats(v.id);
    return '<div class="vehicle-card"><div class="vehicle-top"><div><strong>'+esc(v.plate)+'</strong><br><small>'+esc(v.model)+(v.year?(" · "+esc(v.year)):"")+' · '+esc(v.fuel)+'</small></div><div class="vehicle-actions"><button class="icon-btn dangerish" onclick="deleteVehicle(\''+v.id+'\')">Διαγραφή</button></div></div><div class="metric-row"><span>'+s.entries+' ανεφοδιασμοί</span><span>'+money(s.spend)+'</span><span>'+num(s.litres)+' L</span><span>'+(s.maxOdo?num(s.maxOdo,0)+" km":"—")+'</span></div></div>';
  }).join("");
}
function populateVehicleSelects(){
  const opts=db.vehicles.map(v=>'<option value="'+v.id+'">'+esc(vehicleLabel(v))+'</option>').join("");
  $("#vehicleSelect").innerHTML=db.vehicles.length?'<option value="">Επίλεξε όχημα</option>'+opts:'<option value="">Πρόσθεσε πρώτα όχημα</option>';
  const current=$("#filterVehicle").value;$("#filterVehicle").innerHTML='<option value="">Όλα τα οχήματα</option>'+opts;
  if(Array.from($("#filterVehicle").options).some(o=>o.value===current))$("#filterVehicle").value=current;
}
["amount","price"].forEach(id=>$("#"+id).addEventListener("input",updateLiveCalc));
function updateLiveCalc(){
  const amount=Number($("#amount").value),price=Number($("#price").value);
  if(amount>0&&price>0){const litres=amount/price,b=vatBreakdown(amount);$("#liveCalc").innerHTML="<strong>"+num(litres)+" L</strong> · Καθαρή αξία "+money(b.net)+" · ΦΠΑ 24% "+money(b.vat)}
  else $("#liveCalc").textContent="Συμπλήρωσε ποσό και τιμή για υπολογισμό λίτρων.";
}
$("#fuelForm").addEventListener("submit",e=>{
  e.preventDefault();const vehicleId=$("#vehicleSelect").value,v=getVehicle(vehicleId);
  if(!v){toast("Επίλεξε όχημα.");return}
  const amount=Number($("#amount").value),price=Number($("#price").value),odometer=Number($("#odometer").value);
  if(!(amount>0&&price>0&&odometer>=0)){toast("Έλεγξε ποσό, τιμή και χιλιόμετρα.");return}
  const previous=logsForVehicle(vehicleId).filter(l=>l.odometer>0).slice(-1)[0];
  if(previous&&odometer<Number(previous.odometer)){toast("Το οδόμετρο είναι μικρότερο από την προηγούμενη καταχώρηση.");return}
  db.logs.push({id:uid(),vehicleId:vehicleId,vehiclePlate:v.plate,fuelType:v.fuel,date:$("#date").value||today(),odometer:odometer,amount:amount,price:price,litres:amount/price,station:$("#station").value.trim(),payment:$("#payment").value,fullTank:$("#fullTank").checked,notes:$("#notes").value.trim(),createdAt:new Date().toISOString()});
  e.currentTarget.reset();$("#date").value=today();$("#fullTank").checked=true;updateLiveCalc();saveDB();navigate("dashboard");toast("Ο ανεφοδιασμός αποθηκεύτηκε.");
});
function deleteLog(id){confirmAction("Να διαγραφεί αυτή η καταχώρηση ανεφοδιασμού;",()=>{db.logs=db.logs.filter(l=>l.id!==id);saveDB();toast("Η καταχώρηση διαγράφηκε.")})}
function renderHistory(){
  const tbody=$("#logTable tbody"),empty=$("#historyEmpty"),filterV=$("#filterVehicle").value,q=$("#filterSearch").value.trim().toLowerCase();
  const logs=sortedLogs().filter(l=>(!filterV||l.vehicleId===filterV)&&(!q||(String(l.station||"")+" "+String(l.notes||"")+" "+String(l.vehiclePlate||"")).toLowerCase().includes(q)));
  empty.style.display=logs.length?"none":"block";
  tbody.innerHTML=logs.map(l=>{const c=calcConsumptionForLog(l),v=getVehicle(l.vehicleId);
    return "<tr><td>"+esc(l.date)+"</td><td><strong>"+esc(v?v.plate:(l.vehiclePlate||"—"))+"</strong><br><span class=\"muted\">"+esc(v?v.model:"")+"</span></td><td>"+(l.odometer?num(l.odometer,0):"—")+"</td><td>"+num(l.litres)+" L</td><td>"+money(l.price)+"</td><td>"+money(l.amount)+"</td><td class=\""+(c?"positive":"muted")+"\">"+(c?num(c.consumption)+" L":"—")+"</td><td class=\""+(c?"positive":"muted")+"\">"+(c?money(c.costPerKm):"—")+"</td><td><button class=\"icon-btn dangerish\" onclick=\"deleteLog('"+l.id+"')\">×</button></td></tr>";
  }).join("");
}
$("#filterVehicle").addEventListener("change",renderHistory);$("#filterSearch").addEventListener("input",renderHistory);
function renderDashboard(){
  const g=globalStats();$("#heroCost").textContent=money(g.spend);$("#heroSub").textContent=db.logs.length?(db.logs.length+" καταχωρήσεις · "+db.vehicles.length+" οχήματα"):"Δεν υπάρχουν ακόμη καταχωρήσεις";
  $("#totalSpend").textContent=money(g.spend);$("#totalLitres").textContent=num(g.litres)+" L";$("#avgPrice").textContent=money(g.avgPrice)+"/L";$("#avgConsumption").textContent=g.avgConsumption?(num(g.avgConsumption)+" L/100km"):"—";
  const vs=$("#vehicleSummary");
  if(!db.vehicles.length){vs.className="vehicle-summary empty-state";vs.textContent="Πρόσθεσε το πρώτο σου όχημα."}
  else{vs.className="vehicle-summary";vs.innerHTML=db.vehicles.map(v=>{const s=vehicleStats(v.id);return '<div class="vehicle-mini"><div class="vehicle-mini-top"><strong>'+esc(v.plate)+'</strong><span>'+money(s.spend)+'</span></div><small>'+esc(v.model)+'</small><div class="metric-row"><span>'+num(s.litres)+' L</span><span>'+(s.avgConsumption?num(s.avgConsumption)+" L/100km":"χωρίς μέτρηση κατανάλωσης")+'</span></div></div>'}).join("")}
  const recent=sortedLogs().slice(0,5),box=$("#recentList");
  if(!recent.length){box.className="recent-list empty-state";box.textContent="Δεν υπάρχουν καταχωρήσεις ακόμη."}
  else{box.className="recent-list";box.innerHTML=recent.map(l=>{const v=getVehicle(l.vehicleId),c=calcConsumptionForLog(l);return '<div class="recent-item"><div class="recent-top"><div><strong>'+esc(v?v.plate:(l.vehiclePlate||"Όχημα"))+'</strong><br><small>'+esc(l.date)+(l.station?(" · "+esc(l.station)):"")+'</small></div><strong>'+money(l.amount)+'</strong></div><div class="metric-row"><span>'+num(l.litres)+' L</span><span>'+money(l.price)+'/L</span>'+(c?('<span class="positive">'+num(c.consumption)+' L/100km</span>'):"")+'</div></div>'}).join("")}
  drawCostChart();
}
function drawCostChart(){
  const canvas=$("#costChart"),ctx=canvas.getContext("2d"),dpr=window.devicePixelRatio||1,w=canvas.clientWidth||800,h=280;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const months=[],now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),label:d.toLocaleDateString("el-GR",{month:"short"}),value:0})}
  db.logs.forEach(l=>{const m=months.find(x=>String(l.date||"").indexOf(x.key)===0);if(m)m.value+=Number(l.amount)||0});
  const max=Math.max.apply(null,months.map(m=>m.value).concat([1])),pad=34,chartH=h-62,step=(w-pad*2)/months.length,barW=Math.min(48,step*.55);ctx.font="12px system-ui";ctx.textAlign="center";
  months.forEach((m,i)=>{const x=pad+i*step+step/2,bh=m.value/max*(chartH-28),y=chartH-bh,grad=ctx.createLinearGradient(0,y,0,chartH);grad.addColorStop(0,"#22c55e");grad.addColorStop(1,"#0ea5e9");ctx.fillStyle=grad;roundRect(ctx,x-barW/2,y,barW,bh,10);ctx.fill();ctx.fillStyle="#94a3b8";ctx.fillText(m.label,x,h-18);if(m.value){ctx.fillStyle="#e2e8f0";ctx.fillText(Math.round(m.value)+"€",x,Math.max(14,y-8))}});
  ctx.strokeStyle="#243047";ctx.beginPath();ctx.moveTo(pad,chartH+.5);ctx.lineTo(w-pad,chartH+.5);ctx.stroke();
}
function roundRect(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath()}
function download(name,type,content){const blob=new Blob([content],{type:type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$("#exportJson").addEventListener("click",()=>download("oilbank-backup-"+today()+".json","application/json",JSON.stringify(db,null,2)));
$("#exportCsv").addEventListener("click",()=>{
  const rows=[["Ημερομηνία","Όχημα","Μοντέλο","Οδόμετρο","Πρατήριο","Ποσό","Τιμή/L","Λίτρα","Γεμάτο","L/100km","Κόστος/km","Πληρωμή","Σημειώσεις"]];
  sortedLogs().forEach(l=>{const v=getVehicle(l.vehicleId),c=calcConsumptionForLog(l);rows.push([l.date,v?v.plate:(l.vehiclePlate||""),v?v.model:"",l.odometer||"",l.station||"",l.amount,l.price,l.litres,l.fullTank?"Ναι":"Όχι",c?c.consumption:"",c?c.costPerKm:"",l.payment||"",l.notes||""])});
  const csv="\\uFEFF"+rows.map(r=>r.map(x=>'"'+String(x==null?"":x).replaceAll('"','""')+'"').join(",")).join("\\n");download("oilbank-"+today()+".csv","text/csv;charset=utf-8",csv);
});
$("#importJson").addEventListener("change",async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;try{const imported=normalizeDB(JSON.parse(await file.text()));confirmAction("Να αντικατασταθούν τα τωρινά δεδομένα με backup που έχει "+imported.vehicles.length+" οχήματα και "+imported.logs.length+" καταχωρήσεις;",()=>{saveDB(imported);toast("Το backup εισήχθη.")})}catch(err){toast("Το αρχείο backup δεν είναι έγκυρο.")}e.target.value=""});
$("#clearAll").addEventListener("click",()=>confirmAction("Να διαγραφούν ΟΛΑ τα οχήματα και οι ανεφοδιασμοί από αυτή τη συσκευή;",()=>{db=defaultDB();localStorage.removeItem(DB_KEY);saveDB();toast("Όλα τα δεδομένα διαγράφηκαν.")}));
function renderAll(){populateVehicleSelects();renderVehicles();renderHistory();renderDashboard()}
window.addEventListener("resize",()=>{clearTimeout(window.__chartT);window.__chartT=setTimeout(drawCostChart,120)});
$("#date").value=today();renderAll();window.deleteVehicle=deleteVehicle;window.deleteLog=deleteLog;