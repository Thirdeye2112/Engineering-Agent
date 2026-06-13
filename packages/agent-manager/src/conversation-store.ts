import Redis from 'ioredis';
import type { Message } from './provider-interface.js';
import { getDb, conversationThreads } from '@consensus/db';
import { eq } from 'drizzle-orm';

export interface ConversationThread {
  id: string;
  agentRole: string;
  deliberationId: string;
  messages: Message[];
}

class ConversationStore {
  private redis: Redis | null = null;
  private readonly TTL = 3600; // 1 hour

  async connect(): Promise<void> {
    const url = process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    if (!url) return; // no Redis configured — use PostgreSQL only
    try {
      this.redis = new Redis(url);
      await this.redis.ping();
    } catch {
      this.redis = null; // fall back to PostgreSQL silently
    }
  }

  async disconnect(): Promise<void> {
    await this.redis?.quit();
  }

  async getThread(id: string): Promise<ConversationThread | null> {
    // Try Redis hot cache first
    if (this.redis) {
      const cached = await this.redis.get(`thread:${id}`);
      if (cached) return JSON.parse(cached);
    }
    // Fall back to PostgreSQL
    const db = getDb();
    const rows = await db.select().from(conversationThreads).where(eq(conversationThreads.id, id));
    if (rows.length === 0) return null;
    const row = rows[0];
    const thread: ConversationThread = {
      id: row.id,
      agentRole: row.agentRole,
      deliberationId: row.deliberationId,
      messages: (row.messages as Message[]) ?? [],
    };
    if (this.redis) {
      await this.redis.setex(`thread:${id}`, this.TTL, JSON.stringify(thread));
    }
    return thread;
  }

  async createThread(id: string, agentRole: string, deliberationId: string): Promise<ConversationThread> {
    const thread: ConversationThread = { id, agentRole, deliberationId, messages: [] };
    const db = getDb();
    await db.insert(conversationThreads).values({
      id,
      agentRole,
      deliberationId,
      messages: [],
    });
    if (this.redis) {
      await this.redis.setex(`thread:${id}`, this.TTL, JSON.stringify(thread));
    }
    return thread;
  }

  async appendExchange(id: string, userMessage: Message, assistantMessage: Message): Promise<void> {
    const thread = await this.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    thread.messages.push(userMessage, assistantMessage);

    const db = getDb();
    await db.update(conversationThreads)
      .set({ messages: thread.messages, updatedAt: new Date() })
      .where(eq(conversationThreads.id, id));

    if (this.redis) {
      await this.redis.setex(`thread:${id}`, this.TTL, JSON.stringify(thread));
    }
  }
}

export const conversationStore = new ConversationStore();
