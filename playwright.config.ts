// End-to-end tests (app_spec section 10): the real app in a real browser, against the local
// stand-in database (tests/mock-supabase.ts) and a stand-in game (tests/e2e/fake-game) that the
// test steers round by round. Run: npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

const MOCK_PORT = 54329;
const GAME_PORT = 8090;
const APP_PORT = 5179;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npx vite-node tests/mock-supabase.ts',
      port: MOCK_PORT,
      reuseExistingServer: false,
      env: { MOCK_PORT: String(MOCK_PORT), MOCK_PARAMS: '{"training_seconds": 4, "test_rounds": 2}' },
    },
    {
      command: 'node tests/e2e/serve-fake-game.mjs',
      port: GAME_PORT,
      reuseExistingServer: false,
      env: { FAKE_GAME_PORT: String(GAME_PORT) },
    },
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: `http://localhost:${MOCK_PORT}`,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local',
        SUPABASE_URL: `http://localhost:${MOCK_PORT}`,
        SUPABASE_SECRET_KEY: 'sb_secret_local',
        VITE_GAME_URL: `http://localhost:${GAME_PORT}/`,
        DEV_COUNTRY: 'CZ',
      },
    },
  ],
});
