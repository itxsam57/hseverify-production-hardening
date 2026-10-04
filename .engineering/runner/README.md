# Private CI runner
Engineering Factory's reusable workflow invokes the approved npm run test:masterplan-reassessment-browser command. Masterplan completion QA owns triggers and calls it. Existing jobs own runtime, lint/type and other browser gates. Artifacts retain exact GITHUB_SHA and command exit; only the manager advances CURRENT_TASK.json.
