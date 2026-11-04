// Two simulated players with a short training time (4 s) and 2 test rounds: both phases, a
// timeout in the test phase, a resume after a reload, then the admin's progress and files.
import { test, expect, type Page, type Frame, type APIRequestContext } from '@playwright/test';

const MOCK = 'http://localhost:54329';
const TRAINING_MS = 4_000;
// Local stand-in admin of tests/mock-supabase.ts (exists only in the mock).
const ADMIN_EMAIL = 'admin@local.test';
const ADMIN_PASSWORD = 'local-test-only';

type Round = {
  study_code: string; nick: string; device: string; country: string; attempt: number; phase: string | null; counted: boolean | null;
  test_index: number | null; outcome: string | null; conditions: Record<string, number>; applied: Record<string, number> | null;
  ended_at: string | null;
};

async function rounds(request: APIRequestContext, nick: string): Promise<Round[]> {
  const all: Round[] = await (await request.get(`${MOCK}/debug/rounds`)).json();
  return all.filter((r) => r.study_code === CODE && r.nick === nick);
}

/** Waits until the server has stored the given attempt (started, or also ended). */
async function waitForAttempt(request: APIRequestContext, nick: string, attempt: number, ended: boolean) {
  await expect
    .poll(async () => (await rounds(request, nick)).find((r) => r.attempt === attempt && (!ended || r.ended_at)), { timeout: 10_000 })
    .toBeTruthy();
}

/** A fresh, open study for this run (so repeated runs never share players). */
async function createStudy(request: APIRequestContext): Promise<{ code: string; title: string }> {
  const auth = await (await request.post(`${MOCK}/auth/v1/token?grant_type=password`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })).json();
  const headers = { apikey: 'sb_publishable_local', authorization: `Bearer ${auth.access_token}` };
  const title = `E2E ${Date.now()}`;
  const st = await (await request.post(`${MOCK}/rest/v1/rpc/mlg_admin_create_study`, {
    headers, data: { p_title: title, p_consent_text: 'Test only.', p_params: { training_seconds: TRAINING_MS / 1000, test_rounds: 2 } },
  })).json();
  await request.post(`${MOCK}/rest/v1/rpc/mlg_admin_set_status`, { headers, data: { p_id: st.id, p_status: 'open' } });
  return { code: st.code, title };
}

let CODE = 'TEST01';

async function join(page: Page, nick: string, sex: 'Female' | 'Male' | "I'd rather not say", age: string | null) {
  await page.goto(`/s/${CODE}`);
  await page.getByLabel('Your nick').fill(nick);
  await page.getByRole('radio', { name: sex, exact: true }).check();
  if (age) await page.getByLabel('Age').fill(age);
  else await page.getByRole('checkbox', { name: "I'd rather not say" }).check();
  await page.getByRole('button', { name: 'Join and start driving' }).click();
}

/** Clicks Start driving and returns the game frame once it has received INIT. */
async function startDriving(page: Page): Promise<Frame> {
  await page.getByRole('button', { name: 'Start driving' }).click();
  let frame: Frame | undefined;
  await expect
    .poll(async () => {
      frame = page.frames().find((f) => f.url().startsWith('http://localhost:8090'));
      return frame ? await frame.evaluate(() => (window as any).isReady()) : false;
    }, { timeout: 10_000 })
    .toBe(true);
  return frame!;
}

const play = (frame: Frame, outcome: string) => frame.evaluate((o) => (window as any).playRound(o), outcome);

