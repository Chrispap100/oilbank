let token="";
let me=null,users=[],vehicles=[],logs=[],pendingConfirm=null;
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const money=n=>new Intl.NumberFormat("el-GR",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const num=(n,d=2)=>new Intl.NumberFormat("el-GR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n)||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const today=()=>new Date().toISOString().slice(0,10);

async function api(path,options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(token)headers.Authorization="Bearer "+token;
  const res=await fetch(path,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(res.status===401&&path!=="/api/login"){logout();throw new Error("unauthorized")}
  if(!res.ok){const e=new Error(data.error||"request_failed");e.code=data.error;e.status=res.status;throw e}
  return data;
}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2500)}
function confirmAction(text,fn){pendingConfirm=fn;$("#modalText").textContent=text;$("#modal").classList.add("show")}
function closeModal(){pendingConfirm=null;$("#modal").classList.remove("show")}
$("#modalCancel").addEventListener("click",closeModal);
$("#modalConfirm").addEventListener("click",()=>{const fn=pendingConfirm;closeModal();if(fn)fn()});
function isAdmin(){return me&&me.role==="super_admin"}
function showApp(){
  $("#loginScreen").classList.add("hidden");$("#appShell").classList.remove("hidden");
  $$(".admin-only").forEach(el=>el.classList.toggle("is-hidden",!isAdmin()));
  $("#signedUser").innerHTML='<div class="user-chip"><strong>'+esc(me.name)+'</strong><span>'+esc(me.email)+'</span></div>';
  $("#userRoleLabel").textContent=isAdmin()?"Super Admin":"User";
  $("#heroTitle").textContent=isAdmin()?"Όλη η εικόνα του OilBank σε ένα σημείο.":"Η εικόνα του δικού σου οχήματος, παντού.";
  $("#heroText").textContent=isAdmin()?"Βλέπεις όλους τους χρήστες, όλα τα οχήματα και όλες τις κινήσεις.":"Βλέπεις μόνο τα δικά σου οχήματα και τις δικές σου κινήσεις.";
  if($("#permissionText"))$("#permissionText").textContent=isAdmin()?"Μπορείς να γράψεις κίνηση για οποιοδήποτε όχημα.":"Μπορείς να γράψεις μόνο για τα δικά σου οχήματα.";
  if($("#vehicleListSubtitle"))$("#vehicleListSubtitle").textContent=isAdmin()?"Όλα τα οχήματα όλων των χρηστών":"Μόνο τα δικά σου οχήματα";
  if($("#historySubtitle"))$("#historySubtitle").textContent=isAdmin()?"Όλες οι κινήσεις όλων των χρηστών":"Μόνο οι δικές σου κινήσεις";
}
async function logout(){try{await fetch("/api/logout",{method:"POST"})}catch(e){}token="";me=null;users=[];vehicles=[];logs=[];localStorage.removeItem("oilbank_token");$("#appShell").classList.add("hidden");$("#loginScreen").classList.remove("hidden")}
$("#logoutBtn").addEventListener("click",logout);

async function bootstrap(){try{me=(await api("/api/me")).user;await refreshAll();showApp()}catch(e){}}
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();$("#loginError").textContent="";
  try{
    const data=await api("/api/login",{method:"POST",body:JSON.stringify({email:$("#loginEmail").value,password:$("#loginPassword").value})});
    token="";me=data.user;localStorage.removeItem("oilbank_token");await refreshAll();showApp();
  }catch(e){$("#loginError").textContent="Λάθος email ή κωδικός."}
});

