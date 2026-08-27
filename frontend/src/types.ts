/**
 * Wire + UI types — the whole frontend contract in one file.
 */

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------
export interface SessionInfo {
    session_id: string
    user_id: string
    display_name: string
}

export interface HealthInfo {
    status: string
    agent_model: string
    guard_layers: string[]
}

// ---------------------------------------------------------------------------
// Shop (GET /api/products, POST /api/orders)
// ---------------------------------------------------------------------------
export interface Product {
    id: number
    name: string
    description: string
    price: number
    stock: number
    owner_id: string | null
    emoji: string
    category: string
}

export interface OrderResult {
    order_id: number
    product_id: number
    product_name: string
    quantity: number
    status: string
}

// ---------------------------------------------------------------------------
// SSE stream (POST /api/chat)
// ---------------------------------------------------------------------------
export type SSEEventType = 'thinking' | 'token' | 'tool_start' | 'tool_complete' | 'complete' | 'error'

export interface ToolCompleteData {
    tool: string
    query: string
    blocked: boolean
    rule: string
    reasoning: string
    layer?: 'rules' | 'guard-agent'
    kind?: 'select' | 'write'
    columns?: string[]
    truncated?: boolean
    rows?: Record<string, unknown>[] | null
    rowcount?: number
}

export type SSEEvent =
    | { event: 'thinking'; status_message: string; data: { step?: string } }
    | { event: 'token'; status_message: string; data: { content: string } }
    | { event: 'tool_start'; status_message: string; data: { tool: string; query: string } }
    | { event: 'tool_complete'; status_message: string; data: ToolCompleteData }
    | { event: 'complete'; status_message: string; data: { content: string; blocked_total: number } }
    | { event: 'error'; status_message: string; data: { detail?: string } }

// ---------------------------------------------------------------------------
// Chat UI
// ---------------------------------------------------------------------------
export type MessageRole = 'user' | 'assistant' | 'system'

export interface ProcessingStep {
    id: string
    label: string
    status: 'in_progress' | 'complete' | 'error'
    detail?: string
    result?: string
    arguments?: string
    query?: string
    blocked?: boolean
}

export interface Message {
    id: string
    role: MessageRole
    content: string
    timestamp: Date
    processingSteps?: ProcessingStep[]
}

/** Guard-log entry, appended per tool_complete event. */
export interface GuardEntry {
    id: string
    query: string
    blocked: boolean
    rule: string
    reasoning: string
    layer?: 'rules' | 'guard-agent'
    kind?: 'select' | 'write'
    rowCount?: number
}

/** One-click attack prompt. Frontend-owned demo copy. */
export interface AttackPrompt {
    id: string
    label: string
    message: string
}
