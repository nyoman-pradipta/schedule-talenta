/**
 * Auto Clock-In Talenta
 * Login ke hr.talenta.co dan clock in dengan geolocation spoofing.
 *
 * ENV vars (dari GitHub Secrets):
 *   TALENTA_EMAIL      - email login
 *   TALENTA_PASSWORD   - password login
 *   TALENTA_LATITUDE   - latitude koordinat rumah (contoh: -5.1477)
 *   TALENTA_LONGITUDE  - longitude koordinat rumah (contoh: 119.4327)
 *
 * Flags:
 *   --dry-run  - login saja, tidak klik Clock In (untuk testing)
 */

const { chromium } = require('playwright');

// ─── Config ───────────────────────────────────────────────────────────────────
const EMAIL    = process.env.TALENTA_EMAIL;
const PASSWORD = process.env.TALENTA_PASSWORD;
const LAT      = parseFloat(process.env.TALENTA_LATITUDE  || '-5.1477');
const LNG      = parseFloat(process.env.TALENTA_LONGITUDE || '119.4327');
const DRY_RUN  = process.argv.includes('--dry-run');

const TALENTA_URL    = 'https://hr.talenta.co';
const SCREENSHOT_DIR = 'screenshots';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function fail(msg, err) {
  console.error(`[ERROR] ${msg}`, err || '');
  process.exit(1);
}

async function saveScreenshot(page, name) {
  const fs = require('fs');
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);
  const path = `${SCREENSHOT_DIR}/${name}-${Date.now()}.png`;
  await page.screenshot({ path, fullPage: false });
  log(`Screenshot saved: ${path}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Validasi env
  if (!EMAIL || !PASSWORD) {
    fail('TALENTA_EMAIL dan TALENTA_PASSWORD harus diset sebagai environment variable.');
  }

  log(`Mode: ${DRY_RUN ? 'DRY RUN (no clock-in)' : 'LIVE'}`);
  log(`Geolocation: lat=${LAT}, lng=${LNG}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  // Buat context dengan geolocation spoofed
  const context = await browser.newContext({
    geolocation: { latitude: LAT, longitude: LNG, accuracy: 20 },
    permissions: ['geolocation'],
    locale: 'id-ID',
    timezoneId: 'Asia/Makassar',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────────
    log('Navigating to login page...');
    await page.goto(`${TALENTA_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await saveScreenshot(page, '01-login-page');

    // Isi email
    log('Filling email...');
    await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', { timeout: 15000 });
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', EMAIL);

    // Isi password
    log('Filling password...');
    await page.fill('input[type="password"], input[name="password"]', PASSWORD);
    await saveScreenshot(page, '02-credentials-filled');

    // Klik login
    log('Clicking login button...');
    await page.click('button[type="submit"], button:has-text("Login"), button:has-text("Masuk"), input[type="submit"]');

    // Tunggu redirect setelah login
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 30000 });
    log(`Logged in. Current URL: ${page.url()}`);
    await saveScreenshot(page, '03-after-login');

    // ── Step 2: Navigasi ke Live Attendance ───────────────────────────────────
    log('Navigating to Live Attendance...');

    // Coba URL langsung dulu
    await page.goto(`${TALENTA_URL}/live-attendance`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Kalau redirect balik ke dashboard, coba cari menu attendance
    if (page.url().includes('/live-attendance') === false && page.url().includes('/attendance') === false) {
      log('Direct URL failed, trying menu navigation...');
      // Cari menu attendance di sidebar/navbar
      const attendanceMenu = page.locator([
        'a:has-text("Live Attendance")',
        'a:has-text("Attendance")',
        'a:has-text("Absensi")',
        '[href*="live-attendance"]',
        '[href*="attendance"]',
      ].join(', ')).first();

      if (await attendanceMenu.isVisible({ timeout: 5000 })) {
        await attendanceMenu.click();
        await page.waitForLoadState('domcontentloaded');
      }
    }

    await saveScreenshot(page, '04-attendance-page');
    log(`Attendance page URL: ${page.url()}`);

    // ── Step 3: Clock In ──────────────────────────────────────────────────────
    if (DRY_RUN) {
      log('DRY RUN: skipping Clock In click.');
      await saveScreenshot(page, '05-dry-run-done');
    } else {
      log('Looking for Clock In button...');

      // Tunggu halaman settle
      await page.waitForTimeout(3000);

      // Selectors untuk tombol Clock In — urutan prioritas
      const clockInSelectors = [
        'button:has-text("Clock In")',
        'button:has-text("Clock in")',
        'button:has-text("Hadir")',
        'button:has-text("Check In")',
        '[data-testid*="clock-in"]',
        '[class*="clock-in"]',
        'button.btn-clockin',
        // Fallback: tombol dengan teks yang mengandung CI
        'button:has-text("CI")',
      ];

      let clockInBtn = null;
      for (const sel of clockInSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          clockInBtn = el;
          log(`Found Clock In button with selector: ${sel}`);
          break;
        }
      }

      if (!clockInBtn) {
        await saveScreenshot(page, '05-clockin-not-found');
        fail('Tombol Clock In tidak ditemukan! Cek screenshot untuk debug.');
      }

      // Klik Clock In
      await clockInBtn.click();
      log('Clicked Clock In button!');
      await page.waitForTimeout(3000);
      await saveScreenshot(page, '05-after-clockin');

      // Cek apakah ada dialog konfirmasi
      const confirmBtn = page.locator([
        'button:has-text("OK")',
        'button:has-text("Confirm")',
        'button:has-text("Ya")',
        'button:has-text("Iya")',
        'button[class*="confirm"]',
        '.swal2-confirm',
      ].join(', ')).first();

      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        log('Confirmation dialog detected, clicking confirm...');
        await confirmBtn.click();
        await page.waitForTimeout(2000);
        await saveScreenshot(page, '06-after-confirm');
      }

      log('Clock In BERHASIL! ✅');
    }

  } catch (err) {
    await saveScreenshot(page, 'ERROR').catch(() => {});
    fail('Script error:', err);
  } finally {
    await browser.close();
  }
})();
