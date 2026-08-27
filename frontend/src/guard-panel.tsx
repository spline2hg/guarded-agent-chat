/**
 * The sidebar: guard log (verdict trail).
 */

import { useEffect, useRef } from 'react'
import type { GuardEntry } from './types'

function GuardEntryRow({ entry }: { entry: GuardEntry }) {
    // Allowed SELECTs report returned rows; writes report rows affected.
    // Blocked calls never executed, so they carry no count.
    let countLabel: string | null = null
    if (entry.rowCount !== undefined) {
        const noun = entry.rowCount === 1 ? 'row' : 'rows'
        countLabel =
            entry.kind === 'write'
                ? `${entry.rowCount} ${noun} affected`
                : `${entry.rowCount} ${noun}`
    }

    return (
        <article className={`guard-entry ${entry.blocked ? 'blocked' : 'allowed'}`}>
            <code className="guard-entry-query">{entry.query}</code>
            <div className="guard-entry-meta">
                <span className={`verdict-badge ${entry.blocked ? 'blocked' : 'allowed'}`}>
                    {entry.blocked ? 'BLOCKED' : 'ALLOWED'}
                </span>
                {entry.layer && <span className="guard-entry-layer">{entry.layer}</span>}
                {countLabel && <span className="guard-entry-count">{countLabel}</span>}
            </div>
            <p className="guard-entry-rule">
                <span className="guard-entry-rule-name">{entry.rule}</span>
                {entry.reasoning ? ` — ${entry.reasoning}` : ''}
            </p>
        </article>
    )
}

export function GuardLog({ entries }: { entries: GuardEntry[] }) {
    const endRef = useRef<HTMLDivElement>(null)

    // Newest lands at the bottom — keep it in view.
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [entries.length])

    const blockedCount = entries.reduce((count, entry) => count + (entry.blocked ? 1 : 0), 0)

    return (
        <section className="guard-log" aria-label="Guard log">
            <header className="side-panel-head">
                <h2>Guard log</h2>
                {entries.length > 0 && (
                    <span className="side-panel-count">
                        {blockedCount} of {entries.length} blocked
                    </span>
                )}
            </header>
            <div className="guard-log-entries">
                {entries.length === 0 ? (
                    <p className="side-empty">
                        Every run_sql call the agent makes lands here with its
                        verdict — allowed or blocked, which layer caught it, and why.
                    </p>
                ) : (
                    <>
                        {entries.map((entry) => (
                            <GuardEntryRow key={entry.id} entry={entry} />
                        ))}
                        <div ref={endRef} />
                    </>
                )}
            </div>
        </section>
    )
}
