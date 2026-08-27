/**
 * The chat column: message list + bubbles, live processing steps, input,
 * and the one-click attack chips. Also owns the useProcessingSteps hook that
 * folds the SSE stream into a step list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Database, ChevronDown, ChevronUp, Check, X, Loader2, Zap } from 'lucide-react'
import type { AttackPrompt, Message, ProcessingStep, SSEEvent } from './types'

// ---------------------------------------------------------------------------
// useProcessingSteps — live steps + status line for the turn in flight
// ---------------------------------------------------------------------------
interface ProcessingState {
    currentStatus: string | null
    steps: ProcessingStep[]
}

const INITIAL_STATE: ProcessingState = { currentStatus: null, steps: [] }

function formatDetails(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function reduceEvent(event: SSEEvent, state: ProcessingState): ProcessingState {
    switch (event.event) {
        case 'thinking':
            return { ...state, currentStatus: event.status_message || 'Working…' }
        case 'token':
            return state
        case 'tool_start':
            return {
                ...state,
                steps: [
                    ...state.steps,
                    {
                        id: crypto.randomUUID(),
                        label: 'run_sql',
                        status: 'in_progress',
                        query: event.data.query,
                        arguments: formatDetails({ query: event.data.query }),
                    },
                ],
            }
        case 'tool_complete': {
            const d = event.data
            const count =
                d.kind === 'write' ? (d.rowcount ?? 0) : (d.rows?.length ?? 0)
            const detail = d.blocked
                ? `Blocked — ${d.rule}`
                : d.kind === 'write'
                  ? `${count} row${count === 1 ? '' : 's'} affected`
                  : `${count} row${count === 1 ? '' : 's'} returned`
            return {
                ...state,
                currentStatus: null,
                steps: state.steps.map((step, i) =>
                    i === state.steps.length - 1 && step.status === 'in_progress'
                        ? { ...step, status: d.blocked ? 'error' : 'complete', blocked: d.blocked, detail,
                            result: formatDetails({
                                blocked: d.blocked,
                                rule: d.rule,
                                reasoning: d.reasoning,
                                kind: d.kind,
                                columns: d.columns,
                                rows: d.rows,
                                rowcount: d.rowcount,
                                truncated: d.truncated,
                            }) }
                        : step
                ),
            }
        }
        case 'complete':
        case 'error':
            return { ...state, currentStatus: null }
    }
}

export function useProcessingSteps() {
    const [state, setState] = useState<ProcessingState>(INITIAL_STATE)
    // Mirror of the steps so the stream loop can snapshot the final list at
    // the exact moment the assistant message lands.
    const stepsRef = useRef<ProcessingStep[]>([])

    const handleEvent = useCallback((event: SSEEvent) => {
        setState((prev) => {
            const next = reduceEvent(event, prev)
            stepsRef.current = next.steps
            return next
        })
    }, [])

    const resetSteps = useCallback(() => {
        stepsRef.current = []
        setState(INITIAL_STATE)
    }, [])

    const getSteps = useCallback(() => stepsRef.current, [])

    return useMemo(
        () => ({ ...state, handleEvent, resetSteps, getSteps }),
        [state, handleEvent, resetSteps, getSteps]
    )
}

// ---------------------------------------------------------------------------
// Processing steps display (collapsible; one item per run_sql call)
// ---------------------------------------------------------------------------
export function ProcessingSteps({
    steps,
    defaultExpanded = true,
    currentStatus,
}: {
    steps: ProcessingStep[]
    defaultExpanded?: boolean
    currentStatus?: string | null
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)
    if (steps.length === 0 && !currentStatus) return null

    const headerLabel = currentStatus
        ? 'Processing'
        : `${steps.length} step${steps.length !== 1 ? 's' : ''}`

    return (
        <div className="processing-steps">
            <button
                className="processing-steps-header"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
            >
                <span className="processing-steps-label">{headerLabel}</span>
                {isExpanded ? (
                    <ChevronUp size={12} className="processing-steps-chevron" />
                ) : (
                    <ChevronDown size={12} className="processing-steps-chevron" />
                )}
            </button>

            {isExpanded && (
                <div className="processing-steps-list">
                    {steps.map((step) => (
                        <ProcessingStepItem key={step.id} step={step} />
                    ))}
                    {currentStatus && (
                        <div className="processing-step in_progress">
                            <div className="processing-step-header">
                                <div className="processing-step-icon">
                                    <Loader2 size={14} className="spin" />
                                </div>
                                <span className="processing-step-label">{currentStatus}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function ProcessingStepItem({ step }: { step: ProcessingStep }) {
    const [isExpanded, setIsExpanded] = useState(false)
    const expandable = !!step.query

    return (
        <div className={`processing-step ${step.status}`}>
            <button
                className="processing-step-header"
                onClick={() => expandable && setIsExpanded(!isExpanded)}
                disabled={!expandable}
                aria-expanded={isExpanded}
            >
                <div className="processing-step-icon">
                    <Database size={14} />
                </div>
                <span className="processing-step-label">{step.label}</span>
                {step.status === 'in_progress' && (
                    <Loader2 size={14} className="processing-step-spinner spin" />
                )}
                {step.status === 'complete' && <Check size={14} className="processing-step-check" />}
                {step.status === 'error' && <X size={14} className="processing-step-error" />}
                {expandable && (isExpanded
                    ? <ChevronUp size={14} className="processing-step-chevron" />
                    : <ChevronDown size={14} className="processing-step-chevron" />)}
            </button>

            {isExpanded && expandable && (
                <div className="processing-step-details">
                    {step.arguments && (
                        <div className="step-details-row">
                            <span className="step-detail-label">Arguments</span>
                            <pre className="step-detail-code">{step.arguments}</pre>
                        </div>
                    )}
                    {step.detail && (
                        <div className="step-details-row">
                            <span className="step-detail-label">Status</span>
                            <span className={`step-detail-status ${step.blocked ? 'blocked' : 'allowed'}`}>
                                {step.detail}
                            </span>
                        </div>
                    )}
                    {step.result && (
                        <div className="step-details-row">
                            <span className="step-detail-label">Tool result</span>
                            <pre className="step-detail-code">{step.result}</pre>
                        </div>
                    )}
                    <div className="step-details-row">
                        <span className="step-detail-label">SQL</span>
                        <code className="step-detail-code">{step.query}</code>
                    </div>
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
function MessageBubble({ message, agentName }: { message: Message; agentName: string }) {
    const name = message.role === 'user' ? 'You' : message.role === 'assistant' ? agentName : 'System'
    return (
        <div className={`message ${message.role}`}>
            <span className="message-name">{name}</span>
            <div className="message-bubble">{message.content}</div>
        </div>
    )
}

export function MessageList({
    messages,
    agentName,
    currentStatus,
    steps,
    streamingText,
}: {
    messages: Message[]
    agentName: string
    currentStatus: string | null
    steps: ProcessingStep[]
    streamingText: string
}) {
    const endRef = useRef<HTMLDivElement>(null)
    const stepsRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (messages.length > 1) endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages.length])

    useEffect(() => {
        if (steps.length > 0) {
            stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
    }, [steps.length])

    const showLive = steps.length > 0 || !!currentStatus || !!streamingText

    return (
        <div className="chat-messages">
            {messages.map((message) => (
                <div key={message.id}>
                    {message.role === 'assistant' && message.processingSteps && message.processingSteps.length > 0 && (
                        <ProcessingSteps steps={message.processingSteps} defaultExpanded={false} />
                    )}
                    <MessageBubble message={message} agentName={agentName} />
                </div>
            ))}

            {showLive && (
                <div ref={stepsRef}>
                    <ProcessingSteps steps={steps} currentStatus={currentStatus} defaultExpanded={true} />
                    {streamingText && (
                        <div className="message assistant">
                            <span className="message-name">{agentName}</span>
                            <div className="message-bubble">{streamingText}</div>
                        </div>
                    )}
                </div>
            )}
            <div ref={endRef} />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Input + attack chips
// ---------------------------------------------------------------------------
export function ChatInput({
    value,
    onChange,
    onKeyDown,
    onSubmit,
    isLoading,
    inputRef,
}: {
    value: string
    onChange: (value: string) => void
    onKeyDown: (e: React.KeyboardEvent) => void
    onSubmit: () => void
    isLoading: boolean
    inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
    useEffect(() => {
        if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    }, [inputRef])

    // Collapse the auto-resized textarea when the message is sent.
    useEffect(() => {
        if (value === '' && inputRef.current) inputRef.current.style.height = 'auto'
    }, [value, inputRef])

    const canSubmit = !!value.trim() && !isLoading

    return (
        <div className="chat-input-wrapper">
            <textarea
                ref={inputRef}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={onKeyDown}
                placeholder="Ask about stock, orders, your listings — or anything else"
                className="chat-input"
                rows={1}
                disabled={isLoading}
            />
            <button onClick={onSubmit} disabled={!canSubmit} className="chat-submit">
                Send
            </button>
        </div>
    )
}

export function AttackChips({
    attacks,
    disabled,
    onSend,
}: {
    attacks: AttackPrompt[]
    disabled: boolean
    onSend: (message: string) => void
}) {
    if (attacks.length === 0) return null

    return (
        <div className="attack-chips">
            <span className="attack-chips-label">Try an attack</span>
            <div className="attack-chips-row" role="group" aria-label="One-click prompts">
                {attacks.map((attack) => (
                    <button
                        key={attack.id}
                        className="attack-chip"
                        disabled={disabled}
                        onClick={() => onSend(attack.message)}
                        title={attack.message}
                    >
                        <Zap size={12} />
                        {attack.label}
                    </button>
                ))}
            </div>
        </div>
    )
}
