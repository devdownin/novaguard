export * from './types';
export * from './api';
export * from './protocol';
export * from './calendar';
export * from './client/NovaGuardReadApiClient';
export * from './security/authentication';
export * from './security/authorization';
export * from './security/sanitizer';
export * from './security/audit';
export * from './tools';
export * from './resources';
export * from './server';
export * from './transport/httpServer';

// Stdio runner for standard MCP stdio integration when executed directly
if (require.main === module) {
  const { NovaGuardMcpServer } = require('./server');
  const { STDIO_PEER_ADDRESS } = require('./security/authentication');
  const readline = require('readline');

  const server = new NovaGuardMcpServer();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    if (!line.trim()) return;
    try {
      const jsonReq = JSON.parse(line);
      const res = await server.handleJsonRpcRequest(jsonReq, undefined, STDIO_PEER_ADDRESS);
      // `null` is a notification: it carries no id and must never be answered.
      if (!res) return;
      process.stdout.write(JSON.stringify(res) + '\n');
    } catch (err: any) {
      const errRes = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      };
      process.stdout.write(JSON.stringify(errRes) + '\n');
    }
  });
}
