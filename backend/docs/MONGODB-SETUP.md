# MongoDB Setup (Replica Set)

This project uses MongoDB transactions, so your instance must run as a **replica set** (even in local development).

Helper scripts live in `backend/scripts/mongodb/`.

## Quick Start (Windows)

1. Start MongoDB:

   ```bat
   backend\scripts\mongodb\start-mongo-rs0.bat
   ```

2. In a new terminal, open `mongosh` and initialize the replica set (first time only):

   ```js
   rs.initiate()
   ```

3. Set your backend `.env`:

   ```env
   MONGODB_URI=mongodb://localhost:27017/nepal-school-erp?replicaSet=rs0
   ```

## Scripts

| File | Description |
|------|-------------|
| `start-mongo-rs0.bat` | Starts MongoDB as a single-node replica set (`rs0`) |
| `stop-mongo.bat` | Stops running `mongod` processes |
| `setup-mongodb-service.ps1` | Installs MongoDB as a Windows service via NSSM (run as Administrator) |

## Permanent Windows Service

For daily development, run `setup-mongodb-service.ps1` as Administrator. It requires:

- MongoDB installed (`mongod` in PATH)
- [NSSM](https://nssm.cc/download)

After the service starts, run `rs.initiate()` in `mongosh` if this is the first setup.

## Notes

- Always start MongoDB with `--replSet rs0`.
- A standalone MongoDB instance will not work because the app relies on transactions.
- MongoDB logs from the batch script are written to `backend/logs/`.