async function refreshAll(){
  const reqs=[api("/api/vehicles"),api("/api/logs")];
  if(isAdmin())reqs.push(api("/api/users"));
  const result=await Promise.all(reqs);vehicles=result[0].vehicles||[];logs=result[1].logs||[];users=isAdmin()?(result[2].users||[]):[];renderAll();
}
function navigate(view){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===view));
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const titles={dashboard:"Dashboard",fuel:"Νέος ανεφοδιασμός",vehicles:"Οχήματα",history:"Ιστορικό",users:"Χρήστες"};
  $("#pageTitle").textContent=titles[view]||"OilBank";window.scrollTo({top:0,behavior:"smooth"});
}
$$(".nav-btn").forEach(b=>b.addEventListener("click",()=>{if(b.classList.contains("is-hidden"))return;navigate(b.dataset.view)}));
$("#quickAdd").addEventListener("click",()=>navigate("fuel"));
$$("[data-jump]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.jump)));

function getVehicle(id){return vehicles.find(v=>String(v.id)===String(id))}
function logsForVehicle(id){return logs.filter(l=>String(l.vehicleId)===String(id)).sort((a,b)=>a.odometer-b.odometer||a.date.localeCompare(b.date))}
function calcConsumptionForLog(log){
  if(!log.fullTank||!log.odometer)return null;
  const arr=logsForVehicle(log.vehicleId).filter(x=>x.fullTank&&x.odometer>0),idx=arr.findIndex(x=>String(x.id)===String(log.id));
  if(idx<=0)return null;const prev=arr[idx-1],km=log.odometer-prev.odometer;if(km<=0)return null;
  return{km,consumption:log.litres/km*100,costPerKm:log.amount/km};
}
function vehicleStats(id){
  const arr=logsForVehicle(id),spend=arr.reduce((s,l)=>s+l.amount,0),litres=arr.reduce((s,l)=>s+l.litres,0);
  let km=0,fullLitres=0;arr.forEach(l=>{const c=calcConsumptionForLog(l);if(c){km+=c.km;fullLitres+=l.litres}});
  return{spend,litres,avgConsumption:km?fullLitres/km*100:null,entries:arr.length};
}
function globalStats(){
  const spend=logs.reduce((s,l)=>s+l.amount,0),litres=logs.reduce((s,l)=>s+l.litres,0);let km=0,fullLitres=0;
  logs.forEach(l=>{const c=calcConsumptionForLog(l);if(c){km+=c.km;fullLitres+=l.litres}});
  return{spend,litres,avgPrice:litres?spend/litres:0,avgConsumption:km?fullLitres/km*100:null};
}

function populateSelects(){
  $("#vehicleSelect").innerHTML='<option value="">Επίλεξε όχημα</option>'+vehicles.map(v=>'<option value="'+v.id+'">'+esc(v.plate+" · "+v.model+(isAdmin()&&v.ownerName?" · "+v.ownerName:""))+'</option>').join("");
  const cur=$("#filterVehicle").value;$("#filterVehicle").innerHTML='<option value="">Όλα τα οχήματα</option>'+vehicles.map(v=>'<option value="'+v.id+'">'+esc(v.plate+" · "+v.model)+'</option>').join("");$("#filterVehicle").value=cur;
  $("#vehicleOwner").innerHTML=users.filter(u=>u.active).map(u=>'<option value="'+u.id+'">'+esc(u.name+" · "+u.email)+'</option>').join("");
}
$("#vehicleForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/vehicles",{method:"POST",body:JSON.stringify({userId:isAdmin()?$("#vehicleOwner").value:undefined,plate:$("#plate").value,model:$("#model").value,fuel:$("#fuelKind").value,year:$("#year").value||null,startOdo:Number($("#startOdo").value)||0})});
    e.currentTarget.reset();await refreshAll();toast("Το όχημα προστέθηκε.");
  }catch(err){toast(err.code==="plate_exists"?"Υπάρχει ήδη αυτή η πινακίδα.":"Δεν μπόρεσε να προστεθεί το όχημα.")}
});
async function deleteVehicle(id){
  const v=getVehicle(id);if(!v)return;
  confirmAction("Να διαγραφεί το "+v.plate+" και όλες οι κινήσεις του;",async()=>{try{await api("/api/vehicles/"+id,{method:"DELETE"});await refreshAll();toast("Το όχημα διαγράφηκε.")}catch(e){toast("Η διαγραφή απέτυχε.")}});
}
function renderVehicles(){
  const box=$("#vehicleList");if(!vehicles.length){box.className="vehicle-list empty-state";box.textContent="Δεν υπάρχουν οχήματα.";return}
  box.className="vehicle-list";box.innerHTML=vehicles.map(v=>{const s=vehicleStats(v.id);return '<div class="vehicle-card"><div class="vehicle-top"><div><strong>'+esc(v.plate)+'</strong><br><small>'+esc(v.model)+' · '+esc(v.fuel)+(isAdmin()&&v.ownerName?' · '+esc(v.ownerName):'')+'</small></div><button class="icon-btn dangerish" data-del-vehicle="'+v.id+'">Διαγραφή</button></div><div class="metric-row"><span>'+s.entries+' ανεφοδιασμοί</span><span>'+money(s.spend)+'</span><span>'+num(s.litres)+' L</span></div></div>'}).join("");
  box.querySelectorAll("[data-del-vehicle]").forEach(b=>b.addEventListener("click",()=>deleteVehicle(b.dataset.delVehicle)));
}
["amount","price"].forEach(id=>$("#"+id).addEventListener("input",()=>{const a=Number($("#amount").value),p=Number($("#price").value);$("#liveCalc").textContent=a>0&&p>0?num(a/p)+" L · εκτιμώμενα λίτρα":"Συμπλήρωσε ποσό και τιμή για υπολογισμό λίτρων."}));
$("#fuelForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/logs",{method:"POST",body:JSON.stringify({vehicleId:$("#vehicleSelect").value,date:$("#date").value,odometer:Number($("#odometer").value),amount:Number($("#amount").value),price:Number($("#price").value),station:$("#station").value,payment:$("#payment").value,fullTank:$("#fullTank").checked,notes:$("#notes").value})});
    e.currentTarget.reset();$("#date").value=today();$("#fullTank").checked=true;await refreshAll();navigate("dashboard");toast("Η κίνηση αποθηκεύτηκε.");
  }catch(err){toast(err.code==="odometer_too_low"?"Τα χιλιόμετρα είναι μικρότερα από προηγούμενη κίνηση.":"Η αποθήκευση απέτυχε.")}
});
async function deleteLog(id){confirmAction("Να διαγραφεί αυτή η κίνηση;",async()=>{try{await api("/api/logs/"+id,{method:"DELETE"});await refreshAll();toast("Η κίνηση διαγράφηκε.")}catch(e){toast("Η διαγραφή απέτυχε.")}})}

