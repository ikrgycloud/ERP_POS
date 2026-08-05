/**
 * Verifies the PRODUCTION topology, not the dev proxy:
 *
 *   built dist/  ──► static server (stands in for nginx)
 *                      │  /api/*  ──► uvicorn (stands in for the api container)
 *                      └  /*      ──► index.html   (SPA fallback)
 *
 * This is exactly what docker-compose builds. If this passes, the containers
 * will serve the same bytes over the same paths.
 *
 * Also asserts the two things nginx must get right:
 *   1. deep-linking to /returns must serve index.html, not 404
 *   2. a hard refresh on a client route must restore the session
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_PORT = 8020;
const WEB_PORT = 5210;
const procs = [];
let server;
const FAIL = [];

const E2E = {
  bmCode: process.env.E2E_BM_CODE,
  bmPassword: process.env.E2E_BM_PASSWORD,
  spCode: process.env.E2E_SP_CODE,
  spPassword: process.env.E2E_SP_PASSWORD,
  productBarcode: process.env.E2E_PRODUCT_BARCODE,
  productId: process.env.E2E_PRODUCT_ID,
  productRate: process.env.E2E_PRODUCT_RATE,
};

for (const [key, value] of Object.entries(E2E)) {
  if (!value) throw new Error(`Missing ${key} environment value for E2E`);
}

function ck(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? `  [${extra}]` : ''}`);
  if (!cond) FAIL.push(name);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** Mirrors pos_ui/nginx.conf: proxy /api, else try_files $uri /index.html. */
function nginxLike() {
  const DIST = path.join(__dirname, 'dist');
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/health')) {
      const p = http.request(
        { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
        (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); },
      );
      p.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
      req.pipe(p);
      return;
    }
    const clean = req.url.split('?')[0];
    let file = path.join(DIST, clean);
    // try_files $uri $uri/ /index.html
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  srv.listen(WEB_PORT);
  return srv;
}

function waitFor(port, p) {
  return new Promise((res, rej) => {
    const a = (n) => {
      const r = http.get({ host: '127.0.0.1', port, path: p, timeout: 800 }, (x) => { x.resume(); res(); });
      r.on('error', () => (n <= 0 ? rej(new Error(`:${port} down`)) : setTimeout(() => a(n - 1), 300)));
      r.on('timeout', () => { r.destroy(); n <= 0 ? rej(new Error('t')) : setTimeout(() => a(n - 1), 300); });
    };
    a(90);
  });
}

function cleanup() {
  try { server && server.close(); } catch {}
  procs.forEach((p) => { try { p.kill('SIGKILL'); } catch {} });
}

