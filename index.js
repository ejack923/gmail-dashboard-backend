const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const port = process.env.PORT || 8080;

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Serve static front-end
app.use(express.static(__dirname));

// Load OAuth client if credentials.json exists
function getOAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json not found. Place your Google OAuth Web credentials in the project root.');
  }
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.web;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

app.get('/', (req, res) => {
  res.send('📬 Gmail Dashboard Backend is running.');
});

app.get('/authorize', (req, res) => {
  try {
    const oAuth2Client = getOAuthClient();
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    });
    res.redirect(authUrl);
  } catch (e) {
    res.status(500).send(`❌ ${e.message}`);
  }
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('❌ No code found in callback URL.');

  try {
    const oAuth2Client = getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Tokens stored in token.json');
    res.send('✅ Authorization successful. Tokens saved.');
  } catch (error) {
    console.error('❌ Error retrieving access token:', error);
    res.status(500).send('Error retrieving access token.');
  }
});

app.get('/emails', async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH)) {
      return res.status(400).send('❌ Not authorized yet. Visit /authorize first.');
    }
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const oAuth2Client = getOAuthClient();
    oAuth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const response = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
    const messages = response.data.messages || [];

    const details = await Promise.all(messages.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload.headers || [];
      const getH = (n) => (headers.find(h => h.name === n) || {}).value || '';
      return {
        id: m.id,
        subject: getH('Subject'),
        from: getH('From'),
        date: getH('Date'),
        snippet: msg.data.snippet || ''
      };
    }));

    res.json(details);
  } catch (err) {
    console.error('❌ Failed to fetch emails:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
