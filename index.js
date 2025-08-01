const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');
const http = require('http');
const url = require('url');
const readline = require('readline');
const { exec } = require('child_process');
const schedule = require('node-schedule');

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
 * Prints text to the thermal printer via serial port
 * @param {string} text The text to print
 */
function printToThermalPrinter(text) {
  // Check if we're on a system with serial port (Raspberry Pi)
  const isDevelopment = process.platform === 'darwin'; // macOS
  
  if (isDevelopment) {
    console.log('=== THERMAL PRINTER OUTPUT (Development Mode) ===');
    console.log(text.replace(/\\n/g, '\n'));
    console.log('=== END THERMAL PRINTER OUTPUT ===');
    console.log('(This would print to thermal printer on Raspberry Pi)');
    return;
  }
  
  // Production mode - print to actual thermal printer
  exec('stty -F /dev/serial0 19200', (error) => {
    if (error) {
      console.error('Error setting baud rate:', error);
      return;
    }
    
    // Print the text to the serial port
    exec(`echo "${text}" > /dev/serial0`, (error) => {
      if (error) {
        console.error('Error printing to thermal printer:', error);
      } else {
        console.log('Successfully printed to thermal printer');
      }
    });
  });
}

/**
 * Lists the events for the current day and prints them to the thermal printer.
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
    const noEventsText = `\\n\\nTODAY'S AGENDA\\n${startOfDay.toLocaleDateString()}\\n\\nNo events scheduled\\n\\n\\n\\n`;
    printToThermalPrinter(noEventsText);
    return;
  }
  
  // Format the agenda for thermal printing
  let agendaText = `\\n\\nTODAY'S AGENDA\\n${startOfDay.toLocaleDateString()}\\n\\n`;
  
  events.forEach((event, i) => {
    const start = event.start.dateTime || event.start.date;
    const startTime = new Date(start);
    
    // Convert to MST (Mountain Standard Time)
    const mstTime = new Date(startTime.toLocaleString("en-US", {timeZone: "America/Denver"}));
    const timeString = mstTime.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'America/Denver'
    });
    
    const eventSummary = event.summary || 'No title';
    
    agendaText += `${timeString} - ${eventSummary}\\n`;
  });
  
  agendaText += `\\n\\n\\n\\n`; // Add extra newlines for paper feed
  
  // Print to console
  console.log(`Today's agenda (${startOfDay.toLocaleDateString()}):`);
  events.forEach((event, i) => {
    const start = event.start.dateTime || event.start.date;
    const startTime = new Date(start);
    
    // Convert to MST (Mountain Standard Time)
    const mstTime = new Date(startTime.toLocaleString("en-US", {timeZone: "America/Denver"}));
    const timeString = mstTime.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'America/Denver'
    });
    
    console.log(`${timeString} - ${event.summary}`);
  });
  
  // Print to thermal printer
  printToThermalPrinter(agendaText);
}

/**
 * Schedules the agenda printing job
 */
function scheduleAgendaPrinting() {
  // Schedule to run every weekday (Monday-Friday) at 8:00 AM MST
  const job = schedule.scheduleJob('0 8 * * 1-5', async () => {
    console.log('Running scheduled agenda print job...');
    try {
      const auth = await authorize();
      await listEvents(auth);
    } catch (error) {
      console.error('Error in scheduled job:', error);
    }
  });
  
  console.log('Agenda printing scheduled for weekdays at 8:00 AM MST');
  console.log('Press Ctrl+C to stop the scheduler');
  
  // Keep the process running
  process.on('SIGINT', () => {
    console.log('Stopping scheduler...');
    job.cancel();
    process.exit(0);
  });
}

// Check if we should run immediately or schedule
const args = process.argv.slice(2);
console.log('Command line arguments:', args);

if (args.includes('--now') || args.includes('-n')) {
  console.log('Running immediately with --now flag');
  // Run immediately
  authorize().then(listEvents).catch(console.error);
} else {
  console.log('Starting scheduler (no --now flag detected)');
  // Schedule for weekdays at 8am MST
  scheduleAgendaPrinting();
}