// Netlify Function entry point (Web handler style).
import { handleRequest } from '../../src/handler.mjs';

export default async (request) => {
  let body = null;
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  }

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const result = await handleRequest({ method, path: url.pathname, query, body, headers });

  const responseHeaders = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...result.headers,
  };

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: responseHeaders,
  });
};
