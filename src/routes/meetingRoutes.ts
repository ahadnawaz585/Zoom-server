import express from 'express';
import { joinMeeting } from '../controllers/meetingController';

const router = express.Router();

router.post('/join-meeting', joinMeeting);

export default router;
