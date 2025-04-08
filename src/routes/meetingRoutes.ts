import express from 'express';
import { joinMeeting } from '../controllers/meetingController';
import { health } from '../controllers/health';

const router = express.Router();

  router.get('/health',health)
router.post('/join-meeting', joinMeeting);

export default router;
