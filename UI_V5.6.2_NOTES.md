# v5.6.2

- Added a progress bar to each fleet expedition timer, matching the Nozaki timer concept.
- Added a one-minute early-return window. When <= 60 seconds remain, Success / Great Success can be recorded immediately.
- Early recording ends the local timer and cancels the pending cloud notification so it does not fire again at the old end time.
- Automatic GitHub Pages deployment was disabled because this app is hosted on Vercel. This prevents the repeated Pages 404 failure emails.
- Notification dispatch workflow now skips safely when `CRON_SECRET` is missing and prints the HTTP response when the Vercel endpoint fails.
