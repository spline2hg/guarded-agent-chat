/**
 * ShopPanel — the storefront drawer: product grid with emoji art tiles and a
 * cart. Products refetch whenever the drawer opens, whenever a chat turn
 * finishes (the agent may have changed stock/listings) and after checkout,
 * so the view stays live. The cart is synced with the server-side
 * cart_items table — the same rows the chat agent writes through the
 * guardrail — with localStorage as an offline cache.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
    Loader2,
    Minus,
    PackageOpen,
    Plus,
    ShoppingBag,
    Trash2,
    X,
} from 'lucide-react'
import { createOrder, fetchCart, fetchProducts, saveCart, ApiError } from '@/api'
import type { Product } from '@/types'
import { spring } from '@/chat-ui/lib/springs'

const CART_KEY = 'gac_cart'

interface CartLine {
    productId: number
    qty: number
}

/** Tile gradients per category (light + dark), keyed by category name. */
const TILE: Record<string, string> = {
    Home: 'from-amber-100 to-orange-200 dark:from-amber-400/30 dark:to-orange-400/20',
    Desk: 'from-sky-100 to-indigo-200 dark:from-sky-400/30 dark:to-indigo-400/20',
    Toys: 'from-pink-100 to-fuchsia-200 dark:from-pink-400/30 dark:to-fuchsia-400/20',
    Snacks: 'from-lime-100 to-emerald-200 dark:from-lime-400/30 dark:to-emerald-400/20',
    Games: 'from-violet-100 to-purple-200 dark:from-violet-400/30 dark:to-purple-400/20',
}
const TILE_DEFAULT = 'from-slate-100 to-zinc-200 dark:from-slate-400/30 dark:to-zinc-400/20'

const tileClass = (category: string) => `bg-gradient-to-br ${TILE[category] ?? TILE_DEFAULT}`

function loadCart(): CartLine[] {
    try {
        const raw = localStorage.getItem(CART_KEY)
        const parsed = raw ? (JSON.parse(raw) as CartLine[]) : []
        return Array.isArray(parsed) ? parsed.filter((l) => l.productId && l.qty > 0) : []
    } catch {
        return []
    }
}

const money = (value: number) => `$${value.toFixed(2)}`

interface ShopPanelProps {
    open: boolean
    onClose: () => void
    /** Bumped by the app after every finished chat turn → refetch. */
    refreshKey: number
    /** Visitor identity — the cart lives server-side under this id. */
    userId?: string
    onCartChange?: (count: number) => void
}

