import type { SendTarget } from "../../types.js";

export type ReminderRecord = {
  id: string;
  createdAtMs: number;
  sourceMessageId?: string;
  dueAtMs: number;
  creatorUserId: string;
  creatorChatType: "private" | "group";
  creatorGroupId?: string;
  target: SendTarget;
  mentionUserId?: string;
  text: string;
  status: "pending" | "sending" | "sent" | "canceled";
  claimedAtMs?: number;
  sentAtMs?: number;
  canceledAtMs?: number;
  attempts?: number;
  nextAttemptAtMs?: number;
  lastError?: string;
};
