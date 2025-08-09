const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
app.use(express.static(__dirname));
const PORT = process.env.PORT || 8080;

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = process.env.TOKEN_PATH || path.join(__dirname, 'token.json');
const RULES_PATH = path.join(__dirname, 'rules.json');

let CLIENT_RULES = [];
try {
  if (fs.existsSync(RULES_PATH)) {
    const raw = fs.readFileSync(RULES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) CLIENT_RULES = parsed;
  }
} catch (e) {
  console.warn('⚠️ Could not read/parse rules.json:', e.message);
}

function getOAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('Missing credentials.json beside index.js');
  }
  const content = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_secret, client_id, redirect_uris } = content.web || content.installed || {};
  if (!client_id || !client_secret || !redirect_uris?.length) {
    throw new Error('Invalid credentials.json: client_id/client_secret/redirect_uris required');
  }
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function ensureAuthedClient() {
  const oAuth2Client = getOAuthClient();
  if (!fs.existsSync(TOKEN_PATH)) {
    const err = new Error('Not authorized yet. Visit /authorize first.');
    err.status = 401;
    throw err;
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oAuth2Client.setCredentials(tokens);
  return oAuth2Client;
}

function classifyEmail(email) {
  const hay = `${email.subject || ''} ${email.from || ''} ${email.snippet || ''}`.toLowerCase();
  for (const rule of CLIENT_RULES) {
    const keys = (rule.keywords || []).map(String);
    if (keys.some(k => hay.includes(k.toLowerCase()))) {
      return rule.name || 'Unassigned';
    }
  }
  return 'Unassigned';
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/authorize', (req, res) => {
  try {
    const oAuth2Client = getOAuthClient();
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.readonly']
    });
    res.redirect(authUrl);
  } catch (e) {
    console.error('Authorize error:', e);
    res.status(500).send('Authorize error: ' + e.message);
  }
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('❌ No code in callback URL.');
  try {
    const oAuth2Client = getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    res.send('✅ Authorization successful. Tokens saved.');
    console.log('✅ Token saved to', TOKEN_PATH);
  } catch (e) {
    console.error('Token exchange error:', e);
    res.status(500).send('Error retrieving access token.');
  }
});

app.get('/emails', async (_req, res) => {
  try {
    const auth = await ensureAuthedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const listResp = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50
    });

    const messages = listResp.data.messages || [];
    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
        const headers = msg.data.payload?.headers || [];
        const getH = (n) => (headers.find(h => h.name?.toLowerCase() === n.toLowerCase()) || {}).value || '';
        return {
          id: m.id,
          subject: getH('subject'),
          from: getH('from'),
          date: getH('date'),
          snippet: msg.data.snippet || ''
        };
      })
    );

    res.json(details);
  } catch (e) {
    console.error('❌ Failed to fetch emails:', e);
    res.status(e.status || 500).json({ error: 'Failed to fetch emails' });
  }
});

app.get('/inbox/by-client', async (_req, res) => {
  try {
    const auth = await ensureAuthedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const listResp = await gmail.users.messages.list({ userId: 'me', maxResults: 50 });
    const messages = listResp.data.messages || [];

    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
        const headers = msg.data.payload?.headers || [];
        const getH = (n) => (headers.find(h => h.name?.toLowerCase() === n.toLowerCase()) || {}).value || '';
        return {
          id: m.id,
          subject: getH('subject'),
          from: getH('from'),
          date: getH('date'),
          snippet: msg.data.snippet || ''
        };
      })
    );

    const grouped = details.reduce((acc, d) => {
      const bucket = classifyEmail(d);
      (acc[bucket] ||= []).push(d);
      return acc;
    }, {});

    res.json(grouped);
  } catch (e) {
    console.error('❌ Failed to group emails:', e);
    res.status(e.status || 500).json({ error: 'Failed to group emails' });
  }
});

app.get('/inbox/summary', async (_req, res) => {
  try {
    const auth = await ensureAuthedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const listResp = await gmail.users.messages.list({ userId: 'me', maxResults: 50 });
    const messages = listResp.data.messages || [];

    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
        const headers = msg.data.payload?.headers || [];
        const getH = (n) => (headers.find(h => h.name?.toLowerCase() === n.toLowerCase()) || {}).value || '';
        return {
          id: m.id,
          subject: getH('subject'),
          from: getH('from'),
          date: getH('date'),
          snippet: msg.data.snippet || ''
        };
      })
    );

    const byClient = details.reduce((acc, d) => {
      const bucket = classifyEmail(d);
      acc[bucket] = (acc[bucket] || 0) + 1;
      return acc;
    }, {});
    res.json({ total: details.length, byClient });
  } catch (e) {
    console.error('❌ Failed to summarize emails:', e);
    res.status(e.status || 500).json({ error: 'Failed to summarize emails' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