test('two players: training, test, a timeout, a resume, then progress and files', async ({ browser, request }) => {
  const study = await createStudy(request);
  CODE = study.code;
  // ---- Player 1: laptop. Two training rounds, then test rounds with a timeout in between. ----
  const laptop = await browser.newContext();
  const p1 = await laptop.newPage();
  await join(p1, 'alice', 'Female', '21');
  await expect(p1.getByText('Drive with the arrow keys')).toBeVisible();
  const g1 = await startDriving(p1);

  // What the app sent the game.
  const init = await g1.evaluate(() => (window as any).received.find((m: any) => m.type === 'INIT').payload);
  expect(init.difficulty.schedule).toHaveLength(80);
  expect(init.difficulty).toMatchObject({ totalRounds: 80, deliveryDistance: 200, malfunctionProbability: 0 });
  expect(init.ui).toMatchObject({ autoStart: true, showRoundTotal: false, showQuitButton: false });
  expect(init.player.nickname).toBe('alice');

  await play(g1, 'delivered');
  await waitForAttempt(request, 'alice', 1, true);
  await play(g1, 'crash_car');
  await waitForAttempt(request, 'alice', 2, true);
  await p1.waitForTimeout(TRAINING_MS + 500); // the training time runs out
  await play(g1, 'delivered'); // test 1
  await waitForAttempt(request, 'alice', 3, true);
  await play(g1, 'timeout'); // test, not counted: replaced by the next round
  await waitForAttempt(request, 'alice', 4, true);
  await expect(p1.getByText('Done, thank you!')).not.toBeVisible();
  await play(g1, 'crash_obstacle'); // test 2: done
  await expect(p1.getByText('Done, thank you! You can close this page now.')).toBeVisible();

  const a = await rounds(request, 'alice');
  expect(a.map((r) => [r.attempt, r.phase, r.counted, r.test_index, r.outcome])).toEqual([
    [1, 'train', true, null, 'delivered'],
    [2, 'train', true, null, 'crash_car'],
    [3, 'test', true, 1, 'delivered'],
    [4, 'test', false, null, 'timeout'],
    [5, 'test', true, 2, 'crash_obstacle'],
  ]);
  expect(a[0]).toMatchObject({ device: 'mouse', country: 'CZ' });
  for (const r of a) expect(r.applied).toEqual(r.conditions); // the game applied what the server drew

  // ---- Player 2: phone. One training round, a reload in the middle of a round, then the test. ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await phone.newPage();
  await join(p2, 'bob', 'Male', null);
  await expect(p2.getByText('Drive with these buttons')).toBeVisible();
  let g2 = await startDriving(p2);
  await play(g2, 'crash_pedestrian');
  await waitForAttempt(request, 'bob', 1, true);
  await g2.evaluate(() => (window as any).startRound()); // round 2 starts...
  await waitForAttempt(request, 'bob', 2, false);
  await p2.reload(); // ...and the page is reloaded in the middle of it

  // Resumed: no join form, the start screen again, and the game continues at attempt 3.
  await expect(p2.getByLabel('Your nick')).not.toBeVisible();
  g2 = await startDriving(p2);
  const resumed = await g2.evaluate(() => (window as any).received.find((m: any) => m.type === 'INIT').payload);
  await p2.waitForTimeout(TRAINING_MS + 500);
  await play(g2, 'delivered'); // attempt 3, test 1
  await waitForAttempt(request, 'bob', 3, true);
  await play(g2, 'crash_car'); // attempt 4, test 2: done
  await expect(p2.getByText('Done, thank you!')).toBeVisible();

  const b = await rounds(request, 'bob');
  expect(b.map((r) => [r.attempt, r.phase, r.test_index, r.outcome])).toEqual([
    [1, 'train', null, 'crash_pedestrian'],
    [2, null, null, null], // interrupted: started, never ended
    [3, 'test', 1, 'delivered'],
    [4, 'test', 2, 'crash_car'],
  ]);
  expect(b[0].device).toBe('touch');
  expect(resumed.difficulty.schedule[0]).toEqual(b[2].conditions); // the resumed schedule starts at attempt 3

  // A reload after the end shows "Done" again.
  await p2.reload();
  await expect(p2.getByText('Done, thank you!')).toBeVisible();

  // ---- The admin: live progress and the class files. ----
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/admin');
  await admin.getByPlaceholder('Email').fill(ADMIN_EMAIL);
  await admin.getByPlaceholder('Password').fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('link', { name: study.title }).click();

  const progress = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Live progress', exact: true }) });
  await expect(progress.getByText('Done', { exact: true }).locator('..')).toContainText('2');
  await expect(progress.getByRole('row', { name: /alice/ })).toContainText('2 / 2');
  await expect(progress.getByRole('row', { name: /bob/ })).toContainText('touch');

  await admin.getByRole('button', { name: 'Prepare files' }).click();
  const files = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Files', exact: true }) });
  await expect(files).toContainText('9 rounds recorded, 2 players joined.');
  await expect(files).toContainText('3 rows in game_train.csv, from 2 players.');
  await expect(files).toContainText('4 rows in game_test.csv, from 2 complete players.');
  await expect(files).toContainText('1 timeouts and breakdowns');
  await expect(files).toContainText('1 rounds interrupted by a reload');

  // The projector page counts the same.
  await admin.goto(`/screen/${CODE}`);
  await expect(admin.getByText('Done', { exact: true }).locator('..')).toContainText('2');
});
