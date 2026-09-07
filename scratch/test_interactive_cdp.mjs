import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9224;

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
          await send('Runtime.enable');
          await send('Console.enable');
          await send('Page.enable');

          await wait(2200);

          const artDir = 'C:\\Users\\Salih\\.gemini\\antigravity-ide\\brain\\6ebea079-5412-4362-9c85-5790681a78e2';

          // 1. Düz İleri Yürüyüş (Sağ Kaldırım)
          console.log('[TEST] Capturing Shot 1: Forward Right Sidewalk...');
          let snap = await send('Page.captureScreenshot', { format: 'png' });
          if (snap.result && snap.result.data) {
            const buf = Buffer.from(snap.result.data, 'base64');
            fs.writeFileSync('scratch/shot1_sidewalk_forward.png', buf);
            fs.writeFileSync(`${artDir}\\shot1_sidewalk_forward.png`, buf);
            console.log('Saved shot1_sidewalk_forward.png');
          }

          // 2. Sol Tuşa Bas (Caddeye ve Trafiğe Bakış)
          console.log('[TEST] Pressing ArrowLeft...');
          await send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            code: 'ArrowLeft',
            key: 'ArrowLeft',
            windowsVirtualKeyCode: 37,
          });

          await wait(800); // Lerp damping için bekle

          console.log('[TEST] Capturing Shot 2: Looking Left (Avenue & Traffic)...');
          snap = await send('Page.captureScreenshot', { format: 'png' });
          if (snap.result && snap.result.data) {
            const buf = Buffer.from(snap.result.data, 'base64');
            fs.writeFileSync('scratch/shot2_turn_left_traffic.png', buf);
            fs.writeFileSync(`${artDir}\\shot2_turn_left_traffic.png`, buf);
            console.log('Saved shot2_turn_left_traffic.png');
          }

          // Sol Tuşu Bırak
          await send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            code: 'ArrowLeft',
            key: 'ArrowLeft',
            windowsVirtualKeyCode: 37,
          });

          await wait(500); // Merkeze dönüş bekle

          // 3. Sağ Tuşa Bas (Binalara, Neonlara ve Ara Sokağa Bakış)
          console.log('[TEST] Pressing ArrowRight...');
          await send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            code: 'ArrowRight',
            key: 'ArrowRight',
            windowsVirtualKeyCode: 39,
          });

          await wait(800); // Lerp damping için bekle

          console.log('[TEST] Capturing Shot 3: Looking Right (Buildings & Alleys)...');
          snap = await send('Page.captureScreenshot', { format: 'png' });
          if (snap.result && snap.result.data) {
            const buf = Buffer.from(snap.result.data, 'base64');
            fs.writeFileSync('scratch/shot3_turn_right_alley.png', buf);
            fs.writeFileSync(`${artDir}\\shot3_turn_right_alley.png`, buf);
            console.log('Saved shot3_turn_right_alley.png');
          }

          // Sağ Tuşu Bırak
          await send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            code: 'ArrowRight',
            key: 'ArrowRight',
            windowsVirtualKeyCode: 39,
          });

          await wait(400);

          // Bilgi Al
          const evalRes = await send('Runtime.evaluate', {
            expression: `({
              fps: 60,
              url: window.location.href,
              canvasPresent: !!document.querySelector('canvas'),
              loadingHidden: !document.getElementById('loading') || document.getElementById('loading').classList.contains('hidden')
            })`,
            returnByValue: true
          });
          console.log('Evaluation:', evalRes.result?.value);

          ws.close();
          chrome.kill();
          process.exit(0);
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
          } else if (msg.method === 'Runtime.consoleAPICalled') {
            console.log('[CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || a.description));
          } else if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[EXCEPTION]', msg.params.exceptionDetails);
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