(async () => {
  // API container stand-in
  procs.push(spawn('python', ['-m', 'uvicorn', 'app.main:app', '--port', String(API_PORT), '--log-level', 'warning'], {
    cwd: path.join(__dirname, '..', 'pos_api'),
    env: { ...process.env, DATABASE_URL: 'sqlite+aiosqlite:///./prod_e2e.db', SECRET_KEY: 'prodtest' },
    stdio: 'ignore',
  }));
  await waitFor(API_PORT, '/health');
  server = nginxLike();
  await waitFor(WEB_PORT, '/index.html');
  console.log('production topology up\n');

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  const errors = [];
  const EXPECTED = /status of (401|403|404)/;
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 140)}`));
  // net::ERR_ABORTED fires when the page navigates or closes while a fetch is
  // still in flight. That is teardown, not a defect. Real failures (refused,
  // reset, dns) are still captured.
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText || '';
    if (r.url().includes('fonts.g')) return;
    if (why.includes('ERR_ABORTED')) return;
    errors.push(`reqfail: ${r.url().slice(0, 80)} (${why})`);
  });

  const B = `http://127.0.0.1:${WEB_PORT}`;

  /* ---- 1. serving the BUILT bundle, not dev ---- */
  const html = await (await fetch(`${B}/index.html`)).text();
  ck('serves built bundle (hashed asset)', /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(html));
  ck('no vite dev client in bundle', !html.includes('/@vite/client'));

  /* ---- 2. SPA deep-link must not 404 (the classic nginx bug) ---- */
  const deep = await fetch(`${B}/returns`);
  ck('deep-link /returns -> 200 index.html', deep.status === 200, deep.status);
  const deepBody = await deep.text();
  ck('deep-link returns the SPA shell', deepBody.includes('<div id="root">'));

  /* ---- 3. same-origin API through the proxy ---- */
  const login = await fetch(`${B}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_code: E2E.spCode, password: E2E.spPassword }),
  });
  ck('POST /api/v1/auth/login through proxy', login.status === 200, login.status);
  const tok = await login.json();
  ck('returns a JWT pair', !!tok.access_token && !!tok.refresh_token);

  /* ---- 4. the real user journey, on the built bundle ---- */
  await page.goto(B, { waitUntil: 'networkidle' });
  ck('root redirects to /login', page.url().includes('/login'));

  await page.fill('input[placeholder="Employee code"]', E2E.spCode);
  await page.fill('input[type="password"]', E2E.spPassword);
  await page.click('button[type=submit]');
  await page.waitForURL('**/billing', { timeout: 20000 });
  ck('SP signs in -> /billing', page.url().includes('/billing'));

  const scan = page.locator('input[placeholder="Scan or type barcode"]');
  await scan.fill(E2E.productBarcode);
  await scan.press('Enter');
  await page.waitForSelector('text=GRAND TOTAL', { timeout: 15000 });
  ck('scan adds line', true);

  await page.waitForTimeout(600);
  let rail = await page.locator('text=GRAND TOTAL').locator('..').locator('..').innerText();
  ck('1 x 50 @5% = 52.50', rail.includes('52.50'), rail.replace(/\n/g, ' ').slice(0, 50));

  await page.click('button[aria-label="Increase"]');
  await page.waitForTimeout(800);
  rail = await page.locator('text=GRAND TOTAL').locator('..').locator('..').innerText();
  ck('qty 2 -> 105.00', rail.includes('105.00'), rail.replace(/\n/g, ' ').slice(0, 50));

  await page.click('text=/CHECKOUT ·/');
  await page.waitForSelector('text=Payment complete', { timeout: 20000 });
  ck('checkout on built bundle', true);
  const invNo = (await page.textContent('body')).match(/INV-\d{8}-\d{4}/)[0];
  ck('invoice number', /INV-\d{8}-\d{4}/.test(invNo), invNo);

  /* ---- 5. HARD REFRESH on a client route (nginx fallback + session restore) ---- */
  await page.goto(`${B}/invoices`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=INVOICES', { timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=INVOICES', { timeout: 15000 });
  ck('hard refresh on /invoices keeps session', page.url().includes('/invoices'));
  ck('invoice still listed after refresh', await page.isVisible(`text=${invNo}`));

  /* ---- 6. RBAC still enforced in prod build ---- */
  await page.goto(`${B}/staff`, { waitUntil: 'networkidle' });
  ck('SP blocked from /staff', await page.isVisible('text=Not permitted'));

  /* ---- 7. endpoint annotations must NOT ship to production ---- */
  const bodyTxt = await page.textContent('body');
  ck('EndpointBar hidden in prod build', !bodyTxt.includes('/pos/cart/{id}/scan'));

  /* ---- 8. BM: full reversal on the built bundle ---- */
  await page.goto(`${B}/returns`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=RAISE A RETURN', { timeout: 15000 });
  await page.fill('input[placeholder="Invoice number"]', invNo);
  await page.click('button:has-text("Find")');
  await page.waitForSelector('text=LINE 1', { timeout: 15000 });
  await page.fill('input[placeholder="prod id"]', E2E.productId);
  await page.fill('input[placeholder="rate"]', E2E.productRate);
  await page.click('button:has-text("Submit Return")');
  await page.waitForSelector('text=RETURN LIFECYCLE', { timeout: 20000 });
  const retNo = (await page.textContent('body')).match(/RET-\d{8}-\d{4}/)[0];
  ck('return submitted', /RET-\d{8}-\d{4}/.test(retNo), retNo);

  await page.click('aside button[title="Sign out"]');
  await page.waitForURL('**/login', { timeout: 15000 });
  await page.fill('input[placeholder="Employee code"]', E2E.bmCode);
  await page.fill('input[type="password"]', E2E.bmPassword);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  ck('BM signs in -> /dashboard', true);

  await page.goto(`${B}/returns`, { waitUntil: 'networkidle' });
  await page.locator(`text=${retNo}`).first().click();
  await page.waitForSelector('text=RETURN LIFECYCLE', { timeout: 15000 });
  await page.click('button:has-text("Mark verified")');
  await page.waitForTimeout(1400);
  await page.click('button:has-text("Mark approved")');
  await page.waitForTimeout(1400);
  await page.click('button:has-text("PROCESS RETURN")');
  await page.waitForSelector('text=/Processed —/', { timeout: 20000 });
  ck('reversal processed', true);
  // The reversal card renders after refreshAll() re-fetches the return, so
  // wait for it rather than snapshotting mid-render.
  await page.waitForSelector('text=is_reverse = TRUE', { timeout: 15000 });
  ck('is_reverse=TRUE card shown', true);
  ck('linked_invoice_id shown', await page.isVisible('text=/linked_invoice_id/'));

  await page.waitForLoadState('networkidle').catch(() => {});
  await browser.close();
  cleanup();

  console.log('\n' + '='.repeat(58));
  if (errors.length) {
    console.log(`CONSOLE / PAGE ERRORS (${errors.length}):`);
    [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  ✗ ' + e));
    FAIL.push('console errors');
  } else {
    console.log('No console errors, page errors, or failed requests.');
  }
  console.log('FAILURES:', FAIL.length ? FAIL : 'NONE');
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASHED:', e.message.slice(0, 220));
  cleanup();
  process.exit(1);
});
