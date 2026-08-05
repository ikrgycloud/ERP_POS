/**
 * Boots FastAPI + `vite preview`, then drives the real UI in Chromium.
 * Fails on ANY console error / page error / failed request.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');

const API_PORT = 8010;
const WEB_PORT = 5199; // static server that ALSO proxies /api -> API_PORT (same origin)
const procs = [];
const FAIL = [];

const E2E = {
  bmCode: process.env.E2E_BM_CODE,
  bmPassword: process.env.E2E_BM_PASSWORD,
  spCode: process.env.E2E_SP_CODE,
  spPassword: process.env.E2E_SP_PASSWORD,
  productBarcode: process.env.E2E_PRODUCT_BARCODE,
  productName: process.env.E2E_PRODUCT_NAME,
  productSku: process.env.E2E_PRODUCT_SKU,
  productId: process.env.E2E_PRODUCT_ID,
  productRate: process.env.E2E_PRODUCT_RATE,
  receiptStoreName: process.env.E2E_STORE_NAME,
};

for (const [key, value] of Object.entries(E2E)) {
  if (!value) throw new Error(`Missing ${key} environment value for E2E`);
}

function ck(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? `  [${extra}]` : ''}`);
  if (!cond) FAIL.push(name);
}

function waitFor(port, path = '/', tries = 80) {
  return new Promise((res, rej) => {
    const attempt = (n) => {
      const req = http.get({ host: '127.0.0.1', port, path, timeout: 800 }, (r) => {
        r.resume();
        res(true);
      });
      req.on('error', () => (n <= 0 ? rej(new Error(`port ${port} never came up`)) : setTimeout(() => attempt(n - 1), 300)));
      req.on('timeout', () => { req.destroy(); n <= 0 ? rej(new Error('timeout')) : setTimeout(() => attempt(n - 1), 300); });
    };
    attempt(tries);
  });
}

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png',
};

/**
 * Same-origin server: serves dist/ AND proxies /api + /health to FastAPI.
 * Mirrors what nginx does in production, and avoids Chromium's
 * cross-origin route.continue() block.
 */
function serveSameOrigin() {
  const DIST = '/home/claude/pos_ui/dist';
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/health')) {
      const proxy = http.request(
        { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
        (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); },
      );
      proxy.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
      req.pipe(proxy);
      return;
    }
    let file = path.join(DIST, req.url.split('?')[0]);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  srv.listen(WEB_PORT);
  return srv;
}

function boot() {
  const api = spawn(
    'python',
    ['-m', 'uvicorn', 'app.main:app', '--port', String(API_PORT), '--log-level', 'warning'],
    {
      cwd: '/home/claude/pos_api',
      env: { ...process.env, DATABASE_URL: 'sqlite+aiosqlite:///./e2e.db', SECRET_KEY: 'e2ekey' },
      stdio: 'ignore',
    },
  );
  procs.push(api);
  server = serveSameOrigin();
}

let server = null;

function shutdown() {
  for (const p of procs) { try { p.kill('SIGKILL'); } catch {} }
  try { server && server.close(); } catch {}
}

