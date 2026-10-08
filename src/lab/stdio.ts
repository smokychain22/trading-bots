import { once } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';
import type { DotLabGateway } from './gateway.js';
import { dotMcpReply } from './mcp.js';

/** Private MCP stdio transport for a governed tunnel runner. No public listener or broker executor. */
export async function runDotStdio(gateway: DotLabGateway, input: Readable, output: Writable) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const send = async (value: unknown) => {
    if (!output.write(JSON.stringify(value) + '\n')) await once(output, 'drain');
  };
  const line = async (text: string) => {
    if (Buffer.byteLength(text) > 16 * 1024) throw new Error('DOT_RPC_INPUT_TOO_LARGE');
    try {
      const reply = await dotMcpReply(gateway, JSON.parse(text));
      if (reply !== null) await send(reply);
    } catch {
      await send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
    }
  };
  for await (const chunk of input) {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      await line(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
    if (Buffer.byteLength(pending) > 16 * 1024) throw new Error('DOT_RPC_INPUT_TOO_LARGE');
  }
  pending += decoder.end();
  if (pending.trim()) await line(pending);
}
