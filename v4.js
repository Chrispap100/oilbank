
let expensesV4=[],obligationsV4=[],documentsV4=[],auditV4=[],pendingDocV4=null;
const oldRefreshAllV4=refreshAll,oldRenderAllV4=renderAll,oldShowAppV4=showApp;
refreshAll=async function(){
  await oldRefreshAllV4();
  const calls=[api("/api/expenses"),api("/api/obligations"),api("/api/documents")];
  if(isAdmin())calls.push(api("/api/audit"));
  const r=await Promise.all(calls);
  expensesV4=r[0].expenses||[];obligationsV4=r[1].obligations||[];documentsV4=r[2].documents||[];auditV4=isAdmin()&&r[3]?r[3].audit||[]:[];
  renderV4();
};
showApp=function(){oldShowAppV4();$$(".user-only").forEach(function(x){x.classList.toggle("hidden",isAdmin())});renderV4()};
renderAll=function(){oldRenderAllV4();renderV4()};

(function(){
  const st=document.createElement("style");
  st.textContent=".attention-box{display:grid;gap:8px;margin:0 0 20px}.attention-title{font-weight:900}.attention-item,.attention-ok,.warning-box{padding:12px 14px;border-radius:14px;border:1px solid #334155;background:#0f172a}.attention-item.late{border-color:#7f1d1d;color:#fecaca}.attention-ok{border-color:rgba(34,197,94,.3);color:#bbf7d0}.warning-box{border-color:#92400e;color:#fde68a;background:#451a03}.row-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.wide-link{margin-top:12px}.report-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));min-width:0;margin-bottom:18px}.smart-review{display:grid;gap:12px;margin-top:14px}.smart-review label{display:grid;gap:6px;color:#cbd5e1;font-size:13px;font-weight:700}.smart-review input,.smart-review select,.smart-review textarea{width:100%;background:#0b1220;color:#f8fafc;border:1px solid #334155;border-radius:13px;padding:12px}.doc-actions{display:flex;gap:8px;align-items:center}@media(max-width:820px){.report-filters{grid-template-columns:1fr}.sidebar nav{grid-template-columns:repeat(5,1fr)}}";
  document.head.appendChild(st);
})();

