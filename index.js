
const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const port = process.env.PORT || 8080;

// Paths
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = process.env.TOKEN_PATH || path.join(__dirname, 'token.json');
const RULES_PATH = path.join(__dirname, 'rules.json');

// ---------- Helpers ----------

function getOAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('Missing credentials.json (Google OAuth Web client JSON).');
  }
  const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
  const credentials = JSON.parse(content);
  const { client_secret, client_id, redirect_uris } = credentials.web;

  // Prefer REDIRECT_URI env, else onrender URL in the list, else first item
  const redirectUri =
    process.env.REDIRECT_URI ||
    (redirect_uris.find((u) => u.includes('onrender.com')) || redirect_uris[0]);

  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

// Load rules.json (array style: [{ name, keywords: [] }, ...])
function loadRules() {
  if (!fs.existsSync(RULES_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(RULES_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse rules.json:', e);
    return [];
  }
}

function bucketByClient(email, rulesArr) {
  const from = (email.from || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  for (const r of rulesArr) {
    const needles = (r.keywords || []).map((k) => String(k).toLowerCase());
    if (needles.some((k) => from.includes(k) || subject.includes(k))) {
      return r.name;
    }
  }
  return 'Unassigned';
}

async function fetchEmailsDetailed(maxResults = 25) {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('Not authorized yet. Visit /authorize first.');
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults
  });
  const messages = response.data.messages || [];

  const details = await Promise.all(
    messages.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload?.headers || [];
      const getH = (n) => (headers.find((h) => h.name === n) || {}).value || '';
      return {
        id: m.id,
        subject: getH('Subject'),
        from: getH('From'),
        date: getH('Date'),
        snippet: msg.data.snippet || ''
      };
    })
  );

  return details;
}

// ---------- Routes ----------

app.get('/', (_req, res) => {
  res.send('📬 Gmail Dashboard Backend is running.');
});

// Start OAuth
app.get('/authorize', (_req, res) => {
  try {
    const oAuth2Client = getOAuthClient();
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.readonly']
    });
    res.redirect(authUrl);
  } catch (e) {
    console.error('Authorize error:', e);
    res.status(500).send('Failed to start authorization.');
  }
});

// OAuth callback
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('❌ No code found in callback URL.');

  try {
    const oAuth2Client = getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Tokens stored at', TOKEN_PATH);
    res.send('✅ Authorization successful. Tokens saved.');
  } catch (e) {
    console.error('❌ Error retrieving access token:', e);
    res.status(500).send('Error retrieving access token.');
  }
});

// Raw emails (detailed)
app.get('/emails', async (_req, res) => {
  try {
    const details = await fetchEmailsDetailed(25);
    res.json(details);
  } catch (err) {
    console.error('❌ Failed to fetch emails:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Group emails by client using rules.json
app.get('/inbox/by-client', async (_req, res) => {
  try {
    const rules = loadRules();
    const emails = await fetchEmailsDetailed(25);
    const grouped = {};
    emails.forEach((e) => {
      const b = bucketByClient(e, rules);
      (grouped[b] ||= []).push(e);
    });
    res.json(grouped);
  } catch (e) {
    console.error('❌ Failed to group emails:', e);
    res.status(500).json({ error: 'Failed to group emails' });
  }
});

// Summary counts per client
app.get('/inbox/summary', async (_req, res) => {
  try {
    const rules = loadRules();
    const emails = await fetchEmailsDetailed(25);
    const counts = {};
    emails.forEach((e) => {
      const b = bucketByClient(e, rules);
      counts[b] = (counts[b] || 0) + 1;
    });
    res.json({ total: emails.length, byClient: counts });
  } catch (e) {
    console.error('❌ Failed to summarize emails:', e);
    res.status(500).json({ error: 'Failed to summarize emails' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
