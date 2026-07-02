# MongoDB Helper Scripts

This folder contains utilities to make running MongoDB as a Replica Set easier during development.

## Scripts

| File                              | Description                                      |
|-----------------------------------|--------------------------------------------------|
| `start-mongo-rs0.bat`             | Starts MongoDB configured as a single-node replica set with logging |
| `stop-mongo.bat`                  | Forcefully stops any running mongod processes    |
| `setup-mongodb-service.ps1`       | PowerShell script to install MongoDB as a Windows Service using NSSM |

## Quick Start

1. Run `start-mongo-rs0.bat` (double click or from terminal)
2. In a new terminal, run `mongosh` then execute:
   ```js
   rs.initiate()
   ```
3. Make sure your backend `.env` has:
   ```env
   MONGODB_URI=mongodb://localhost:27017/nepal-school-erp?replicaSet=rs0
   ```

For a more permanent setup, use `setup-mongodb-service.ps1` (run as Administrator).

## Notes

- Always start MongoDB with the `--replSet rs0` flag.
- The project will not work with a standalone MongoDB instance because it relies on transactions.
