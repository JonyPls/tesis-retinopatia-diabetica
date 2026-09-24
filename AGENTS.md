# Project Instructions

## Project overview

This repository contains a web system for supporting the classification of
diabetic retinopathy severity from retinal fundus images.

The system is intended as clinical decision support. The AI result does not
replace the final decision of the medical specialist.

## Repository structure

The project is divided mainly into:

- `frontend/`: React + TypeScript web frontend.
- `backend/`: Python + Flask backend.
- `backend/dl_model/`: deep-learning inference and model integration.
- `backend/routes/`: HTTP/API routes.
- `backend/services/`: application and business logic.
- `backend/src/models/`: domain/data entities.
- `backend/src/repositories/`: data-access layer.
- `backend/utils/`: backend utilities.

Use Codebase Memory when useful to understand symbol relationships,
dependencies, callers, routes, or change impact before reading many files.

## Frontend

Main technologies:

- React
- TypeScript
- Vite
- Tailwind CSS

The frontend is organized primarily by features under:

`frontend/src/features/`

Important feature areas include:

- authentication
- dashboard
- diagnosis
- patients
- reports

When modifying frontend functionality:

- Preserve the existing feature-based organization.
- Inspect the feature's API, hooks, components, pages, store, and types when relevant.
- Prefer existing shared components and utilities instead of duplicating them.
- Preserve established TypeScript types.
- Do not introduce a new state-management or API-access pattern without first
  checking the existing implementation.

## Backend

Main technologies include:

- Python
- Flask
- SQLAlchemy / Flask-SQLAlchemy where used by the current implementation
- PyMySQL where used by the current implementation
- JWT authentication

The backend follows separation between routes, services, models/entities,
repositories, and supporting utilities.

When modifying backend functionality:

- Routes should focus on HTTP concerns.
- Business/application logic should remain in services when applicable.
- Data-access logic should remain in repositories when applicable.
- Preserve the current architecture before introducing a new pattern.
- Inspect existing implementations before creating new abstractions.
- Validate authentication and authorization requirements for protected endpoints.

## Deep learning module

The AI-related implementation is under:

`backend/dl_model/`

Relevant source code includes model architecture, inference, and validation logic.

Model checkpoints and generated artifacts must not be modified unless the task
explicitly requires it.

The classification task uses five diabetic-retinopathy severity levels:

0. No DR
1. Mild
2. Moderate
3. Severe
4. Proliferative DR

Do not change model preprocessing, class mapping, inference behavior, or
Grad-CAM behavior without first identifying the impact on the trained model
and the surrounding application.

## Database

The real database scripts under `backend/db/` are intentionally excluded from
Git and from Codebase Memory.

Do not assume the database schema from memory.

When a task depends on exact database structure:

- Inspect the authorized local schema or relevant repository/model code.
- Do not invent tables, columns, constraints, or relationships.
- Never expose database dumps, credentials, patient data, or other sensitive data.

A sanitized schema representation may be added to project documentation later.

## Generated and private files

Do not treat generated/runtime files as source code.

Important ignored content includes:

- virtual environments
- Python caches
- frontend dependencies/build output
- temporary PDF output
- uploaded retinal images
- model checkpoints
- environment files
- other generated ML artifacts

Never modify or expose `.env` files or credentials unless explicitly requested.

## Working with Codebase Memory

When investigating the codebase, prefer targeted structural queries when they
can answer the question efficiently.

Good uses include:

- locating symbols
- finding callers and callees
- inspecting API routes
- tracing dependencies
- identifying affected components
- understanding change impact

Do not query the entire architecture when a targeted query is sufficient.

After Codebase Memory identifies relevant files or symbols, read the actual
source code before making changes that depend on implementation details.

Codebase Memory describes the current code structure; it does not replace
source-code verification.

## Change discipline

Before implementing a change:

1. Understand the requested behavior.
2. Identify the smallest relevant area of the codebase.
3. Inspect dependencies and impact when necessary.
4. Read the actual source files that will be modified.
5. Make the smallest coherent change.
6. Verify the result using the project's available tools.

Avoid unrelated refactors during feature work or bug fixes.

## Verification

Use deterministic local tools instead of asking the LLM to reason manually
over large amounts of code whenever possible.

Depending on the affected area, use existing:

- tests
- TypeScript checks
- ESLint
- frontend build
- Python tests/checks
- application logs

Run focused verification first and broader verification only when justified.

Do not state that a change works unless it has actually been verified.
If verification could not be performed, state that explicitly.

## Git safety

- Do not commit automatically unless explicitly requested.
- Do not push automatically unless explicitly requested.
- Do not rewrite Git history unless explicitly requested.
- Do not delete uncommitted user work.
- Inspect `git status` before potentially destructive operations.

## Scope

Focus only on the task requested by the user.

Do not redesign unrelated modules merely because a different approach might be
cleaner.

If an architectural problem is discovered outside the requested scope, report
it separately instead of silently refactoring it.