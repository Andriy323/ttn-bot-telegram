import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { escapeHtml } from '../utils/formatters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let browserInstance = null;
let idleTimer = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 хвилин простою до автозакриття браузера

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(async () => {
    if (browserInstance) {
      console.log("💤 Бот у простої: автоматично закриваємо браузер для вивільнення RAM...");
      await closeBrowser();
    }
  }, IDLE_TIMEOUT_MS);
}

async function getBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  if (!browserInstance || !browserInstance.connected) {
    console.log("🚀 Запуск Chromium для генерації PDF...");
    browserInstance = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions'
      ]
    });
  }
  return browserInstance;
}

export async function generateTtnPdf(data) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  for (const [key, value] of Object.entries(data)) {
    const safeVal = escapeHtml(value);
    html = html.replaceAll(`{{${key}}}`, safeVal);
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: '1-2'
    });
    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
    // Запускаємо таймер вимкнення браузера після завершення генерації
    resetIdleTimer();
  }
}

export async function closeBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browserInstance && browserInstance.connected) {
    await browserInstance.close().catch(console.error);
    browserInstance = null;
  }
}