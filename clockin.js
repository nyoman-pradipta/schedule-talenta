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
    geolocation: { latitude: LAT, longitude: LNG, accuracy: 15 },
    permissions: ['geolocation'],
    locale: 'id-ID',
    timezoneId: 'Asia/Makassar',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  // Grant permission spesifik untuk origin Talenta
  await context.grantPermissions(['geolocation'], { origin: 'https://hr.talenta.co' });
  await context.grantPermissions(['geolocation'], { origin: 'https://account.mekari.com' });

  // Override navigator.geolocation via JS injection dengan callback async (setTimeout)
  // Sangat penting: React/Vue Promise wrapper membutuhkan callback async agar tidak race-condition!
  await context.addInitScript(({ lat, lng }) => {
    function createPos() {
      return {
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy: 15,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };
    }

    const mockGeo = {
      getCurrentPosition: function(success, error, options) {
        setTimeout(() => {
          if (typeof success === 'function') success(createPos());
        }, 50);
      },
      watchPosition: function(success, error, options) {
        setTimeout(() => {
          if (typeof success === 'function') success(createPos());
        }, 50);
        return 999;
      },
      clearWatch: function() {},
    };

    try {
      Object.defineProperty(navigator, 'geolocation', {
        get: () => mockGeo,
        configurable: true,
      });
    } catch (e) {
      navigator.geolocation = mockGeo;
    }

    if (window.navigator.permissions) {
      const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = function(params) {
        if (params && params.name === 'geolocation') {
          return Promise.resolve({ state: 'granted', onchange: null });
        }
        return origQuery(params);
      };
    }
  }, { lat: LAT, lng: LNG });


  const page = await context.newPage();

  // Listen console logs dari browser
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('error') || msg.text().includes('Attendance')) {
      log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    }
  });

  // Listen semua API response yang berkaitan dengan attendance/clock-in
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('attendance') || url.includes('clock') || url.includes('live') || url.includes('api')) {
      const status = response.status();
      if (status >= 400 || url.includes('clock') || url.includes('attendance')) {
        try {
          const body = await response.text();
          log(`[API RESPONSE ${status}] ${url} => ${body.substring(0, 300)}`);
        } catch (e) {}
      }
    }
  });

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────────
    log('Navigating to Talenta (will redirect to Mekari SSO)...');
    // Buka root URL — Talenta akan redirect ke Mekari SSO login
    await page.goto(TALENTA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Tunggu redirect selesai (Mekari SSO bisa butuh waktu)
    await page.waitForTimeout(3000);
    await saveScreenshot(page, '01-login-page');
    log(`Login page URL: ${page.url()}`);

    // Isi email — coba berbagai selector (Talenta & Mekari SSO)
    log('Filling email...');
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[id="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[name="user[email]"]',
      'input[id="user_email"]',
    ].join(', ');

    await page.waitForSelector(emailSelectors, { timeout: 20000 });
    await page.fill(emailSelectors, EMAIL);

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
      await page.waitForTimeout(4000);
      await saveScreenshot(page, '05-after-clockin');

      // Cek apakah ada dialog / modal konfirmasi (misal: "Submit", "Yes", "Clock In", "OK", "Confirm", dll)
      const modalBtnSelectors = [
        '.modal-dialog button:has-text("Clock In")',
        '.modal button:has-text("Clock In")',
        'button:has-text("Submit")',
        'button:has-text("OK")',
        'button:has-text("Confirm")',
        'button:has-text("Ya")',
        'button:has-text("Iya")',
        'button[class*="confirm"]',
        '.swal2-confirm',
      ];

      for (const modalSel of modalBtnSelectors) {
        const modalBtn = page.locator(modalSel).first();
        if (await modalBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          log(`Modal confirm button found with selector: ${modalSel}, clicking...`);
          await modalBtn.click();
          await page.waitForTimeout(4000);
          await saveScreenshot(page, '06-after-modal-confirm');
          break;
        }
      }

      // Tunggu jaringan idle untuk memastikan API request absensi selesai
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await saveScreenshot(page, '07-final-attendance-status');

      log('Clock In process finished! ✅');
    }

  } catch (err) {
    await saveScreenshot(page, 'ERROR').catch(() => {});
    fail('Script error:', err);
  } finally {
    await browser.close();
  }
})();
