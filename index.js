const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const port = process.env.PORT || 8080;

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const RULES_PATH = path.join(__dirname, 'rules.json');

// Load client rules
let CLIENT_RULES = {};
if (fs.existsSync(RULES_PATH)) {
  CLIENT_RULES = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
}

const content = fs.readFileSync(CREDENTIALS_PATH);
const credentials = JSON.parse(content);
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

function classifyEmail(email) {
  const fromLower = email.from.toLowerCase();
  for (const [client, patterns] of Object.entries(CLIENT_RULES)) {
    if (patterns.some(p => fromLower.includes(p.toLowerCase()) || email.subject.toLowerCase().includes(p.toLowerCase()))) {
      return client;
    }
  }
  return 'Unassigned';
}

async function ensureAuthedClient() {
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('No token.json found. Please authorize first.');
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

app.get('/', (req, res) => {
  res.send('📬 Gmail Dashboard Backend is running.');
});

app.get('/authorize', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('❌ No code found in callback URL.');
  }
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send('✅ Authorization successful. Tokens saved.');
    console.log('✅ Tokens stored in token.json');
  } catch (error) {
    console.error('❌ Error retrieving access token:', error);
    res.status(500).send('Error retrieving access token.');
  }
});

// Diagnostic endpoint
app.get('/_diag', (_req, res) => {
  try {
    let rulesCount = Array.isArray(CLIENT_RULES) ? CLIENT_RULES.length : Object.keys(CLIENT_RULES || {}).length;
    res.json({
      cwd: process.cwd(),
      tokenPath: TOKEN_PATH,
      tokenExists: fs.existsSync(TOKEN_PATH),
      rulesPath: RULES_PATH,
      rulesExists: fs.existsSync(RULES_PATH),
      rulesCount
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Test grouping endpoint
app.get('/inbox/test', async (_req, res) => {
  try {
    const auth = await ensureAuthedClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const listResp = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
    const messages = listResp.data.messages || [];

    const details = await Promise.all(messages.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload?.headers || [];
      const getH = (n) => (headers.find(h => h.name?.toLowerCase() === n.toLowerCase()) || {}).value || '';
      const email = {
        id: m.id,
        subject: getH('subject'),
        from: getH('from'),
        date: getH('date'),
        snippet: msg.data.snippet || ''
      };
      return { ...email, bucket: classifyEmail(email) };
    }));

    res.json(details);
  } catch (e) {
    console.error('❌ /inbox/test error:', e);
    res.status(e.status || 500).json({ error: 'Failed to run test' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
