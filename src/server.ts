import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import fs from 'fs';
import https from 'https';
import meetingRoutes from './routes/meetingRoutes';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api', meetingRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// SSL certificate op


// SSL certificate options
const options = {
  key: fs.readFileSync(__dirname + '/../ssl/selfsigned.key'),
  cert: fs.readFileSync(__dirname + '/../ssl/selfsigned.crt'),
};
// Create HTTPS server
const server = https.createServer(options, app);

// Start server
server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] HTTPS Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Available routes:`);
  console.log(`[${new Date().toISOString()}] POST: /api/join-meeting - Join Zoom meeting with bots`);
  console.log(`[${new Date().toISOString()}] GET: /health - Health check endpoint`);
});
