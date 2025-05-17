---
trigger: model_decision
description: If no other preceded has been set (e.g. other files int he same folder), follow these principles
---

The POWR project has consistently used npm as its package manager since the beginning of the project, as evidenced by the presence of package-lock.json and absence of yarn.lock. All package management operations should continue to use npm to maintain consistency and avoid dependency conflicts. This aligns with the user's general preference for npm.

Always run `taskkill /f /im node.exe` before running `npx expo start --web` or `npx expo start --web --clear`

Do not create code duplications. Look for more elegant solutions.

Use camelCase for files in this project, other than *.md files.