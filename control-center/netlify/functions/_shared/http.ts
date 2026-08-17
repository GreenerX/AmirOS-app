export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function methodNotAllowed(): Response {
  return json({ message: "Method not allowed." }, 405);
}

export function serviceNotConfigured(): Response {
  return json({
    message: "The Control Center storage is not configured yet. This request was not saved.",
    code: "control_center_storage_unavailable",
  }, 503);
}