function labelObV4(t){return({kteo:"ΚΤΕΟ",insurance:"Ασφάλεια",emissions:"Κάρτα Καυσαερίων",road_tax:"Τέλη Κυκλοφορίας",warranty:"Εγγύηση"}[t]||t)}
function labelCatV4(t){return({service:"Service",repair:"Επισκευή",tires:"Ελαστικά",battery:"Μπαταρία",parking:"Parking",tolls:"Διόδια",wash:"Πλύσιμο",fine:"Πρόστιμο",accessories:"Αξεσουάρ",other:"Λοιπά"}[t]||labelObV4(t))}
function vehicleCostV4(id){return logs.filter(function(x){return String(x.vehicleId)===String(id)}).reduce(function(s,x){return s+x.amount},0)+expensesV4.filter(function(x){return String(x.vehicleId)===String(id)}).reduce(function(s,x){return s+x.amount},0)+obligationsV4.filter(function(x){return String(x.vehicleId)===String(id)}).reduce(function(s,x){return s+x.amount},0)}
function fillV4(id,all){
  const e=$(id);if(!e)return;const cur=e.value;
  e.innerHTML=(all?'<option value="">Όλα τα οχήματα</option>':'<option value="">Επίλεξε όχημα</option>')+vehicles.map(function(v){return '<option value="'+v.id+'">'+esc(v.plate+" · "+v.model+(isAdmin()&&v.ownerName?" · "+v.ownerName:""))+'</option>'}).join("");
  e.value=cur;
}
function populateV4(){
  ["#expenseVehicle","#obVehicle","#smartVehicle"].forEach(function(x){fillV4(x,false)});fillV4("#reportVehicle",true);
  const ru=$("#reportUser");if(ru)ru.innerHTML='<option value="">Όλοι οι χρήστες</option>'+users.map(function(u){return '<option value="'+u.id+'">'+esc(u.name)+'</option>'}).join("");
  const years=[].concat(logs.map(function(x){return x.date&&x.date.slice(0,4)}),expensesV4.map(function(x){return x.date&&x.date.slice(0,4)}),obligationsV4.map(function(x){return (x.startDate||x.dueDate||"").slice(0,4)})).filter(Boolean);
  const uniq=Array.from(new Set(years)).sort().reverse(),cy=String(new Date().getFullYear());if(uniq.indexOf(cy)<0)uniq.unshift(cy);
  const ry=$("#reportYear");if(ry&&ry.options.length!==uniq.length+1)ry.innerHTML='<option value="">Όλα τα έτη</option>'+uniq.map(function(y){return "<option>"+y+"</option>"}).join("");
}
function renderAttentionV4(){
  const box=$("#attentionBox");if(!box)return;const now=new Date(),lim=new Date(Date.now()+30*86400000),items=[];
  obligationsV4.forEach(function(o){if(!o.dueDate)return;const d=new Date(o.dueDate+"T00:00:00");if(d<=lim)items.push({late:d<now,text:o.vehiclePlate+" · "+labelObV4(o.type)+" · "+o.dueDate})});
  if(isAdmin())users.filter(function(u){return u.status==="pending"}).forEach(function(u){items.push({late:false,text:"Αίτηση χρήστη: "+u.name})});
  box.innerHTML=items.length?'<div class="attention-title">Χρειάζονται προσοχή</div>'+items.slice(0,10).map(function(i){return '<div class="attention-item '+(i.late?"late":"")+'">'+esc(i.text)+'</div>'}).join(""):'<div class="attention-ok">✓ Δεν υπάρχει κάτι επείγον στις επόμενες 30 ημέρες.</div>';
}
function renderDashboardV4(){
  if(!$("#fuelSpend"))return;const fuel=logs.reduce(function(s,x){return s+x.amount},0),other=expensesV4.reduce(function(s,x){return s+x.amount},0)+obligationsV4.reduce(function(s,x){return s+x.amount},0);
  $("#heroCost").textContent=money(fuel+other);$("#fuelSpend").textContent=money(fuel);$("#otherSpend").textContent=money(other);
  $("#vehicleSummary").innerHTML=vehicles.length?vehicles.map(function(v){return '<div class="vehicle-mini"><div class="vehicle-mini-top"><strong>'+esc(v.plate)+'</strong><span>'+money(vehicleCostV4(v.id))+'</span></div><small>'+esc(v.model)+(isAdmin()&&v.ownerName?" · "+esc(v.ownerName):"")+'</small></div>'}).join(""):'<div class="empty-state">Δεν υπάρχουν οχήματα.</div>';
  renderAttentionV4();
}
function renderExpensesV4(){
  const b=$("#expenseList");if(!b)return;b.innerHTML=expensesV4.length?expensesV4.map(function(x){return '<div class="vehicle-card"><div class="vehicle-top"><div><strong>'+esc(labelCatV4(x.category))+' · '+money(x.amount)+'</strong><br><small>'+esc(x.vehiclePlate)+' · '+esc(x.date)+(x.vendor?" · "+esc(x.vendor):"")+'</small></div><button class="icon-btn dangerish" data-v4dele="'+x.id+'">×</button></div><div class="metric-row"><span>'+esc(x.title||"")+'</span>'+(x.nextDueDate?'<span>Επόμενο: '+esc(x.nextDueDate)+'</span>':"")+'</div></div>'}).join(""):'<div class="empty-state">Δεν υπάρχουν έξοδα.</div>';
  b.querySelectorAll("[data-v4dele]").forEach(function(btn){btn.onclick=function(){confirmAction("Να διαγραφεί το έξοδο;",async function(){await api("/api/expenses/"+btn.dataset.v4dele,{method:"DELETE"});await refreshAll();toast("Το έξοδο διαγράφηκε.")})}});
}
function renderObligationsV4(){
  const b=$("#obligationList");if(!b)return;b.innerHTML=obligationsV4.length?obligationsV4.map(function(x){return '<div class="vehicle-card"><div class="vehicle-top"><div><strong>'+esc(labelObV4(x.type))+' · '+money(x.amount)+'</strong><br><small>'+esc(x.vehiclePlate)+(x.dueDate?" · λήξη "+esc(x.dueDate):"")+'</small></div><button class="icon-btn dangerish" data-v4delo="'+x.id+'">×</button></div><div class="metric-row"><span>'+(x.paid?"Πληρωμένο":"Εκκρεμεί")+'</span><span>'+esc(x.provider||"")+'</span></div></div>'}).join(""):'<div class="empty-state">Δεν υπάρχουν υποχρεώσεις.</div>';
  b.querySelectorAll("[data-v4delo]").forEach(function(btn){btn.onclick=function(){confirmAction("Να διαγραφεί η υποχρέωση;",async function(){await api("/api/obligations/"+btn.dataset.v4delo,{method:"DELETE"});await refreshAll();toast("Η υποχρέωση διαγράφηκε.")})}});
}
function renderUsersV4(){
  if(!isAdmin()||!$("#userList"))return;
  $("#userList").innerHTML=users.map(function(u){
    let a="";if(u.status==="pending")a+='<button class="icon-btn" data-v4approve="'+u.id+'">Έγκριση</button>';
    a+='<button class="icon-btn" data-v4vault="'+u.id+'">Κωδικός</button><button class="icon-btn" data-v4reset="'+u.id+'">Reset</button>';
    if(String(u.id)!==String(me.id))a+='<button class="icon-btn" data-v4status="'+u.id+'">'+(u.status==="active"?"Απενεργ.":"Ενεργοποίηση")+'</button><button class="icon-btn dangerish" data-v4archive="'+u.id+'">Αρχειοθέτηση</button>';
    return '<div class="user-row"><div class="user-meta"><strong>'+esc(u.name)+'</strong><span>'+esc(u.email)+'</span><span class="role-badge">'+esc(u.role)+" · "+esc(u.status||"active")+'</span></div><div class="row-actions">'+a+'</div></div>';
  }).join("");
  $$("[data-v4approve]").forEach(function(b){b.onclick=function(){passwordPromptV4("Έγκριση χρήστη",async function(p){await api("/api/users/"+b.dataset.v4approve+"/approve",{method:"POST",body:JSON.stringify({password:p})});await refreshAll();toast("Ο χρήστης εγκρίθηκε.")})}});
  $$("[data-v4reset]").forEach(function(b){b.onclick=function(){passwordPromptV4("Νέος κωδικός",async function(p){await api("/api/users/"+b.dataset.v4reset+"/reset-password",{method:"POST",body:JSON.stringify({password:p})});await refreshAll();toast("Ο κωδικός άλλαξε.")})}});
  $$("[data-v4vault]").forEach(function(b){b.onclick=async function(){try{const d=await api("/api/users/"+b.dataset.v4vault+"/vault");alert("Κωδικός χρήστη: "+d.password)}catch(e){toast("Το Admin Vault δεν είναι ακόμη διαθέσιμο για αυτόν τον χρήστη.")}}});
  $$("[data-v4status]").forEach(function(b){b.onclick=async function(){const u=users.find(function(x){return String(x.id)===String(b.dataset.v4status)}),s=u.status==="active"?"disabled":"active";await api("/api/users/"+u.id+"/status",{method:"POST",body:JSON.stringify({status:s})});await refreshAll()}});
  $$("[data-v4archive]").forEach(function(b){b.onclick=function(){confirmAction("Να αρχειοθετηθεί ο χρήστης; Τα δεδομένα του θα παραμείνουν.",async function(){await api("/api/users/"+b.dataset.v4archive+"/status",{method:"POST",body:JSON.stringify({status:"archived"})});await refreshAll()})}});
}
function passwordPromptV4(title,fn){
  pendingConfirm=async function(){const p=$("#v4Password").value;if(p.length<6)return toast("Τουλάχιστον 6 χαρακτήρες.");await fn(p);closeModal()};
  $("#modalText").textContent=title+" — όρισε κωδικό.";$("#modalExtra").innerHTML='<input id="v4Password" type="text" placeholder="Κωδικός" style="width:100%;padding:12px;border-radius:12px;background:#0b1220;color:white;border:1px solid #334155">';$("#modal").classList.add("show");
}
function renderAuditV4(){
  const b=$("#auditList");if(!b||!isAdmin())return;b.innerHTML=auditV4.map(function(a){return '<div class="vehicle-card"><div class="vehicle-top"><strong>'+esc(a.action)+'</strong><small>'+new Date(a.createdAt).toLocaleString("el-GR")+'</small></div><div class="metric-row"><span>'+esc(a.actorName||"System")+'</span><span>'+esc(a.entityType||"")+" "+esc(a.entityId||"")+'</span></div></div>'}).join("")||'<div class="empty-state">Δεν υπάρχουν καταγραφές.</div>';
}
function reportV4(){
  if(!$("#reportTotal"))return;const vid=$("#reportVehicle").value,uid=isAdmin()?$("#reportUser").value:"",year=$("#reportYear").value,cat=$("#reportCategory").value;
  function ok(x,type){if(vid&&String(x.vehicleId)!==vid)return false;if(uid&&String(x.userId)!==uid)return false;const d=x.date||x.startDate||x.dueDate||"";if(year&&d.slice(0,4)!==year)return false;if(cat){if(type==="fuel"&&cat!=="fuel")return false;if(type!=="fuel"&&(x.category||x.type)!==cat)return false}return true}
  const fl=logs.filter(function(x){return ok(x,"fuel")}),ex=expensesV4.filter(function(x){return ok(x,"expense")}),ob=obligationsV4.filter(function(x){return ok(x,"obligation")});
  const fu=fl.reduce(function(s,x){return s+x.amount},0),ot=ex.reduce(function(s,x){return s+x.amount},0)+ob.reduce(function(s,x){return s+x.amount},0),tot=fu+ot;
  $("#reportTotal").textContent=money(tot);$("#reportFuel").textContent=money(fu);$("#reportOther").textContent=money(ot);
  let km=0;if(vid){const o=fl.map(function(x){return x.odometer}).filter(Boolean);if(o.length>1)km=Math.max.apply(null,o)-Math.min.apply(null,o)}$("#reportCostKm").textContent=km?money(tot/km)+"/km":"—";
  const by={};fl.forEach(function(x){by["Καύσιμα"]=(by["Καύσιμα"]||0)+x.amount});ex.forEach(function(x){const k=labelCatV4(x.category);by[k]=(by[k]||0)+x.amount});ob.forEach(function(x){const k=labelObV4(x.type);by[k]=(by[k]||0)+x.amount});
  $("#reportBreakdown").innerHTML=Object.keys(by).sort(function(a,b){return by[b]-by[a]}).map(function(k){return '<div class="vehicle-card"><div class="vehicle-top"><strong>'+esc(k)+'</strong><strong>'+money(by[k])+'</strong></div></div>'}).join("")||'<div class="empty-state">Δεν υπάρχουν δεδομένα.</div>';
}
function renderDocumentsV4(){
  const b=$("#documentList");if(!b)return;b.innerHTML=documentsV4.map(function(d){return '<div class="vehicle-card"><div class="vehicle-top"><div><strong>'+esc(d.filename)+'</strong><br><small>'+esc(d.plate||"Χωρίς όχημα")+" · "+esc(d.doc_type||"")+" · "+(d.confirmed?"Επιβεβαιωμένο":"AI read / αναμονή")+'</small></div><button class="icon-btn" data-docopen="'+d.id+'">Άνοιγμα</button></div></div>'}).join("")||'<div class="empty-state">Δεν υπάρχουν έγγραφα.</div>';
  b.querySelectorAll("[data-docopen]").forEach(function(btn){btn.onclick=async function(){try{const r=await fetch("/api/documents/"+btn.dataset.docopen+"/file",{headers:{Authorization:"Bearer "+token}});if(!r.ok)throw new Error();const bl=await r.blob(),u=URL.createObjectURL(bl);window.open(u,"_blank");setTimeout(function(){URL.revokeObjectURL(u)},60000)}catch(e){toast("Δεν άνοιξε το αρχείο.")}}});
}
function renderV4(){populateV4();renderDashboardV4();renderExpensesV4();renderObligationsV4();renderUsersV4();renderAuditV4();renderDocumentsV4();reportV4()}

