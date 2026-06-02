export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: 'workflow endpoint ready' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
