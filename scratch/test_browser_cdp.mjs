import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9223;

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  '--headless=new',
  '--no-sandbox',
  '--use-gl=angle',
  '--window-size=1280,720',
  'http://localhost:8080'
]);

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  await wait(2500);

  http.get(`http://127.0.0.1:${port}/json`, async (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      try {
        const list = JSON.parse(data);
        const page = list.find(t => t.url.includes('localhost:8080'));
        if (!page) {
          console.error('Page not found');
          chrome.kill();
          return;
        }

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let id = 1;
        const callbacks = new Map();

        function send(method, params = {}) {
          return new Promise(resolve => {
            const reqId = id++;
            callbacks.set(reqId, resolve);
            ws.send(JSON.stringify({ id: reqId, method, params }));
          });
        }

        ws.onopen = async () => {
          ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
          ws.send(JSON.stringify({ id: id++, method: 'Console.enable' }));
          ws.send(JSON.stringify({ id: id++, method: 'Page.enable' }));

          await wait(2000);

          // Capture screenshot
          const snap = await send('Page.captureScreenshot', { format: 'png' });
          if (snap.result && snap.result.data) {
            fs.writeFileSync('c:\\Users\\Salih\\Web_Tasarım\\Animasyon_Ödevi\\scratch\\cdp_screenshot.png', Buffer.from(snap.result.data, 'base64'));
            console.log('Screenshot saved to scratch/cdp_screenshot.png');
          }

          // Evaluate document and console state
          const evalRes = await send('Runtime.evaluate', {
            expression: `({
              loading: document.getElementById('loading')?.textContent,
              loadingClasses: document.getElementById('loading')?.className,
              children: Array.from(document.body.children).map(c => c.tagName + '#' + c.id),
              canvas: !!document.querySelector('canvas'),
              canvasWidth: document.querySelector('canvas')?.width,
              canvasHeight: document.querySelector('canvas')?.height
            })`,
            returnByValue: true
          });
          console.log('DOM Evaluation:', evalRes.result?.value);

          ws.close();
          chrome.kill();
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
          } else if (msg.method === 'Runtime.consoleAPICalled') {
            console.log('[BROWSER CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || a.description));
          } else if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails);
          }
        };

      } catch (e) {
        console.error(e);
        chrome.kill();
      }
    });
  }).on('error', err => {
    console.error('HTTP error:', err);
    chrome.kill();
  });
}

run();
