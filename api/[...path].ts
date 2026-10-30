export default async function handler(req, res) {
  const incoming = new URL(req.url || '/', 'http://localhost');
  const requestedRoute = incoming.searchParams.get('path');
  if (requestedRoute) req.url = requestedRoute;

  // Import the .mjs server at runtime so Node loads it as native ESM.
  const { default: appServer } = await import('../server.mjs');
  appServer.emit('request', req, res);
}
