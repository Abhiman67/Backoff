import { z } from "zod";

export const MAX_CHAT_ATTACHMENTS = 3;
export const chatAttachmentIds = z.array(z.string().min(1).max(128)).max(MAX_CHAT_ATTACHMENTS);
export type ChatAttachment = { id: string; name: string };
