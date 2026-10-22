import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeApi } from './api-client.js';
import { createMcpServer } from './server.js';

try {
  const token = process.env.FSB_TOKEN || (await readFile(join(process.env.FSB_DATA_DIR || join(homedir(), '.figma-semantic-bridge'), 'pairing-token'), 'utf8')).trim();
  const server = createMcpServer(new BridgeApi(process.env.FSB_SERVER_URL || 'http://127.0.0.1:4177', token));
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write('Unable to start Figma Semantic Bridge MCP. Start the local server and configure FSB_SERVER_URL plus FSB_DATA_DIR (or FSB_TOKEN).\n');
  process.exitCode = 1;
}
