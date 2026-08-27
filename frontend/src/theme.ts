/**
 * Theme hook — dark (default) / light, persisted in localStorage.
 * The pre-paint script in index.html applies the class before React mounts.
 */

import { useCallback, useState } from 'react'

type Theme = 'light' | 'dark'

export function useTheme(): { theme: Theme; toggle: () => void } {
    const [theme, setTheme] = useState<Theme>(() =>
        document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    )

    const toggle = useCallback(() => {
        setTheme((cur) => {
            const next: Theme = cur === 'dark' ? 'light' : 'dark'
            document.documentElement.classList.toggle('dark', next === 'dark')
            document
                .querySelector('meta[name="theme-color"]')
                ?.setAttribute('content', next === 'dark' ? '#0b0b0d' : '#faf8f2')
            try {
                localStorage.setItem('gac_theme', next)
            } catch {
                /* storage unavailable — the class still applies */
            }
            return next
        })
    }, [])

    return { theme, toggle }
}
