export type ChatType = "private" | "group";

export type MessageSegment =
  | { type: "text"; data: { text: string } }
  | { type: "at"; data: { qq: string } }
  | { type: string; data: Record<string, unknown> };

export type OneBotMessageEvent = {
  post_type: "message";
  time: number;
  self_id: number;
  message_type: ChatType;
  sub_type?: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message?: MessageSegment[] | string | unknown;
  raw_message?: string;
  font?: number;
  sender?: Record<string, unknown>;
};

export type ChatEvent = {
  platform: "napcatqq";
  chatType: ChatType;
  messageId: string;
  userId: string;
  groupId?: string;
  replyToMessageId?: string;
  segments: MessageSegment[];
  text: string;
  timestampMs: number;
  raw: unknown;
};

export type SendTarget =
  | { chatType: "private"; userId: string }
  | { chatType: "group"; groupId: string };

export type SendMessage = {
  target: SendTarget;
  text: string;
  replyToMessageId?: string;
};

