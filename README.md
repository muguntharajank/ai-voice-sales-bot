# AI Voice Sales Bot — Sankar Group

## Run locally
1. Install Python 3.11 or newer.
2. Extract the zip and open a terminal in this folder.
3. Run `python -m venv .venv`
4. Windows: `.venv\\Scripts\\activate` (PowerShell: `.venv\\Scripts\\Activate.ps1`)
5. Run `pip install -r requirements.txt`
6. Copy `.env.example` to `.env`.
7. For actual LLM-generated replies and summaries, create a Gemini API key in Google AI Studio and set `GEMINI_API_KEY` in `.env`. Keep it server-side; never add it to JavaScript or commit it.
8. Run `python manage.py migrate`
9. Run `python manage.py runserver`
10. Open http://127.0.0.1:8000 in Chrome or Edge and allow microphone access.

## What works
- Django web app and SQLite call history
- Browser speech recognition and spoken AI replies (speech support varies by browser)
- Live transcript, Start/End controls and timer
- Customer consent checkbox and microphone audio recording
- Recording upload and playback
- AI summary/status when Gemini API key is configured
- A rule-based fallback for interface testing when no key is configured

## Honest limitations
- Without a Gemini key, the app is not using a real LLM; the fallback is rule-based. To meet the assignment's AI requirement, obtain a free-tier key if eligible and configure it.
- Browser SpeechRecognition is not supported consistently across all browsers. Chrome/Edge are recommended.
- Current recording captures microphone audio and may not contain the AI's synthesized audio. Verify the recording. For a complete two-way recording, record/mix both tracks or use a voice API with recording support.
- This is an MVP, not production-secure. Views are CSRF-exempt to speed up local testing; add authentication, CSRF protection, user-level authorization, secure recording storage, retention controls, and production database settings before real customer use.
- Hosting must support persistent database/media storage, or recordings/history can be lost on redeploy. HTTPS is required for microphone access on a deployed site.
