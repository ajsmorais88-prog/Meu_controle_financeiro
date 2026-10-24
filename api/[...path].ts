import appServer from '../server.mjs';

export default function handler(req, res) {
  appServer.emit('request', req, res);
}
