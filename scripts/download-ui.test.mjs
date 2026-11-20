import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

test('download progress, manual save, timeout recovery and logout cleanup', async () => {
  const statuses = [], blobs = [], revoked = [];
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, clicks: 0,
      set textContent(value) { if (id === 'status') statuses.push(value); },
      addEventListener() {}, replaceChildren() {}, focus() {},
      click() { this.clicks++; }, removeAttribute(name) { delete this[name]; },
    });
    return elements.get(id);
  }
  const testKey = await webcrypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const iv = new Uint8Array(12);
  const plaintext = new TextEncoder().encode('PK zip fixture');
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, testKey, plaintext));
  const encrypted = new Uint8Array(iv.length + ciphertext.length);
  encrypted.set(iv); encrypted.set(ciphertext, iv.length);
  const context = createContext({
    document: { getElementById: element }, crypto: webcrypto, Blob, AbortSignal,
    TextEncoder, TextDecoder, Uint8Array,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL(url) { revoked.push(url); } },
    fetch: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encrypted.slice(0, 16)); controller.enqueue(encrypted.slice(16)); controller.close();
    } })),
    testKey, testFolder: { name: 'fixture', id: 'fixture.bin', bytes: plaintext.length },
  });
  runInContext(readFileSync(new URL('../site/app.js', import.meta.url), 'utf8'), context);
  await runInContext('key = testKey; save(testFolder)', context);
  assert.ok(statuses.some(status => status.startsWith('Загружаю fixture.zip:')));
  assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()), plaintext);
  assert.equal(element('save-zip').hidden, false);
  assert.equal(element('save-zip').download, 'fixture.zip');
  assert.equal(element('save-zip').clicks, 1);
  const successfulFetch = context.fetch;
  context.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
  await runInContext('save(testFolder)', context);
  assert.match(statuses.at(-1), /слишком долго/);
  assert.equal(element('save-zip').hidden, true);
  assert.ok(revoked.includes('blob:test'));
  context.fetch = successfulFetch;
  await runInContext('save(testFolder)', context);
  assert.equal(element('save-zip').hidden, false);
  runInContext("$('lock').onclick()", context);
  assert.equal(element('save-zip').hidden, true);
  assert.equal(element('save-zip').href, undefined);
});
