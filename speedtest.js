import { performance } from 'node:perf_hooks';

const REQUEST_COUNT = 10;
const TIMEOUT_MS = 30_000;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Запуск: node speedtest.js <http(s) URL>');
    return;
  }
  if (args.length !== 1) {
    throw new Error('Укажите один URL. Запуск: node speedtest.js <http(s) URL>');
  }
  const url = new URL(args[0]);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Поддерживаются только HTTP и HTTPS.');
  }

  let totalBytes = 0;
  let totalSeconds = 0;

  for (let i = 1; i <= REQUEST_COUNT; i++) {
    const start = performance.now();
    let bytes = 0;
    try {
      const response = await fetch(url, {
        headers: {
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      // fetch автоматически распаковывает сжатый ответ. Не выдаём
      // размер распакованных данных за объём скачивания.
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding.toLowerCase().trim() !== 'identity') {
        await response.body?.cancel();
        throw new Error(`Сервер прислал сжатый ответ (${encoding}), несмотря на Accept-Encoding: identity.`);
      }
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
        }
      }
      if (bytes === 0) throw new Error('Получен пустой ответ; выберите URL файла.');
    } catch (error) {
      throw new Error(`Запрос ${i}/${REQUEST_COUNT}: ${error.message}`, { cause: error });
    }
    const seconds = (performance.now() - start) / 1000;
    totalBytes += bytes;
    totalSeconds += seconds;
    console.log(`Запрос ${i}/${REQUEST_COUNT}: ${bytes} байт, ${seconds.toFixed(3)} с`);
  }

  console.log(`\nВсего скачано: ${totalBytes} байт`);
  console.log(`Среднее время запроса: ${(totalSeconds / REQUEST_COUNT).toFixed(3)} с`);
  console.log(`Суммарное время запросов: ${totalSeconds.toFixed(3)} с`);
  console.log(`Скорость скачивания: ${(totalBytes / totalSeconds / 1_000_000).toFixed(3)} МБ/с`);
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
