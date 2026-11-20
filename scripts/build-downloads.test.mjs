import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, pbkdf2Sync, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './build-downloads.mjs';

test('only committed files are archived; catalog and nested ZIPs require the password', async () => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'downloads-test-'));
  try {
    process.chdir(root);
    const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
    git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    mkdirSync('site'); writeFileSync('site/index.html', 'public shell');
    mkdirSync('project/вложенная', { recursive: true });
    writeFileSync('project/вложенная/code.txt', 'PRIVATE SOURCE');
    writeFileSync('root.txt', 'root file');
    git('add', '.'); git('commit', '-m', 'fixture');
    writeFileSync('untracked-secret.txt', 'DO NOT INCLUDE');
    mkdirSync('runner/site', { recursive: true });
    writeFileSync('runner/site/index.html', 'public shell');
    process.chdir(join(root, 'runner'));
    assert.throws(() => build('weak'), /12 characters/);
    const password = 'test-only-password-123456789';
    const manifest = build(password, 'dist', root);
    const config = JSON.parse(readFileSync('dist/config.json'));
    const key = pbkdf2Sync(password, Buffer.from(config.salt, 'base64'), config.iterations, 32, 'sha256');
    const decrypt = (file, secret = key) => {
      const bytes = readFileSync(`dist/data/${file}`);
      const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
    };
    assert.deepEqual(JSON.parse(decrypt('catalog.bin')), manifest);
    assert.throws(() => decrypt('catalog.bin', Buffer.alloc(32)));
    const browserKey = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    const catalogBytes = readFileSync('dist/data/catalog.bin');
    assert.equal(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: catalogBytes.subarray(0, 12) }, browserKey, catalogBytes.subarray(12))).toString(), decrypt('catalog.bin').toString());
    const nested = manifest.folders.find(f => f.path === 'project/вложенная');
    assert.equal(nested.files, 1);
    writeFileSync('nested.zip', decrypt(nested.id));
    writeFileSync('all.zip', decrypt(manifest.folders.find(f => !f.path).id));
    execFileSync('python3', ['-c', "import zipfile; n=zipfile.ZipFile('nested.zip'); assert n.namelist()==['вложенная/','вложенная/code.txt']; assert n.read('вложенная/code.txt')==b'PRIVATE SOURCE'; a=zipfile.ZipFile('all.zip'); assert 'roboticslib/root.txt' in a.namelist(); assert not any('untracked-secret' in x or '/.git/' in x for x in a.namelist())"]);
    const tampered = readFileSync(`dist/data/${nested.id}`); tampered[15] ^= 1;
    writeFileSync('dist/data/tampered.bin', tampered);
    assert.throws(() => decrypt('tampered.bin'));
    assert.ok(readdirSync('dist/data').every(f => f.endsWith('.bin')));
  } finally { process.chdir(original); rmSync(root, { recursive: true, force: true }); }
});
