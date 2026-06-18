import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { create_server } from '../src/server.ts';

// The prompts shape the agent; the key property is the deliberate before-done / review-assistant
// ASYMMETRY (the honesty lever for the laundering tension) + that NO prompt grants verdict authority.
async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
    const server = create_server({ env: { bin: 'swarm', cwd: '/tmp' }, root: '/tmp' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await server.connect(st);
    await client.connect(ct);
    return { client, close: async () => { await client.close(); await server.close(); } };
}

function promptText(result: { messages: { content: { type: string; text?: string } }[] }): string {
    return result.messages.map((m) => (m.content.type === 'text' ? m.content.text ?? '' : '')).join('\n');
}

describe('swarm-mcp prompts', () => {
    it('lists the five v0 prompts', async () => {
        const { client, close } = await connect();
        try {
            const names = (await client.listPrompts()).prompts.map((p) => p.name).sort();
            expect(names).toEqual(
                ['swarm_before_done', 'swarm_evidence_rule', 'swarm_finding_candidate', 'swarm_review_assistant', 'swarm_task_briefing'].sort()
            );
        } finally {
            await close();
        }
    });

    it('before_done tells the implementer it may NOT approve its own work', async () => {
        const { client, close } = await connect();
        try {
            const r = (await client.getPrompt({ name: 'swarm_before_done', arguments: { task: 'TASK-x' } })) as {
                messages: { content: { type: string; text?: string } }[];
            };
            const text = promptText(r);
            expect(text).toMatch(/ready for review/i);
            expect(text).toMatch(/may not approve|not approve it|independent reviewer owns/i);
            expect(text).toMatch(/Unverified/);
        } finally {
            await close();
        }
    });

    it('review_assistant tells the reviewer to falsify, not trust, and not to review own work', async () => {
        const { client, close } = await connect();
        try {
            const r = (await client.getPrompt({ name: 'swarm_review_assistant', arguments: { task: 'TASK-x' } })) as {
                messages: { content: { type: string; text?: string } }[];
            };
            const text = promptText(r);
            expect(text).toMatch(/did NOT author|not author/i);
            expect(text).toMatch(/falsify|not a result to trust/i);
            expect(text).toMatch(/do not approve/i);
        } finally {
            await close();
        }
    });

    it('no prompt grants verdict authority (no "approve"/"merge"/"Pass it")', async () => {
        const { client, close } = await connect();
        try {
            for (const p of (await client.listPrompts()).prompts) {
                const args = p.arguments && p.arguments.length > 0 ? { task: 'TASK-x' } : {};
                const r = (await client.getPrompt({ name: p.name, arguments: args })) as {
                    messages: { content: { type: string; text?: string } }[];
                };
                // a prompt may discuss NOT approving, but must never instruct the agent to approve/merge.
                expect(promptText(r)).not.toMatch(/\byou (may|can|should) approve\b|\bmerge it\b/i);
            }
        } finally {
            await close();
        }
    });
});
