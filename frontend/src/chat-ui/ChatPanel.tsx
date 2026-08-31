/**
 * ChatPanel — the agent chat column, adapted from the emit workspace chat.
 * Owns one SSE turn at a time: guard verdicts, tool calls, reasoning and tool
 * results land inside collapsible thinking blocks; the final answer streams
 * in as Markdown below them. Every tool_complete also surfaces as a guard-log
 * entry via `onGuardEntry`.
 */

import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Zap } from 'lucide-react';
import { InputMessage } from '@/chat-ui/components/ui/input-message';
import { ChatMessage } from '@/chat-ui/components/ui/chat-message';
import {
    ThinkingSteps,
    ThinkingStepsHeader,
    ThinkingStepsContent,
    ThinkingStep,
    ThinkingStepDetails,
} from '@/chat-ui/components/ui/thinking-steps';
import type { StepStatus } from '@/chat-ui/components/ui/thinking-steps';
import type { IconName } from '@/chat-ui/lib/icon-context';
import { streamChat, ApiError } from '@/api';
import { MessageSquarePlus } from 'lucide-react';
import type {
    AttackPrompt,
    GuardEntry,
    SessionInfo,
    SSEEvent,
    ToolCompleteData,
} from '@/types';

/** localStorage key holding the chat transcript across visits/reloads. */
const CHAT_HISTORY_KEY = 'gac_chat_history';

/** Braille spinner frames — a classic terminal-style "work in progress" dot. */
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Animate the braille dots while `active`; freezes (returns '') otherwise. */
function useBrailleSpinner(active: boolean): string {
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setFrame((n) => n + 1), 90);
        return () => window.clearInterval(timer);
    }, [active]);
    return active ? BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length] : '';
}

// Persisted shape — same as Message, guaranteed by construction below.
interface StoredMessage {
    id: string;
    text: string;
    from: 'user' | 'assistant';
    thinkingSteps?: ThinkingStepData[];
}

