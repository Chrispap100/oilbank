const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { spawnSync } = require('child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oilbank-test-'));
process.env.OILBANK_HOME = home;
process.env.PORT = '0';
process.env.ADMIN_EMAIL = 'admin@example.test';
process.env.ADMIN_PASSWORD = 'Test-password-123';
process.env.OILBANK_AUTO_BACKUP = '0';
const local = require('../local-store');
const { start } = require('../server');

test('Local SQLite end-to-end', async t => {
  const server = await start();if (!server.listening) await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await new Promise(r => server.close(r));local.close();fs.rmSync(home, {recursive:true,force:true}); });
  let token, userToken, otherToken, uid, vid, docId, snapshot;
  async function request(route, method='GET', body, auth=token) {
    const r = await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const text = await r.text();let data;try {data=JSON.parse(text)}catch {data=text}
    return {status:r.status,data,headers:r.headers};
  }
  const ok = (r, status=200) => {assert.equal(r.status,status,JSON.stringify(r.data));return r.data};
  await t.test('schema creation, migration idempotence, foreign keys', () => {
    local.migrate();assert.equal(local.db().prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(local.db().prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(local.db().prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.ok(local.db().prepare('PRAGMA table_info(documents)').all().some(x=>x.name==='file_path'));
    assert.ok(!local.db().prepare('PRAGMA table_info(documents)').all().some(x=>x.name==='file_bytes'));
  });
  await t.test('login success and wrong password, protected routes', async () => {
    assert.equal((await request('/api/users','GET',undefined,'')).status,401);
    assert.equal((await request('/api/login','POST',{email:process.env.ADMIN_EMAIL,password:'wrong'},'')).status,401);
    token=ok(await request('/api/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD},'')).token;
    assert.equal(ok(await request('/api/me')).user.role,'super_admin');
  });
  await t.test('users and duplicate email', async () => {
    uid=ok(await request('/api/users','POST',{name:'Δοκιμή',email:'user@example.test',password:'password123'}),201).user.id;
    ok(await request('/api/users','POST',{name:'Other',email:'other@example.test',password:'password123'}),201);
    assert.equal((await request('/api/users','POST',{name:'Duplicate',email:'user@example.test',password:'password123'})).status,409);
    userToken=ok(await request('/api/login','POST',{email:'user@example.test',password:'password123'},'')).token;
    otherToken=ok(await request('/api/login','POST',{email:'other@example.test',password:'password123'},'')).token;
    assert.equal(ok(await request('/api/users')).users.length,3);
    assert.equal((await request('/api/users','GET',undefined,userToken)).status,403);
  });
  await t.test('vehicles ownership, duplicate plate, isolation', async () => {
    vid=ok(await request('/api/vehicles','POST',{plate:'ΑΒΓ-1234',model:'Car',fuel:'diesel',userId:uid}),201).vehicle.id;
    assert.equal((await request('/api/vehicles','POST',{plate:'ΑΒΓ-1234',model:'Car',fuel:'diesel',userId:uid})).status,409);
    assert.equal(ok(await request('/api/vehicles','GET',undefined,userToken)).vehicles.length,1);
    assert.equal(ok(await request('/api/vehicles','GET',undefined,otherToken)).vehicles.length,0);
    assert.equal((await request('/api/vehicles/'+vid,'DELETE',undefined,otherToken)).status,403);
  });
  await t.test('fuel logs, boolean mapping and odometer validation', async () => {
    const log=ok(await request('/api/logs','POST',{vehicleId:vid,date:'2026-10-08',odometer:100,amount:60,price:1.5,fullTank:false},userToken),201).log;
    assert.equal(log.litres,40);assert.equal(log.fullTank,false);
    assert.equal((await request('/api/logs','POST',{vehicleId:vid,date:'2026-10-08',odometer:90,amount:60,price:1.5},userToken)).status,400);
    assert.equal(ok(await request('/api/logs','GET',undefined,otherToken)).logs.length,0);
  });
  await t.test('expenses and obligations, paid state, ownership', async () => {
    ok(await request('/api/expenses','POST',{vehicleId:vid,date:'2026-10-08',category:'service',amount:123.45,title:'=HYPERLINK("evil")'},userToken),201);
    ok(await request('/api/obligations','POST',{vehicleId:vid,type:'insurance',dueDate:'2027-01-01',amount:99,paid:false},userToken),201);
    assert.equal(ok(await request('/api/expenses','GET',undefined,userToken)).expenses[0].amount,123.45);
    assert.equal(ok(await request('/api/obligations','GET',undefined,userToken)).obligations[0].paid,false);
    assert.equal((await request('/api/expenses','POST',{vehicleId:vid,date:'2026-10-08'},otherToken)).status,403);
  });
  const bytes=Buffer.from('%PDF-1.4\nOilBank test document\n%%EOF');
  await t.test('offline document upload stores original bytes on disk', async () => {
    docId=ok(await request('/api/documents','POST',{filename:'τιμολόγιο.pdf',vehicleId:vid,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')},userToken),201).documentId;
    const row=local.db().prepare('SELECT * FROM documents WHERE id=?').get(docId);
    assert.deepEqual(fs.readFileSync(local.documentPath(row.file_path)),bytes);
    assert.equal(row.size_bytes,bytes.length);assert.equal(row.file_bytes,undefined);
    const response=await fetch(base+'/api/documents/'+docId+'/file',{headers:{Authorization:'Bearer '+userToken}});
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    assert.equal((await request('/api/documents/'+docId+'/file','GET',undefined,otherToken)).status,403);
    assert.equal((await request('/api/documents','POST',{filename:'x.svg',dataUrl:'data:image/svg+xml;base64,PHN2Zz4='},userToken)).status,400);
  });
  await t.test('document confirmation transaction rollback and repeat protection', async () => {
    assert.equal((await request('/api/documents/'+docId+'/confirm','POST',{extraction:{vehicleId:vid,docType:'fuel',amount:-1}},userToken)).status,400);
    assert.equal(local.db().prepare('SELECT confirmed FROM documents WHERE id=?').get(docId).confirmed,0);
    ok(await request('/api/documents/'+docId+'/confirm','POST',{extraction:{vehicleId:vid,docType:'service',date:'2026-10-08',amount:55}},userToken));
    assert.equal((await request('/api/documents/'+docId+'/confirm','POST',{extraction:{vehicleId:vid}},userToken)).status,409);
    assert.equal(ok(await request('/api/expenses','GET',undefined,userToken)).expenses.length,2);
  });
  await t.test('JSON and boolean roundtrip, audit log visibility', async () => {
    const docs=ok(await request('/api/documents','GET',undefined,userToken)).documents;
    assert.equal(docs[0].confirmed,true);assert.equal(docs[0].ai_json.docType,'service');
    const log=ok(await request('/api/audit')).audit;
    assert.ok(log.some(x=>x.action==='document_confirmed'&&x.details.documentId));
    assert.ok(log.some(x=>x.action==='fuel_created'));
    assert.equal((await request('/api/audit','GET',undefined,userToken)).status,403);
  });
  await t.test('disabled users cannot use old tokens; status metadata persists', async () => {
    ok(await request('/api/users/'+uid+'/status','POST',{status:'disabled'}));
    assert.equal((await request('/api/me','GET',undefined,userToken)).status,401);
    assert.equal(ok(await request('/api/users')).users.find(x=>x.id===uid).status,'disabled');
    ok(await request('/api/users/'+uid+'/status','POST',{status:'active'}));
  });
  await t.test('password reset, vault and old token invalidation', async () => {
    ok(await request('/api/users/'+uid+'/reset-password','POST',{password:'new-password-123'}));
    assert.equal(ok(await request('/api/users/'+uid+'/vault')).password,'new-password-123');
    assert.equal((await request('/api/me','GET',undefined,userToken)).status,401);
    userToken=ok(await request('/api/login','POST',{email:'user@example.test',password:'new-password-123'},'')).token;
  });
  await t.test('registration request and approval', async () => {
    ok(await request('/api/register-request','POST',{name:'Pending',email:'pending@example.test'},''),201);
    const pending=ok(await request('/api/users')).users.find(x=>x.email==='pending@example.test');
    assert.equal(pending.status,'pending');assert.equal(pending.active,false);
    ok(await request('/api/users/'+pending.id+'/approve','POST',{password:'approved-password'}));
    ok(await request('/api/login','POST',{email:'pending@example.test',password:'approved-password'},''));
  });
  await t.test('CSV export: seven tables, Greek text, escaping, no password hashes', async () => {
    const exported=ok(await request('/api/export/csv')).files;
    assert.equal(Object.keys(exported).length,7);
    assert.ok(exported['vehicles.csv'].includes('ΑΒΓ-1234'));
    assert.ok(exported['expenses.csv'].includes("'=HYPERLINK"));
    assert.ok(!exported['users.csv'].includes('password_hash'));assert.ok(!exported['users.csv'].includes('vault_cipher'));
    assert.equal((await request('/api/export/csv','GET',undefined,userToken)).status,403);
    assert.equal(fs.readdirSync(path.join(home,'exports')).length,1);
  });
  await t.test('backup includes SQLite and binary documents', async () => {
    snapshot=ok(await request('/api/backup'));
    assert.equal(snapshot.format,'oilbank-local');assert.equal(Object.keys(snapshot.documents).length,1);
    assert.ok(Buffer.from(snapshot.database,'base64').subarray(0,15).equals(Buffer.from('SQLite format 3')));
    assert.equal((await request('/api/backup','GET',undefined,userToken)).status,403);
  });
  await t.test('invalid, incomplete and legacy backups leave live data untouched', async () => {
    for(const bad of [{...snapshot,sha256:'bad'},{...snapshot,documents:{}},{users:[],vehicles:[],fuelLogs:[],expenses:[],obligations:[]}]) {
      assert.equal((await request('/api/backup/restore','POST',bad)).status,400);
      assert.equal(ok(await request('/api/vehicles')).vehicles.length,1);
    }
  });
  await t.test('full restore recovers deleted records, documents, passwords, vault and audit', async () => {
    ok(await request('/api/vehicles/'+vid,'DELETE'));
    assert.equal(ok(await request('/api/vehicles')).vehicles.length,0);
    fs.unlinkSync(local.documentPath(local.db().prepare('SELECT file_path FROM documents WHERE id=?').get(docId).file_path));
    ok(await request('/api/backup/restore','POST',snapshot));
    assert.equal((await request('/api/me')).status,401);
    token=ok(await request('/api/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD},'')).token;
    assert.equal(ok(await request('/api/vehicles')).vehicles.length,1);
    assert.equal(ok(await request('/api/logs')).logs.length,1);
    assert.equal(ok(await request('/api/expenses')).expenses.length,2);
    assert.equal(ok(await request('/api/obligations')).obligations.length,1);
    assert.equal(ok(await request('/api/users/'+uid+'/vault')).password,'new-password-123');
    const row=local.db().prepare('SELECT * FROM documents WHERE id=?').get(docId);
    assert.deepEqual(fs.readFileSync(local.documentPath(row.file_path)),bytes);
    assert.ok(fs.readdirSync(path.join(home,'backups')).some(x=>x.startsWith('before-restore-')));
    assert.deepEqual(local.db().prepare('PRAGMA foreign_key_check').all(),[]);
  });
  await t.test('parallel API requests do not interleave transactions', async () => {
    const results=await Promise.all(Array.from({length:8},(_,n)=>request('/api/expenses','POST',{vehicleId:vid,date:'2026-10-08',amount:n,title:'Parallel '+n})));
    for(const r of results)ok(r,201);
    assert.equal(ok(await request('/api/expenses')).expenses.length,10);
  });
  await t.test('private files are never served; UI assets retained', async () => {
    for(const file of ['/data/oilbank.db','/.env','/server.js','/local-store.js','/package.json','/.git/config'])assert.equal((await request(file)).status,404,file);
    for(const file of ['/','/style.css','/script.js','/v4.js','/local-ui.js','/icon.svg'])assert.equal((await request(file)).status,200,file);
  });
  await t.test('maintenance lock and persistent database access from a second process', () => {
    local.acquireLock();
    const blocked=spawnSync(process.execPath,['scripts/manage.js','export'],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});
    assert.equal(blocked.status,1);assert.ok(blocked.stderr.includes('already running'));
    fs.unlinkSync(path.join(home,'data','oilbank.lock'));
    const run=spawnSync(process.execPath,['scripts/manage.js','export'],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);assert.ok(run.stdout.includes('exports'));
  });
  await t.test('first-run setup creates a local admin once and releases its lock', async () => {
    const setupHome=path.join(home,'setup-check');
    const child=require('child_process').spawn(process.execPath,['scripts/setup.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,OILBANK_HOME:setupHome},stdio:['pipe','pipe','pipe']});
    let output='',errors='';
    child.stdout.on('data',chunk=>{const text=chunk.toString();output+=text;if(text.includes('Administrator name:'))child.stdin.write('Local Admin\n');if(text.includes('Administrator email'))child.stdin.write('setup@example.test\n')});
    child.stderr.on('data',chunk=>errors+=chunk.toString());
    const [code]=await once(child,'exit');assert.equal(code,0,errors);
    assert.ok(output.includes('Local account created'));
    const password=output.match(/Password: (\S+)/)[1];
    const d=new (require('node:sqlite').DatabaseSync)(path.join(setupHome,'data','oilbank.db'));
    const user=d.prepare('SELECT * FROM users').get();assert.equal(user.email,'setup@example.test');assert.equal(require('bcryptjs').compareSync(password,user.password_hash),true);d.close();
    assert.equal(fs.existsSync(path.join(setupHome,'data','oilbank.lock')),false);
    const again=spawnSync(process.execPath,['scripts/setup.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,OILBANK_HOME:setupHome},encoding:'utf8'});assert.equal(again.status,0,again.stderr);assert.ok(again.stdout.includes('already configured'));
  });

});
