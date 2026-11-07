# novaguard-relay

Lets claude.ai, ChatGPT and Copilot Studio reach a NovaGuard phone that has opted in. Design and
privacy consequences: [`docs/CONNEXION.md`](../docs/CONNEXION.md) §14.

The phone dials `wss://<relay>/connect`, proves it holds its P-256 key (the Android Keystore's) by signing a challenge, and
is then reachable at `https://<relay>/d/<id>/mcp`. `<id>` is a hash of the key, so nobody can take
another phone's address and the relay keeps no registry.

```bash
npm ci && npm test
PORT=8080 npm start
```

Behind a TLS terminator only. It keeps nothing: logs hold time, device, method, status, size and
duration, never a path, a header or a body. It does see requests and answers in clear, images
included.

| Limit | Value |
| --- | --- |
| Request body | 256 KiB |
| Answer body | 8 MiB |
| Requests per phone | 120 per minute, 8 in flight |
| Wait for the phone | 30 s |
