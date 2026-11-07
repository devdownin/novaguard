import { createRelay } from './relay.js';

const port = Number(process.env.PORT ?? 8080);
const relay = createRelay({ log: entry => console.log(JSON.stringify(entry)) });
relay.server.listen(port, () => console.log(JSON.stringify({ ts: Date.now(), event: 'listening', port })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => relay.close().then(() => process.exit(0)));
