# OilBank

Multi-user vehicle, fuel, expense and compliance manager.

## Stack
- Node.js / Express
- PostgreSQL
- Vanilla JS responsive frontend
- Render deployment
- OpenAI vision extraction for vehicle documents
- PWA shell + service worker

## Main features
- Super Admin / User roles
- Vehicle ownership and permission isolation
- Fuel tracking and consumption
- Expenses / service
- KTEO, insurance, emissions card and road tax
- Smart photo/PDF document extraction with confirmation
- Duplicate document detection
- Audit log
- Reporting by vehicle, user, category and year
- JSON backup and admin restore
- Installable PWA and online/offline state

## Environment variables
See `.env.example`.

Never commit real secrets.

## Local setup
1. Node 20+
2. `npm install`
3. Copy `.env.example` to `.env` and fill values.
4. Start PostgreSQL.
5. `npm start`

## Security notes
- Passwords are hashed with bcrypt.
- Admin-visible issued credentials are additionally encrypted with `VAULT_KEY`.
- OpenAI API key stays server-side.
- Users are restricted server-side to their own vehicles/data.
- Uploaded documents require authentication to retrieve.

## Deployment
Render web service:
- Build: `npm install`
- Start: `npm start`
- PostgreSQL via `DATABASE_URL`

## Backup
Super Admin can download a JSON backup and restore compatible records from Settings.

## PWA
`manifest.webmanifest` and `sw.js` provide installability and cached application shell.