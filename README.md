# Gmail Dashboard Backend (Ready for GitHub)

A minimal Node/Express backend that authorizes with Gmail via OAuth, stores tokens locally, and exposes `/emails` to list recent messages. Includes a simple `index.html` to view results.

## Run locally
```bash
npm install
# Place your Google OAuth Web credentials as credentials.json in this folder
# Ensure the redirect URI in Google Cloud is set to: http://localhost:8080/oauth2callback
npm start
# Visit http://localhost:8080/authorize, approve, then open http://localhost:8080/index.html
```

## Security
- **Do not commit** `credentials.json` or `token.json`. They are ignored by `.gitignore`.
