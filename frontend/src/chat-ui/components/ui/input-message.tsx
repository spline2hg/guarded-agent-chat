import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/chat-ui/lib/utils";
import { fontWeights } from "@/chat-ui/lib/font-weight";
import { spring } from "@/chat-ui/lib/springs";
import { useShape } from "@/chat-ui/lib/shape-context";
import { surfaceClasses } from "@/chat-ui/lib/surface-classes";
import { SurfaceProvider } from "@/chat-ui/lib/surface-context";
import { useIcon } from "@/chat-ui/lib/icon-context";
import { Button } from "@/chat-ui/components/ui/button";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface InputMessageProps extends HTMLAttributes<HTMLDivElement> {
  /** Controlled textarea value. */
  value: string;
  /** Called with the new value on every textarea change. */
  onValueChange: (value: string) => void;
  /** Fired when the user submits (Enter or the send button). Receives the
   *  trimmed value. */
  onSend?: (value: string) => void;
  /** Placeholder text shown when the value is empty. */
  placeholder?: string;
  /** Content rendered in the bottom-left action area. */
  leftSlot?: ReactNode;
  /** Content rendered in the bottom-right action area, before the send button. */
  rightSlot?: ReactNode;
  /** Disables the textarea and send button. */
  disabled?: boolean;
  /** Minimum visible rows before the textarea grows. */
  minRows?: number;
  /** Maximum visible rows before the textarea starts to scroll. */
  maxRows?: number;
  /** When false, clicking the surrounding container won't refocus the textarea. */
  clickToFocus?: boolean;
  /** Accessible label for the send button. */
  sendLabel?: string;
  /** Previously-sent messages, oldest first. When the textarea is focused,
   * ArrowUp (caret on the first line) recalls the previous one and walks
   * backward through history; ArrowDown (caret on the last line) walks forward
   * toward the in-progress draft. */
  history?: string[];
}

// ─── InputMessage ─────────────────────────────────────────────────────────

