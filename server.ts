// Vercel server entrypoint: start the shared HTTP server during module initialization.
import server from './server.mjs';
server.listen(process.env.PORT ?? 3000);
