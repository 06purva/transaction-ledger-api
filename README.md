# Transaction Ledger API

A RESTful transaction ledger API built with **Node.js, TypeScript, Fastify, Prisma, and PostgreSQL**. It supports account creation, credit and debit transactions, balance inquiries, transaction history, and atomic transfers between accounts.

## Features

- Create accounts with a zero initial balance.
- Credit and debit accounts using precise decimal arithmetic.
- Reject debits and transfers when funds are insufficient.
- Prevent duplicate transactions using account-specific reference IDs.
- Retrieve account balances.
- Retrieve transaction history with type filtering and pagination.
- Maintain an immutable transaction ledger.
- Execute transfers atomically, updating both accounts and recording both ledger entries in a single database transaction.
- Validate incoming requests and return meaningful HTTP errors.
- Enforce database constraints and indexes.
- Generate API documentation with Swagger.

## Tech Stack

- Node.js
- TypeScript
- Fastify
- PostgreSQL
- Prisma ORM
- Zod
- Vitest

## Prerequisites

- Node.js and npm
- A PostgreSQL database
- A configured environment file

## Setup

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the project root using `.env.example` as a reference.
4. Configure `DATABASE_URL` with your development PostgreSQL connection string.
5. Configure `TEST_DATABASE_URL` with a separate test database connection string.
6. Apply database migrations:

   ```bash
   npx prisma migrate deploy
   ```

7. Start the development server:

   ```bash
   npm run dev
   ```

The API uses port `3000` by default, subject to your environment configuration.

## Available Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Compile TypeScript for production |
| `npm start` | Start the compiled application |
| `npm test` | Run automated tests against the configured test database |

## API Endpoints

### Accounts

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/accounts` | Create an account |
| `GET` | `/api/v1/accounts/:accountId/balance` | Retrieve an account balance |

### Transactions

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/accounts/:accountId/transactions` | Create a credit or debit transaction |
| `GET` | `/api/v1/accounts/:accountId/transactions` | Retrieve transaction history |

Transaction history supports type filtering and pagination according to the API's implemented query parameters.

### Transfers

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/transfers` | Transfer funds between accounts |

### Utility and Documentation

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Swagger API documentation |

## Example: Create an Account

```bash
curl -X POST http://localhost:3000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo Account"}'
```

## Example: Credit an Account

Replace `ACCOUNT_ID` with an existing account UUID.

```bash
curl -X POST http://localhost:3000/api/v1/accounts/ACCOUNT_ID/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CREDIT",
    "amount": "100.00",
    "reference_id": "demo-credit-001",
    "description": "Initial funding"
  }'
```

## Example: Transfer Funds

Replace both account ID placeholders with valid account UUIDs.

```bash
curl -X POST http://localhost:3000/api/v1/transfers \
  -H "Content-Type: application/json" \
  -d '{
    "from_account_id": "SOURCE_ACCOUNT_UUID",
    "to_account_id": "DESTINATION_ACCOUNT_UUID",
    "amount": "25.00",
    "reference_id": "demo-transfer-001",
    "description": "Demo transfer"
  }'
```

## Data Integrity

- Account balances start at zero.
- Transaction amounts must be positive.
- Account balances cannot become negative.
- Each account can use a reference ID only once.
- The same reference ID can be used on different accounts.
- Transfers update both balances and create both ledger entries in one database transaction.
- Failed transactions must not leave partial balance changes or ledger entries.

## Testing

Run the automated test suite:

```bash
npm test
```

The test command is configured to use `TEST_DATABASE_URL`, which must point to a database separate from the development database.

Build the application:

```bash
npm run build
```

## Environment Variables

Create `.env.example` containing placeholders for the required environment variables. Never commit actual credentials or database connection strings.
