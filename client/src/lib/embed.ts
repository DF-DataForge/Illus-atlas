/**
 * Messages exchanged between the embed iframes (/embed/map, /embed/list) and
 * the host page. The data is public (sales point ids and page heights), so
 * messages are posted with targetOrigin "*".
 */
export const EMBED_MESSAGE = {
  /** list → host: the list iframe's content height in pixels ({ height }). */
  height: "illus-salespoints:height",
  /** host → map: focus a sales point on the map ({ id }); optional, not sent by the app itself. */
  select: "illus-salespoints:select",
} as const;

type EmbedMessageType = (typeof EMBED_MESSAGE)[keyof typeof EMBED_MESSAGE];

export function isEmbedMessage(data: unknown, type: EmbedMessageType): data is { type: string; [key: string]: unknown } {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === type;
}

export const isInIframe = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export function postToParent(message: { type: EmbedMessageType; [key: string]: unknown }) {
  if (isInIframe()) window.parent.postMessage(message, "*");
}
