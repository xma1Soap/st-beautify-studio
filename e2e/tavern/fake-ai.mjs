// A stand-in AI for the real-SillyTavern checks: an OpenAI-compatible endpoint that answers with replies queued by the
// test, and keeps every request it got (so a test can see what SillyTavern sent the AI: world book, variables, rules).
import http from 'node:http';

const json = (res, body, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/**
 * Starts it on 127.0.0.1:`port`. `queue` holds the next replies (taken from the front); an empty queue answers with a
 * short note. `requests` is every chat request body, oldest first.
 */
export function startFakeAi(port = 8790) {
  const queue = [];
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let body = '';
    for await (const c of req) body += c;
    if (req.method === 'GET' && url.pathname.endsWith('/models')) return json(res, { object: 'list', data: [{ id: 'fake-model', object: 'model', owned_by: 'e2e' }] });
    if (url.pathname.endsWith('/chat/completions')) {
      let b = {};
      try {
        b = JSON.parse(body || '{}');
      } catch {}
      requests.push(b);
      const content = queue.length ? queue.shift() : '（假 AI：测试没给这一轮准备回复）';
      const created = Math.floor(Date.now() / 1000);
      if (b.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        // a few pieces, like a real stream
        const parts = content.match(/[\s\S]{1,40}/g) ?? [''];
        for (const p of parts) res.write(`data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      return json(res, {
        id: 'e2e',
        object: 'chat.completion',
        created,
        model: 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    json(res, { error: 'not found' }, 404);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}/v1`, queue, requests, close: () => new Promise((r) => server.close(r)) }));
  });
}
