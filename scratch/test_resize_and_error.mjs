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
  await wait(2000);

  http.get(`http://127.0.0.1:${port}/json`, async (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      try {
        const list = JSON.parse(data);
        const page = list.find(t => t.url.includes('localhost:8080'));
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
          await send('Runtime.enable');
          await wait(2000);

          // 1. Test resize event
          const resizeRes = await send('Runtime.evaluate', {
            expression: `(() => {
              window.dispatchEvent(new Event('resize'));
              return {
                windowW: window.innerWidth,
                windowH: window.innerHeight,
                errorOverlayPresent: !!document.getElementById('error-overlay'),
                errorOverlayVisible: document.getElementById('error-overlay')?.classList.contains('visible')
              };
            })()`,
            returnByValue: true
          });
          console.log('[TEST RESULT - Resize & Error Overlay DOM]:', resizeRes.result?.value);

          // 2. Test error overlay triggering
          const triggerErrRes = await send('Runtime.evaluate', {
            expression: `(() => {
              const errOverlay = document.getElementById('error-overlay');
              const errDetails = document.getElementById('error-details');
              // simulate error
              errOverlay.classList.add('visible');
              errDetails.textContent = 'TestError: Simulated WebGL crash';
              return {
                visible: errOverlay.classList.contains('visible'),
                details: errDetails.textContent
              };
            })()`,
            returnByValue: true
          });
          console.log('[TEST RESULT - Error Simulation]:', triggerErrRes.result?.value);

          ws.close();
          chrome.kill();
          process.exit(0);
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
          }
        };

      } catch (e) {
        console.error(e);
        chrome.kill();
        process.exit(1);
      }
    });
  }).on('error', err => {
    console.error('HTTP error:', err);
    chrome.kill();
    process.exit(1);
  });
}

run();
