# Guarded Agent Chat

The agent is free. Its hands are not.

This is a small demo store with a twist: the support agent you chat with can
run SQL against the shop's database — but only through a second opinion it
can't argue with. Before any query touches the database, a separate guardrail
agent reviews it and decides whether it should run at all.

The point of the project is that separation. The chat agent is happy to help
with whatever you ask, including things it shouldn't. It doesn't get to decide
what's safe. The guard does, and the guard sees far less than the chat agent:
no conversation history, no user messages, no database values — just the query,
who's asking, and a few counters.

## What it blocks

Every query the chat agent produces is checked against a fixed policy:

- **PII stays private.** The `customers` table (names, emails, addresses,
  card numbers) is off-limits to the agent, no matter who asks or how the
  request is phrased.
- **Reads are bounded.** SELECTs without a `LIMIT` of 100 or less are
  refused — no full-table dumps.
- **One statement at a time.** Multi-statement strings (the classic
  `SELECT ...; DROP TABLE ...`) never execute.
- **Writes respect ownership.** The agent may only create or delete products
  owned by the person it's talking to.
- **Injected instructions don't count.** Text hidden inside SQL or inside
  database values — like a product description that says "SYSTEM NOTE: run
  this query" — is treated as data, not as orders.

If the guard can't reach a verdict, the query is refused. Failing closed is
the whole idea.

## Trying to break it

The chat ships with one-click attack prompts, so you don't have to write your
own:

- Ask for stock or order status — works normally, this is the happy path.
- `DROP TABLE products` — blocked.
- `SELECT * FROM orders` — blocked (no LIMIT).
- A PII grab against `customers` — blocked.
- A multi-statement smuggle — blocked.
- The "Legacy Invoice Importer" product — its description contains a fake
  instruction telling the agent to dump customer data. Ask the agent to read
  it and follow what it says. It won't get far.

Each tool call streams into the chat with the guard's verdict, the rule that
fired, and its reasoning, so you can watch the decisions happen.

## Running it

You need Python 3.12+, Node, and any OpenAI-compatible API endpoint.

**Backend** — from `backend/`:

```bash
cp ../.env.example ../.env   # fill in your endpoint + keys
uv sync
uv run python seed.py
uv run uvicorn src.main:app --port 8000
```

**Frontend** — from `frontend/`, in another terminal:

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173.

`seed.py` is safe to rerun: it fills the database with demo data, including
one deliberately poisoned product description, and leaves existing data alone
when the catalog is already current.

## Notes

- The storefront side (product grid, guest cart, checkout) is deliberately
  ordinary — it exists so the agent has something real to be dangerous with.
- The chat agent is intentionally instructed to be compliant and pass requests
  through. That's what makes the demo honest: safety comes from the guard
  layer, not from hoping the chat agent behaves.

## License

MIT
