// Two simulated players play freely (data contract v07): the bar and Menu between rounds, the
// check-in after 10 rounds, "I'm done", a timeout, a resume after a reload; then the admin's
// progress, a release with its preview, the team page and the projector.
import { test, expect, type Page, type Frame, type APIRequestContext } from '@playwright/test';

const MOCK = 'http://localhost:54329';
// Local stand-in admin of tests/mock-supabase.ts (exists only in the mock).
const ADMIN_EMAIL = 'admin@local.test';
const ADMIN_PASSWORD = 'local-test-only';

type Round = {
  study_code: string; nick: string; device: string; country: string; attempt: number; counted: boolean | null;
  outcome: string | null; conditions: Record<string, number>; applied: Record<string, number> | null;
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
    headers, data: { p_title: title, p_consent_text: 'Test only.', p_params: { test_rounds: 2, min_rounds: 3 } },
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

test('two players play freely, say they are done, then progress, a release and the team page', async ({ browser, request }) => {
  const study = await createStudy(request);
  CODE = study.code;
  // ---- Player 1: laptop. Ten rounds with a timeout, the check-in, one more round, Menu, done. ----
  const laptop = await browser.newContext();
  const p1 = await laptop.newPage();
  await join(p1, 'alice', 'Female', '21');
  await expect(p1.getByText('Drive with the arrow keys')).toBeVisible();
  const g1 = await startDriving(p1);

  // What the app sent the game.
  const init = await g1.evaluate(() => (window as any).received.find((m: any) => m.type === 'INIT').payload);
  expect(init.difficulty.schedule).toHaveLength(100);
  expect(init.difficulty).toMatchObject({ totalRounds: 100, deliveryDistance: 200, malfunctionProbability: 0, safeFinish: true });
  expect(init.ui).toMatchObject({ autoStart: true, showRoundTotal: false, showQuitButton: false, timeRing: true });
  expect(init.player.nickname).toBe('alice');

  const outcomes = ['delivered', 'crash_car', 'delivered', 'timeout', 'crash_obstacle', 'delivered', 'delivered', 'crash_car', 'delivered', 'delivered'];
  for (let i = 0; i < outcomes.length; i++) {
    await play(g1, outcomes[i]);
    await waitForAttempt(request, 'alice', i + 1, true);
    if (i === 0) await expect(p1.getByText('1 round ·')).toBeVisible(); // the bar between rounds
  }
  // After 10 rounds the menu opens by itself.
  await expect(p1.getByText('Thank you for playing 10 rounds!')).toBeVisible();
  await p1.getByRole('button', { name: 'Keep driving' }).click();
  await expect(p1.getByText('Thank you for playing')).not.toBeVisible();
  await play(g1, 'crash_pedestrian');
  await waitForAttempt(request, 'alice', 11, true);
  await p1.getByRole('button', { name: 'Menu' }).click();
  await expect(p1.getByText('Your game so far')).toBeVisible();
  await p1.getByRole('button', { name: "I'm done" }).click();
  await expect(p1.getByText('Done, thank you! You can close this page now.')).toBeVisible();
  await expect(p1.getByText('Rounds', { exact: true }).locator('..')).toContainText('11');

  const a = await rounds(request, 'alice');
  expect(a.map((r) => [r.attempt, r.counted, r.outcome])).toEqual([
    [1, true, 'delivered'], [2, true, 'crash_car'], [3, true, 'delivered'], [4, false, 'timeout'],
    [5, true, 'crash_obstacle'], [6, true, 'delivered'], [7, true, 'delivered'], [8, true, 'crash_car'],
    [9, true, 'delivered'], [10, true, 'delivered'], [11, true, 'crash_pedestrian'],
  ]);
  expect(a[0]).toMatchObject({ device: 'keyboard', country: 'CZ' });
  for (const r of a) expect(r.applied).toEqual(r.conditions); // the game applied what the server drew

  // ---- Player 2: phone. One round, a reload in the middle of a round, two more, done. ----
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
  await play(g2, 'delivered');
  await waitForAttempt(request, 'bob', 3, true);
  // With 2 counted rounds the menu asks for at least 3.
  await p2.getByRole('button', { name: 'Menu' }).click();
  await expect(p2.getByText('please play at least 3 rounds')).toBeVisible();
  await p2.getByRole('button', { name: 'Keep driving' }).click();
  await play(g2, 'crash_car');
  await waitForAttempt(request, 'bob', 4, true);
  await p2.getByRole('button', { name: 'Menu' }).click();
  await expect(p2.getByText('please play at least')).not.toBeVisible();
  await p2.getByRole('button', { name: "I'm done" }).click();
  await expect(p2.getByText('Done, thank you!')).toBeVisible();

  const b = await rounds(request, 'bob');
  expect(b.map((r) => [r.attempt, r.counted, r.outcome])).toEqual([
    [1, true, 'crash_pedestrian'],
    [2, null, null], // interrupted: started, never ended
    [3, true, 'delivered'],
    [4, true, 'crash_car'],
  ]);
  expect(b[0].device).toBe('touch');
  expect(resumed.difficulty.schedule[0]).toEqual(b[2].conditions); // the resumed schedule starts at attempt 3

  // A reload after the end shows "Done" again, with the numbers.
  await p2.reload();
  await expect(p2.getByText('Done, thank you!')).toBeVisible();
  await expect(p2.getByText('Delivered', { exact: true }).locator('..')).toContainText('1');

  // ---- The admin: live progress, a release with its preview. ----
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/admin');
  await admin.getByPlaceholder('Email').fill(ADMIN_EMAIL);
  await admin.getByPlaceholder('Password').fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('link', { name: study.title }).click();

  const progress = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Live progress', exact: true }) });
  await expect(progress.getByText('Done', { exact: true }).locator('..')).toContainText('2');
  await expect(progress.getByText('3+ counted rounds', { exact: true }).locator('..')).toContainText('2');
  await expect(progress.getByRole('row', { name: /alice/ })).toContainText('done');
  await expect(progress.getByRole('row', { name: /bob/ })).toContainText('touch');

  const releases = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Data releases', exact: true }) });
  await releases.getByRole('button', { name: 'Prepare a release' }).click();
  // alice: 10 counted rounds, bob: 3; the last 2 of each are the test.
  await expect(releases).toContainText('2 players in game_test.csv (4 rows), 0 only in game_train.csv');
  await expect(releases).toContainText('9 rows in game_train.csv.');
  await expect(releases).toContainText('1 timeouts, 1 unfinished');
  await releases.getByRole('button', { name: 'Release to students' }).click();
  await expect(releases.getByRole('row', { name: /latest/ })).toContainText('9 train, 4 test');

  // The team page has release 1.
  await admin.goto(`/s/${CODE}/submit`);
  await expect(admin.getByText('Data release 1')).toBeVisible();

  // The projector page counts the same.
  await admin.goto(`/screen/${CODE}`);
  await expect(admin.getByText('Done', { exact: true }).locator('..')).toContainText('2');
  await expect(admin.getByText('3+ rounds', { exact: true }).locator('..')).toContainText('2');
});
