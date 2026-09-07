import http from 'http';
import { spawn } from 'child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9225;

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
  await wait(2200);

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

        ws.onmessage = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
          }
        };

        ws.onopen = async () => {
          await send('Runtime.enable');
          await wait(2500);

          const evalRes = await send('Runtime.evaluate', {
            expression: `
              JSON.stringify({
                sceneDrawCalls: window.__sceneDrawCalls,
                sceneTriangles: window.__sceneTriangles,
                geometries: window.__renderer ? window.__renderer.info.memory.geometries : null,
                textures: window.__renderer ? window.__renderer.info.memory.textures : null
              })
            `
          });

          console.log('[BASELINE MEASUREMENT]', evalRes.result ? (evalRes.result.value || evalRes.result.result?.value || JSON.stringify(evalRes)) : 'no result');
          ws.close();
          chrome.kill();
        };
      } catch (err) {
        console.error(err);
        chrome.kill();
      }
    });
  });
}

run();
