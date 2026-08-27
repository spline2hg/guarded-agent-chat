/**
 * API client — session bootstrap, SSE chat stream, and health.
 * Base URL is empty = same origin (Vite dev proxy / co-hosted production).
 */

const API_BASE: string = import.meta.env.VITE_API_URL || ''

import type { SessionInfo, HealthInfo, SSEEvent, Product, OrderResult } from './types'

export class ApiError extends Error {
    constructor(
        message: string,
        public statusCode?: number
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    })
    if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new ApiError(detail.detail || `Request failed (${response.status})`, response.status)
    }
    return response.json()
}

/** Open a chat session; first visit sends no user_id (server mints a uuid). */
export async function startSession(userId?: string): Promise<SessionInfo> {
    return apiRequest<SessionInfo>('/api/session', {
        method: 'POST',
        body: JSON.stringify(userId ? { user_id: userId } : {}),
    })
}

/** Liveness + which guard layers are armed. */
export async function fetchHealth(): Promise<HealthInfo> {
    return apiRequest<HealthInfo>('/api/health')
}

/** Current store catalog (id, price, stock, emoji, …). */
export async function fetchProducts(): Promise<Product[]> {
    return apiRequest<Product[]>('/api/products')
}

/** Guest checkout for one cart line; decrements stock server-side. */
export async function createOrder(
    userId: string,
    productId: number,
    quantity: number
): Promise<OrderResult> {
    return apiRequest<OrderResult>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, product_id: productId, quantity }),
    })
}

/** The user's order history (newest first). */
export async function fetchOrders(userId: string): Promise<OrderResult[]> {
    return apiRequest<OrderResult[]>(`/api/orders?user_id=${encodeURIComponent(userId)}`)
}

/** One cart line as stored server-side (shared with the agent's cart). */
export interface CartApiLine {
    product_id: number
    quantity: number
}

/** Read the user's server-side cart (same rows the agent writes via run_sql). */
export async function fetchCart(userId: string): Promise<CartApiLine[]> {
    return apiRequest<CartApiLine[]>(`/api/cart?user_id=${encodeURIComponent(userId)}`)
}

/** Replace the user's server-side cart with the given lines. */
export async function saveCart(userId: string, lines: CartApiLine[]): Promise<CartApiLine[]> {
    return apiRequest<CartApiLine[]>('/api/cart', {
        method: 'PUT',
        body: JSON.stringify({ user_id: userId, lines }),
    })
}

/**
 * Pull complete JSON objects out of a buffer — handles concatenated and
 * pretty-printed bodies that arrive split across SSE chunks.
 * Returns [extracted object strings, remaining buffer].
 */
function extractJSONObjects(buffer: string): [string[], string] {
    const objects: string[] = []
    let depth = 0
    let inString = false
    let escape = false
    let objectStart = -1

    for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i]
        if (escape) { escape = false; continue }
        if (char === '\\' && inString) { escape = true; continue }
        if (char === '"') { inString = !inString; continue }
        if (inString) continue

        if (char === '{') {
            if (depth === 0) objectStart = i
            depth++
        } else if (char === '}') {
            depth--
            if (depth === 0 && objectStart !== -1) {
                objects.push(buffer.slice(objectStart, i + 1))
                objectStart = -1
            }
        }
    }

    const remaining = objectStart !== -1 ? buffer.slice(objectStart) : ''
    return [objects, remaining]
}

/** Send a chat message and yield the agent turn's SSE events. */
export async function* streamChat(sessionId: string, message: string): AsyncGenerator<SSEEvent> {
    const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
    })
    if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new ApiError(detail.detail || `Request failed (${response.status})`, response.status)
    }
    if (!response.body) throw new ApiError('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const [objects, remaining] = extractJSONObjects(buffer)
            buffer = remaining
            for (const jsonStr of objects) {
                try {
                    yield JSON.parse(jsonStr) as SSEEvent
                } catch {
                    /* skip malformed frame */
                }
            }
        }
    } finally {
        reader.releaseLock()
    }
}
