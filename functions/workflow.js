const KEY = 'workflow-state';

function headers() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: headers()
  });
}

function emptyState() {
  return {
    version: 1,
    app: 'DI Procurement Dashboard',
    updatedAt: null,
    workflow: {}
  };
}

function normalize(payload) {
  if (!payload) return {};
  if (payload.workflow && typeof payload.workflow === 'object') return payload.workflow;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  if (typeof payload === 'object') return payload;
  return {};
}

function merge(current = {}, incoming = {}) {
  const merged = { ...current };

  for (const [key, incomingValue] of Object.entries(incoming || {})) {
    const currentValue = merged[key];

    if (!currentValue) {
      merged[key] = incomingValue;
      continue;
    }

    const currentTime = new Date(currentValue.updatedAt || 0).getTime();
    const incomingTime = new Date(incomingValue.updatedAt || 0).getTime();

    merged[key] = incomingTime > currentTime
      ? { ...currentValue, ...incomingValue }
      : { ...incomingValue, ...currentValue };
  }

  return merged;
}

async function readState(env) {
  if (!env.WORKFLOW_KV) return emptyState();

  const saved = await env.WORKFLOW_KV.get(KEY, 'json');
  return saved || emptyState();
}

async function writeState(env, state) {
  if (!env.WORKFLOW_KV) {
    throw new Error('WORKFLOW_KV binding is not configured');
  }

  await env.WORKFLOW_KV.put(KEY, JSON.stringify(state, null, 2));
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: headers() });
}

export async function onRequestGet({ env }) {
  try {
    const state = await readState(env);
    return json(state);
  } catch (error) {
    return json({ error: String(error?.message || error) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const incoming = await request.json();
    const current = await readState(env);

    const next = {
      version: 1,
      app: 'DI Procurement Dashboard',
      updatedAt: new Date().toISOString(),
      workflow: merge(current.workflow || {}, normalize(incoming))
    };

    await writeState(env, next);

    return json({ ok: true, updatedAt: next.updatedAt });
  } catch (error) {
    return json({ error: String(error?.message || error) }, 500);
  }
}
