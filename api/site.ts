import appServer from '../server.mjs';

export default function handler(req, res) {
  const incoming = new URL(req.url || '/', 'http://localhost');
  const route = incoming.searchParams.get('path') || '/';
  req.url = route;
  appServer.emit('request', req, res);
}
