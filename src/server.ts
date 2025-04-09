// src/server.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import schedule from 'node-schedule';
import meetingRoutes from './routes/meetingRoutes';
import meetingScheduler from './schedule/schedule';

// Load environment variables
dotenv.config();

class Server {
  private app: Express;
  private port: string | number;
  private scheduler: meetingScheduler;
  constructor() {
    this.app = express();

    this.port = process.env.PORT || 3000;

    // Initialize middleware
    this.configureMiddleware();

    // Initialize routes
    this.configureRoutes();
    this.scheduler = new meetingScheduler();
    // Start scheduled tasks
  }

  private configureMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(morgan('dev'));
  }

  private configureRoutes(): void {
    this.app.use('/api', meetingRoutes);

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    });
  }

  public start(): void {
    this.app.listen(this.port, () => {
      console.log(`[${new Date().toISOString()}] Server running on port ${this.port}`);
      console.log(`[${new Date().toISOString()}] Available routes:`);
      console.log(`[${new Date().toISOString()}] POST: /api/join-meeting - Join Zoom meeting with bots`);
      console.log(`[${new Date().toISOString()}] GET: /health - Health check endpoint`);
    });
  }
}

// Instantiate and start the server
const server = new Server();
server.start();

export default Server;