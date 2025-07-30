const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');
const http = require('http');
const url = require('url');
const readline = require('readline');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  
  // Load credentials from file
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  // Create OAuth2 client with explicit redirect URI
  const oauth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    'http://localhost:3000/oauth2callback'
  );
  
  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  
  console.log('Authorize this app by visiting this url:', authUrl);
  
  // Start local server to handle callback
  const server = http.createServer(async (req, res) => {
    try {
      const queryObject = url.parse(req.url, true).query;
      const code = queryObject.code;
      
      if (code) {
        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        
        // Save credentials
        await saveCredentials(oauth2Client);
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');
        
        // Close server after successful auth
        server.close();
        return oauth2Client;
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Authentication failed!</h1>');
      server.close();
    }
  });
  
  // Start server on port 3000
  server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
  
  // Wait for authentication to complete
  return new Promise((resolve, reject) => {
    server.on('close', () => {
      resolve(oauth2Client);
    });
  });
}

/**
 * Lists the events for the current day on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listEvents(auth) {
  const calendar = google.calendar({version: 'v3', auth});
  
  // Get start and end of current day
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });
  
  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log('No events found for today.');
    return;
  }
  
  console.log(`Today's agenda (${startOfDay.toLocaleDateString()}):`);
  events.map((event, i) => {
    const start = event.start.dateTime || event.start.date;
    const startTime = new Date(start);
    const timeString = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    console.log(`${timeString} - ${event.summary}`);
  });
}

authorize().then(listEvents).catch(console.error);