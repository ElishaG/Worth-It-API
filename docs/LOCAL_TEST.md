# Local test flow

## 1. Install and configure

In PowerShell inside this folder:

```powershell
.\scripts\setup.ps1
notepad .env
```

Add the Supabase publishable key and the server-only secret key. Do not send or commit the secret key. Keep both providers set to `mock` for the first test.

## 2. Start the API

```powershell
.\scripts\start-api.ps1
```

Open a second PowerShell window in the same folder and start the worker:

```powershell
.\scripts\start-worker.ps1
```

## 3. Confirm the API is running

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected status: `ok`.

## 4. Confirm public reference data

```powershell
Invoke-RestMethod http://localhost:3000/v1/currencies
Invoke-RestMethod http://localhost:3000/v1/categories
```

## 5. Authenticated tests

Protected endpoints require a real Supabase access token from a signed-in user. The React Native app will provide this automatically. Until the mobile app exists, you can create a test user in Supabase Authentication and obtain a session through a small test client or the Supabase JavaScript SDK.

Do not use the Supabase secret key as a Bearer token in mobile or test requests.
