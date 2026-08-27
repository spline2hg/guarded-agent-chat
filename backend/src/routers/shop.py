"""Storefront endpoints: product catalog and guest checkout.

These are plain demo-shop routes — deliberately outside the agent's guarded
SQL path. The chat agent keeps going through the guardrail; the cart in the
frontend only ever calls these typed endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..db import get_db
from ..models import CartItem, Order, Product

router = APIRouter(tags=["shop"])


class ProductOut(BaseModel):
    id: int
    name: str
    description: str
    price: float
    stock: int
    owner_id: str | None
    emoji: str
    category: str


class OrderRequest(BaseModel):
    user_id: str
    product_id: int
    quantity: int = Field(default=1, ge=1, le=99)


class OrderOut(BaseModel):
    order_id: int
    product_id: int
    product_name: str
    quantity: int
    status: str


class CartLineIn(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=99)


class CartSyncRequest(BaseModel):
    user_id: str
    lines: list[CartLineIn]


class CartLineOut(BaseModel):
    product_id: int
    quantity: int


@router.get("/products", response_model=list[ProductOut])
def list_products(db=Depends(get_db)) -> list[ProductOut]:
    products = db.scalars(select(Product).order_by(Product.id)).all()
    return [
        ProductOut(
            id=p.id,
            name=p.name,
            description=p.description,
            price=p.price,
            stock=p.stock,
            owner_id=p.owner_id,
            emoji=p.emoji,
            category=p.category,
        )
        for p in products
    ]


@router.get("/cart", response_model=list[CartLineOut])
def get_cart(user_id: str, db=Depends(get_db)) -> list[CartLineOut]:
    """One user's cart lines — the same rows the agent writes via run_sql."""
    rows = db.scalars(
        select(CartItem).where(CartItem.user_id == user_id).order_by(CartItem.id)
    ).all()
    return [CartLineOut(product_id=r.product_id, quantity=r.quantity) for r in rows]


@router.put("/cart", response_model=list[CartLineOut])
def replace_cart(req: CartSyncRequest, db=Depends(get_db)) -> list[CartLineOut]:
    """Replace one user's cart with the given lines (UI-side sync).

    Validates every line against the catalog and stock before deleting
    anything, so a bad request leaves the stored cart untouched.
    """
    for line in req.lines:
        product = db.get(Product, line.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"No product with id {line.product_id}")
        if line.quantity > product.stock:
            raise HTTPException(
                status_code=409,
                detail=f"Only {product.stock} left in stock for '{product.name}'",
            )

    for row in db.scalars(select(CartItem).where(CartItem.user_id == req.user_id)):
        db.delete(row)
    # Flush deletes before inserts: SQLAlchemy otherwise orders INSERTs
    # first, which trips the (user_id, product_id) unique constraint when
    # a line is replaced.
    db.flush()
    for line in req.lines:
        db.add(
            CartItem(
                user_id=req.user_id,
                product_id=line.product_id,
                quantity=line.quantity,
            )
        )
    db.commit()

    rows = db.scalars(
        select(CartItem).where(CartItem.user_id == req.user_id).order_by(CartItem.id)
    ).all()
    return [CartLineOut(product_id=r.product_id, quantity=r.quantity) for r in rows]


@router.get("/orders", response_model=list[OrderOut])
def list_orders(user_id: str, db=Depends(get_db)) -> list[OrderOut]:
    """One user's orders, newest first (order-history panel in the UI)."""
    rows = db.scalars(
        select(Order).where(Order.user_id == user_id).order_by(Order.id.desc())
    ).all()
    out: list[OrderOut] = []
    for o in rows:
        product = db.get(Product, o.product_id)
        out.append(
            OrderOut(
                order_id=o.id,
                product_id=o.product_id,
                product_name=product.name if product else f"product #{o.product_id}",
                quantity=o.quantity,
                status=o.status,
            )
        )
    return out


@router.post("/orders", response_model=OrderOut)
def create_order(req: OrderRequest, db=Depends(get_db)) -> OrderOut:
    product = db.get(Product, req.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.stock < req.quantity:
        raise HTTPException(
            status_code=409,
            detail=f"Only {product.stock} left in stock for '{product.name}'",
        )

    product.stock -= req.quantity
    order = Order(
        user_id=req.user_id,
        product_id=product.id,
        status="pending",
        quantity=req.quantity,
    )
    db.add(order)
    db.commit()

    return OrderOut(
        order_id=order.id,
        product_id=product.id,
        product_name=product.name,
        quantity=req.quantity,
        status=order.status,
    )
