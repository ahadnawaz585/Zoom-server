import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
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


// Start server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Available routes:`);
  console.log(`[${new Date().toISOString()}] POST: /api/join-meeting - Join Zoom meeting with bots`);
  console.log(`[${new Date().toISOString()}] GET: /health - Health check endpoint`);
});