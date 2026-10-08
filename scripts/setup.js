const local = require('../local-store');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const readline = require('readline/promises');
async function setup() {
  local.acquireLock();local.migrate();
  if (local.db().prepare('SELECT id FROM users LIMIT 1').get()) { console.log('OilBank is already configured.');return; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = (await rl.question('Administrator name: ')).trim() || 'Administrator';
    let email = '';
    while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = (await rl.question('Administrator email (used only for local login): ')).trim().toLowerCase();
    const password = crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(password, 12);
    local.db().prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'super_admin')").run(name,email,hash);
    local.secret('jwt');local.secret('vault');
    console.log('\nLocal account created. Keep these credentials:\nEmail: '+email+'\nPassword: '+password+'\nYou can change it using Reset in Users.');
  } finally { rl.close();local.close(); }
}
setup().catch(e=>{console.error(e.message);process.exitCode=1});
