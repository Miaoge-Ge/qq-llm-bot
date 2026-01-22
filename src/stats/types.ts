export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type StatsScope = {
  date: string;
  chatType: "private" | "group";
  userId: string;
  groupId?: string;
};

export type DailyUserStats = {
  date: string;
  chatType: "private" | "group";
  userId: string;
  groupId?: string;

  llmCalls: number;
  llmPromptTokens: number;
  llmCompletionTokens: number;
  llmTotalTokens: number;

  visionCalls: number;
  visionPromptTokens: number;
  visionCompletionTokens: number;
  visionTotalTokens: number;

  toolCalls: number;
  toolCallsByName: Record<string, number>;
};

