// File: README.md
# Zoom Meeting Bot Express Server

A Node.js Express server for programmatically joining Zoom meetings with multiple browser-based bots.

## Features

- Join Zoom meetings with multiple bots using different browser engines (Chromium, Firefox, WebKit)
- Distribute bots across browser types for better performance
- Worker thread implementation for concurrent processing
- Caching for Zoom meeting signatures

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with your Zoom SDK credentials:
   ```
   NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY=your_zoom_sdk_key
   NEXT_PUBLIC_ZOOM_MEETING_SDK_SECRET=your_zoom_sdk_secret
   NEXT_PUBLIC_CLIENT_URL=http://your-client-url
   ```

## Usage

### Development

```
npm run dev
```

### Production

```
npm run build
npm start
```

## API Endpoints

### POST /api/join-meeting

Join a Zoom meeting with bots.

#### Request Body

```json
{
  "bots": [
    {
      "id": 1,
      "name": "Bot1",
      "status": "ready"
    }
  ],
  "meetingId": "your-zoom-meeting-id",
  "password": "meeting-password",
  "botCount": 10,
  "duration": 60
}
```

#### Response

```json
{
  "success": true,
  "message": "10/10 bots joined",
  "failures": [],
  "browserStats": {
    "chromium": {
      "total": 4,
      "successes": 4
    },
    "firefox": {
      "total": 3,
      "successes": 3
    },
    "webkit": {
      "total": 3,
      "successes": 3
    }
  }
}
```

## Requirements

- Node.js 16+
- Playwright browsers (installed automatically)
- Zoom SDK credentials
