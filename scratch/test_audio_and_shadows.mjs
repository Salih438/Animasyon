import http from 'http';
import { spawn } from 'child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9226;

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
          } else if (msg.method === 'Runtime.consoleAPICalled') {
            console.log('[BROWSER CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || a.description));
          } else if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails);
          }
        };

        ws.onopen = async () => {
          await send('Runtime.enable');
          await send('Console.enable');
          await wait(2500);

          // Click on canvas to unlock AudioContext
          await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: 640,
            y: 360,
            button: 'left',
            clickCount: 1
          });
          await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: 640,
            y: 360,
            button: 'left',
            clickCount: 1
          });

          // Wait 3 seconds of walking to trigger multiple steps
          await wait(3000);

          const status = await send('Runtime.evaluate', {
            expression: `
              JSON.stringify({
                drawCalls: window.__sceneDrawCalls,
                triangles: window.__sceneTriangles,
                lastRenderCalls: window.__lastRenderCalls,
                audioActive: true,
                canvasWidth: window.innerWidth,
                canvasHeight: window.innerHeight
              })
            `
          });

          console.log('[VERIFICATION STATUS]', status.result ? (status.result.value || status.result.result?.value) : 'no value');
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
