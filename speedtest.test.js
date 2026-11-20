import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./speedtest.js', import.meta.url));

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { timeout: 10_000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}/file`;
}

test('полностью читает 10 ответов последовательно и правильно считает итог', async (t) => {
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  const url = await serve(t, (req, res) => {
    requests++;
    active++;
    maxActive = Math.max(maxActive, active);
    res.write(Buffer.alloc(1024));
    setTimeout(() => {
      active--;
      res.end(Buffer.alloc(1024));
    }, 20);
  });
  const result = await run([url]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests, 10);
  assert.equal(maxActive, 1);
  assert.match(result.stdout, /Всего скачано: 20480 байт/);
  const total = Number(result.stdout.match(/Суммарное время запросов: ([\d.]+)/)[1]);
  const average = Number(result.stdout.match(/Среднее время запроса: ([\d.]+)/)[1]);
  const speed = Number(result.stdout.match(/Скорость скачивания: ([\d.]+)/)[1]);
  assert.ok(total >= 0.2);
  assert.ok(Math.abs(average - total / 10) < 0.001);
  assert.ok(Math.abs(speed - 20480 / total / 1_000_000) < 0.002);
});

test('останавливается при HTTP-ошибке без итоговой скорости', async (t) => {
  let requests = 0;
  const url = await serve(t, (req, res) => {
    requests++;
    res.writeHead(404).end('Not found');
  });
  const result = await run([url]);
  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.match(result.stderr, /HTTP 404/);
  assert.doesNotMatch(result.stdout, /Скорость скачивания/);
});

test('не принимает оборванное тело за полный ответ', async (t) => {
  const url = await serve(t, (req, res) => {
    res.writeHead(200, { 'Content-Length': '10000' });
    res.write('partial');
    setTimeout(() => res.destroy(), 10);
  });
  const result = await run([url]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Запрос 1\/10/);
  assert.doesNotMatch(result.stdout, /Скорость скачивания/);
});

test('отклоняет пустые ответы', async (t) => {
  const url = await serve(t, (req, res) => res.end());
  const result = await run([url]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /пустой ответ/);
});

test('проверяет аргументы и поддерживает справку', async () => {
  assert.equal((await run([])).code, 1);
  assert.equal((await run(['file:///tmp/file'])).code, 1);
  assert.equal((await run(['not-a-url'])).code, 1);
  assert.equal((await run(['--help'])).code, 0);
});
