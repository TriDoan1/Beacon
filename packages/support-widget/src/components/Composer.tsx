import { useEffect, useRef, useState } from "react";

interface ComposerProps {
  disabled: boolean;
  pending: boolean;
  onSend: (text: string) => void;
  onAttach?: () => void;
  attachLabel?: string;
}

export function Composer({ disabled, pending, onSend, onAttach, attachLabel }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled || pending) return;
    onSend(text);
    setValue("");
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="row">
        {onAttach ? (
          <button
            type="button"
            className="icon"
            onClick={onAttach}
            disabled={disabled || pending}
            aria-label={attachLabel ?? "Attach screenshot"}
            title={attachLabel ?? "Attach screenshot"}
          >
            <span aria-hidden="true">📎</span>
          </button>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? "Conversation closed" : "Describe what happened…"}
        />
        <button type="submit" className="send" disabled={disabled || pending || !value.trim()}>
          {pending ? "…" : "Send"}
        </button>
      </div>
      <div className="hint">Press Enter to send · Shift+Enter for newline</div>
    </form>
  );
}