(async () => {
  boot();
  await waitFor(API_PORT, '/health');
  await waitFor(WEB_PORT, '/index.html');
  console.log('servers up\n');

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  const errors = [];
  // 401/403/404 are triggered on purpose (RBAC checks, bad barcode, missing
  // customer). Chromium logs those as console errors; they are not defects.
  const EXPECTED = /status of (401|403|404)/;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (EXPECTED.test(t)) return;
    errors.push(`console: ${t.slice(0, 160)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.includes('fonts.g')) errors.push(`reqfail: ${u.slice(0, 90)}`);
  });

  if (process.env.E2E_DEBUG) {
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/')) console.log('   <-', r.status(), r.url().replace(/^https?:\/\/[^/]+/, ''));
    });
  }

  const BASE = `http://127.0.0.1:${WEB_PORT}`;

  /* ---------------------------------------------------------- 1. login */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  ck('redirects to /login', page.url().includes('/login'), page.url());

  await page.fill('input[placeholder="Employee code"]', E2E.spCode);
  await page.fill('input[type="password"]', E2E.spPassword);
  await page.click('button[type=submit]');
  await page.waitForURL('**/billing', { timeout: 15000 });
  ck('SP lands on /billing', page.url().includes('/billing'));

  await page.waitForSelector('text=CART', { timeout: 10000 });

  /* ------------------------------------------------------- 2. scan flow */
  const scan = page.locator('input[placeholder="Scan or type barcode"]');
  await scan.fill(E2E.productBarcode);
  await scan.press('Enter');
  await page.waitForSelector(`text=${E2E.productName}`, { timeout: 10000 });
  ck('scan adds line', await page.isVisible(`text=${E2E.productName}`));

  // totals: 1 x 50 @5% => 52.50
  await page.waitForTimeout(500);
  const grand1 = await page.locator('text=GRAND TOTAL').locator('..').locator('..').innerText();
  ck('grand total 52.50 after 1 unit', grand1.includes('52.50'), grand1.replace(/\n/g, ' ').slice(0, 60));

  // increment qty -> 105.00
  await page.click('button[aria-label="Increase"]');
  await page.waitForTimeout(700);
  const grand2 = await page.locator('text=GRAND TOTAL').locator('..').locator('..').innerText();
  ck('qty 2 -> 105.00', grand2.includes('105.00'), grand2.replace(/\n/g, ' ').slice(0, 60));

  // inter-state toggle -> IGST
  await page.click('text=Intra-state (CGST + SGST)');
  await page.waitForTimeout(700);
  ck('toggled to inter-state', await page.isVisible('text=Inter-state (IGST)'));

  await page.click('text=Inter-state (IGST)'); // back
  await page.waitForTimeout(700);

  /* -------------------------------------------------- 3. bad barcode UX */
  await scan.fill('DOES-NOT-EXIST');
  await scan.press('Enter');
  await page.waitForSelector('text=/No product for barcode/i', { timeout: 8000 });
  ck('bad barcode shows toast', true);
  await page.waitForTimeout(300);

  /* ------------------------------------------------------- 4. checkout */
  await page.click('text=/CHECKOUT ·/');
  await page.waitForSelector('text=Payment complete', { timeout: 15000 });
  ck('checkout succeeds', await page.isVisible('text=Payment complete'));
  const invNo = await page.locator('text=/INV-\\d{8}-\\d{4}/').first().innerText();
  ck('invoice number rendered', /INV-\d{8}-\d{4}/.test(invNo), invNo);

  /* --------------------------------------------- 5. SP guard on /staff */
  await page.goto(`${BASE}/staff`, { waitUntil: 'networkidle' });
  ck('SP blocked from /staff', await page.isVisible('text=Not permitted'));

  /* --------------------------------------------------- 6. SP invoices */
  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=INVOICES', { timeout: 10000 });
  ck('invoice list renders', await page.isVisible(`text=${invNo}`), invNo);

  await page.click(`text=${invNo}`);
  await page.waitForSelector('text=TAX BREAKDOWN', { timeout: 10000 });
  ck('invoice detail opens', await page.isVisible('text=IMMUTABLE'));
  ck('receipt renders', await page.isVisible(`text=${E2E.receiptStoreName}`));

  /* ------------------------------------------------- 7. SP submits return */
  await page.goto(`${BASE}/returns`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=RAISE A RETURN', { timeout: 10000 });
  await page.fill('input[placeholder="Invoice number"]', invNo);
  await page.click('button:has-text("Find")');
  await page.waitForSelector('text=LINE 1', { timeout: 10000 });
  ck('return form opens for invoice', true);

  await page.fill('input[placeholder="prod id"]', E2E.productId);
  await page.fill('input[placeholder="rate"]', E2E.productRate);
  await page.click('button:has-text("Submit Return")');
  await page.waitForSelector('text=RETURN LIFECYCLE', { timeout: 15000 });
  const bodyTxt = await page.textContent('body');
  const retNo = (bodyTxt.match(/RET-\d{8}-\d{4}/) || [''])[0];
  ck('return submitted', /RET-\d{8}-\d{4}/.test(retNo), retNo);
  ck('stepper shows SUBMITTED', await page.isVisible('text=SUBMITTED'));

  /* ---------------------------------------------- 8. logout -> BM login */
  await page.click('aside button[title="Sign out"]');
  await page.waitForURL('**/login', { timeout: 10000 });
  ck('logout returns to /login', page.url().includes('/login'));

  await page.fill('input[placeholder="Employee code"]', E2E.bmCode);
  await page.fill('input[type="password"]', E2E.bmPassword);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  ck('BM lands on /dashboard', page.url().includes('/dashboard'));
  await page.waitForSelector("text=TODAY'S REVENUE", { timeout: 10000 });
  ck('BM dashboard KPIs render', await page.isVisible('text=LOW STOCK'));

  /* ------------------------------------- 9. BM advances + processes return */
  await page.goto(`${BASE}/returns`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=RETURNS', { timeout: 10000 });
  await page.locator(`text=${retNo}`).first().click();
  await page.waitForSelector('text=RETURN LIFECYCLE', { timeout: 10000 });
  ck('BM opens return detail', await page.isVisible('text=ORIGINAL INVOICE'));
  ck('immutable badge shown', await page.isVisible('text=IMMUTABLE'));
  ck('no reversal yet', await page.isVisible('text=/No reversal invoice yet/'));

  await page.click('button:has-text("Mark verified")');
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Mark approved")');
  await page.waitForTimeout(1200);
  ck('reached approved', await page.isVisible('button:has-text("PROCESS RETURN")'));

  await page.click('button:has-text("PROCESS RETURN")');
  await page.waitForSelector('text=/Processed —/', { timeout: 15000 });
  ck('processed banner', true);
  ck('reversal invoice card appears', await page.isVisible('text=is_reverse = TRUE'));
  ck('linked_invoice_id shown', await page.isVisible('text=/linked_invoice_id/'));

  /* ---------------------------------------------------- 10. BM staff page */
  await page.goto(`${BASE}/staff`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=REPORTING HIERARCHY', { timeout: 10000 });
  ck('hierarchy renders', await page.isVisible('text=CREATE MATRIX'));
  // BM may NOT create Sales Person -> locked
  const spLocked = await page.locator('button:has-text("Sales Person")').isDisabled();
  ck('BM: Sales Person option locked', spLocked);
  const smEnabled = !(await page.locator('button:has-text("Sales Manager")').first().isDisabled());
  ck('BM: Sales Manager option enabled', smEnabled);

  /* ------------------------------------------------------- 11. products */
  await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`text=${E2E.productName}`, { timeout: 10000 });
  ck('products render', await page.isVisible(`text=${E2E.productSku}`));
  await page.fill('input[placeholder="Search by name or SKU…"]', 'zzzz');
  await page.waitForTimeout(900);
  ck('empty search state', await page.isVisible('text=/Nothing matches/'));

  /* ---------------------------------------------- 12. session restore */
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector("text=TODAY'S REVENUE", { timeout: 10000 });
  ck('session survives hard reload', page.url().includes('/dashboard'));

  await browser.close();
  shutdown();

  console.log('\n' + '='.repeat(56));
  if (errors.length) {
    console.log(`CONSOLE / PAGE ERRORS (${errors.length}):`);
    [...new Set(errors)].slice(0, 15).forEach((e) => console.log('  ✗ ' + e));
    FAIL.push('console errors');
  } else {
    console.log('No console errors, page errors, or failed requests.');
  }
  console.log('FAILURES:', FAIL.length ? FAIL : 'NONE');
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E CRASHED:', e.message);
  shutdown();
  process.exit(1);
});
