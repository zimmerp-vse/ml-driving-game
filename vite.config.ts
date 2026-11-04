import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

// In development, serve /api/join from api/join.ts (on Vercel it is a function).
// The country header is simulated with DEV_COUNTRY (default CZ).
function devJoinApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-join-api',
    configureServer(server) {
      server.middlewares.use('/api/join', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule('/api/join.ts');
        const request = new Request('http://localhost/api/join', {
          method: req.method,
          headers: { 'content-type': 'application/json', 'x-vercel-ip-country': env.DEV_COUNTRY ?? 'CZ' },
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        });
        const response: Response = await mod.handleJoin(request, env);
        res.statusCode = response.status;
        res.setHeader('content-type', 'application/json');
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: { port: 5173 },
    plugins: [react(), devJoinApi(env)],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  };
});
