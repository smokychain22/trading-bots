import { z } from 'zod';
import type { DotLabGateway } from './gateway.js';
import { callDotReadTool, dotReadTools } from './read-tools.js';

/** Shared read-only RPC core for authenticated HTTP and owner-controlled private stdio. */
export async function dotMcpReply(gateway: DotLabGateway, input: unknown) {
  const rpc = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number().int()]).optional(),
    method: z.string(), params: z.record(z.string(), z.unknown()).optional() }).strict().parse(input);
  if (rpc.method.startsWith('notifications/') && rpc.id === undefined) return null;
  if (rpc.id === undefined) throw new Error('DOT_RPC_ID_REQUIRED');
  let result: unknown;
  if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} },
    serverInfo: { name: 'dot-strategy-lab-read-only', version: '1.0.0' } };
  else if (rpc.method === 'tools/list') result = { tools: dotReadTools() };
  else if (rpc.method === 'ping') result = {};
  else if (rpc.method === 'tools/call') {
    const params = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }).strict().parse(rpc.params);
    try {
      const data = await callDotReadTool(gateway, params.name, params.arguments);
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false };
    } catch {
      result = { content: [{ type: 'text', text: 'DOT_READ_TOOL_FAILED_OR_FORBIDDEN' }], isError: true };
    }
  } else return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } };
  return { jsonrpc: '2.0', id: rpc.id, result };
}