function loadStoredMessages(): StoredMessage[] | null {
    try {
        const raw = localStorage.getItem(CHAT_HISTORY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredMessage[];
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch {
        return null;
    }
}

function storeMessages(list: Message[]): void {
    try {
        if (list.length === 0) localStorage.removeItem(CHAT_HISTORY_KEY);
        else localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(list));
    } catch {
        /* storage unavailable — transcript just won't persist */
    }
}

interface ThinkingStepData {
    id: string;
    icon: IconName;
    label: string;
    description?: string;
    status: StepStatus;
    details?: string[];
    detailSummary?: string;
}

interface Message {
    id: string;
    text: string;
    from: 'user' | 'assistant';
    thinkingSteps?: ThinkingStepData[];
}

interface ChatPanelProps {
    session: SessionInfo | null;
    /** Assistant greeting shown once the session is ready. */
    welcome: string;
    /** Connection/boot failure text; shown instead of the greeting. */
    bootError?: string | null;
    attacks: AttackPrompt[];
    /** Optional sink for guard verdicts (guard log, telemetry, …). */
    onGuardEntry?: (entry: GuardEntry) => void;
    /** Fired once per finished turn (success or failure). */
    onTurnComplete?: () => void;
}

function toolIcon(name: string): IconName {
    if (name.includes('sql') || name.includes('query') || name.includes('database')) return 'database';
    if (name.includes('search')) return 'search';
    return 'brain';
}

// Pretty-print the guard/tool result payload as indented JSON.
function formatResult(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function guardEntryFrom(data: ToolCompleteData): GuardEntry {
    return {
        id: crypto.randomUUID(),
        query: data.query,
        blocked: data.blocked,
        rule: data.rule,
        reasoning: data.reasoning,
        layer: data.layer,
        kind: data.kind,
        rowCount: data.blocked
            ? undefined
            : data.kind === 'write'
              ? data.rowcount
              : (data.rows?.length ?? 0),
    };
}

// Fold a tool_complete payload into the finished shape of its thinking step:
// the summary line carries the verdict, the details carry the guard's
// reasoning and the raw tool result.
function completeStep(step: ThinkingStepData, data: ToolCompleteData): ThinkingStepData {
    const count = data.kind === 'write' ? (data.rowcount ?? 0) : (data.rows?.length ?? 0);
    const rows = data.kind === 'write' ? 'affected' : 'returned';

    const summary = data.blocked
        ? `Blocked — ${data.rule}`
        : `Allowed — ${count} row${count === 1 ? '' : 's'} ${rows}`;

    const details = [
        `Layer: ${data.layer ?? 'unknown'}`,
        data.reasoning ? `Reasoning: ${data.reasoning}` : null,
        formatResult({
            kind: data.kind,
            columns: data.columns,
            rows: data.rows,
            rowcount: data.rowcount,
            truncated: data.truncated,
        }),
    ].filter((line): line is string => line !== null);

    return {
        ...step,
        status: 'complete',
        detailSummary: summary,
        details,
    };
}

export function ChatPanel({ session, welcome, bootError, attacks, onGuardEntry, onTurnComplete }: ChatPanelProps) {
    const [value, setValue] = useState('');
    const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages() ?? []);
    const [thinking, setThinking] = useState(false);
    const [statusLine, setStatusLine] = useState<string | null>(null);
    const [currentSteps, setCurrentSteps] = useState<ThinkingStepData[]>([]);
    const [streamingText, setStreamingText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sentHistory, setSentHistory] = useState<string[]>([]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const streamingRef = useRef(false);
    const welcomeShownRef = useRef(false);
    // id of the just-sent user message: scroll it to the top of the viewport.
    const pendingScrollRef = useRef<string | null>(null);
    // Stick-to-bottom only while the user is already near the bottom; the
    // send-scroll pins the new message to the top, so streaming must not
    // yank the view down until the user chooses to follow.
    const nearBottomRef = useRef(true);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    };

    // Seed the greeting once the session is live — but only when there is no
    // restored transcript to show.
    useEffect(() => {
        if (!session || welcomeShownRef.current) return;
        welcomeShownRef.current = true;
        setMessages((previous) =>
            previous.length > 0
                ? previous
                : [{ id: crypto.randomUUID(), text: welcome, from: 'assistant' }],
        );
    }, [session, welcome]);

    // Persist the transcript after every settled change.
    useEffect(() => {
        if (!thinking) storeMessages(messages);
    }, [messages, thinking]);

    const startNewChat = () => {
        if (streamingRef.current) return;
        welcomeShownRef.current = true;
        setMessages([{ id: crypto.randomUUID(), text: welcome, from: 'assistant' }]);
        setError(null);
        setSentHistory([]);
        nearBottomRef.current = true;
    };

    // Pin the just-sent user message to the top of the viewport (once its
    // element exists), so the tool calls and answer land directly in view.
    useEffect(() => {
        const pending = pendingScrollRef.current;
        if (!pending) return;
        pendingScrollRef.current = null;
        const frame = requestAnimationFrame(() => {
            const container = scrollRef.current;
            const target = container?.querySelector<HTMLElement>(`[data-mid="${pending}"]`);
            if (!container || !target) return;
            const top =
                target.getBoundingClientRect().top - container.getBoundingClientRect().top;
            container.scrollTo({ top: Math.max(0, container.scrollTop + top - 12), behavior: 'smooth' });
            nearBottomRef.current = false;
        });
        return () => cancelAnimationFrame(frame);
    }, [messages]);

    // Follow the stream only when the user is near the bottom.
    useEffect(() => {
        const el = scrollRef.current;
        if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
    }, [messages, currentSteps, streamingText, statusLine]);

    const send = async (text: string) => {
        const message = text.trim();
        if (!message || !session || streamingRef.current) return;

        streamingRef.current = true;
        setValue('');
        setError(null);
        setThinking(true);
        setStatusLine(null);
        setCurrentSteps([]);
        setStreamingText('');
        setSentHistory((prev) => [...prev, message]);
        const userMessageId = crypto.randomUUID();
        pendingScrollRef.current = userMessageId;
        setMessages((previous) => [
            ...previous,
            { id: userMessageId, text: message, from: 'user' },
        ]);

        let answer = '';
        let failure: string | null = null;
        let liveSteps: ThinkingStepData[] = [];

        const updateSteps = (next: ThinkingStepData[]) => {
            liveSteps = next;
            setCurrentSteps(next);
        };

        const handleEvent = (event: SSEEvent) => {
            if (event.event === 'thinking') {
                setStatusLine(event.status_message || 'Thinking…');
                return;
            }

            if (event.event === 'tool_start') {
                const name = event.data.tool || 'run_sql';
                updateSteps([
                    ...liveSteps,
                    {
                        id: crypto.randomUUID(),
                        icon: toolIcon(name),
                        label: name,
                        description: event.data.query,
                        status: 'active',
                        details: undefined,
                        detailSummary: undefined,
                    },
                ]);
                return;
            }

            if (event.event === 'tool_complete') {
                const data = event.data;
                setStatusLine(null);
                onGuardEntry?.(guardEntryFrom(data));
                const index = liveSteps.findIndex((step) => step.status === 'active');
                if (index === -1) return;
                const next = [...liveSteps];
                next[index] = completeStep(next[index], data);
                updateSteps(next);
                return;
            }

            if (event.event === 'token') {
                answer += event.data.content;
                setStreamingText(answer);
            } else if (event.event === 'complete') {
                answer = event.data.content || answer;
                setStreamingText(answer);
            } else if (event.event === 'error') {
                failure = event.data.detail || 'The agent failed to answer';
                setError(failure);
            }
        };

        try {
            for await (const event of streamChat(session.session_id, message)) {
                handleEvent(event);
            }
            if (failure) throw new Error(failure);
            setMessages((previous) => [
                ...previous,
                {
                    id: crypto.randomUUID(),
                    text: answer || 'The agent did not return an answer.',
                    from: 'assistant',
                    thinkingSteps:
                        liveSteps.length > 0
                            ? liveSteps.map((step) => ({ ...step, status: 'complete' as const }))
                            : undefined,
                },
            ]);
        } catch (caught) {
            const messageText =
                caught instanceof ApiError || caught instanceof Error
                    ? caught.message
                    : 'Chat request failed';
            setError(messageText);
            setMessages((previous) => [
                ...previous,
                {
                    id: crypto.randomUUID(),
                    text: `Unable to answer: ${messageText}`,
                    from: 'assistant',
                    thinkingSteps:
                        liveSteps.length > 0
                            ? liveSteps.map((step) => ({ ...step, status: 'complete' as const }))
                            : undefined,
                },
            ]);
        } finally {
            streamingRef.current = false;
            setThinking(false);
            setStatusLine(null);
            setCurrentSteps([]);
            setStreamingText('');
            onTurnComplete?.();
        }
    };

    const inputDisabled = !session || thinking;
    const bootBraille = useBrailleSpinner(!session && !bootError);

    return (
        <div className="chat-ui relative flex min-h-0 w-full flex-1 flex-col">
            <button
                type="button"
                onClick={startNewChat}
                disabled={thinking}
                title="Start a fresh chat"
                aria-label="Start a new chat"
                className="new-chat-btn"
            >
                <MessageSquarePlus size={14} />
                <span>New chat</span>
            </button>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide"
                >
                    <div className="mx-auto flex max-w-4xl flex-col justify-start gap-2 py-2">
                        {messages.length === 0 && !thinking && (
                            <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
                                {bootError ? (
                                    <p className="max-w-md text-center text-sm">{bootError}</p>
                                ) : (
                                    <>
                                        <span className="font-mono text-2xl leading-none" aria-hidden="true">
                                            {bootBraille}
                                        </span>
                                        <p className="text-sm">Backend is starting up — this can take up to a minute.</p>
                                    </>
                                )}
                            </div>
                        )}

                        {messages.map((message) => (
                            <div key={message.id} data-mid={message.id} className="flex flex-col">
                                <ChatMessage from={message.from}>
                                {message.from === 'assistant' ? (
                                    <div className="flex flex-col gap-2">
                                        {message.thinkingSteps && message.thinkingSteps.length > 0 && (
                                            <ThinkingSteps defaultOpen={false} className="w-full max-w-sm">
                                                <ThinkingStepsHeader>Thinking</ThinkingStepsHeader>
                                                <ThinkingStepsContent>
                                                    {message.thinkingSteps.map((step, index) => (
                                                        <ThinkingStep
                                                            key={step.id}
                                                            icon={step.icon}
                                                            label={step.label}
                                                            description={step.description}
                                                            status={step.status}
                                                            isLast={index === message.thinkingSteps!.length - 1}
                                                        >
                                                            {step.details?.length && step.detailSummary && (
                                                                <ThinkingStepDetails
                                                                    summary={step.detailSummary}
                                                                    details={step.details}
                                                                />
                                                            )}
                                                        </ThinkingStep>
                                                    ))}
                                                </ThinkingStepsContent>
                                            </ThinkingSteps>
                                        )}
                                        <div className="chat-prose prose prose-sm dark:prose-invert max-w-none whitespace-normal">
                                            <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                                        </div>
                                    </div>
                                ) : (
                                    message.text
                                )}
                                </ChatMessage>
                            </div>
                        ))}

                        {thinking && (
                            <ChatMessage from="assistant">
                                <div className="flex flex-col gap-2">
                                    {currentSteps.length > 0 && (
                                        <ThinkingSteps defaultOpen className="w-full max-w-sm">
                                            <ThinkingStepsHeader>
                                                <span className="shimmer">Thinking</span>
                                            </ThinkingStepsHeader>
                                            <ThinkingStepsContent>
                                                {currentSteps.map((step, index) => (
                                                    <ThinkingStep
                                                        key={step.id}
                                                        icon={step.icon}
                                                        label={step.label}
                                                        description={step.description}
                                                        status={step.status}
                                                        isLast={index === currentSteps.length - 1}
                                                    >
                                                        {step.details?.length && step.detailSummary && (
                                                            <ThinkingStepDetails
                                                                summary={step.detailSummary}
                                                                details={step.details}
                                                            />
                                                        )}
                                                    </ThinkingStep>
                                                ))}
                                            </ThinkingStepsContent>
                                        </ThinkingSteps>
                                    )}
                                    {streamingText ? (
                                        <div className="chat-prose prose prose-sm dark:prose-invert max-w-none whitespace-normal">
                                            <Markdown remarkPlugins={[remarkGfm]}>{streamingText}</Markdown>
                                        </div>
                                    ) : currentSteps.length === 0 ? (
                                        <span className="shimmer">{error || statusLine || 'Thinking…'}</span>
                                    ) : null}
                                </div>
                            </ChatMessage>
                        )}
                    </div>
                </div>

                <div className="mx-auto w-full max-w-4xl shrink-0 px-3 pb-3">
                    <InputMessage
                        value={value}
                        onValueChange={setValue}
                        onSend={(text) => void send(text)}
                        disabled={inputDisabled}
                        placeholder={session ? 'Ask about stock, orders, your listings — or anything else' : 'Connecting…'}
                        history={sentHistory}
                        leftSlot={null}
                        rightSlot={null}
                    />
                    {attacks.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
                            <span className="shrink-0 text-[12px] text-muted-foreground select-none">
                                Try an attack
                            </span>
                            {attacks.map((attack) => (
                                <button
                                    key={attack.id}
                                    type="button"
                                    disabled={inputDisabled}
                                    onClick={() => void send(attack.message)}
                                    title={attack.message}
                                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border bg-transparent px-2.5 py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                >
                                    <Zap size={12} />
                                    {attack.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ChatPanel;
