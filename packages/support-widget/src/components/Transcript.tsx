import { useEffect, useRef } from "react";
import type { InternalMessage } from "../types.js";

interface TranscriptProps {
  greeting: string | null;
  messages: InternalMessage[];
}

export function Transcript({ greeting, messages }: TranscriptProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  return (
    <div className="transcript" ref={ref}>
      {greeting ? (
        <div className="message assistant" key="greeting">
          {greeting}
        </div>
      ) : null}
      {messages.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageItem({ message }: { message: InternalMessage }) {
  if (message.role === "user") {
    return <div className="message user">{message.content}</div>;
  }
  if (message.role === "assistant") {
    return (
      <>
        {message.content || message.pending ? (
          <div className="message assistant">
            {message.content}
            {message.pending ? <span className="pending-cursor" aria-hidden="true" /> : null}
          </div>
        ) : null}
        {message.toolCalls?.map((tc) => (
          <div className="tool-banner" key={tc.id}>
            {describeTool(tc.name)}
          </div>
        ))}
      </>
    );
  }
  return <div className="message system">{message.content}</div>;
}

function describeTool(name: string): string {
  switch (name) {
    case "submit_intake_packet":
      return "Filing your report — we'll be in touch shortly.";
    case "request_human":
      return "Connecting you with a human responder.";
    case "not_a_bug_close":
      return "Marked as a question rather than a bug.";
    default:
      return `Action: ${name}`;
  }
}
