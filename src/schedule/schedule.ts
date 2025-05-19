// src/schedule/schedule.ts
import schedule from 'node-schedule';
// import { getUpcomingMeetings } from '../lib/firebase/schedule';
import { joinMeeting } from '../controllers/meetingController';
import { JoinRequest } from '../types';

// Mock response and request implementation for non-HTTP context
class MockResponse {
  statusCode: number;
  responseData: any;

  constructor() {
    this.statusCode = 200;
    this.responseData = null;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(data: any) {
    this.responseData = data;
    return this;
  }
}

class MockRequest {
  body: any;

  constructor(body: any) {
    this.body = body;
  }
}

export default class MeetingScheduler {
  private task: schedule.Job;

  constructor() {
    this.task = schedule.scheduleJob('*/1 * * * *', this.job.bind(this));
  }

  private async job() {
    try {
      const today = new Date();
      const indianTime = today
      .toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
      })
      .split(' ')[0];

      const currentISTDate = today
      .toLocaleDateString('en-IN', { 
        timeZone: 'Asia/Kolkata', 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      })
      .split('/')
      .reverse()
      .join('-');

      const currentISTTime = today
  .toLocaleTimeString('en-IN', { 
    timeZone: 'Asia/Kolkata', 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit' 
  })
  .slice(0, 5);

      // let meetings = await getUpcomingMeetings(currentISTDate, currentISTTime);

      // console.log(`Indian time: ${indianTime}`);
      // if (meetings.length > 0) {
      //   // Deduplicate meetings by meetingId
      //   const uniqueMeetingIds = new Set();
      //   meetings = meetings.filter(meeting => {
      //     if (uniqueMeetingIds.has(meeting.meetingId)) {
      //       return false;
      //     }
      //     uniqueMeetingIds.add(meeting.meetingId);
      //     return true;
      //   });

      //   console.log(`Processing ${meetings.length} unique upcoming meetings at ${currentISTDate} ${currentISTTime}:`, meetings);
        
      //   // Process each unique meeting
      //   for (const meeting of meetings) {
      //     await this.processMeeting(meeting);
      //   }
      // } else {
      //   console.log(`No meetings scheduled at ${currentISTDate} ${currentISTTime}`);
      // }
    } catch (error) {
      console.error('Error in scheduler job:', error);
    }
  }

  private async processMeeting(meeting: any) {
    try {
      console.log(`Processing meeting: ${meeting.meetingId}`);
      
      // Create a join request from the meeting data
      // Pass the actual bots array from the meeting data
      const joinRequest: JoinRequest = {
        meetingId: meeting.meetingId,
        password: meeting.password,
        bots: meeting.bots || [], // Use the actual bot objects with their names
        botCount: 0, // Set to 0 to use only the provided bots array
        duration: meeting.duration || 60
      };

      // Debug log to show the actual bot data being passed
      console.log(`Using bots data:`, joinRequest.bots.map(bot => bot.name || `Bot-${bot.id}`));

      // Create mock request and response objects
      const mockReq = new MockRequest({ ...joinRequest });
      const mockRes = new MockResponse();
      
      // Call joinMeeting with the mock objects
      await joinMeeting(mockReq as any, mockRes as any);
      
      // Log the result
      console.log(`Meeting ${meeting.meetingId} processing result:`, 
        mockRes.statusCode, 
        mockRes.responseData
      );
      
      // Optionally update the meeting status in your database
      // await updateMeetingStatus(meeting.id, 'PROCESSING', mockRes.responseData);
      
    } catch (error) {
      console.error(`Error processing meeting ${meeting.meetingId}:`, error);
      // Optionally update meeting status to failed
      // await updateMeetingStatus(meeting.id, 'FAILED', { error: String(error) });
    }
  }
}