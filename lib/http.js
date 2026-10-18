export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const fail = (status, message) => json({ error: message }, status);

export async function readJson(request) {
  try {
    const v = await request.json();
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export const can = (auth, ...roles) => roles.includes(auth.role);
