import schedule from 'node-schedule';
import { getUpcomingMeetings } from '../lib/firebase/schedule';

export default class MeetingScheduler {
  private task: schedule.Job;

  constructor() {
    this.task = schedule.scheduleJob('*/1 * * * *', this.job.bind(this));
  }

  private async job() {
    try {
      const today = new Date();
      const indianTime = today.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      // Format current IST date as YYYY-MM-DD (e.g., "2025-04-25")
      const currentISTDate = today.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).split('/').reverse().join('-'); // Converts DD/MM/YYYY to YYYY-MM-DD

      // Format current IST time as HH:MM (24-hour, e.g., "22:15")
      const currentISTTime = today.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }).slice(0, 5); // Extracts "HH:MM"

      // Fetch upcoming meetings for the current date and time
      const meetings = await getUpcomingMeetings(currentISTDate, currentISTTime);

      // Log current time and matching meetings
      console.log(`Indian time: ${indianTime}`);
      if (meetings.length > 0) {
        console.log(`Upcoming meetings at ${currentISTDate} ${currentISTTime}:`, meetings);
      } else {
        console.log(`No meetings scheduled at ${currentISTDate} ${currentISTTime}`);
      }
    } catch (error) {
      console.error('Error in scheduler job:', error);
    }
  }
}