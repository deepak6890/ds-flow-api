# DS FLOW — Live Owner Control Panel

This version serves the Owner Control Panel from the same Node.js app at `https://flowwultra.online/` and uses the live `/api/admin/*` endpoints. It does not store users in localStorage.

## Features
- Owner login via `/api/admin/login`
- Live user list from MySQL
- Create extension users with subscription days, max devices and server 1–7 access
- Edit user status, max devices, subscription, password and server access
- Clear devices
- Delete users
- Live audit logs
- API health indicator

## Deployment
Replace the current `server.js` with the included one and upload the included `public/` folder to the GitHub repository root. Keep `package.json`, schema and environment variables unchanged.

The Node app serves the panel from `/` and the API from `/api/*`.

## Environment variables
Use the existing Hostinger variables:
- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- DB_PASSWORD
- JWT_SECRET
- ADMIN_EMAIL
- ADMIN_PASSWORD
- CORS_ORIGIN

No `.env` file is required on Hostinger.

## Important
The panel intentionally does not pretend to upload/manage Server JSON files or extension settings because the current API has no endpoints for those operations. Those can be added to the backend later.
