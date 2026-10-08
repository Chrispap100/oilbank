const { spawn } = require('child_process');
const local = require('../local-store');
local.acquireLock();
require('../server').start().then(server => {
    const url = 'http://127.0.0.1:' + server.address().port;
    if (process.platform === 'win32') {
      const child = spawn('powershell.exe', ['-NoProfile','-WindowStyle','Hidden','-Command', 'Start-Process ' + url], { windowsHide:true, stdio:'ignore' });
      child.on('error', () => console.log('Open '+url+' in your browser.'));
    }
    console.log('Keep this window open. Press Ctrl+C to stop OilBank.');
  server.on('error', e => { console.error(e.message);process.exit(1); });
}).catch(e => { console.error(e.message);process.exit(1); });