export function ShopPanel({ open, onClose, refreshKey, userId, onCartChange }: ShopPanelProps) {
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [cart, setCart] = useState<CartLine[]>(loadCart)
    const [tab, setTab] = useState<'products' | 'cart'>('products')
    const [category, setCategory] = useState<string>('All')
    const [checkingOut, setCheckingOut] = useState(false)
    const [checkoutError, setCheckoutError] = useState<string | null>(null)
    const [orderNote, setOrderNote] = useState<string | null>(null)
    // Set once the server cart has been read; local edits persist to the
    // server only after that, so we never clobber agent-added lines with
    // stale localStorage before seeing them.
    const hydratedRef = useRef(false)

    const productById = useMemo(
        () => new Map(products.map((p) => [p.id, p])),
        [products]
    )
    const categories = useMemo(
        () => ['All', ...new Set(products.map((p) => p.category || 'General'))],
        [products]
    )
    const visible = useMemo(
        () => (category === 'All' ? products : products.filter((p) => (p.category || 'General') === category)),
        [products, category]
    )
    const cartCount = cart.reduce((sum, line) => sum + line.qty, 0)
    const subtotal = cart.reduce(
        (sum, line) => sum + (productById.get(line.productId)?.price ?? 0) * line.qty,
        0
    )

    useEffect(() => {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart))
        } catch {
            /* no persistence this visit */
        }
        onCartChange?.(cart.reduce((sum, line) => sum + line.qty, 0))
        // Mirror local edits into the server-side cart (same rows the agent
        // reads/writes). Skipped until hydration so we don't overwrite
        // agent-added lines with a stale local cart.
        if (userId && hydratedRef.current) {
            saveCart(
                userId,
                cart.map((l) => ({ product_id: l.productId, quantity: l.qty })),
            ).catch(() => {
                /* offline-ish: local state still works this visit */
            })
        }
    }, [cart, onCartChange, userId])

    // Live catalog: on open and after every finished chat turn / checkout.
    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        setLoadError(null)
        fetchProducts()
            .then((list) => {
                if (!cancelled) setProducts(list)
            })
            .catch((error) => {
                if (!cancelled)
                    setLoadError(
                        error instanceof ApiError ? error.message : 'Could not load the catalog.'
                    )
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        // Server cart is the source of truth (the agent may have changed it).
        if (userId) {
            fetchCart(userId)
                .then((lines) => {
                    if (cancelled) return
                    hydratedRef.current = true
                    setCart(lines.map((l) => ({ productId: l.product_id, qty: l.quantity })))
                })
                .catch(() => {
                    /* keep the local cache */
                })
        }
        return () => {
            cancelled = true
        }
    }, [open, refreshKey, userId])

    // Esc closes the drawer.
    useEffect(() => {
        if (!open) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    const addToCart = (product: Product) => {
        setOrderNote(null)
        setCheckoutError(null)
        setCart((prev) => {
            const line = prev.find((l) => l.productId === product.id)
            const current = line?.qty ?? 0
            if (current >= product.stock) return prev
            return line
                ? prev.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l))
                : [...prev, { productId: product.id, qty: 1 }]
        })
    }

    const setQty = (productId: number, qty: number) => {
        const stock = productById.get(productId)?.stock ?? 0
        setCart((prev) =>
            qty <= 0 || stock === 0
                ? prev.filter((l) => l.productId !== productId)
                : prev.map((l) =>
                      l.productId === productId ? { ...l, qty: Math.min(qty, stock) } : l
                  )
        )
    }

    const checkout = async () => {
        if (cart.length === 0 || checkingOut) return
        setCheckingOut(true)
        setCheckoutError(null)
        try {
            let placed = 0
            for (const line of cart) {
                await createOrder(line.productId, line.qty)
                placed += line.qty
            }
            setCart([])
            setOrderNote(`Order placed — ${placed} item${placed === 1 ? '' : 's'} on the way!`)
            setTab('products')
            const list = await fetchProducts()
            setProducts(list)
        } catch (error) {
            setCheckoutError(
                error instanceof ApiError ? error.message : 'Checkout failed — try again.'
            )
            const list = await fetchProducts().catch(() => null)
            if (list) setProducts(list)
        } finally {
            setCheckingOut(false)
        }
    }

    const stockLabel = (product: Product) => {
        if (product.stock <= 0) return { text: 'Sold out', cls: 'text-destructive' }
        if (product.stock <= 5)
            return { text: `Only ${product.stock} left`, cls: 'text-amber-600 dark:text-amber-400' }
        return { text: `${product.stock} in stock`, cls: 'text-muted-foreground' }
    }

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        key="shop-backdrop"
                        className="fixed inset-0 z-40 bg-black/40"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                    />
                    <motion.aside
                        key="shop-panel"
                        className="chat-ui fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background text-foreground shadow-2xl"
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={spring.moderate}
                        aria-label="Store"
                    >
                        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                            <ShoppingBag size={16} />
                            <h2 className="text-[15px] font-medium">Store</h2>
                            {orderNote && (
                                <span className="truncate text-[12px] text-muted-foreground">
                                    {orderNote}
                                </span>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setTab('products')}
                                    className={`cursor-pointer rounded-md px-2.5 py-1 text-[13px] transition-colors hover:bg-hover ${
                                        tab === 'products' ? 'font-medium text-foreground' : 'text-muted-foreground'
                                    }`}
                                >
                                    Products
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTab('cart')}
                                    className={`cursor-pointer rounded-md px-2.5 py-1 text-[13px] transition-colors hover:bg-hover ${
                                        tab === 'cart' ? 'font-medium text-foreground' : 'text-muted-foreground'
                                    }`}
                                >
                                    Cart{cartCount > 0 ? ` (${cartCount})` : ''}
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Close store"
                                    className="ml-1 cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </header>

                        {tab === 'products' ? (
                            <>
                                <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2 scrollbar-hide">
                                    {categories.map((cat) => (
                                        <button
                                            key={cat}
                                            type="button"
                                            onClick={() => setCategory(cat)}
                                            className={`shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                                                category === cat
                                                    ? 'border-border bg-hover font-medium text-foreground'
                                                    : 'border-transparent text-muted-foreground hover:bg-hover'
                                            }`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                                    {loading && products.length === 0 && (
                                        <div className="flex items-center gap-2 py-16 text-muted-foreground">
                                            <Loader2 size={16} className="animate-spin" />
                                            <span className="text-sm">Loading catalog…</span>
                                        </div>
                                    )}
                                    {loadError && (
                                        <p className="py-16 text-center text-sm text-destructive">{loadError}</p>
                                    )}
                                    <div className="grid grid-cols-2 gap-3">
                                        {visible.map((product) => {
                                            const inCart = cart.find((l) => l.productId === product.id)?.qty ?? 0
                                            const stock = stockLabel(product)
                                            const soldOut = product.stock <= 0
                                            const full = inCart >= product.stock
                                            return (
                                                <div
                                                    key={product.id}
                                                    className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                                                >
                                                    <div
                                                        className={`relative flex h-24 items-center justify-center text-5xl ${tileClass(
                                                            product.category
                                                        )}`}
                                                    >
                                                        <span>{product.emoji || '📦'}</span>
                                                        {product.owner_id && (
                                                            <span className="absolute top-1.5 right-1.5 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                                resale
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-1 flex-col gap-1 p-2.5">
                                                        <p className="text-[13px] leading-tight font-medium">
                                                            {product.name}
                                                        </p>
                                                        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                                                            {product.description}
                                                        </p>
                                                        <div className="mt-auto flex items-center justify-between pt-1.5">
                                                            <div className="flex flex-col">
                                                                <span className="text-[13px] font-medium">
                                                                    {money(product.price)}
                                                                </span>
                                                                <span className={`text-[10px] ${stock.cls}`}>
                                                                    {stock.text}
                                                                </span>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => addToCart(product)}
                                                                disabled={soldOut || full}
                                                                title={soldOut ? 'Sold out' : full ? 'All stock in cart' : 'Add to cart'}
                                                                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
                                                            >
                                                                <Plus size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                                    {cart.length === 0 ? (
                                        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                                            <PackageOpen size={24} />
                                            <p className="text-sm">Your cart is empty.</p>
                                        </div>
                                    ) : (
                                        <ul className="flex flex-col gap-2">
                                            {cart.map((line) => {
                                                const product = productById.get(line.productId)
                                                if (!product) return null
                                                return (
                                                    <li
                                                        key={line.productId}
                                                        className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5"
                                                    >
                                                        <div
                                                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-2xl ${tileClass(
                                                                product.category
                                                            )}`}
                                                        >
                                                            {product.emoji || '📦'}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="truncate text-[13px] font-medium">
                                                                {product.name}
                                                            </p>
                                                            <p className="text-[11px] text-muted-foreground">
                                                                {money(product.price)} each
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => setQty(line.productId, line.qty - 1)}
                                                                aria-label="Decrease quantity"
                                                                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border transition-colors hover:bg-hover"
                                                            >
                                                                <Minus size={12} />
                                                            </button>
                                                            <span className="w-6 text-center text-[13px]">{line.qty}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setQty(line.productId, line.qty + 1)}
                                                                disabled={line.qty >= product.stock}
                                                                aria-label="Increase quantity"
                                                                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
                                                            >
                                                                <Plus size={12} />
                                                            </button>
                                                        </div>
                                                        <span className="w-14 text-right text-[13px] font-medium">
                                                            {money(product.price * line.qty)}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setQty(line.productId, 0)}
                                                            aria-label={`Remove ${product.name}`}
                                                            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                                <footer className="border-t border-border px-4 py-3">
                                    {checkoutError && (
                                        <p className="mb-2 text-[12px] text-destructive">{checkoutError}</p>
                                    )}
                                    <div className="mb-2 flex items-baseline justify-between">
                                        <span className="text-[13px] text-muted-foreground">
                                            {cartCount} item{cartCount === 1 ? '' : 's'}
                                        </span>
                                        <span className="text-[15px] font-medium">{money(subtotal)}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void checkout()}
                                        disabled={cart.length === 0 || checkingOut}
                                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
                                    >
                                        {checkingOut && <Loader2 size={14} className="animate-spin" />}
                                        {checkingOut ? 'Placing order…' : 'Checkout'}
                                    </button>
                                </footer>
                            </div>
                        )}
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}

export default ShopPanel
