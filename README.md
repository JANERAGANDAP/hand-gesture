# Sign Language System

A full-stack sign language application that uses **PostgreSQL** for database management, **Prisma** as the ORM, and **Ollama** for accessing local AI models.

## Project Structure

```text
project-root/
│
├── server/                 # API server for Ollama local model access
│
├── sign-language-server/   # Main backend application
│   ├── prisma/             # Prisma schema and migrations
│   └── ...
│
└── ...
```

### Components

* **PostgreSQL** – Primary database used by the system.
* **Prisma** – ORM used for database operations. Prisma configuration and schema files are located in the `sign-language-server` directory.
* **server/** – Handles communication with Ollama and provides access to locally hosted AI models.
* **sign-language-server/** – Main backend service containing application logic and database integration.

---

## Prerequisites

Before running the system, ensure the following are installed:

* [Node.js](https://nodejs.org/) (recommended latest LTS version)
* PostgreSQL
* Ollama
* npm (included with Node.js)

Additionally, make sure all required project dependencies are installed.

---

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd <repository-name>
```

### 2. Install Dependencies

Install all required libraries and packages before running the application:

```bash
npm install
```

If the project contains multiple packages/workspaces, install dependencies in the relevant directories as needed.

---

## Database Setup

### Configure PostgreSQL

Create a PostgreSQL database and update the environment variables with your database connection string.

Example:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/database_name"
```

### Prisma Setup

Prisma is located in:

```text
sign-language-server/prisma
```

Run migrations:

```bash
cd sign-language-server
npx prisma migrate deploy
```

Or for development:

```bash
npx prisma migrate dev
```

Generate the Prisma client:

```bash
npx prisma generate
```

---

## Ollama Setup

Make sure Ollama is installed and running locally.

Pull the required model:

```bash
ollama pull <model-name>
```

Verify that the model is available:

```bash
ollama list
```

---

## Running the Application

After installing all dependencies, configuring PostgreSQL, and ensuring Ollama is running, start the system with:

```bash
npm run dev
```

This command automatically starts:

* The **server** folder (Ollama API integration)
* The **sign-language-server** backend service

No need to start these services separately when using the development command.

---

## Notes

* Ensure PostgreSQL is running before starting the application.
* Ensure Ollama is running and the required model has been downloaded.
* Install all project dependencies before executing `npm run dev`.
* Prisma files and database configurations are located in the `sign-language-server` directory.
* The application may fail to start if any required libraries or services are missing.

---

## Development Workflow

```bash
# Install dependencies
npm install

# Setup database
cd sign-language-server
npx prisma generate
npx prisma migrate dev

# Return to project root
cd ..

# Start the application
npm run dev
```

## Troubleshooting

### Database Connection Errors

* Verify PostgreSQL is running.
* Check the `DATABASE_URL` configuration.
* Ensure database migrations have been applied.

### Prisma Errors

```bash
cd sign-language-server
npx prisma generate
```

Then restart the application.

### Ollama Connection Issues

* Verify Ollama is running locally.
* Confirm the required model has been downloaded.
* Check that the `server` service can access the Ollama endpoint.

---

## License

This project is licensed under the license specified in this repository.
