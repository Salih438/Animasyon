import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9222;

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  '--headless=new',
  '--no-sandbox',
  '--window-size=1280,720',
  'http://localhost:8080'
]);

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  await wait(2000);
  
  // Get debug target
  http.get(`http://127.0.0.1:${port}/json`, async (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      try {
        const list = JSON.parse(data);
        console.log('Targets:', list.map(t => ({ url: t.url, type: t.type })));
      } catch (e) {
        console.error(e);
      }
      chrome.kill();
    });
  }).on('error', err => {
    console.error('HTTP error:', err);
    chrome.kill();
  });
}

run();
