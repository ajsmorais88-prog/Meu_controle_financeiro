import appServer from '../server.mjs';

export default function handler(req, res) {
  const incoming = new URL(req.url || '/', 'http://localhost');
  const requestedRoute = incoming.searchParams.get('path');
  if (requestedRoute) req.url = requestedRoute;
  appServer.emit('request', req, res);
}
