import assert from 'node:assert/strict';
import { compileModules } from '../helpers/compile.mjs';
import test from 'node:test';
const { analyticsEventResponse, api } = await compileModules(`
  export { analyticsEventResponse } from './workers/api/src/diagnostics/analytics';
  export { default as api } from './workers/api/src/index';`);
const ctx = { waitUntil() {} };

function recordingAnalytics() {
  const points = [];
  return {
    points,
    ANALYTICS: {
      writeDataPoint(event) {
        points.push(event);
      },
    },
  };
}

test('analytics events record the action with an anonymous visitor id', async () => {
  const { points, ANALYTICS } = recordingAnalytics();
  const first = await analyticsEventResponse(
    new Request('https://example.test/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'played-snake' }),
    }),
    { ANALYTICS },
    ctx,
  );
  assert.equal(first.status, 204);
  assert.match(first.headers.get('set-cookie') ?? '', /^ttc_aid=/);
  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[0], 'played-snake');
  const visitor = points[0].blobs[1];
  assert.match(visitor, /^[0-9a-f-]{36}$/i);

  // The cookie issued by the first request joins the next event to the same
  // visitor, and no further cookie is set.
  const cookie = first.headers.get('set-cookie') ?? '';
  const second = await analyticsEventResponse(
    new Request('https://example.test/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'tracked-streetcar' }),
    }),
    { ANALYTICS },
    ctx,
  );
  assert.equal(second.status, 204);
  assert.equal(second.headers.get('set-cookie'), null);
  assert.equal(points[1].blobs[1], visitor);
});

test('analytics rejects unknown actions, bad bodies and missing bindings', async () => {
  for (const [body, status, error] of [
    [JSON.stringify({ action: 'definitely-not-an-action' }), 422, 'unknown-action'],
    ['not json', 400, 'invalid-body'],
  ]) {
    const { ANALYTICS } = recordingAnalytics();
    const response = await analyticsEventResponse(
      new Request('https://example.test/api/v1/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      { ANALYTICS },
      ctx,
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, error);
  }
  const disabled = await analyticsEventResponse(
    new Request('https://example.test/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'located' }),
    }),
    {},
    ctx,
  );
  assert.equal(disabled.status, 404);
});

test('event endpoint is routed under /api/v1/event', async () => {
  const { ANALYTICS } = recordingAnalytics();
  const response = await api.fetch(
    new Request('https://example.test/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'located' }),
    }),
    { ANALYTICS },
    ctx,
  );
  assert.equal(response.status, 204);
});
