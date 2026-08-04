import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "../types";

type ChatMediaProps = {
  message: ChatMessage;
};

export function ChatMedia({ message }: ChatMediaProps) {
  const [failed, setFailed] = useState(false);
  const source = message.mediaUrl;
  if (!source || failed) {
    return <span className="media-unavailable">Media preview unavailable</span>;
  }

  if (message.type === "image" || message.type === "sticker") {
    return <img className={message.type === "sticker" ? "chat-sticker" : "chat-image"} src={source} alt={message.body === "Media message" ? "WhatsApp image" : message.body} loading="lazy" onError={() => setFailed(true)} />;
  }
  if (message.type === "video" || message.type === "gif") {
    return <video className="chat-video" src={source} controls preload="metadata" onError={() => setFailed(true)}><track kind="captions" /></video>;
  }
  if (message.type === "ptt" || message.type === "audio") {
    return <span className="chat-audio"><Music2 size={18} /><audio src={source} controls preload="metadata" onError={() => setFailed(true)} /></span>;
  }
  if (message.type === "document") {
    return <a className="chat-document" href={source} target="_blank" rel="noreferrer"><FileText size={22} /><span><strong>Open document</strong><small>WhatsApp attachment</small></span></a>;
  }
  return <a className="chat-document" href={source} target="_blank" rel="noreferrer"><ImageIcon size={22} /><span><strong>Open media</strong><small>WhatsApp attachment</small></span></a>;
}