function renderHistory(){
  const filter=$("#filterVehicle").value,q=$("#filterSearch").value.toLowerCase().trim(),arr=logs.filter(l=>(!filter||String(l.vehicleId)===filter)&&(!q||(l.station+" "+l.notes+" "+l.ownerName+" "+l.creatorName).toLowerCase().includes(q)));
  $("#historyEmpty").style.display=arr.length?"none":"block";
  $("#logTable tbody").innerHTML=arr.map(l=>{const c=calcConsumptionForLog(l);return '<tr><td>'+esc(l.date)+'</td><td>'+esc(l.ownerName||"")+'</td><td><strong>'+esc(l.vehiclePlate)+'</strong><br><span class="muted">'+esc(l.vehicleModel)+'</span></td><td>'+num(l.odometer,0)+'</td><td>'+num(l.litres)+' L</td><td>'+money(l.price)+'</td><td>'+money(l.amount)+'</td><td class="'+(c?"positive":"muted")+'">'+(c?num(c.consumption):"—")+'</td><td>'+esc(l.creatorName||"")+'</td><td><button class="icon-btn dangerish" data-del-log="'+l.id+'">×</button></td></tr>'}).join("");
  $("#logTable tbody").querySelectorAll("[data-del-log]").forEach(b=>b.addEventListener("click",()=>deleteLog(b.dataset.delLog)));
}
$("#filterVehicle").addEventListener("change",renderHistory);$("#filterSearch").addEventListener("input",renderHistory);

