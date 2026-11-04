// Serves the stand-in game page for the end-to-end tests (port FAKE_GAME_PORT, default 8090).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./fake-game/index.html', import.meta.url));
const port = Number(process.env.FAKE_GAME_PORT ?? 8090);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}).listen(port, () => console.log(`fake game on http://localhost:${port}/`));
