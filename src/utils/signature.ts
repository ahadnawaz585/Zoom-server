import { KJUR } from 'jsrsasign';

const signatureCache = new Map<string, { signature: string; expires: number }>();

export  const generateSignature = async(
  meetingNumber: string,
  role: number = 0,
  duration: number = 60 
): Promise<string> => {
  console.log(`[${new Date().toISOString()}] Generating signature for meeting ${meetingNumber}`);
  const cacheKey = `${meetingNumber}-${role}-${duration}`;
  const now = Date.now() / 1000;

  const iat = Math.round(now) - 30;
  const exp = iat + duration * 60; // duration in minutes -> seconds

  const cached = signatureCache.get(cacheKey);
  if (cached && cached.expires > now) return cached.signature;

  const { NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY, NEXT_PUBLIC_ZOOM_MEETING_SDK_SECRET } = process.env;
  if (!NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY || !NEXT_PUBLIC_ZOOM_MEETING_SDK_SECRET) {
    console.error(`[${new Date().toISOString()}] Zoom SDK credentials missing`);
    throw new Error('Zoom SDK credentials not configured');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    appKey: NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY,
    sdkKey: NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
  };

  const signature = await KJUR.jws.JWS.sign('HS256', JSON.stringify(header), JSON.stringify(payload), NEXT_PUBLIC_ZOOM_MEETING_SDK_SECRET);
  signatureCache.set(cacheKey, { signature, expires: exp });
  console.log(`[${new Date().toISOString()}] New signature generated for ${meetingNumber} with expiry in ${duration} minutes`);
  return signature;
};
