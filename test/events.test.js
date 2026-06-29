import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isRetryableError, writeStopFailureEvent, readStopFailureEvent, clearStopFailureEvent,
} from '../src/events.js';

describe('isRetryableError', () => {
  it('accepts the retryable overload classes', () => {
    for (const e of ['overloaded', 'server_error', 'rate_limit', 'OVERLOADED']) {
      assert.equal(isRetryableError(e), true, e);
    }
  });
  it('rejects permanent / unknown classes', () => {
    for (const e of ['authentication_failed', 'billing_error', 'invalid_request', '', undefined, null, 42]) {
      assert.equal(isRetryableError(e), false, String(e));
    }
  });
});

describe('StopFailure event markers', () => {
  let dir;
  before(async () => { dir = await mkdtemp(join(tmpdir(), 'car-ev-')); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it('round-trips a pane-keyed marker', async () => {
    await writeStopFailureEvent('%2', { error: 'overloaded', session_id: 'abc' }, dir);
    const ev = await readStopFailureEvent('%2', 60_000, dir);
    assert.equal(ev.error, 'overloaded');
    assert.equal(ev.pane, '%2');
    assert.equal(ev.session_id, 'abc');
    assert.equal(typeof ev.ts, 'number');
  });

  it('sanitizes the pane id into the filename', async () => {
    await writeStopFailureEvent('%7', { error: 'server_error' }, dir);
    const files = await readdir(dir);
    assert.ok(files.includes('_7.json'), files.join(','));
  });

  it('returns null for an absent marker', async () => {
    assert.equal(await readStopFailureEvent('%99', 60_000, dir), null);
  });

  it('treats a marker past maxAge as stale', async () => {
    await writeStopFailureEvent('%3', { error: 'overloaded' }, dir);
    assert.equal(await readStopFailureEvent('%3', -1, dir), null);  // negative age → always stale
  });

  it('ignores an unparseable marker file', async () => {
    await writeFile(join(dir, '_4.json'), 'not json');
    assert.equal(await readStopFailureEvent('%4', 60_000, dir), null);
  });

  it('clear() consumes the marker', async () => {
    await writeStopFailureEvent('%5', { error: 'rate_limit' }, dir);
    await clearStopFailureEvent('%5', dir);
    assert.equal(await readStopFailureEvent('%5', 60_000, dir), null);
  });

  it('write is a no-op without a pane key', async () => {
    assert.equal(await writeStopFailureEvent('', { error: 'overloaded' }, dir), null);
  });
});
