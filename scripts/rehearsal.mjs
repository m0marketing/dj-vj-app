import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSession } from '../src/lib/auth.ts';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd());
const target = process.env.REHEARSAL_URL || 'http://localhost:3031';
const output = resolve('.playwright-mcp/rehearsal');
const errors = [];
const reports = [];
let server;
let browser;
await mkdir(output, { recursive: true });
try {
  if (!process.env.REHEARSAL_URL) {
    // Ephemeral credentials and storage belong only to this test server.
    process.env.AUTH_SECRET = randomBytes(32).toString('hex');
    process.env.ACCESS_CODE_HASH = createHash('sha256').update(randomBytes(24)).digest('hex');
    const data = await mkdtemp(join(tmpdir(), 'djvj-rehearsal-'));
    server = spawn('npm', ['run', 'start', '--', '--port', '3031'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENAI_API_KEY: '', AUTOMATION_DATA_DIR: data, AUTOMATION_TOKEN: '', MCP_CALLBACK_HOSTS: '' },
      detached: true,
    });
    let startupLog = '';
    server.stdout.on('data', (chunk) => { startupLog = (startupLog + chunk).slice(-2000); });
    server.stderr.on('data', (chunk) => { startupLog = (startupLog + chunk).slice(-2000); });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (server.exitCode !== null) throw new Error('検証サーバーの起動に失敗しました。\n' + startupLog);
      try { const response = await fetch(target + '/login', { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) throw new Error('検証サーバーの起動待ちがタイムアウトしました。');
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const unauthenticated = await context.request.get(target + '/rehearsal', { maxRedirects: 0 });
  if (![302, 303, 307, 308].includes(unauthenticated.status())) throw new Error('検証画面の認証を確認できませんでした。');
  await context.addCookies([{ name: 'djvj_session', value: createSession(), url: target, httpOnly: true, sameSite: 'Lax' }]);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(target + '/rehearsal');
    await page.getByRole('button', { name: '自動リハーサル開始', exact: true }).click();
    const status = page.getByTestId('rehearsal-status');
    await page.locator('[data-testid="rehearsal-status"][data-complete="true"]').waitFor({ timeout: 45000 });
    const failed = Number(await status.getAttribute('data-failed'));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '結果JSONを保存', exact: true }).click();
    await (await download).saveAs(join(output, `${name}-checks.json`));
    if (failed) throw new Error(`${name}: ${await status.innerText()}`);
    await page.getByRole('button', { name: 'ディープ', exact: true }).click();
    if (await page.getByTestId('rehearsal-look').innerText() !== 'ディープ') throw new Error('場面切替に失敗しました。');
    await page.getByRole('button', { name: 'DevDay キーノート', exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error(`${name}: 横方向にはみ出しています。`);
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    reports.push({ viewport: name, width, height, status: await status.innerText(), failed });
    await page.close();
  }
  if (server) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(target);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('dj-vj-app', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('tracks', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        db.createObjectStore('samples', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        db.createObjectStore('pads', { keyPath: 'index' });
        db.createObjectStore('settings');
      };
      req.onerror = reject;
      req.onsuccess = () => {
        const db = req.result, tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put(true, 'seeded'); tx.objectStore('settings').put(8, 'kitVersion');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject;
      };
    }));
    await page.getByRole('button', { name: '▶ スタート', exact: true }).click();
    await page.getByRole('button', { name: '▶ スタート', exact: true }).waitFor({ state: 'hidden' });
    const panel = page.locator('details').filter({ has: page.locator('summary', { hasText: 'イベント連携・自動リハーサル' }) });
    await panel.locator('summary').click();
    await panel.getByText('保存: file', { exact: false }).waitFor();
    await panel.getByLabel('件名', { exact: true }).fill('検証用の進行変更');
    await panel.getByLabel('内容', { exact: true }).fill('通知先なしの隔離テスト');
    await panel.getByRole('button', { name: 'イベントを記録・通知', exact: true }).click();
    await panel.getByText('イベントを保存しました。', { exact: false }).waitFor();
    await panel.getByRole('button', { name: 'イベントを記録・通知', exact: true }).click();
    await panel.getByText('保存済みのイベントです。', { exact: false }).waitFor();
    const state = await (await context.request.get(target + '/api/automation')).json();
    if (state.events.length !== 1) throw new Error('イベントが重複登録されました。');
    if (!(await panel.getByRole('button', { name: 'Agentsで開始', exact: true }).isDisabled())) throw new Error('API未設定でAgentsを開始できます。');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(output, 'automation-mobile.png'), fullPage: true });
    const box = await panel.boundingBox();
    if (box.x + box.width > 390) throw new Error('イベント連携パネルがモバイル画面からはみ出しています。');
    reports.push({ scenario: 'event panel and real local API', status: 'passed', duplicateEvents: 0 });

    const mockState = { ...state, agentsConfigured: true, runs: [] };
    let simulated;
    await page.route('**/api/automation', (route) => route.fulfill({ json: mockState }));
    await page.route('**/api/automation/rehearsal**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: simulated });
      const input = route.request().postDataJSON();
      if (input.action === 'start') {
        mockState.runs = [{ id: input.id, state: 'running', sessionId: 'mock-session' }];
        simulated = { id: input.id, state: 'requires_action', output: '', activity: [], turns: [], required: [{ requestId: 'approval', type: 'browser_origin_access', origin: 'https://studio.example', reason: '検証画面に接続', canApprove: true }] };
        return route.fulfill({ json: { id: input.id, state: 'running' } });
      }
      if (input.action === 'approve') {
        simulated = { ...simulated, state: 'idle', output: 'モックの画面操作が完了しました。', required: [], turns: [{ id: 'turn', status: 'completed' }] };
        return route.fulfill({ json: { accepted: true } });
      }
      if (input.action === 'delete') { mockState.runs = []; return route.fulfill({ json: { deleted: true } }); }
      return route.fulfill({ status: 400, json: { error: 'unsupported mock action' } });
    });
    await panel.getByRole('button', { name: '状態を再取得', exact: true }).click();
    await panel.getByRole('button', { name: 'Agentsで開始', exact: true }).click();
    await panel.getByRole('button', { name: 'この接続を許可', exact: true }).click();
    await panel.getByText('モックの画面操作が完了しました。', { exact: true }).waitFor();
    const result = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Agents結果JSONを保存', exact: true }).click();
    await (await result).saveAs(join(output, 'mock-agent-result.json'));
    await panel.getByRole('button', { name: '停止・セッション削除', exact: true }).click();
    await panel.getByText('Agentsセッションの削除を要求しました。', { exact: true }).waitFor();
    reports.push({ scenario: 'Agents panel with mocked API', status: 'passed', stages: ['start', 'approval', 'result', 'download', 'delete'] });
    await page.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`リハーサル成功。結果: ${output}`);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  console.error(errors.at(-1));
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ at: new Date().toISOString(), target, reports, errors }, null, 2));
  await browser?.close();
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}