function renderUsers(){
  if(!isAdmin())return;const box=$("#userList");if(!users.length){box.className="vehicle-list empty-state";box.textContent="Δεν υπάρχουν χρήστες.";return}
  box.className="vehicle-list";box.innerHTML=users.map(u=>'<div class="user-row"><div class="user-meta"><strong>'+esc(u.name)+'</strong><span>'+esc(u.email)+'</span><span class="role-badge">'+esc(u.role)+'</span></div>'+(String(u.id)!==String(me.id)?'<button class="icon-btn dangerish" data-del-user="'+u.id+'">Διαγραφή</button>':'<span class="muted">Εσύ</span>')+'</div>').join("");
  box.querySelectorAll("[data-del-user]").forEach(b=>b.addEventListener("click",()=>deleteUser(b.dataset.delUser)));
}
$("#userForm").addEventListener("submit",async e=>{
  e.preventDefault();try{
    await api("/api/users",{method:"POST",body:JSON.stringify({name:$("#newUserName").value,email:$("#newUserEmail").value,password:$("#newUserPassword").value,role:$("#newUserRole").value})});
    e.currentTarget.reset();await refreshAll();toast("Ο χρήστης δημιουργήθηκε.");
  }catch(err){toast(err.code==="email_exists"?"Υπάρχει ήδη αυτό το email.":"Δεν μπόρεσε να δημιουργηθεί ο χρήστης.")}
});
async function deleteUser(id){const u=users.find(x=>String(x.id)===String(id));if(!u)return;confirmAction("Να διαγραφεί ο χρήστης "+u.name+" μαζί με όλα τα οχήματα και τις κινήσεις του;",async()=>{try{await api("/api/users/"+id,{method:"DELETE"});await refreshAll();toast("Ο χρήστης διαγράφηκε.")}catch(e){toast("Η διαγραφή απέτυχε.")}})}

function renderDashboard(){
  const g=globalStats();$("#heroCost").textContent=money(g.spend);$("#heroSub").textContent=logs.length+" κινήσεις · "+vehicles.length+" οχήματα"+(isAdmin()?" · "+users.length+" χρήστες":"");
  $("#totalSpend").textContent=money(g.spend);$("#totalLitres").textContent=num(g.litres)+" L";$("#avgPrice").textContent=money(g.avgPrice)+"/L";$("#avgConsumption").textContent=g.avgConsumption?num(g.avgConsumption)+" L/100km":"—";
  const vs=$("#vehicleSummary");vs.className=vehicles.length?"vehicle-summary":"vehicle-summary empty-state";vs.innerHTML=vehicles.length?vehicles.map(v=>{const s=vehicleStats(v.id);return '<div class="vehicle-mini"><div class="vehicle-mini-top"><strong>'+esc(v.plate)+'</strong><span>'+money(s.spend)+'</span></div><small>'+esc(v.model)+(isAdmin()&&v.ownerName?' · '+esc(v.ownerName):'')+'</small><div class="metric-row"><span>'+num(s.litres)+' L</span><span>'+(s.avgConsumption?num(s.avgConsumption)+" L/100km":"χωρίς μέτρηση")+'</span></div></div>'}).join(""):"Δεν υπάρχουν οχήματα.";
  const recent=logs.slice(0,5),box=$("#recentList");box.className=recent.length?"recent-list":"recent-list empty-state";box.innerHTML=recent.length?recent.map(l=>'<div class="recent-item"><div class="recent-top"><div><strong>'+esc(l.vehiclePlate)+'</strong><br><small>'+esc(l.date)+(isAdmin()?' · '+esc(l.ownerName):'')+'</small></div><strong>'+money(l.amount)+'</strong></div></div>').join(""):"Δεν υπάρχουν κινήσεις.";
  drawCostChart();
}
function drawCostChart(){
  const canvas=$("#costChart"),ctx=canvas.getContext("2d"),dpr=window.devicePixelRatio||1,w=canvas.clientWidth||800,h=280;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const months=[],now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),label:d.toLocaleDateString("el-GR",{month:"short"}),value:0})}
  logs.forEach(l=>{const m=months.find(x=>l.date.startsWith(x.key));if(m)m.value+=l.amount});const max=Math.max(...months.map(x=>x.value),1),pad=34,base=h-45,step=(w-pad*2)/6,bw=Math.min(48,step*.55);
  ctx.font="12px system-ui";ctx.textAlign="center";months.forEach((m,i)=>{const x=pad+i*step+step/2,bh=m.value/max*(h-90),y=base-bh,g=ctx.createLinearGradient(0,y,0,base);g.addColorStop(0,"#22c55e");g.addColorStop(1,"#0ea5e9");ctx.fillStyle=g;ctx.fillRect(x-bw/2,y,bw,bh);ctx.fillStyle="#94a3b8";ctx.fillText(m.label,x,h-18);if(m.value){ctx.fillStyle="#e2e8f0";ctx.fillText(Math.round(m.value)+"€",x,Math.max(14,y-7))}});
}
function renderAll(){populateSelects();renderVehicles();renderHistory();renderUsers();renderDashboard()}
$("#date").value=today();bootstrap();