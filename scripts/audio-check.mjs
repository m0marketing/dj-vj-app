import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSession } from '../src/lib/auth.ts';

createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const target = process.env.AUDIO_TEST_URL || 'http://localhost:3032';
const engine = process.env.AUDIO_TEST_ENGINE || 'chromium';
const output = resolve('.playwright-mcp/audio', engine);
const reports = [], errors = [];
let server, browser, page;
await mkdir(output, { recursive: true });
try {
  if (!process.env.AUDIO_TEST_URL) {
    process.env.AUTH_SECRET = randomBytes(32).toString('hex');
    process.env.ACCESS_CODE_HASH = createHash('sha256').update(randomBytes(24)).digest('hex');
    server = spawn('npm', ['run', 'start', '--', '--port', '3032'], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENAI_API_KEY: '', AUTOMATION_DATA_DIR: await mkdtemp(join(tmpdir(), 'djvj-audio-')) },
    });
    let log = '';
    server.stdout.on('data', chunk => { log = (log + chunk).slice(-2000); });
    server.stderr.on('data', chunk => { log = (log + chunk).slice(-2000); });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) throw new Error(log);
      try { if ((await fetch(target + '/login')).ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Audio test server did not start');
  }
  browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await context.addCookies([{ name: 'djvj_session', value: createSession(), url: target, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => {
    window.__audioCheck = { context: null, analyser: null, peak: 0, starts: 0, renderDelay: 0 };
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = async function () {
      const result = await render.call(this);
      if (window.__audioCheck.renderDelay) await new Promise(resolve => setTimeout(resolve, window.__audioCheck.renderDelay));
      return result;
    };
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const analyser = createAnalyser.call(this);
      // The engine's first analyser is after the master limiter, on the destination path.
      window.__audioCheck.context = this;
      window.__audioCheck.analyser ??= analyser;
      return analyser;
    };
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this), start = source.start;
      source.start = function (...args) { window.__audioCheck.starts++; return start.apply(this, args); };
      return source;
    };
    setInterval(() => {
      const meter = window.__audioCheck;
      if (!meter.analyser) return;
      const pcm = new Float32Array(meter.analyser.fftSize);
      meter.analyser.getFloatTimeDomainData(pcm);
      for (const value of pcm) meter.peak = Math.max(meter.peak, Math.abs(value));
    }, 5);
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const record = (scenario, details = {}) => { reports.push({ scenario, ...details }); console.log('Passed:', scenario, JSON.stringify(details)); };
  const stop = async () => {
    await page.getByRole('button', { name: /^■ 全停止/ }).click();
    await page.waitForTimeout(160);
  };
  const measure = async (scenario, trigger, { silent = false, starts, milliseconds = 350 } = {}) => {
    await page.evaluate(() => { window.__audioCheck.peak = 0; window.__audioCheck.starts = 0; });
    await trigger();
    await page.waitForTimeout(milliseconds);
    const result = await page.evaluate(() => ({ peak: window.__audioCheck.peak, starts: window.__audioCheck.starts, state: window.__audioCheck.context.state }));
    assert.equal(result.state, 'running', scenario + ': audio context is not running');
    if (silent) assert.ok(result.peak < 0.001, scenario + ': unexpected output ' + result.peak);
    else assert.ok(result.peak > 0.005, scenario + ': silent output ' + result.peak);
    if (starts !== undefined) assert.equal(result.starts, starts, scenario + ': duplicate or missing trigger');
    record(scenario, result);
  };
  const bank = async name => page.getByRole('tab', { name: 'バンク ' + name, exact: true }).click();
  const pad = name => page.getByRole('grid').getByRole('button', { name: new RegExp('^' + name + ' \\(キー ') });
  await page.goto(target);
  await page.getByRole('button', { name: '▶ スタート', exact: true }).click();
  await pad('Kick').waitFor({ timeout: 90000 });
  await measure('fresh install: real built-in Kick', () => pad('Kick').click(), { starts: 1 });
  await stop();
  await page.evaluate(() => window.__audioCheck.context.suspend());
  await measure('pointer resumes suspended audio', () => pad('Kick').click(), { starts: 1 });
  await stop();
  await page.evaluate(() => window.__audioCheck.context.suspend());
  await measure('pad shortcut resumes suspended audio', () => page.keyboard.press('1'), { starts: 1 });
  await stop();
  await measure('focused pad: Enter', async () => { await pad('Kick').focus(); await page.keyboard.press('Enter'); }, { starts: 1 });
  await stop();
  await measure('focused pad: Space', async () => { await pad('Kick').focus(); await page.keyboard.press('Space'); }, { starts: 1 });
  await stop();
  console.log('Waiting for the full built-in kit and demo tracks…');
  await page.getByText('内蔵音源を準備中です。名前が表示されたパッドから使えます。', { exact: true }).first().waitFor({ state: 'hidden', timeout: 180000 });
  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('dj-vj-app', 1);
    req.onerror = reject;
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction(['samples', 'tracks']);
      const samples = tx.objectStore('samples').count(), tracks = tx.objectStore('tracks').count();
      tx.oncomplete = () => { db.close(); resolve({ samples: samples.result, tracks: tracks.result }); };
      tx.onerror = reject;
    };
  }));
  assert.ok(saved.samples >= 90 && saved.tracks === 3, 'The built-in kit did not finish generating');
  record('full kit and three demo tracks persisted', saved);
  for (const [name, sound] of [['B', 'Hey!'], ['C', 'Loop Kick'], ['D', 'アイーン'], ['E', 'Chorus Lead'], ['F', 'Drop Impact'], ['G', '909 Kick'], ['H', '808 Kick Short']]) {
    await bank(name);
    await measure('bank ' + name + ': ' + sound, () => pad(sound).click(), { starts: 1 });
    await stop();
  }
  await bank('A');
  await measure('gate sounds while held', async () => {
    await pad('Riser').hover();
    await page.mouse.down();
  }, { milliseconds: 1500 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await measure('gate stops on release', async () => {}, { silent: true, starts: 0 });
  await measure('toggle starts', () => pad('Siren').click(), { starts: 1 });
  await pad('Siren').click();
  await page.waitForTimeout(200);
  await measure('toggle stops on second tap', async () => {}, { silent: true, starts: 0 });
  await page.getByLabel('サンプラー音量', { exact: true }).fill('0');
  await page.getByText('サンプラー音量が0です。', { exact: false }).waitFor();
  await page.waitForTimeout(200); // Let the smoothed fader and the analyser's sample window settle.
  await measure('zero volume stays silent', () => pad('Kick').click(), { silent: true });
  await stop();
  await page.getByRole('button', { name: '音量を戻す', exact: true }).click();
  await measure('restore sampler volume', () => pad('Kick').click(), { starts: 1 });
  await stop();
  await page.getByLabel('マスターボリューム', { exact: true }).fill('0');
  await page.getByText('マスター音量が0です。', { exact: false }).waitFor();
  await page.waitForTimeout(200);
  await measure('master zero volume stays silent', () => pad('Kick').click(), { silent: true });
  await stop();
  await page.getByRole('button', { name: '音量を戻す', exact: true }).click();
  await measure('restore master volume', () => pad('Kick').click(), { starts: 1 });
  await stop();
  await page.getByRole('button', { name: '🥁 Drum', exact: true }).click();
  await page.getByRole('button', { name: 'house', exact: true }).first().click();
  await page.evaluate(() => window.__audioCheck.context.suspend());
  await measure('drum sequencer resumes and outputs audio', () => page.getByRole('button', { name: '▶ 再生', exact: true }).first().click());
  await stop();
  await page.getByRole('button', { name: /^Tropical Sunrise .* を Deck B に$/ }).click();
  await page.getByRole('button', { name: '再生', exact: true }).last().waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button[aria-label="再生"]')).some(button => !button.disabled));
  await page.locator('h1').first().click();
  await page.evaluate(() => window.__audioCheck.context.suspend());
  await measure('deck playback recovers after suspension', () => page.keyboard.press('Space'), { milliseconds: 1300 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  await bank('C');
  await pad('Loop Kick').click({ button: 'right' });
  await page.getByRole('radio', { name: 'Loop', exact: true }).click();
  await page.getByRole('button', { name: '完了', exact: true }).click();
  await page.evaluate(() => { window.__audioCheck.renderDelay = 800; });
  await measure('released loop does not start after slow tempo matching', async () => {
    await pad('Loop Kick').click();
  }, { silent: true, starts: 0, milliseconds: 1400 });
  await measure('stop all cancels a pending tempo-matched pad', async () => {
    await pad('Loop Hats').click();
    await stop();
  }, { silent: true, starts: 0, milliseconds: 1400 });
  await page.evaluate(() => { window.__audioCheck.renderDelay = 0; });
  await page.reload();
  await page.getByRole('button', { name: '▶ スタート', exact: true }).click();
  await pad('Kick').waitFor({ timeout: 90000 });
  await measure('saved kit outputs after reload', () => pad('Kick').click(), { starts: 1 });
  await stop();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Pads', exact: true }).click();
  await page.evaluate(() => window.__audioCheck.context.suspend());
  await measure('mobile touch resumes and plays', () => pad('Kick').tap(), { starts: 1 });
  await stop();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout overflows');
  await page.screenshot({ path: join(output, 'mobile-sampler.png'), fullPage: true });
  record('mobile sampler layout fits');
  // Corrupt only this disposable browser's sample: one bad file must not block the studio.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('dj-vj-app', 1);
    req.onerror = reject;
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('samples', 'readwrite'), store = tx.objectStore('samples');
      const all = store.getAll();
      all.onsuccess = () => { const kick = all.result.find(s => s.name === 'Kick'); store.put({ ...kick, blob: { format: 'djvj-blob-v1', data: new TextEncoder().encode('invalid audio').buffer, type: 'audio/wav' } }); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject;
    };
  }));
  await page.reload();
  await page.getByRole('button', { name: '▶ スタート', exact: true }).click();
  await page.getByRole('tab', { name: 'Pads', exact: true }).click();
  await pad('Snare').waitFor({ timeout: 90000 });
  await measure('one corrupt sample does not block other pads or startup', () => pad('Snare').tap(), { starts: 1 });
  await stop();
  await pad('Kick').tap();
  await page.getByText('このパッドの音源を読み込めませんでした。「編集」から音源を再割り当てしてください。', { exact: true }).waitFor();
  record('unreadable pad explains how to recover');
  assert.deepEqual(errors, [], 'Unexpected browser exceptions');
  console.log('Audio checks passed:', reports.length, target, engine);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  console.error(errors.at(-1));
  if (page) {
    try {
      await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText({ timeout: 5000 }));
      await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, timeout: 5000 });
    } catch { /* Keep the original failure if the page is unavailable. */ }
  }
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ target, engine, reports, errors }, null, 2));
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* stopped */ } }
}