const InputMessage = forwardRef<HTMLDivElement, InputMessageProps>(
  (
    {
      value,
      onValueChange,
      onSend,
      placeholder = "Ask me anything…",
      leftSlot,
      rightSlot,
      disabled,
      minRows = 1,
      maxRows = 8,
      clickToFocus = true,
      sendLabel = "Send",
      history = [],
      className,
      style,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    const ArrowUpIcon = useIcon("arrow-up");

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [focusVisible, setFocusVisible] = useState(false);
    const [hovered, setHovered] = useState(false);

    // Sent-message history navigation (readline-style). `historyIndex` is null
    // when not browsing; `draftBeforeHistory` stashes the in-progress text so
    // ArrowDown past the newest entry restores it.
    const [historyIndex, setHistoryIndex] = useState<number | null>(null);
    const draftBeforeHistory = useRef("");

    // Parsed line-height, cached per textarea element — getComputedStyle on
    // every keystroke is needless work when the value only changes with font
    // or zoom changes.
    const lineHeightCache = useRef<{ el: HTMLTextAreaElement; value: number } | null>(null);

    useIsoLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      let cache = lineHeightCache.current;
      if (!cache || cache.el !== el) {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        cache = { el, value: Number.isNaN(lineHeight) ? 20 : lineHeight };
        lineHeightCache.current = cache;
      }
      const min = cache.value * minRows;
      const max = cache.value * maxRows;
      const next = Math.min(Math.max(el.scrollHeight, min), max);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }, [value, minRows, maxRows]);

    const trimmed = value.trim();
    const canSend = !disabled && trimmed.length > 0;

    // Edge = the box-shadow's 1px ring, recoloured in place per state so the
    // stroke gains contrast without ever appearing to thicken. Applied inline
    // (not via a Tailwind `shadow-*` utility, which mangles multi-layer
    // arbitrary values) with the precedence focus > hover; when none are
    // active, the className's `shadow-surface-2` supplies the resting edge.
    const EDGE_DROP = "0 1px 1px -0.5px var(--shadow-color)";
    const edgeShadow = focusVisible
      ? `0 0 0 1px color-mix(in oklab, var(--foreground) 20%, transparent), ${EDGE_DROP}`
      : hovered && clickToFocus && !disabled
        ? `0 0 0 1px var(--border), ${EDGE_DROP}`
        : undefined;

    const handleSend = useCallback(() => {
      if (!canSend) return;
      setHistoryIndex(null);
      onSend?.(trimmed);
    }, [canSend, onSend, trimmed]);

    const setCaretEnd = useCallback(() => {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    }, []);

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return;

        // Readline-style history. Only plain ArrowUp/ArrowDown navigate (no
        // modifiers), and only when the caret is on the first/last line so
        // multi-line editing still works normally.
        if (
          history.length > 0 &&
          (e.key === "ArrowUp" || e.key === "ArrowDown") &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          !e.ctrlKey
        ) {
          const el = e.currentTarget;
          const caret = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? caret;
          if (e.key === "ArrowUp" && !value.slice(0, caret).includes("\n")) {
            const start = historyIndex == null ? history.length : historyIndex;
            if (start > 0) {
              e.preventDefault();
              if (historyIndex == null) draftBeforeHistory.current = value;
              const ni = start - 1;
              setHistoryIndex(ni);
              onValueChange(history[ni]);
              setCaretEnd();
            }
            return;
          }
          if (
            e.key === "ArrowDown" &&
            historyIndex != null &&
            !value.slice(end).includes("\n")
          ) {
            e.preventDefault();
            const ni = historyIndex + 1;
            if (ni >= history.length) {
              setHistoryIndex(null);
              onValueChange(draftBeforeHistory.current);
            } else {
              setHistoryIndex(ni);
              onValueChange(history[ni]);
            }
            setCaretEnd();
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [history, value, historyIndex, onValueChange, setCaretEnd, handleSend]
    );

    const handleContainerMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!clickToFocus || disabled) return;
        const target = e.target as HTMLElement;
        if (target === textareaRef.current) return;
        if (
          target.closest(
            'button, a, input, select, textarea, [contenteditable], [role="button"]'
          )
        ) {
          return;
        }
        e.preventDefault();
        textareaRef.current?.focus();
      },
      [clickToFocus, disabled]
    );

    return (
      <div
        ref={ref}
        onMouseDown={handleContainerMouseDown}
        className={cn(
          // The edge is the box-shadow's hairline ring (from surface-2), not a
          // border. State changes recolor that same 1px ring in place rather
          // than layering a second colored border beside it.
          "flex flex-col gap-1 border border-border p-2 transition-[box-shadow,color] duration-80",
          surfaceClasses(2, 2),
          shape.container,
          clickToFocus && !disabled && "cursor-text",
          disabled && "opacity-50 pointer-events-none",
          className
        )}
        style={edgeShadow ? { boxShadow: edgeShadow, ...style } : style}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        {...props}
      >
        <SurfaceProvider value={2}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              // Real typing exits history mode (recall sets the value
              // programmatically, which doesn't fire onChange).
              setHistoryIndex(null);
              onValueChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              if (e.target.matches(":focus-visible")) setFocusVisible(true);
            }}
            onBlur={() => setFocusVisible(false)}
            placeholder={placeholder}
            disabled={disabled}
            rows={minRows}
            aria-label="Message"
            className={cn(
              "w-full resize-none border-0 bg-transparent outline-none",
              "text-[14px] leading-5 text-foreground placeholder:text-muted-foreground",
              "px-2 py-2"
            )}
            style={{ fontVariationSettings: fontWeights.normal }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">{leftSlot}</div>
            <div className="flex items-center gap-1.5 shrink-0">
              {rightSlot}
              <Button
                type="button"
                variant="primary"
                size="icon-sm"
                onClick={handleSend}
                disabled={!canSend}
                aria-label={sendLabel}
              >
                <motion.span
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={spring.fast}
                  className="flex items-center justify-center leading-none"
                >
                  <ArrowUpIcon
                    size={19}
                    className="block !h-[19px] !w-[19px]"
                  />
                </motion.span>
              </Button>
            </div>
          </div>
        </SurfaceProvider>
      </div>
    );
  }
);

InputMessage.displayName = "InputMessage";

export { InputMessage };
export type { InputMessageProps };
export default InputMessage;