$("#registerForm")&&$("#registerForm").addEventListener("submit",async function(e){e.preventDefault();try{await api("/api/register-request",{method:"POST",body:JSON.stringify({name:$("#regName").value,email:$("#regEmail").value})});$("#registerMsg").textContent="Η αίτηση στάλθηκε. Περιμένει έγκριση από τον Super Admin.";e.currentTarget.reset()}catch(err){$("#registerMsg").textContent=err.code==="email_exists"?"Υπάρχει ήδη αυτό το email.":"Δεν μπόρεσε να σταλεί η αίτηση."}});
$("#showRegister")&&$("#showRegister").addEventListener("click",function(){$("#loginPane").classList.add("hidden");$("#registerPane").classList.remove("hidden")});
$("#backLogin")&&$("#backLogin").addEventListener("click",function(){$("#registerPane").classList.add("hidden");$("#loginPane").classList.remove("hidden")});

$("#expenseForm")&&$("#expenseForm").addEventListener("submit",async function(e){e.preventDefault();try{await api("/api/expenses",{method:"POST",body:JSON.stringify({vehicleId:$("#expenseVehicle").value,category:$("#expenseCategory").value,date:$("#expenseDate").value,amount:Number($("#expenseAmount").value),odometer:$("#expenseOdo").value||null,title:$("#expenseTitle").value,vendor:$("#expenseVendor").value,nextDueDate:$("#expenseDueDate").value||null,nextDueOdometer:$("#expenseNextOdo").value||null,notes:$("#expenseNotes").value})});e.currentTarget.reset();$("#expenseDate").value=today();await refreshAll();toast("Το έξοδο αποθηκεύτηκε.")}catch(e){toast("Αποτυχία αποθήκευσης.")}});
$("#obligationForm")&&$("#obligationForm").addEventListener("submit",async function(e){e.preventDefault();try{await api("/api/obligations",{method:"POST",body:JSON.stringify({vehicleId:$("#obVehicle").value,type:$("#obType").value,title:$("#obTitle").value,startDate:$("#obStart").value||null,dueDate:$("#obDue").value||null,amount:Number($("#obAmount").value)||0,provider:$("#obProvider").value,referenceNo:$("#obRef").value,paid:$("#obPaid").checked,notes:$("#obNotes").value})});e.currentTarget.reset();await refreshAll();toast("Η υποχρέωση αποθηκεύτηκε.")}catch(e){toast("Αποτυχία αποθήκευσης.")}});
["reportVehicle","reportUser","reportYear","reportCategory"].forEach(function(id){const e=$("#"+id);if(e)e.addEventListener("change",reportV4)});
$("#backupBtn")&&$("#backupBtn").addEventListener("click",async function(){try{const d=await api("/api/backup"),bl=new Blob([JSON.stringify(d,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(bl);a.download="oilbank-backup-"+today()+".json";a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000);toast("Το backup δημιουργήθηκε.")}catch(e){toast("Το backup απέτυχε.")}});
$("#selfDeleteBtn")&&$("#selfDeleteBtn").addEventListener("click",function(){confirmAction("Θα χάσεις την πρόσβαση. Τα δεδομένα σου θα παραμείνουν στον Super Admin. Πάτησε συνέχεια για δεύτερη επιβεβαίωση.",function(){confirmAction("Τελική επιβεβαίωση: να αρχειοθετηθεί ο λογαριασμός σου;",async function(){await api("/api/self/archive",{method:"POST"});logout()})})});
$("#smartFile")&&$("#smartFile").addEventListener("change",function(e){const f=e.target.files&&e.target.files[0];$("#smartFileName").textContent=f?f.name:""});
async function imageDataV4(file){
 if(!file.type||!file.type.startsWith("image/"))return await new Promise(function(resolve,reject){const r=new FileReader();r.onload=function(){resolve(r.result)};r.onerror=reject;r.readAsDataURL(file)});
 return await new Promise(function(resolve,reject){
  const r=new FileReader();
  r.onload=function(){
   const img=new Image();
   img.onload=function(){
    const max=1200,scale=Math.min(1,max/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,w,h);
    resolve(canvas.toDataURL("image/jpeg",0.72));
   };
   img.onerror=reject;img.src=r.result;
  };
  r.onerror=reject;r.readAsDataURL(file);
 });
}
$("#smartAnalyze")&&$("#smartAnalyze").addEventListener("click",async function(){
 const f=$("#smartFile").files&&$("#smartFile").files[0];
 if(!f)return toast("Διάλεξε φωτογραφία ή PDF.");
 if(f.size>12*1024*1024)return toast("Μέγιστο 12 MB.");
 try{
  $("#smartResult").innerHTML='<div class="calc-box">Γίνεται ανάγνωση με AI...</div>';
  const dataUrl=await imageDataV4(f);
  pendingDocV4=await api("/api/documents/analyze",{method:"POST",body:JSON.stringify({filename:f.name,dataUrl:dataUrl})});
  showAiV4(pendingDocV4);
 }catch(e){
  const msg=e.details||e.message||"Η ανάλυση απέτυχε.";
  $("#smartResult").innerHTML='<div class="form-error">'+esc(msg)+"</div>";
 }
});
function showAiV4(d){
 const x=d.extraction||{},du=d.duplicate?'<div class="warning-box">Πιθανό διπλότυπο: '+esc(d.duplicate.filename)+(d.duplicate.plate?" · "+esc(d.duplicate.plate):"")+"</div>":"";
 $("#smartResult").innerHTML=du+'<div class="smart-review"><label>Τύπος<select id="aiType"><option value="fuel">Καύσιμα</option><option value="insurance">Ασφάλεια</option><option value="kteo">ΚΤΕΟ</option><option value="emissions">Κάρτα Καυσαερίων</option><option value="road_tax">Τέλη Κυκλοφορίας</option><option value="service">Service</option><option value="repair">Επισκευή</option><option value="tires">Ελαστικά</option><option value="battery">Μπαταρία</option><option value="other">Άλλο</option></select></label><label>Όχημα<select id="aiVehicle"></select></label><div class="form-row"><label>Ημερομηνία<input id="aiDate" type="date"></label><label>Λήξη<input id="aiDue" type="date"></label></div><div class="form-row"><label>Σύνολο με ΦΠΑ<input id="aiAmount" type="number" step="0.01"></label><label>Οδόμετρο<input id="aiOdo" type="number"></label></div><div class="form-row"><label>Καθαρή αξία<input id="aiNet" type="number" step="0.01"></label><label>ΦΠΑ %<input id="aiVatRate" type="number" step="0.001"></label></div><div class="form-row"><label>Ποσό ΦΠΑ<input id="aiVatAmount" type="number" step="0.01"></label><label>Προϊόν / Καύσιμο<input id="aiProduct"></label></div><div class="form-row"><label>Λίτρα<input id="aiLitres" type="number" step="0.001"></label><label>Τιμή/L<input id="aiPrice" type="number" step="0.0001"></label></div><label>Εταιρεία / Πρατήριο<input id="aiProvider"></label><label>Αριθμός παραστατικού<input id="aiRef"></label><label>Τίτλος<input id="aiTitle"></label><label>Σημειώσεις<textarea id="aiNotes"></textarea></label><button id="aiConfirm" class="primary wide" type="button">Επιβεβαίωση & Καταχώριση</button></div>';
 $("#aiType").value=x.docType||"other";$("#aiVehicle").innerHTML='<option value="">Επίλεξε όχημα</option>'+vehicles.map(function(v){return '<option value="'+v.id+'">'+esc(v.plate+" · "+v.model)+"</option>"}).join("");$("#aiVehicle").value=x.vehicleId||"";$("#aiDate").value=x.date||"";$("#aiDue").value=x.dueDate||"";$("#aiAmount").value=x.amount==null?"":x.amount;$("#aiOdo").value=x.odometer==null?"":x.odometer;$("#aiNet").value=x.netAmount==null?"":x.netAmount;$("#aiVatRate").value=x.vatRate==null?"":x.vatRate;$("#aiVatAmount").value=x.vatAmount==null?"":x.vatAmount;$("#aiProduct").value=x.product||"";$("#aiLitres").value=x.litres==null?"":x.litres;$("#aiPrice").value=x.pricePerLitre==null?"":x.pricePerLitre;$("#aiProvider").value=x.provider||"";$("#aiRef").value=x.referenceNo||"";$("#aiTitle").value=x.title||"";$("#aiNotes").value=x.notes||"";
 $("#aiConfirm").onclick=confirmAiV4;
}
async function confirmAiV4(){
 const x={docType:$("#aiType").value,vehicleId:$("#aiVehicle").value,date:$("#aiDate").value||null,dueDate:$("#aiDue").value||null,amount:$("#aiAmount").value?Number($("#aiAmount").value):null,netAmount:$("#aiNet").value?Number($("#aiNet").value):null,vatRate:$("#aiVatRate").value?Number($("#aiVatRate").value):null,vatAmount:$("#aiVatAmount").value?Number($("#aiVatAmount").value):null,product:$("#aiProduct").value,odometer:$("#aiOdo").value?Number($("#aiOdo").value):null,litres:$("#aiLitres").value?Number($("#aiLitres").value):null,pricePerLitre:$("#aiPrice").value?Number($("#aiPrice").value):null,provider:$("#aiProvider").value,referenceNo:$("#aiRef").value,title:$("#aiTitle").value,notes:$("#aiNotes").value};
 try{await api("/api/documents/"+pendingDocV4.documentId+"/confirm",{method:"POST",body:JSON.stringify({extraction:x})});pendingDocV4=null;$("#smartResult").innerHTML='<div class="attention-ok">✓ Το έγγραφο καταχωρίστηκε και επιβεβαιώθηκε.</div>';$("#smartFile").value="";$("#smartFileName").textContent="";await refreshAll();toast("Η καταχώριση ολοκληρώθηκε.")}catch(e){toast("Έλεγξε τα στοιχεία πριν την καταχώριση.")}
}
if($("#expenseDate"))$("#expenseDate").value=today();
setInterval(function(){if((token||me)&&navigator.onLine)refreshAll().catch(function(){})},5000);


function updateNetV4(){
  const s=$("#syncStatus");if(!s)return;
  s.textContent=navigator.onLine?"• Online":"• Offline";
  s.style.color=navigator.onLine?"#86efac":"#fbbf24";
}
window.addEventListener("online",function(){updateNetV4();if(token||me)refreshAll().catch(function(){})});
window.addEventListener("offline",updateNetV4);
document.addEventListener("visibilitychange",function(){if(!document.hidden&&(token||me)&&navigator.onLine)refreshAll().catch(function(){})});
updateNetV4();

if("serviceWorker" in navigator){
  window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})});
}

$("#restoreFile")&&$("#restoreFile").addEventListener("change",function(e){
  const f=e.target.files&&e.target.files[0];if(!f)return;
  confirmAction("Η επαναφορά θα προσθέσει/επαναφέρει δεδομένα από το backup. Συνέχεια;",function(){
    const r=new FileReader();
    r.onload=async function(){
      try{
        const data=JSON.parse(r.result);
        await api("/api/backup/restore",{method:"POST",body:JSON.stringify(data)});
        await refreshAll();toast("Το backup επαναφέρθηκε.");
      }catch(err){toast("Η επαναφορά απέτυχε. Έλεγξε το αρχείο backup.")}
      e.target.value="";
    };
    r.readAsText(f);
  });
});
