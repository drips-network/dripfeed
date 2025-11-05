# Dripfeed 🌊

**Dripfeed** is a blockchain events indexer for [Drips](https://drips.network). It ingests protocol events—both historical and near real-time—from the Drips smart contracts, along with related IPFS documents, to build a structured database of higher-level entities (like “Drip Lists” and “Projects”). This database powers the [Drips GraphQL API](https://github.com/drips-network/graphql-api), which provides a unified, read-only endpoint for querying decentralized data across the Drips Network.

As a "read-only" service, Dripfeed and Drips GraphQL API function solely as a query layer for on-chain activity. Blockchain and IPFS remain the ultimate sources of truth. In practice, anyone can run their own instance of the service and, after indexing all past and ongoing events, reach the exact same state as the production Drips app.

## 🚀 Running the Service

> ⚠️ Dripfeed is designed to run as a **single instance per blockchain network**.

### Locally

1. Copy `.env.example` to `.env` and configure:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
DB_SCHEMA=public
NETWORK=mainnet
RPC_URL=https://your-rpc-endpoint
# ... other settings
```

2. Run database migrations:

```bash
npm run db:migrate
```

3. Start the indexer:

```bash
npm run dev    # Development mode with watch
npm run start  # Production mode
```

### Docker

1. Configure environment variables in `.env`:

```bash
cp .env.example .env
# Edit .env with your configuration
```

2. Start services:

```bash
docker compose up -d
```

3. Run migrations (first time only):

```bash
docker compose exec dripfeed npm run db:migrate
```

The Docker setup includes:

- `dripfeed`: The indexer service (runs in dev mode with hot reload).
- `postgres`: PostgreSQL database (port 54321).
- `pgadmin`: Database admin interface (accessible at <http://localhost:5051>).

**Connecting to pgAdmin:**

1. Open <http://localhost:5051/> in your browser.
2. Default credentials (override via env vars):
   - Email: `PGADMIN_EMAIL` (default: <admin@admin.com>)
   - Password: `PGADMIN_PASSWORD` (default: admin)
3. Connect to database using:
   - Host: `postgres`
   - Port: `5432`
   - Username: `POSTGRES_USER` (default: user)
   - Password: `POSTGRES_PASSWORD` (default: admin)
   - Database: `POSTGRES_DB` (default: dripfeeddb)

> ⚠️ **Important**
>
> - **One indexer per chain per schema** - Each chain needs a unique `DB_SCHEMA`. Never run multiple instances for the same chain/schema.
> - **Container-managed dependencies** - `node_modules` are managed inside the container to prevent platform-specific binary conflicts.

## 🛠️ Development

See [DEVELOPMENT.md](DEVELOPMENT.md) guide

## 🔄 How It Works

1. **Fetch**: Gets logs from RPC, decodes events, stores with block hashes
2. **Detect**: Compares stored block hashes against chain for reorgs
3. **Process**: Routes events to handlers that update entity state

Events are processed _sequentially_ in block order.
