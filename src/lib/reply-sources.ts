import { z } from "zod";

export const REPLY_SOURCES_ROLE = "reply_sources";
export const replySourcesSchema = z.array(z.object({ id: z.string(), label: z.string() })).max(3);
export type ReplySource = z.infer<typeof replySourcesSchema>[number];

export function replySourceRecordId(replyId: string) {
  return `reply-sources-${replyId}`;
}
