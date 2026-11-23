export const DEFAULT_CONVERSATION_TITLE = "New conversation";
export const MAX_CONVERSATION_TITLE_LENGTH = 120;

export function titleFromFirstMessage(message: string): string {
  const topic = message.replace(/\s+/g, " ").trim();
  const characters = Array.from(topic);
  if (characters.length <= 64) return topic || DEFAULT_CONVERSATION_TITLE;
  const excerpt = characters.slice(0, 63).join("");
  const boundary = excerpt.lastIndexOf(" ");
  return `${boundary > 35 ? excerpt.slice(0, boundary) : excerpt}…`;
}
