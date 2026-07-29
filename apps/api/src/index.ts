import { Hono } from 'hono';

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
  return c.json({
    name: 'Clutch API',
    status: 'ok',
    tagline: 'Knowledge earns the attempt. Skill wins the game.',
  });
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
  });
});

app.get('/api/tournaments/:slug', async (c) => {
  const slug = c.req.param('slug');
  return c.json({
    slug,
    message: 'Tournament endpoint ready. Connect D1 to return real data.',
  });
});

export default app;
