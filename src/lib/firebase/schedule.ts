import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where, serverTimestamp, getDoc } from 'firebase/firestore';
import { firestore } from '.';

export interface Bot {
  id: string;
  name: string;
  countryCode: string;
  country?: string;
  status: string; // Changed from string | undefined to string
  flag?: string;
}

export interface Schedule {
  id: string;
  meetingId: string;
  password: string;
  quantity: number;
  duration: number;
  countryCode: string;
  scheduledDate?: string;
  scheduledTime?: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  bots: any;
  userId: string;
  createdAt: any;
  updatedAt?: any;
}

export const previousSchedulesCollection = collection(firestore, 'previousSchedules');
export const upcomingMeetingsCollection = collection(firestore, 'upcomingMeetings');

export const savePreviousSchedule = async (schedule: Omit<Schedule, 'id' | 'createdAt'>): Promise<string> => {
  try {
    const docRef = await addDoc(previousSchedulesCollection, {
      ...schedule,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error('Error saving previous schedule:', error);
    throw error;
  }
};

export const getPreviousSchedules = async (userId: string): Promise<Schedule[]> => {
  try {
    const q = query(
      previousSchedulesCollection,
      where('userId', '==', userId)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Schedule[];
  } catch (error) {
    console.error('Error getting previous schedules:', error);
    throw error;
  }
};

export const saveUpcomingMeeting = async (meeting: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  try {
    const normalizedBots = meeting.bots.map((bot:any) => ({
      id: bot.id,
      name: bot.name,
      countryCode: bot.countryCode,
      country: bot.country || '',
      status: bot.status || 'Ready',
      flag: bot.flag || ''
    }));

    const docRef = await addDoc(upcomingMeetingsCollection, {
      ...meeting,
      bots: normalizedBots,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error('Error saving upcoming meeting:', error);
    throw error;
  }
};

export const getUpcomingMeetings = async (date: string, time: string): Promise<Schedule[]> => {
    try {
      const q = query(
        upcomingMeetingsCollection,
        where('scheduledDate', '==', date),
        where('scheduledTime', '==', time),
        where('status', 'in', ['scheduled'])
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Schedule[];
    } catch (error) {
      console.error('Error getting upcoming meetings:', error);
      throw error;
    }
  };

export const updateUpcomingMeeting = async (meetingId: string, updates: Partial<Omit<Schedule, 'id'>>): Promise<void> => {
  try {
    const meetingRef = doc(upcomingMeetingsCollection, meetingId);
    await updateDoc(meetingRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating upcoming meeting:', error);
    throw error;
  }
};

export const deleteUpcomingMeeting = async (meetingId: string): Promise<void> => {
  try {
    const meetingRef = doc(upcomingMeetingsCollection, meetingId);
    await deleteDoc(meetingRef);
  } catch (error) {
    console.error('Error deleting upcoming meeting:', error);
    throw error;
  }
};

export const getMeetingById = async (meetingId: string): Promise<Schedule | null> => {
  try {
    const meetingRef = doc(upcomingMeetingsCollection, meetingId);
    const meetingSnap = await getDoc(meetingRef);
    if (meetingSnap.exists()) {
      return { id: meetingSnap.id, ...meetingSnap.data() } as Schedule;
    }
    return null;
  } catch (error) {
    console.error('Error fetching meeting by ID:', error);
    throw error;
  }
};

export const getAllUpcomingMeetings = async (): Promise<Schedule[]> => {
  try {
    const querySnapshot = await getDocs(upcomingMeetingsCollection);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Schedule[];
  } catch (error) {
    console.error('Error getting all upcoming meetings:', error);
    throw error;
  }
};

export const completeUpcomingMeeting = async (meetingId: string): Promise<void> => {
  try {
    const meeting = await getMeetingById(meetingId);
    if (!meeting) throw new Error('Meeting not found');

    await updateUpcomingMeeting(meetingId, { status: 'completed' });
    const { id, ...meetingWithoutId } = meeting;
    await savePreviousSchedule({
      ...meetingWithoutId,
      status: 'completed'
    });
  } catch (error) {
    console.error('Error completing upcoming meeting:', error);
    throw error;
  }
};