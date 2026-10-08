const fs = require('fs');
const local = require('../local-store');
try {
  local.acquireLock();local.migrate();
  const command = process.argv[2];
  if (command === 'migrate') console.log('SQLite schema is ready.');
  else if (command === 'backup') console.log(local.backup().file);
  else if (command === 'export') console.log(local.exportCsv().directory);
  else if (command === 'restore') {
    const file = process.argv[3];
    if (!file || !process.argv.includes('--confirm')) throw new Error('Usage: npm run restore -- "C:\\path\\backup.json" --confirm (replaces all data; stop OilBank first)');
    console.log('Restored. Safety backup: '+local.restore(JSON.parse(fs.readFileSync(file,'utf8'))));
  } else throw new Error('Unknown command');
} catch(e) { console.error(e.message);process.exitCode=1; }
finally { local.close(); }
